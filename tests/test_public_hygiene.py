import importlib,json,tempfile,unittest
from pathlib import Path
try:audit=importlib.import_module('tools.audit_public')
except ModuleNotFoundError:audit=None
ROOT=Path(__file__).resolve().parents[1]
class PublicHygieneTests(unittest.TestCase):
 def test_auditor_exists(self):self.assertTrue(callable(getattr(audit,'audit_entries',None)))
 @unittest.skipIf(audit is None,'auditor unavailable')
 def test_rejects_private_paths_secrets_and_copyright_binaries(self):
  drive=chr(67)+':'+chr(92)
  issues=audit.audit_entries({'readme.md':('local '+drive+'Users'+chr(92)+'private'+chr(92)+'input.wav').encode(),'app.js':('const token="ghp_'+'a'*30+'"').encode(),'data/drum-atlas.wav':b'RIFF','dist/release.zip':b'zip','data/chart.json':b'{}'})
  self.assertEqual({i['path'] for i in issues},{'readme.md','app.js','data/drum-atlas.wav','dist/release.zip','data/chart.json'})
 @unittest.skipIf(audit is None,'auditor unavailable')
 def test_permits_original_source_and_explicit_synthetic_fixture(self):
  self.assertEqual(audit.audit_entries({'app.mjs':b'export const value=1;','tests/fixtures/chart.json':b'{"synthetic":true}','data/README.md':b'Provide licensed inputs locally.'}),[])
 def test_portable_media_example_uses_only_relative_paths(self):
  self.assertTrue((ROOT/'media.example.json').is_file())
  config=json.loads((ROOT/'media.example.json').read_text(encoding='utf8'))
  self.assertEqual(set(config),{'video','midi','backing','drums','renderedVideo'})
  for value in config.values():
   self.assertFalse(Path(value).is_absolute());self.assertNotIn(':',value)
if __name__=='__main__':unittest.main()
