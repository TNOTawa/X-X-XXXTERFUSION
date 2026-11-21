import importlib
import unittest

try:
    server = importlib.import_module("server")
except ModuleNotFoundError:
    server = None

class ServerTests(unittest.TestCase):
    def test_00_range_parser_exists(self):
        self.assertTrue(callable(getattr(server, "parse_byte_range", None)), "safe media server is missing")

    @unittest.skipIf(server is None, "server unavailable")
    def test_original_drum_module_and_small_atlas_are_public(self):
        for public in ["/calibration.mjs", "/sample-audio.mjs", "/scoring.mjs", "/leaderboard.mjs", "/player.mjs", "/data/audio-manifest.json", "/data/drum-atlas.wav"]:
            self.assertIn(public, server.PUBLIC_FILES)

    @unittest.skipIf(server is None, "server unavailable")
    def test_server_does_not_allow_silent_duplicate_port_binding(self):
        self.assertFalse(getattr(getattr(server, "LocalServer", None), "allow_reuse_address", True))

    @unittest.skipIf(server is None, "server unavailable")
    def test_closed_open_and_suffix_ranges(self):
        self.assertEqual(server.parse_byte_range("bytes=10-19", 100), (10, 19))
        self.assertEqual(server.parse_byte_range("bytes=90-", 100), (90, 99))
        self.assertEqual(server.parse_byte_range("bytes=-12", 100), (88, 99))
        self.assertEqual(server.parse_byte_range("bytes=0-999", 100), (0, 99))

    @unittest.skipIf(server is None, "server unavailable")
    def test_invalid_or_multiple_ranges_are_rejected(self):
        for value in ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=0-1,5-8", "items=1-2", "bytes=a-b"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                server.parse_byte_range(value, 100)

    @unittest.skipIf(server is None, "server unavailable")
    def test_only_explicit_public_files_are_served(self):
        self.assertIn("/index.html", server.PUBLIC_FILES)
        for private in ["/media.local.json", "/server.py", "/../media.local.json", "/tools/extract_chart.py"]:
            self.assertNotIn(private, server.PUBLIC_FILES)

if __name__ == "__main__":
    unittest.main()
