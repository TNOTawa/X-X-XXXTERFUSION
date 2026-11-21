import importlib
import unittest
import numpy as np

try:
    alignment = importlib.import_module("tools.align_media")
except ModuleNotFoundError:
    alignment = None

class AlignmentTests(unittest.TestCase):
    def test_00_alignment_estimator_exists(self):
        self.assertTrue(callable(getattr(alignment, "estimate_offset", None)), "onset alignment estimator is missing")

    @unittest.skipIf(alignment is None, "estimator unavailable")
    def test_positive_and_negative_source_offsets(self):
        times = np.arange(0, 8, .001)
        events = np.array([1.0, 1.33, 2.1, 2.62, 3.05, 4.4, 5.1])
        for shift in [.137, -.083]:
            flux = sum(np.exp(-((times-(event+shift))/.005)**2) for event in events)
            offset, score, _ = alignment.estimate_offset(times, flux, events, -.3, .3, .001)
            self.assertAlmostEqual(offset, shift, places=3)
            self.assertGreater(score, .95)

    @unittest.skipIf(alignment is None, "estimator unavailable")
    def test_empty_targets_are_rejected(self):
        with self.assertRaises(ValueError):
            alignment.estimate_offset(np.arange(4), np.ones(4), np.array([]))

if __name__ == "__main__":
    unittest.main()
