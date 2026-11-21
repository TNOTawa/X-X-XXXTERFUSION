"""Loopback-only experiment server. Original MP4 is streamed in place, never copied."""
import argparse
import json
import mimetypes
import re
import socket
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {
    "/": "index.html", "/index.html": "index.html", "/style.css": "style.css",
    "/calibration.mjs": "calibration.mjs",
    "/sample-audio.mjs": "sample-audio.mjs", "/data/audio-manifest.json": "data/audio-manifest.json",
    "/data/drum-atlas.wav": "data/drum-atlas.wav",
    "/scoring.mjs": "scoring.mjs", "/leaderboard.mjs": "leaderboard.mjs", "/player.mjs": "player.mjs",
    "/app.mjs": "app.mjs", "/core.mjs": "core.mjs", "/data/chart.json": "data/chart.json",
    "/data/alignment.json": "data/alignment.json", "/data/alignment.png": "data/alignment.png",
}


def parse_byte_range(header, size):
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not match or not any(match.groups()) or size <= 0:
        raise ValueError("Invalid byte range")
    first, last = match.groups()
    if not first:
        length = int(last)
        if length <= 0:
            raise ValueError("Invalid suffix length")
        return max(0, size-length), size-1
    start = int(first)
    end = min(int(last), size-1) if last else size-1
    if start >= size or end < start:
        raise ValueError("Unsatisfiable byte range")
    return start, end


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, video_path, backing_path=None, **kwargs):
        self.video_path = video_path
        self.backing_path = backing_path
        super().__init__(*args, **kwargs)

    def do_HEAD(self):
        self.serve(head_only=True)

    def do_GET(self):
        self.serve(head_only=False)

    def serve(self, head_only):
        path = urlsplit(self.path).path
        if path == "/api/local-status":
            payload = json.dumps({"videoAvailable": self.video_path.is_file(), "videoName": self.video_path.name,
                                  "originalAudio": False, "backingAvailable": bool(self.backing_path and self.backing_path.is_file()),
                                  "hitSamplesAvailable": (ROOT / "data/drum-atlas.wav").is_file()}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if not head_only:
                self.wfile.write(payload)
            return
        if path == "/media/pv.mp4":
            file = self.video_path
            mime = "video/mp4"
        elif path == "/media/backing.wav" and self.backing_path:
            file = self.backing_path
            mime = "audio/wav"
        elif path in PUBLIC_FILES:
            file = ROOT / PUBLIC_FILES[path]
            mime = "text/javascript" if file.suffix == ".mjs" else mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        else:
            self.send_error(404)
            return
        if not file.is_file():
            self.send_error(404, "Configured media or public file not found")
            return
        size = file.stat().st_size
        start, end = 0, size-1
        partial_content = False
        if self.headers.get("Range"):
            try:
                start, end = parse_byte_range(self.headers["Range"], size)
                partial_content = True
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self.send_response(206 if partial_content else 200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(max(0, end-start+1)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if partial_content:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return
        try:
            with file.open("rb") as stream:
                stream.seek(start)
                remaining = end-start+1
                while remaining > 0:
                    block = stream.read(min(256*1024, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Video seeking cancels an in-flight range request normally.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--video", type=Path)
    parser.add_argument("--config", type=Path, default=ROOT / "media.local.json")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    rendered=Path(config["renderedVideo"]) if config.get("renderedVideo") else None
    video = args.video or (rendered if rendered and rendered.is_file() else Path(config["video"]))
    backing = Path(config["backing"]).resolve()
    if not backing.is_file():
        parser.error(f"Backing does not exist: {backing}")
    video = video.resolve()
    if not video.is_file():
        parser.error(f"Video does not exist: {video}")
    server = LocalServer(("127.0.0.1", args.port), partial(Handler, video_path=video, backing_path=backing))
    print(f"Xterfusion local experiment: http://127.0.0.1:{args.port}", flush=True)
    print("Streaming configured PV (rendered overlay when available) and replacement backing. Ctrl+C stops the server.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
