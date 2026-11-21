"""Estimate MIDI-to-PV offset from audio attacks, without modifying either asset."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from scipy import ndimage, signal


def estimate_offset(times, flux, events, minimum=-6, maximum=6, step=.002):
    if not len(events):
        raise ValueError("At least one target onset is required")
    shifts = np.arange(minimum, maximum + step/2, step)
    scores = np.array([np.interp(events + shift, times, flux, left=0, right=0).mean() for shift in shifts])
    best = int(np.argmax(scores))
    peaks, _ = signal.find_peaks(scores, distance=max(1, round(.10/step)))
    candidates = sorted(peaks, key=lambda index: scores[index], reverse=True)[:8]
    return float(shifts[best]), float(scores[best]), [
        {"offsetMs": round(float(shifts[i])*1000, 3), "score": round(float(scores[i]), 6)} for i in candidates]


def novelty(audio, sample_rate, window):
    hop = window//8
    frequencies, times, spectrum = signal.stft(audio, fs=sample_rate, nperseg=window,
                                              noverlap=window-hop, boundary="zeros")
    amplitude = np.abs(spectrum[(frequencies >= 70) & (frequencies <= 9000)])
    amplitude = np.log1p(amplitude/(np.median(amplitude, axis=1, keepdims=True)+1e-5))
    flux = np.maximum(np.diff(amplitude, axis=1, prepend=amplitude[:, :1]), 0).mean(axis=0)
    flux = ndimage.gaussian_filter1d(flux, .6)
    flux /= ndimage.maximum_filter1d(flux, max(3, round(1.16*sample_rate/hop)))+1e-6
    return times, flux


def analyze(video, chart):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required on PATH")
    end_seconds = chart["rounds"][-1]["endMs"]/1000+10
    result = subprocess.run([ffmpeg, "-v", "error", "-i", str(video), "-vn", "-t", str(end_seconds),
                             "-ac", "1", "-ar", "22050", "-f", "f32le", "pipe:1"], capture_output=True, check=True)
    audio = np.frombuffer(result.stdout, dtype="<f4")
    events = np.array(sorted(note["midiMs"]/1000 for r in chart["rounds"] for note in r["demoNotes"]+r["notes"]))
    detectors = []
    primary = None
    for window in (512, 1024):
        times, flux = novelty(audio, 22050, window)
        offset, score, candidates = estimate_offset(times, flux, events)
        detectors.append({"windowSamples": window, "hopSamples": window//8, "offsetMs": round(offset*1000, 3),
                          "score": round(score, 6), "candidates": candidates})
        if window == 1024:
            primary = (times, flux, offset)
    recommended = round(float(np.median([item["offsetMs"] for item in detectors])))
    times, flux, global_offset = primary
    round_evidence = []
    for r in chart["rounds"]:
        targets = np.array([n["midiMs"]/1000 for n in r["demoNotes"]+r["notes"]])
        local_offset, local_score, _ = estimate_offset(times, flux, targets, global_offset-.10, global_offset+.10, .001)
        clear = local_score >= .50 and abs(local_offset-global_offset) <= .025
        round_evidence.append({"round": r["id"], "offsetMs": round(local_offset*1000, 3),
                               "score": round(local_score, 6), "reliable": bool(clear)})
    accepted = [r["offsetMs"] for r in round_evidence if r["reliable"]]
    report = {"version": 1, "offsetMs": recommended,
              "equation": "videoMs = midiMs + offsetMs", "videoName": Path(video).name,
              "method": "Multi-band spectral-flux attack matching across 132 MIDI onsets; two analysis window sizes",
              "limitations": "Attack-peak estimate, not sample-accurate origin or device/input latency. Original response audio retained.",
              "searchRangeMs": [-6000, 6000], "detectors": detectors, "rounds": round_evidence,
              "clearRoundOffsetRangeMs": [min(accepted), max(accepted)] if accepted else None,
              "firstAnswerVideoMs": round(chart["rounds"][0]["answerStartMs"]+recommended, 6)}
    return report, times, flux


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--chart", type=Path, default=Path("data/chart.json"))
    parser.add_argument("--out", type=Path, default=Path("data/alignment.json"))
    parser.add_argument("--plot", type=Path, default=Path("data/alignment.png"))
    args = parser.parse_args()
    chart = json.loads(args.chart.read_text(encoding="utf-8"))
    report, times, flux = analyze(args.video, chart)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib import pyplot as plt
    figure, axes = plt.subplots(2, 1, figsize=(12, 6), layout="constrained")
    r = chart["rounds"][0]
    lo, hi = r["answerStartMs"]/1000-.20, r["endMs"]/1000-.10
    mask = (times >= lo) & (times <= hi)
    axes[0].plot(times[mask], flux[mask], color="#327de0", linewidth=1.4, label="PV audio attack strength")
    for i, note in enumerate(r["notes"]):
        axes[0].axvline((note["midiMs"]+report["offsetMs"])/1000, color="#d06935", alpha=.8,
                        label="Aligned MIDI target" if i == 0 else None)
    axes[0].set(title="Xterfusion: first piano response / original PV", xlabel="Video time (seconds)", ylabel="Normalized novelty")
    axes[0].legend()
    for row in report["rounds"]:
        axes[1].scatter(row["round"], row["offsetMs"], color="#327de0" if row["reliable"] else "#aaaaaa",
                        marker="o" if row["reliable"] else "x")
    axes[1].axhline(report["offsetMs"], color="#d06935", linestyle="--", label=f"Initial offset: {report['offsetMs']:+d} ms")
    axes[1].set(title="Per-round check (gray = ambiguous attack matching)", xlabel="Round", ylabel="Attack-peak offset (ms)", xticks=range(1, 15))
    axes[1].legend()
    figure.savefig(args.plot, dpi=140)
    plt.close(figure)
    print(json.dumps({"offsetMs": report["offsetMs"], "detectors": [(d["windowSamples"], d["offsetMs"]) for d in report["detectors"]],
                      "clearRoundOffsetRangeMs": report["clearRoundOffsetRangeMs"], "firstAnswerVideoMs": report["firstAnswerVideoMs"]}, ensure_ascii=False))

if __name__ == "__main__":
    main()
