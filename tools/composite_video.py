"""Composite Hyperframes-rendered alpha layers over untouched PV timing, locally."""
import json
import shutil
import subprocess
from pathlib import Path
import numpy as np

def build_command(ffmpeg,source,backing,output,gpu=False):
    cmd=[str(ffmpeg),'-hide_banner','-y','-i',str(source),'-c:v','libvpx-vp9','-i','.cache/overlay-intro.webm',
         '-c:v','libvpx-vp9','-i','.cache/overlay-game.webm','-i',str(backing),'-filter_complex_threads','4',
         '-filter_complex','[1:v]setpts=PTS-STARTPTS[intro];[2:v]setpts=PTS-STARTPTS+74/TB[notes];'
         '[0:v][intro]overlay=0:0:eof_action=pass:enable=between(t\\,0\\,12.5)[a];'
         '[a][notes]overlay=0:0:eof_action=pass:enable=between(t\\,74\\,113),format=yuv420p[v]',
         '-map','[v]','-map','3:a:0']
    if gpu:cmd+=['-c:v','h264_nvenc','-preset','p5','-cq','18','-b:v','0']
    else:cmd+=['-c:v','libx264','-preset','fast','-crf','18','-threads','8']
    return cmd+['-c:a','aac','-b:a','256k','-ar','44100','-r','60','-t','170.005333','-movflags','+faststart',str(output)]

def main():
    ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe')
    cfg=json.loads(Path('media.local.json').read_text(encoding='utf-8'))
    for name,second in [('intro',2),('game',3)]:
        path=Path('.cache')/f'overlay-{name}.webm'
        if not path.is_file():raise RuntimeError(f'Missing Hyperframes overlay: {path}')
        p=subprocess.run([ffmpeg,'-v','error','-c:v','libvpx-vp9','-ss',str(second),'-i',str(path),'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1'],capture_output=True,check=True)
        frame=np.frombuffer(p.stdout,dtype=np.uint8).reshape(1080,1920,4)
        if frame[0,0,3]!=0 or frame[:,:,3].max()==0:raise RuntimeError(f'Alpha decode failed for {path}')
    probe=subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=320x240:r=60:d=0.1','-c:v','h264_nvenc','-f','null','-'],capture_output=True)
    gpu=probe.returncode==0
    output=Path('video/renders/X-X-XXXTERFUSION.mp4');output.parent.mkdir(exist_ok=True)
    temp=output.with_suffix('.partial.mp4')
    print(f'Alpha checks passed. Encoding {output} with '+('NVENC' if gpu else 'libx264'),flush=True)
    with Path('.cache/composite-ffmpeg.log').open('wb') as log:
        subprocess.run(build_command(ffmpeg,cfg['video'],cfg['backing'],temp,gpu),stdout=log,stderr=log,check=True)
    data=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,duration,start_time','-of','json',str(temp)],encoding='utf-8'))
    duration=float(data['format']['duration'])
    if abs(duration-170.005333)>.05:raise RuntimeError(f'Unexpected output duration: {duration}')
    temp.replace(output)
    cfg['renderedVideo']=str(output.resolve())
    Path('media.local.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    report={'output':str(output.resolve()),'bytes':output.stat().st_size,'duration':duration,'encoder':'NVENC' if gpu else 'libx264','probe':data,
            'sourceVideoUnmodified':True,'introOverlays':[0,12.5],'gameOverlays':[74,113],'timeShiftSeconds':0}
    Path('data/video-render.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
