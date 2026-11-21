import importlib
import unittest
import numpy as np

try:
    audio = importlib.import_module("tools.prepare_audio")
except ModuleNotFoundError:
    audio = None

class AudioAssetTests(unittest.TestCase):
    def test_00_sample_builder_exists(self):
        self.assertTrue(callable(getattr(audio, "build_atlas", None)), "original drum sample builder is missing")

    @unittest.skipIf(audio is None, "builder unavailable")
    def test_each_note_has_its_own_slice_and_does_not_include_next_attack(self):
        sr = 10000
        source = np.zeros((2*sr, 2), dtype=np.float32)
        source[1000:1050] = .5
        source[1440:1490] = .9
        notes = [{"id":"a", "midiMs":100}, {"id":"b", "midiMs":144}]
        atlas, cues = audio.build_atlas(source, sr, notes, [100,144], offset_ms=0, attack_lead_ms=0)
        self.assertEqual(set(cues), {"a", "b"})
        self.assertLessEqual(cues["a"]["sourceStartSeconds"] + cues["a"]["durationSeconds"], .144)
        first = atlas[round(cues["a"]["offsetSeconds"]*sr):round((cues["a"]["offsetSeconds"]+cues["a"]["durationSeconds"])*sr)]
        self.assertLessEqual(float(np.max(np.abs(first))), .501)
        self.assertGreater(float(np.max(np.abs(first))), .1)
        self.assertLess(cues["a"]["offsetSeconds"]+cues["a"]["durationSeconds"], cues["b"]["offsetSeconds"])

    @unittest.skipIf(audio is None, "builder unavailable")
    def test_sample_ends_fade_to_zero_without_per_note_loudness_normalization(self):
        source = np.ones((20000,2),dtype=np.float32)*.2
        atlas, cues = audio.build_atlas(source,10000,[{"id":"a","midiMs":100}],[100],offset_ms=0,attack_lead_ms=0)
        n=round(cues["a"]["durationSeconds"]*10000)
        self.assertEqual(float(atlas[0,0]),0)
        self.assertEqual(float(atlas[n-1,0]),0)
        self.assertAlmostEqual(float(atlas[n//2,0]),.2,places=5)

if __name__ == "__main__":
    unittest.main()
