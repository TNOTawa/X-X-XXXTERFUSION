import importlib,json,tempfile,unittest
from pathlib import Path
try: builder=importlib.import_module('tools.build_toy')
except ModuleNotFoundError: builder=None
ROOT=Path(__file__).resolve().parents[1]
class ToyPackageTests(unittest.TestCase):
 def setUp(self):
  import wave
  self._temp=tempfile.TemporaryDirectory();self.addCleanup(self._temp.cleanup);self.assets=Path(self._temp.name)
  chart=json.loads((ROOT/'tests/fixtures/chart.json').read_text(encoding='utf8'))
  (self.assets/'chart.json').write_text(json.dumps(chart),encoding='utf8')
  (self.assets/'alignment.json').write_text('{"offsetMs":14}',encoding='utf8')
  cues={n['id']:{'offsetSeconds':0,'durationSeconds':.01} for r in chart['rounds']+chart['challengeRounds'] for n in r['notes']}
  (self.assets/'audio-manifest.json').write_text(json.dumps({'version':3,'atlasUrl':'./drum-atlas.wav','cues':cues}),encoding='utf8')
  with wave.open(str(self.assets/'drum-atlas.wav'),'wb') as w:
   w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(bytes(160))
 def build(self,destination):return builder.build_package(destination,data_root=self.assets)
 def test_builder_exists(self):self.assertTrue(callable(getattr(builder,'build_package',None)))
 @unittest.skipIf(builder is None,'builder unavailable')
 def test_package_is_relative_and_contains_only_runtime_and_drum_cues(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)/'toy';self.build(root)
   files={str(p.relative_to(root)).replace('\\','/') for p in root.rglob('*') if p.is_file()}
   self.assertIn('data/drum-atlas.wav',files);self.assertIn('calibration.js',files)
   self.assertEqual([f for f in files if f.endswith(('.wav','.mp3','.mp4','.webm','.mid'))],['data/drum-atlas.wav'])
   for f in files:
    self.assertNotIn('media.local',f);self.assertNotIn('server.py',f)
   html=(root/'index.html').read_text(encoding='utf8');self.assertIn('data-environment="toy"',html)
   self.assertNotIn('src="./media/pv.mp4"',html)
   self.assertNotIn('src="/app.mjs"',html);self.assertNotIn('href="/style.css"',html)
   app=(root/'app.js').read_text(encoding='utf8');self.assertNotIn("'/data/",app)
   manifest=json.loads((root/'data/audio-manifest.json').read_text(encoding='utf8'))
   self.assertNotIn('backingUrl',manifest);self.assertEqual(manifest['atlasUrl'],'./data/drum-atlas.wav')
   self.assertEqual(len(manifest['cues']),162)
   self.assertLess(sum((root/f).stat().st_size for f in files),5_000_000)
 def test_production_uses_served_js_extensions_and_has_no_video_even_before_boot(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.build(root)
   html=(root/'index.html').read_text(encoding='utf8')
   self.assertIn('src="./app.js"',html)
   self.assertNotIn('<video',html);self.assertNotIn('id="local-player"',html)
   self.assertIn('class="host-mode"',html);self.assertIn('__toyBoot',html)
   self.assertNotIn('.mjs',html)
   self.assertEqual(list(root.rglob('*.mjs')),[])
   for path in root.glob('*.js'):
    self.assertNotIn('.mjs',path.read_text(encoding='utf8'))
 def test_rebuild_removes_only_retired_generated_mjs_and_rejects_unknown_files(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'app.mjs').write_text('old generated module',encoding='utf8')
   self.build(root);self.assertFalse((root/'app.mjs').exists())
   (root/'notes.txt').write_text('user file',encoding='utf8')
   with self.assertRaises(ValueError):self.build(root)
   self.assertEqual((root/'notes.txt').read_text(encoding='utf8'),'user file')
 def test_can_build_from_an_explicit_data_directory(self):
  import inspect
  self.assertIn('data_root',inspect.signature(builder.build_package).parameters)
 def test_missing_assets_do_not_partially_modify_a_destination(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)/'output';root.mkdir();sentinel=root/'app.js';sentinel.write_text('existing output',encoding='utf8')
   with self.assertRaises(FileNotFoundError):builder.build_package(root,data_root=Path(d)/'missing')
   self.assertEqual(sentinel.read_text(encoding='utf8'),'existing output')
 def test_runtime_requires_host_in_production_and_disables_full_backing(self):
  app=(ROOT/'app.mjs').read_text(encoding='utf8')
  self.assertIn('backingEnabled:false',app)
  self.assertIn('requireHost',app)
  self.assertNotIn("audioEngine.attachVideo(video);",app)
if __name__=='__main__':unittest.main()
