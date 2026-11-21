"""Read-only extraction of the supplied Xterfusion call/response passage."""
import argparse
import bisect
import json
from collections import defaultdict
from pathlib import Path

import mido

SECTION_TICK = 30912
PHRASES = [(b, 4) for b in (0, 8, 16, 24)] + [(b, 2) for b in (32, 36, 40, 44, 48, 52)] + [(b, 1) for b in (56, 58, 60, 62)]


def extract_chart(path):
    midi = mido.MidiFile(path)
    if midi.ticks_per_beat != 96:
        raise ValueError("This transcription is expected to have 96 ticks per quarter note")
    tick, elapsed, tempo = 0, 0.0, 500000
    tempo_points = [(0, 0.0, tempo)]
    for message in mido.merge_tracks(midi.tracks):
        elapsed += mido.tick2second(message.time, midi.ticks_per_beat, tempo)
        tick += message.time
        if message.type == "set_tempo":
            tempo = message.tempo
            if tempo_points[-1][0] == tick:
                tempo_points[-1] = (tick, elapsed, tempo)
            elif tempo_points[-1][2] != tempo:
                tempo_points.append((tick, elapsed, tempo))
    tempo_ticks = [p[0] for p in tempo_points]

    def to_ms(tick_value):
        start_tick, seconds, microseconds = tempo_points[bisect.bisect_right(tempo_ticks, tick_value) - 1]
        return (seconds + mido.tick2second(tick_value - start_tick, midi.ticks_per_beat, microseconds)) * 1000

    tracks = {}
    for track in midi.tracks:
        absolute_tick = 0
        grouped = defaultdict(list)
        for message in track:
            absolute_tick += message.time
            if message.type == "note_on" and message.velocity > 0:
                grouped[absolute_tick].append((message.note, message.velocity))
        tracks[track.name] = grouped
    for required in ("Drum", "Drum #2", "Piano"):
        if required not in tracks:
            raise ValueError(f"Required transcription track missing: {required}")

    rounds = []
    for index, (start_beat, phrase_beats) in enumerate(PHRASES, 1):
        demo_tick = SECTION_TICK + start_beat * midi.ticks_per_beat
        answer_tick = demo_tick + phrase_beats * midi.ticks_per_beat
        end_tick = answer_tick + phrase_beats * midi.ticks_per_beat
        demo_ticks = sorted(t for t in tracks["Drum"] if demo_tick <= t < answer_tick)
        answer_ticks = sorted(t for t in tracks["Drum #2"] if answer_tick <= t < end_tick)
        demo_pattern = [t - demo_tick for t in demo_ticks]
        answer_pattern = [t - answer_tick for t in answer_ticks]
        if not demo_pattern or demo_pattern != answer_pattern:
            raise ValueError(f"Call and response beat patterns disagree in round {index}")
        if any(t not in tracks["Piano"] for t in answer_ticks):
            raise ValueError(f"Piano response is missing a target in round {index}")
        notes = []
        for number, note_tick in enumerate(answer_ticks, 1):
            pitches = sorted(set(n for n, _ in tracks["Piano"][note_tick]))
            notes.append({"id": f"r{index}-n{number}", "tick": note_tick,
                          "midiMs": round(to_ms(note_tick), 6), "beat": (note_tick - answer_tick) / midi.ticks_per_beat,
                          "pitches": pitches})
        rounds.append({"id": index, "beatsPerPhrase": phrase_beats,
                       "demoStartMs": round(to_ms(demo_tick), 6), "answerStartMs": round(to_ms(answer_tick), 6),
                       "endMs": round(to_ms(end_tick), 6),
                       "demoNotes": [{"midiMs": round(to_ms(t), 6), "beat": (t-demo_tick)/midi.ticks_per_beat} for t in demo_ticks],
                       "notes": notes})
    # The coda changes from echoing to continuous follow-along. Chord layers at the
    # same tick are still one physical hit, including overlapping drum/piano events.
    tail_start, tail_end = 37056, 40896
    tail_ticks = sorted({t for name in ("Drum", "Piano") for t in tracks[name] if tail_start <= t < tail_end})
    if len(tail_ticks) != 96:
        raise ValueError(f"Expected 96 unique tail hits, got {len(tail_ticks)}")
    challenge = {"id": 15, "kind": "stream", "label": "高速跟拍", "beatsPerPhrase": 40,
                 "demoStartMs": round(to_ms(tail_start), 6), "answerStartMs": round(to_ms(tail_start), 6),
                 "endMs": round(to_ms(tail_end), 6), "demoNotes": [],
                 "notes": [{"id": f"tail-{t}", "tick": t, "midiMs": round(to_ms(t),6),
                            "beat": (t-tail_start)/midi.ticks_per_beat,
                            "pitches": sorted({n for name in ("Drum","Piano") for n,_ in tracks[name].get(t,[])})}
                           for t in tail_ticks]}
    difficulties = [
        {"id": "easy", "label": "简单", "roundCount": 3, "includeChallenge": False,
         "targetCount": 18, "endMs": rounds[2]["endMs"], "description": "前三轮记忆复奏"},
        {"id": "normal", "label": "普通", "roundCount": 14, "includeChallenge": False,
         "targetCount": 66, "endMs": rounds[-1]["endMs"], "description": "完整十四轮记忆复奏"},
        {"id": "hard", "label": "硬核", "roundCount": 14, "includeChallenge": True,
         "targetCount": 162, "endMs": challenge["endMs"], "description": "完整复奏＋加速连打＋高速钢琴"},
    ]
    return {"version": 3, "difficulties": difficulties, "challengeRounds": [challenge], "hardTotalTargets": 162, "title": "Xterfusion · 记忆复奏", "sourceName": Path(path).name,
            "ticksPerBeat": midi.ticks_per_beat, "midiDurationMs": round(midi.length * 1000, 6),
            "rounds": rounds, "totalTargets": sum(len(r["notes"]) for r in rounds),
            "tempoMap": [{"tick": t, "midiMs": round(s*1000, 6), "bpm": round(mido.tempo2bpm(v), 6)} for t, s, v in tempo_points]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("midi", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/chart.json"))
    args = parser.parse_args()
    chart = extract_chart(args.midi)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(chart, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(chart['rounds'])} rounds / {chart['totalTargets']} targets -> {args.out}")

if __name__ == "__main__":
    main()
