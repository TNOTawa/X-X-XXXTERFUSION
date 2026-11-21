# Local-only generated assets

This repository intentionally does **not** distribute the released song chart, timing-analysis reports, MIDI, original/replacement audio, drum slices, source PV, fonts, covers, or release ZIPs. This is a source-code repository, not a licensed media pack.

All generated files directly under this directory are ignored by Git. Bring your own lawfully obtained inputs and generate:

- `chart.json`: extracted/author-supplied chart; inspect `tests/fixtures/chart.json` for schema (that fixture is synthetic, not the released song).
- `alignment.json`: material timing offset from `tools/align_media.py`.
- `drum-atlas.wav` and `audio-manifest.json`: sliced drum cues from `tools/prepare_audio.py`.

`tools/build_toy.py` checks that these local files exist before touching the output. Do not force-add them or attach a built Toy ZIP to GitHub Releases unless you separately hold redistribution permission for every contained asset.
