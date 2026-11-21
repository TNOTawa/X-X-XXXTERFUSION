import importlib,json,os
import unittest
from pathlib import Path

try:
    chart_module = importlib.import_module("tools.extract_chart")
except ModuleNotFoundError:
    chart_module = None

ROOT=Path(__file__).resolve().parents[1]
config_path=ROOT/'media.local.json'
local_config=json.loads(config_path.read_text(encoding='utf-8-sig')) if config_path.is_file() else {}
MIDI=Path(os.environ.get('XTERFUSION_MIDI') or local_config.get('midi','media/input.mid'))
if not MIDI.is_absolute():MIDI=ROOT/MIDI

class ChartTests(unittest.TestCase):
    def test_00_extractor_exists(self):
        self.assertTrue(callable(getattr(chart_module, "extract_chart", None)), "beat-aware MIDI extractor is missing")

    @unittest.skipIf(chart_module is None or not MIDI.exists(), "extractor or local MIDI unavailable")
    def test_all_fourteen_call_response_patterns_match(self):
        chart = chart_module.extract_chart(MIDI)
        self.assertEqual(len(chart["rounds"]), 14)
        self.assertEqual(sum(len(r["notes"]) for r in chart["rounds"]), 66)
        for r in chart["rounds"]:
            self.assertEqual([n["beat"] for n in r["demoNotes"]], [n["beat"] for n in r["notes"]])

    @unittest.skipIf(chart_module is None or not MIDI.exists(), "extractor or local MIDI unavailable")
    def test_chords_are_single_targets_and_non_conductor_tempo_is_used(self):
        chart = chart_module.extract_chart(MIDI)
        first = chart["rounds"][0]
        self.assertEqual(len(first["notes"]), 5)
        self.assertEqual(first["notes"][0]["pitches"], [50, 55, 58])
        self.assertAlmostEqual(first["answerStartMs"], 77317.26825, places=3)
        self.assertAlmostEqual(first["demoStartMs"], 75471.11625, places=3)
        self.assertEqual([r["beatsPerPhrase"] for r in chart["rounds"]], [4]*4 + [2]*6 + [1]*4)
        self.assertGreater(len(chart["tempoMap"]), 14)

    @unittest.skipIf(chart_module is None or not MIDI.exists(), "extractor or local MIDI unavailable")
    def test_acceleration_is_not_a_fixed_millisecond_copy(self):
        r = chart_module.extract_chart(MIDI)["rounds"][3]
        demo_gap = r["demoNotes"][1]["midiMs"] - r["demoNotes"][0]["midiMs"]
        answer_gap = r["notes"][1]["midiMs"] - r["notes"][0]["midiMs"]
        self.assertGreater(demo_gap, answer_gap)

    @unittest.skipIf(chart_module is None or not MIDI.exists(), "extractor or local MIDI unavailable")
    def test_hard_difficulty_includes_all_96_unique_accelerating_tail_hits(self):
        chart = chart_module.extract_chart(MIDI)
        self.assertEqual([d["id"] for d in chart.get("difficulties", [])], ["easy", "normal", "hard"])
        self.assertEqual([d["targetCount"] for d in chart["difficulties"]], [18,66,162])
        challenge = chart["challengeRounds"][0]
        self.assertEqual(challenge["kind"], "stream")
        self.assertEqual(challenge["demoStartMs"], challenge["answerStartMs"])
        self.assertEqual(len(challenge["notes"]), 96)
        self.assertEqual(len(set(n["tick"] for n in challenge["notes"])), 96)
        self.assertAlmostEqual(challenge["endMs"], 111671.026, delta=1)
        self.assertLess(min(b["midiMs"]-a["midiMs"] for a,b in zip(challenge["notes"],challenge["notes"][1:])),60)

if __name__ == "__main__":
    unittest.main()
