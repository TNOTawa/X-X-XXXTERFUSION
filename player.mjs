import { HostClock } from './core.mjs';

export async function loadToySdk({ required = false } = {}) {
  if (globalThis.toy) return globalThis.toy;
  const host = globalThis.location?.hostname || '';
  if (!required && host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return null;
  await new Promise((resolve,reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(()=>reject(new Error('Toy SDK 加载超时')),6000);
    script.src = 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
    script.onload = ()=>{clearTimeout(timer);resolve();};
    script.onerror = ()=>{clearTimeout(timer);reject(new Error('Toy SDK 加载失败'));};
    document.head.append(script);
  });
  return globalThis.toy || null;
}

export async function createPlayer(video, { toy = null, requireHost = false, onSeek = ()=>{}, onPause = ()=>{}, onContainer = ()=>{} } = {}) {
  let host = false;
  if (toy) {
    try { host = (await Promise.all(['onPlayerChange','getPlayerState','setPlayerState'].map(a=>toy.isSupport(a)))).every(Boolean); }
    catch { host = false; }
  }
  if (host) {
    const clock = new HostClock();
    let pending = null, pauseRequested = false, settlingUntil = 0;
    const listener = state => {
      // A delayed bridge callback must not roll the native clock backwards.
      if(clock.sample && !pending && Number.isFinite(state.timestamp) && Number.isFinite(clock.sample.timestamp)
        && state.timestamp < clock.sample.timestamp)return;
      const previous = clock.sample ? clock.position() : null;
      const commanded = Boolean(pending);
      const previousSample=clock.sample;
      clock.update(state);
      if (!state.playing) { pauseRequested = false; onPause(); }
      if (pending && Math.abs(clock.position()-pending.position)<500 && state.playing && !state.muted && clock.rate>0) {
        settlingUntil=state.timestamp+3000;
        clearTimeout(pending.timer); const done=pending.resolve; pending=null; done();
      }
      // Compare the two native sampling instants, not event arrival time. Bridge
      // latency must not look like a rewind when rate becomes zero on buffering.
      let expected=previous;
      if(previousSample && Number.isFinite(previousSample.timestamp) && Number.isFinite(state.timestamp)){
        const priorRate=previousSample.playing?Math.max(0,previousSample.rate||0):0;
        expected=previousSample.position+Math.max(0,state.timestamp-previousSample.timestamp)*priorRate;
        const duration=state.duration||previousSample.duration;
        if(duration>0)expected=Math.min(expected,duration);
      }
      if(previousSample?.rate===0 && state.rate>0)settlingUntil=Math.max(settlingUntil,state.timestamp+2000);
      // This is an entertainment/practice hint, not an anti-cheat boundary.
      // Allow clock correction during first-play warm-up and buffering recovery.
      const recovering=previousSample?.rate===0 || state.rate===0 || state.timestamp<=settlingUntil;
      const tolerance=recovering?1500:750;
      if(!commanded && expected!==null && Math.abs(state.position-expected)>tolerance)onSeek(clock.position());
    };
    const off = toy.onPlayerChange(listener);
    let offContainer = ()=>{};
    try {
      listener(await toy.getPlayerState());
      if (await toy.isSupport('onContainerChange')) offContainer=toy.onContainerChange(onContainer);
    } catch (error) { off(); throw error; }
    return {
      kind:'host', now:()=>clock.position(), rate:()=>clock.rate,
      playing:()=>!pauseRequested && Boolean(clock.sample?.playing && clock.rate>0),
      seekAndPlay: position => new Promise((resolve,reject)=>{
        if (pending) { clearTimeout(pending.timer); pending.reject(new Error('起播请求已被替换')); }
        pauseRequested=false;
        const request={position,resolve,reject,timer:null};
        request.timer=setTimeout(()=>{if(pending===request)pending=null;reject(new Error('宿主未确认目标播放位置，请重试'));},6000);
        pending=request;
        Promise.resolve(toy.setPlayerState({position:Math.max(0,Math.round(position)),playing:true,muted:false})).catch(error=>{
          if(pending===request){clearTimeout(request.timer);pending=null;reject(error);}
        });
      }),
      async pause(){pauseRequested=true;onPause();try{await toy.setPlayerState({playing:false});}catch(error){pauseRequested=false;throw error;}},
      async resume(){pauseRequested=false;await toy.setPlayerState({playing:true,muted:false});},
      async refresh(){listener(await toy.getPlayerState());},
      destroy(){off();offContainer();if(pending){clearTimeout(pending.timer);pending.reject(new Error('页面已关闭'));pending=null;}},
    };
  }
  if(requireHost)throw new Error('当前环境不支持半屏视频联动。请使用最新版哔哩哔哩 App，从配套视频打开半屏 Toy。');
  if(!video)throw new Error('本地调试播放器不存在');
  let waiting=false,intentional=false;
  const handlers=[];
  const listen=(event,callback)=>{video.addEventListener(event,callback);handlers.push([event,callback]);};
  listen('waiting',()=>{waiting=true;onPause();});
  listen('playing',()=>{waiting=false;});
  listen('canplay',()=>{waiting=false;});
  listen('pause',onPause);
  listen('seeking',()=>{if(!intentional)onSeek(video.currentTime*1000);});
  listen('seeked',()=>{intentional=false;waiting=false;});
  return {
    kind:'local', now:()=>video.currentTime*1000, rate:()=>video.playbackRate,
    playing:()=>!video.paused && !video.ended && !video.seeking && !waiting,
    async seekAndPlay(position){
      if(video.readyState===0)await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',done);video.removeEventListener('error',failed);};
        const done=()=>{cleanup();resolve();};const failed=()=>{cleanup();reject(new Error('无法读取 PV 元数据'));};
        const timer=setTimeout(failed,10000);video.addEventListener('loadedmetadata',done);video.addEventListener('error',failed);
      });
      intentional=true;video.currentTime=Math.max(0,position/1000);await video.play();
    },
    pause(){onPause();video.pause();},resume:()=>video.play(),refresh:async()=>{},
    destroy(){for(const [event,handler] of handlers)video.removeEventListener(event,handler);},
  };
}
