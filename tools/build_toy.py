"""Build a static, host-only Toy package. Never include full song/PV/private config."""
import json,zipfile,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RUNTIME=['index.html','style.css','app.mjs','core.mjs','scoring.mjs','leaderboard.mjs','player.mjs','sample-audio.mjs','calibration.mjs']
DATA=['chart.json','alignment.json','drum-atlas.wav']
BUILD='20261121-r3'

def runtime_name(name):
 return name[:-4]+'.js' if name.endswith('.mjs') else name

def build_package(destination, data_root=None):
 data_root=Path(data_root) if data_root is not None else ROOT/'data'
 missing=[name for name in DATA+['audio-manifest.json'] if not (data_root/name).is_file()]
 if missing:raise FileNotFoundError('Missing locally prepared assets: '+', '.join(missing)+'. See data/README.md; copyrighted assets are not distributed.')
 destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
 expected={runtime_name(n) for n in RUNTIME}|{'data/'+n for n in DATA}|{'data/audio-manifest.json'}
 retired={n for n in RUNTIME if n.endswith('.mjs')}
 unexpected={str(p.relative_to(destination)).replace('\\','/') for p in destination.rglob('*') if p.is_file()}-expected-retired
 if unexpected:raise ValueError(f'Refusing to package unexpected existing files: {sorted(unexpected)}')
 # Remove only the named obsolete files emitted by earlier versions of this builder.
 for name in retired:(destination/name).unlink(missing_ok=True)
 for name in RUNTIME:
  text=(ROOT/name).read_text(encoding='utf-8')
  if name=='index.html':
   text=text.replace('<html lang="zh-CN">',f'<html lang="zh-CN" data-environment="toy" data-build="{BUILD}">')
   text=text.replace('<body>','<body class="host-mode">')
   text=re.sub(r'\s*<div id="local-player"[^>]*>.*?</div>','',text,flags=re.S)
   text=text.replace('正在加载音轨…',f'正在启动…（修复版 {BUILD}）')
   bootstrap=(ROOT/'tools/toy_bootstrap.js').read_text(encoding='utf-8')
   text=text.replace('<script type="module" src="./app.mjs"></script>',f'<script>\n{bootstrap}\n</script>\n  <script type="module" src="./app.js"></script>')
  elif name.endswith('.mjs'):
   # The published content host returned404 for the .mjs entry and tested dependencies.
   # Use regular .js throughout the import graph, not just the entry filename.
   text=re.sub(r"(['\"])(\./[^'\"]+)\.mjs\1",r"\1\2.js\1",text)
  (destination/runtime_name(name)).write_text(text,encoding='utf-8')
 (destination/'data').mkdir(exist_ok=True)
 for name in DATA:(destination/'data'/name).write_bytes((data_root/name).read_bytes())
 source=json.loads((data_root/'audio-manifest.json').read_text(encoding='utf-8'))
 manifest={'version':source['version'],'atlasUrl':'./data/drum-atlas.wav','cues':source['cues']}
 (destination/'data/audio-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 return sorted(expected)

def main():
 destination=ROOT/'dist/toy';files=build_package(destination)
 output=ROOT/'dist/X-X-XXXTERFUSION-toy.zip'
 with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
  for name in files:archive.write(destination/name,name)
 report={'build':BUILD,'folder':str(destination),'zip':str(output),'files':len(files),'uncompressedBytes':sum((destination/f).stat().st_size for f in files),'zipBytes':output.stat().st_size,'audioFiles':['data/drum-atlas.wav'],'fullSongIncluded':False,'hostRequired':True}
 (ROOT/'dist/package-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
