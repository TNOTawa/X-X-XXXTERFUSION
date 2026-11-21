"""Build a small original-drum atlas, preserving all supplied source files."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal


def build_atlas(source, sample_rate, notes, all_onsets_ms, offset_ms=14, attack_lead_ms=12):
    if source.ndim == 1:
        source = source[:, None]
    onset_starts = sorted(set(round((t+offset_ms-attack_lead_ms)*sample_rate/1000) for t in all_onsets_ms))
    chunks, cues, cursor = [], {}, 0
    gap = np.zeros((round(.005*sample_rate), source.shape[1]), dtype=np.float32)
    for note in notes:
        start = max(0, round((note["midiMs"]+offset_ms-attack_lead_ms)*sample_rate/1000))
        following = next((frame for frame in onset_starts if frame > start), len(source))
        end = min(start+round(.280*sample_rate), following-round(.002*sample_rate), len(source))
        if end-start < round(.015*sample_rate):
            raise ValueError(f"Sample is too short or outside source: {note['id']}")
        clip = source[start:end].copy()
        fade_in = min(round(.001*sample_rate), len(clip)//4)
        fade_out = min(round(.006*sample_rate), len(clip)//4)
        if fade_in:
            clip[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)[:, None]
        if fade_out:
            clip[-fade_out:] *= np.linspace(1, 0, fade_out, dtype=np.float32)[:, None]
        cues[note["id"]] = {"offsetSeconds": cursor/sample_rate, "durationSeconds": len(clip)/sample_rate,
                            "sourceStartSeconds": start/sample_rate}
        chunks.extend((clip, gap))
        cursor += len(clip)+len(gap)
    atlas = np.concatenate(chunks)
    # A single attenuation factor preserves the original dynamics between hits.
    peak = float(np.max(np.abs(atlas)))
    if peak > .95:
        atlas *= .95/peak
    return atlas, cues


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def measure_file_delay(video, wave, start, duration=5, sample_rate=44100):
    command = [shutil.which("ffmpeg") or "ffmpeg", "-v", "error", "-ss", str(start), "-i", str(video),
               "-t", str(duration), "-vn", "-ar", str(sample_rate), "-ac", "1", "-f", "f32le", "pipe:1"]
    original = np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype="<f4")
    with sf.SoundFile(wave) as source:
        if source.samplerate != sample_rate:
            raise ValueError("Alignment check expects the provided 44100 Hz WAV")
        source.seek(round(start*sample_rate))
        replacement = source.read(len(original), dtype="float32", always_2d=True).mean(axis=1)
    a, b = original-original.mean(), replacement-replacement.mean()
    correlation = signal.correlate(b, a, mode="full", method="fft")
    lags = signal.correlation_lags(len(b), len(a), mode="full")
    mask = np.abs(lags) <= sample_rate//4
    best = int(np.argmax(correlation[mask]))
    return {"videoStartSeconds": start, "fileDelayMs": round(float(lags[mask][best])/sample_rate*1000, 6),
            "correlation": round(float(correlation[mask][best]/np.sqrt(np.dot(a,a)*np.dot(b,b))), 6)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("media.local.json"))
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    inputs = {key: Path(config[key]) for key in ("video", "midi", "backing", "drums")}
    before = {key: file_hash(path) for key,path in inputs.items()}
    chart = json.loads(Path("data/chart.json").read_text(encoding="utf-8"))
    alignment = json.loads(Path("data/alignment.json").read_text(encoding="utf-8"))
    checks = [measure_file_delay(inputs["video"], inputs["backing"], t) for t in (65,105)]
    if any(row["correlation"] < .95 or abs(row["fileDelayMs"]) > 10 for row in checks):
        raise ValueError(f"Backing does not match the original PV timeline: {checks}")
    drum_checks = [measure_file_delay(inputs["video"], inputs["drums"], t) for t in (65,105)]
    if any(abs(row["fileDelayMs"]) > 10 for row in drum_checks):
        raise ValueError(f"Drum stem needs a separate offset: {drum_checks}")
    source, sample_rate = sf.read(inputs["drums"], dtype="float32", always_2d=True)
    all_rounds = chart["rounds"] + chart.get("challengeRounds", [])
    notes = [note for r in all_rounds for note in r["notes"]]
    all_onsets = [note["midiMs"] for r in all_rounds for note in r["demoNotes"]+r["notes"]]
    atlas, cues = build_atlas(source, sample_rate, notes, all_onsets, alignment["offsetMs"])
    # Tail hits retain the original backing as a guide. Keep feedback quieter to
    # avoid doubling the perceived loudness during the sustained rapid section.
    for note in notes:
        if note["id"].startswith("tail-"):
            cues[note["id"]]["gain"] = .35
    sf.write("data/drum-atlas.wav", atlas, sample_rate, subtype="PCM_16")
    after = {key: file_hash(path) for key,path in inputs.items()}
    if before != after:
        raise RuntimeError("A source file changed while audio assets were being prepared")
    manifest = {"version": 3, "backingUrl": "/media/backing.wav", "atlasUrl": "/data/drum-atlas.wav",
                "backingName": inputs["backing"].name, "stemName": inputs["drums"].name,
                "backingOffsetMs": round(float(np.median([x["fileDelayMs"] for x in checks]))),
                "backingAlignmentChecks": checks, "stemAlignmentChecks": drum_checks,
                "sampleRate": sample_rate, "atlasDurationSeconds": len(atlas)/sample_rate,
                "sampleCount": len(cues), "attackLeadMs": 12, "maxSliceMs": 280,
                "cues": cues, "sourceSha256": before, "sourcesUnchanged": before == after}
    Path("data/audio-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"samples": len(cues), "atlasSeconds": round(len(atlas)/sample_rate,3),
                      "atlasBytes": Path("data/drum-atlas.wav").stat().st_size,
                      "backingChecks": checks, "sourcesUnchanged": True}, ensure_ascii=False))

if __name__ == "__main__":
    main()
