"""Author deterministic Hyperframes X notation from the game's exact MIDI chart."""
import json
from pathlib import Path
PIXELS_PER_BEAT=480
TRAVEL_PIXELS=880

def beat_at_time(chart, seconds):
    """MIDI seconds -> continuous quarter-note position across the tempo map."""
    segments=chart['tempoMap']
    segment=next((s for s in reversed(segments) if s['midiMs']/1000<=seconds),segments[0])
    return segment['tick']/chart['ticksPerBeat']+(seconds-segment['midiMs']/1000)*segment['bpm']/60

def time_at_beat(chart, beat):
    segments=chart['tempoMap']
    segment=next((s for s in reversed(segments) if s['tick']/chart['ticksPerBeat']<=beat),segments[0])
    return segment['midiMs']/1000+(beat-segment['tick']/chart['ticksPerBeat'])*60/segment['bpm']

def travel_segments(chart, due, offset_ms=14):
    """All notes follow one beat-space clock: no overtaking at tempo changes.

    Returned times are absolute video seconds; distances are unsigned pixels.
    Split at each tempo change to retain linear GSAP motion inside each segment.
    """
    shift=offset_ms/1000
    due_beat=beat_at_time(chart,due-shift)
    start=time_at_beat(chart,due_beat-TRAVEL_PIXELS/PIXELS_PER_BEAT)+shift
    boundaries=[start]+[s['midiMs']/1000+shift for s in chart['tempoMap'] if start<s['midiMs']/1000+shift<due]+[due]
    return [{'start':a,'end':b,'startX':PIXELS_PER_BEAT*(due_beat-beat_at_time(chart,a-shift)),
             'endX':PIXELS_PER_BEAT*(due_beat-beat_at_time(chart,b-shift))}
            for a,b in zip(boundaries,boundaries[1:])]


def overlay_events(chart,offset_ms=14):
    events=[]
    for r in chart['rounds']:
        for i,n in enumerate(r['demoNotes']):
            events.append({'id':f'demo-{r["id"]}-{i}','sourceId':f'demo-{r["id"]}-{i}', 'kind':'demo','side':'left','due':(n['midiMs']+offset_ms)/1000})
        for n in r['notes']:
            events.append({'id':n['id'],'sourceId':n['id'],'kind':'answer','side':'right','due':(n['midiMs']+offset_ms)/1000})
    for r in chart.get('challengeRounds',[]):
        for n in r['notes']:
            for side in ['left','right']:
                events.append({'id':n['id']+'-'+side,'sourceId':n['id'],'kind':'stream','side':side,'due':(n['midiMs']+offset_ms)/1000})
    return sorted(events,key=lambda e:(e['due'],e['side'],e['id']))

def composition_html(chart,offset_ms=14,offset=0,duration=170,background=False):
    notes=[];tweens=[]
    for i,e in enumerate(overlay_events(chart,offset_ms)):
        segments=travel_segments(chart,e['due'],offset_ms)
        spawn=segments[0]['start']-offset
        if spawn<0 or spawn>=duration:continue
        id='x-'+e['id'];due=e['due']-offset
        notes.append(f'<div id="{id}" class="clip note {e["side"]}" data-start="{spawn:.9f}" data-duration="{due-spawn+.08:.9f}" data-track-index="{100+i}" data-layout-ignore>X</div>')
        sign=-1 if e['side']=='left' else 1
        for segment in segments:
            a=segment['start']-offset;b=segment['end']-offset
            x0=sign*segment['startX'];x1=sign*segment['endX']
            tweens.append(f'tl.fromTo("#{id}",{{x:{x0:.9f}}},{{x:{x1:.9f},duration:{b-a:.9f},ease:"none",immediateRender:false}},{a:.9f});')
        tweens.append(f'tl.to("#{id}",{{opacity:0,duration:.06,ease:"none"}},{due+.02:.9f});')
    cards=[]
    instructions=[(.3,4.5,'请使用最新版哔哩哔哩 App','打开配套半屏 Toy 游玩；普通播放无法进行互动。'),
                  (4.5,8.3,'<span class="highlight">X X XXX</span>TERFUSION','左边听示范，右边轮到你；X 到达中线时，点击下方任意空白处。'),
                  (8.3,12.3,'先校准延迟，再选难度','硬核两侧同时到达，也只打一拍。听一段，再把节奏打回来。')]
    for i,(start,end,title,sub) in enumerate(instructions,1):
        a,b=start-offset,end-offset
        if a<0 or a>=duration:continue
        b=min(b,duration)
        cards.append(f'<div id="intro-{i}" class="clip instruction" data-start="{a:.6f}" data-duration="{b-a:.6f}" data-track-index="{i+2}"><div class="instruction-content"><h1>{title}</h1><p>{sub}</p></div></div>')
        ease=['power3.out','sine.out','power2.out'][i-1]
        tweens.extend([f'tl.fromTo("#intro-{i}",{{opacity:0,y:18}},{{opacity:1,y:0,duration:.22,ease:"{ease}",immediateRender:false}},{a:.6f});',
                       f'tl.to("#intro-{i}",{{opacity:0,duration:.18,ease:"sine.in"}},{b-.18:.6f});'])
    lane_start=max(0,74.15-offset);lane_end=min(duration,112.4-offset)
    if lane_end>lane_start:
        tweens.extend([f'tl.fromTo("#lane",{{opacity:0}},{{opacity:1,duration:.25,ease:"sine.out",immediateRender:false}},{lane_start:.6f});',
                       f'tl.to("#lane",{{opacity:0,duration:.25,ease:"sine.in"}},{lane_end-.25:.6f});'])
    bg=''
    if background:
        bg='<video id="source-video" class="clip" src="assets/source.mp4" data-start="0" data-duration="170" data-track-index="0" muted playsinline></video><audio id="source-audio" src="assets/backing.wav" data-start="0" data-duration="170" data-track-index="1"></audio>'
    html="""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><script src="assets/gsap.min.js"></script><style>
@font-face{font-family:OverlayCJK;src:url("fonts/Microsoft-YaHei.ttc")}@font-face{font-family:OverlayMono;src:url("fonts/Consolas-Bold.ttf");font-weight:700}
*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:transparent}#root{position:relative;width:1920px;height:1080px;font-family:OverlayCJK,sans-serif;color:#e9edef;overflow:hidden}
#source-video{position:absolute;inset:0;width:1920px;height:1080px;object-fit:contain}#lane{position:absolute;left:64px;top:740px;width:1792px;height:270px;background:rgba(32,39,45,.88);opacity:0;overflow:visible;z-index:3}
#center-line{position:absolute;left:893px;top:65px;width:6px;height:140px;background:rgba(233,237,239,.45);z-index:5}.side-label{position:absolute;top:17px;font-size:28px;letter-spacing:4px;font-weight:500}.side-label.left{left:34px;color:#cbd3d9}.side-label.right{right:34px;color:#dceac5}.note{position:absolute;left:896px;top:135px;width:84px;height:100px;margin-left:-42px;margin-top:-50px;line-height:100px;text-align:center;font-family:OverlayMono,monospace;font-size:80px;font-weight:700}.note.left{color:#cbd3d9}.note.right{color:#dceac5}
.instruction{position:absolute;left:64px;top:650px;width:1792px;height:300px;background:rgba(32,39,45,.94);z-index:8;opacity:0}.instruction-content{display:flex;flex-direction:column;justify-content:center;gap:22px;width:100%;height:100%;padding:32px 48px}.instruction h1{font-size:64px;font-weight:700;letter-spacing:0;line-height:1.35}.instruction p{font-size:32px;line-height:1.5;color:#cbd3d9}.highlight{font-family:OverlayMono,monospace;font-weight:700;color:#dceac5;white-space:pre}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="__DURATION__" data-width="1920" data-height="1080" data-fps="60">__BACKGROUND____CARDS__<div id="lane"><span class="side-label left">示范</span><span class="side-label right">你</span><div id="center-line"></div>__NOTES__</div></div><script>
const tl=gsap.timeline({paused:true});
__TWEENS__
window.__timelines=window.__timelines||{};window.__timelines.main=tl;
</script></body></html>"""
    if not background:
        html=html.replace('assets/gsap.min.js','../assets/gsap.min.js').replace('fonts/','../fonts/')
    return html.replace('__DURATION__',str(duration)).replace('__BACKGROUND__',bg).replace('__CARDS__',''.join(cards)).replace('__NOTES__',''.join(notes)).replace('__TWEENS__','\n'.join(tweens))

def main():
    chart=json.loads(Path('data/chart.json').read_text(encoding='utf-8'));offset=json.loads(Path('data/alignment.json').read_text(encoding='utf-8'))['offsetMs'];root=Path('video')
    (root/'index.html').write_text(composition_html(chart,offset,0,170,True),encoding='utf-8')
    (root/'compositions').mkdir(exist_ok=True)
    (root/'compositions/overlay-intro.html').write_text(composition_html(chart,offset,0,12.5,False),encoding='utf-8')
    (root/'compositions/overlay-game.html').write_text(composition_html(chart,offset,74,39,False),encoding='utf-8')
    (root/'overlay-events.json').write_text(json.dumps(overlay_events(chart,offset),ensure_ascii=False,indent=2),encoding='utf-8')
    print('Hyperframes: full170s preview, 12.5s intro overlay, 39s game overlay;324 X glyphs /162 player targets')
if __name__=='__main__':main()
