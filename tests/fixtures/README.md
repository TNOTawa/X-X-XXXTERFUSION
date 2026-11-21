# Synthetic test data

`chart.json` is an original, programmatically constructed test fixture: evenly spaced middle-C events, a constant120BPM tempo, arbitrary phrase positions and a generic fast tail. It contains no extracted MIDI notes, source audio, PV frames or song transcription. Counts exercise the game's three18/66/162-note difficulty configurations; the timing and pitches are unrelated to the released song chart.

Package tests synthesize a tiny silent WAV in a temporary directory. That temporary file is not part of the repository or a release.
