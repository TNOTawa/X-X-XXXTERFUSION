"""Audit the exact Git index before a public push; never print secret values."""
import argparse,json,re,subprocess
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parents[1]
BINARY_SUFFIXES={'.wav','.mp3','.m4a','.aac','.flac','.ogg','.aif','.aiff','.mp4','.mkv','.webm','.mov','.avi','.mid','.midi','.png','.jpg','.jpeg','.webp','.gif','.ico','.ttf','.ttc','.otf','.woff','.woff2','.zip','.7z','.rar','.tar','.gz','.exe','.dll','.so','.dylib','.pem','.key'}
PRIVATE_PREFIXES=('.cache/','dist/','covers/','media/','.venv/','venv/','node_modules/','.toy/','docs/superpowers/','video/assets/','video/fonts/','video/renders/','video/.hyperframes/','video/compositions/')
PRIVATE_NAMES={'media.local.json','.env','.npmrc','.netrc','.git-credentials','video/index.html','video/overlay-events.json','video/meta.json','video/agents.md','video/claude.md'}
CONTENT_RULES=[
 ('machine-specific Windows absolute path',re.compile(rb'(?<![A-Za-z0-9])[A-Za-z]:[\\/]')),
 ('personal home-directory path',re.compile(rb'/(?:Users|home)/[^/\s"\x27]+')),
 ('credential-like token',re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})')),
 ('private key',re.compile(rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----')),
 ('credential assignment',re.compile(rb'(?i)(?:access_token|refresh_token|authorization)["\x27]?\s*[:=]\s*["\x27]?(?:Bearer\s+)?[A-Za-z0-9._-]{16,}')),
]

def audit_entries(entries):
 issues=[]
 for path,body in sorted(entries.items()):
  name=path.replace('\\','/');lower=name.lower();suffix=PurePosixPath(lower).suffix
  if lower in PRIVATE_NAMES or lower.startswith(PRIVATE_PREFIXES) or lower.endswith('.local.json') or (lower.startswith('data/') and lower!='data/readme.md'):
   issues.append({'path':name,'reason':'private/generated asset path'})
  elif suffix in BINARY_SUFFIXES:
   issues.append({'path':name,'reason':'media/archive/font/binary not allowed in the source repository'})
  elif len(body)>512*1024:
   issues.append({'path':name,'reason':'unexpectedly large source file'})
  for reason,pattern in CONTENT_RULES:
   match=pattern.search(body)
   if match:issues.append({'path':name,'reason':reason,'line':body.count(b'\n',0,match.start())+1})
 return issues

def index_entries(root):
 root=Path(root).resolve()
 top=Path(subprocess.check_output(['git','-C',str(root),'rev-parse','--show-toplevel'],text=True).strip()).resolve()
 if root!=top:raise ValueError('Run the audit from the repository root, not an exported subdirectory')
 names=subprocess.check_output(['git','-C',str(root),'ls-files','--cached','-z']).decode('utf8').split('\0')
 return {name:subprocess.check_output(['git','-C',str(root),'show',':'+name]) for name in names if name}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--json',action='store_true');args=parser.parse_args()
 entries=index_entries(ROOT)
 if not entries:raise SystemExit('Refusing to approve an empty Git index')
 issues=audit_entries(entries)
 if args.json:print(json.dumps({'files':len(entries),'issues':issues},ensure_ascii=False,indent=2))
 elif issues:
  for issue in issues:print(f"FAIL {issue['path']}: {issue['reason']}"+(f" at line{issue['line']}" if 'line' in issue else ''))
 else:print(f'Public-index audit passed: {len(entries)} text/source files; no blocked media, private paths or credential patterns.')
 raise SystemExit(1 if issues else 0)
if __name__=='__main__':main()
