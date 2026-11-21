// Static production bundle under a non-root prefix + simulated native SDK.
// This is a browser integration test, NOT an actual Bilibili App/device test.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist/toy'),debug=process.env.CDP_URL||'http://127.0.0.1:9228',prefix='/toy/test-package/';
const requests=[],results=[];let blockedResource=null;
const server=createServer(async(req,res)=>{requests.push(req.url);const path=new URL(req.url,'http://localhost').pathname;
 if(blockedResource&&path.endsWith('/'+blockedResource)){res.writeHead(404);res.end('Simulated missing published JS resource');return;}
 if(path.endsWith('.mjs')){res.writeHead(404);res.end('Toy production does not serve this module extension');return;}
 if(!path.startsWith(prefix)){res.writeHead(404);res.end();return;}
 const file=resolve(root,decodeURIComponent(path.slice(prefix.length))||'index.html');
 if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\')){res.writeHead(403);res.end();return;}
 try{const body=await readFile(file),mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.wav':'audio/wav'}[extname(file)];res.writeHead(200,{'Content-Type':mime||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}
});await new Promise(r=>server.listen(8766,'127.0.0.1',r));
const base='http://127.0.0.1:8766'+prefix+'index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const instrumentation=`(()=>{
 if(!sessionStorage.getItem('r3-seeded')){localStorage.clear();sessionStorage.setItem('r3-seeded','1');}window.__starts=[];window.__nativeCalls=[];
 const p=AudioContext.prototype,orig=p.createBufferSource;p.createBufferSource=function(...a){const b=orig.apply(this,a),start=b.start.bind(b);b.start=(...a)=>{window.__starts.push(a);return start(...a);};return b;};
})();`;
function nativeSdk(mode){return `(()=>{
 let listener,state={position:0,duration:170000,timestamp:Date.now(),rate:0,playing:false,muted:false};
 const snapshot=()=>({...state,position:state.position+(Date.now()-state.timestamp)*state.rate,timestamp:Date.now()});
 const support=${JSON.stringify(mode)}==='host';
 window.toy={async isSupport(a){if(${JSON.stringify(mode)}==='stalled')return new Promise(()=>{});return support&&['onPlayerChange','getPlayerState','setPlayerState','onContainerChange'].includes(a);},
  onPlayerChange(fn){listener=fn;fn(snapshot());return()=>{listener=null;};},async getPlayerState(){return snapshot();},
  async setPlayerState(req){window.__nativeCalls.push(req);const current=snapshot();state={...current,...req};state.rate=state.playing?1:0;setTimeout(()=>listener?.(snapshot()),15);},
  onContainerChange(fn){fn({safeArea:{bottom:12},viewport:{width:390,height:450},changedFields:[]});return()=>{};}
 };
 window.__nativeNow=()=>snapshot().position;
 window.__nativeJitter=delta=>{state={...snapshot(),position:snapshot().position+delta};listener?.(snapshot());};
})();`;}
async function page(mode){
 const t=await(await fetch(debug+'/json/new?about:blank',{method:'PUT'})).json();const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let seq=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);if(p){pending.delete(d.id);d.error?p.reject(new Error(JSON.stringify(d.error))):p.resolve(d.result);}}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
 const wait=async expression=>{const end=Date.now()+6000;while(Date.now()<end){if(await ev(expression))return;await sleep(40);}throw new Error('Timed out '+expression+' '+await ev('document.body.innerText'));};
 await call('Page.enable');await call('Runtime.enable');await call('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation+nativeSdk(mode)+(mode==='stalled'?`{const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===30000?500:ms,...args);}`:'')});
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:700,deviceScaleFactor:1,mobile:true});await call('Page.navigate',{url:base});await call('Page.bringToFront');
 return{call,ev,wait,errors,async close(){await fetch(debug+'/json/close/'+t.id);if(ws.readyState===WebSocket.OPEN)ws.close();}};
}
try{
 for(const missing of ['app.js','core.js']){
  blockedResource=missing;const c=await page('host');
  try{await c.wait("document.body?.dataset.boot==='failed'");
   assert.equal(await c.ev("document.querySelector('video')"),null);
   assert.equal(await c.ev("document.getElementById('local-player')"),null);
   assert.equal(await c.ev("document.getElementById('error').hidden"),false);
   assert.ok(await c.ev("document.getElementById('error').textContent.includes('脚本')"));
   assert.ok(await c.ev("document.getElementById('loading').textContent.includes('失败')"));
   assert.equal(await c.ev("document.querySelector('[data-difficulty]').disabled"),true);
   results.push({test:'missing '+missing+' is a visible startup error, with no embedded video even before app execution',pass:true});
  }finally{await c.close();}
 }
 blockedResource=null;
 {const c=await page('stalled');try{
  await c.wait("document.body?.dataset.boot==='failed'");
  assert.ok(await c.ev("document.getElementById('error').textContent.includes('超时')"));
  assert.equal(await c.ev("document.querySelector('video')"),null);
  assert.equal(await c.ev("document.getElementById('calibrate').disabled"),true);
  results.push({test:'unresponsive native bridge times out visibly instead of loading forever',pass:true});
 }finally{await c.close();}}
 let before=requests.length;let c=await page('unsupported');
 try{await c.wait("document.getElementById('error')&&!document.getElementById('error').hidden");
  const text=await c.ev("document.getElementById('error').textContent");assert.ok(text.includes('最新版'));assert.ok(text.includes('半屏 Toy'));
  assert.equal(await c.ev("document.querySelector('[data-difficulty]').disabled"),true);assert.equal(await c.ev("document.getElementById('calibrate').disabled"),true);
  assert.equal(requests.slice(before).some(p=>p.endsWith('.wav')||p.endsWith('.mp4')),false);assert.deepEqual(c.errors,[]);
  results.push({test:'non-App/old-App/missing-player capability blocks start and calibration; suggests supported environment; no audio/video download',pass:true});
 }finally{await c.close();}
 before=requests.length;c=await page('host');
 try{await c.wait("document.querySelector('[data-difficulty]')&&!document.querySelector('[data-difficulty]').disabled");
  assert.equal(await c.ev("document.getElementById('local-player')"),null);assert.equal(await c.ev("document.querySelector('video')"),null);
  assert.equal(await c.ev("document.getElementById('environment-notice').hidden"),true);assert.equal(await c.ev('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.equal(await c.ev("Number(document.getElementById('hit-volume').value)"),150);
  assert.equal(await c.ev("document.getElementById('toy-sound-notice').hidden"),false);
  assert.ok(await c.ev("document.getElementById('toy-sound-notice').textContent.includes('右上角')"));
  await c.ev("{const v=document.getElementById('hit-volume');v.value=220;v.dispatchEvent(new Event('input',{bubbles:true}));v.dispatchEvent(new Event('change',{bubbles:true}));}");
  assert.equal(await c.ev("JSON.parse(localStorage.getItem('xterfusion-lab-v1')).hitVolume"),220);
  const oldOrigin=await c.ev('performance.timeOrigin');
  await c.call('Page.reload');await c.wait(`performance.timeOrigin!==${oldOrigin} && document.querySelector('[data-difficulty]')&&!document.querySelector('[data-difficulty]').disabled`);
  assert.equal(await c.ev("Number(document.getElementById('hit-volume').value)"),220);
  results.push({test:'default150percent, explicit Toy-unmute hint, and persisted volume restored on reload',pass:true});
  await c.ev("document.querySelector('[data-difficulty=easy]').click()");await c.wait("document.getElementById('panel').dataset.screen==='playing' && !document.getElementById('pause').disabled");
  await c.ev("window.__nativeJitter(-200)");
  assert.equal(await c.ev("document.getElementById('practice-indicator').hidden"),true);
  await c.ev("{document.getElementById('game-volume').open=true;const v=document.getElementById('game-hit-volume');v.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));v.value=180;v.dispatchEvent(new Event('input',{bubbles:true}));v.dispatchEvent(new Event('change',{bubbles:true}));}");
  assert.equal(await c.ev("document.getElementById('hit-volume-value').textContent"),'180%');
  assert.equal(await c.ev("JSON.parse(localStorage.getItem('xterfusion-lab-v1')).hitVolume"),180);
  assert.equal(await c.ev('window.__starts.length'),0);
  await c.ev("document.getElementById('game-volume').open=false");
  const outcome=await c.ev(`(async()=>{const chart=await(await fetch('./data/chart.json')).json();const targets=chart.rounds.slice(0,3).flatMap(r=>r.notes).map(n=>n.midiMs+14);let i=0;const until=performance.now()+20000;
   return new Promise((resolve,reject)=>{const timer=setInterval(()=>{const now=window.__nativeNow();while(i<targets.length&&now>=targets[i]-2){document.body.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));i++;}
    if(document.getElementById('panel').dataset.screen==='result'){clearInterval(timer);resolve({taps:i,hits:window.__starts.length,score:document.getElementById('result-score').textContent,calls:window.__nativeCalls,time:now});}
    else if(performance.now()>until){clearInterval(timer);reject(new Error('host playthrough timeout '+JSON.stringify({now,played:i,screen:document.getElementById('panel').dataset.screen,phase:document.getElementById('phase').textContent,text:document.body.innerText,calls:window.__nativeCalls})));}},2);});})()`);
  assert.equal(outcome.taps,18);assert.equal(outcome.hits,18);assert.ok(outcome.calls[0].muted===false);assert.equal(outcome.calls.some(r=>r.muted===true),false);
  assert.equal(await c.ev("document.getElementById('result').dataset.eligible"),'true');
  assert.equal(await c.ev("document.getElementById('result').dataset.locked"),'true');
  assert.equal(await c.ev("document.getElementById('retry').disabled && document.getElementById('choose').disabled && document.getElementById('submit-score').disabled"),true);
  await c.ev("for(let i=0;i<12;i++){document.getElementById('retry').click();document.getElementById('choose').dispatchEvent(new MouseEvent('click',{bubbles:true}));}");
  assert.equal(await c.ev("document.getElementById('panel').dataset.screen"),'result');
  assert.equal(await c.ev("document.getElementById('result-score').textContent"),outcome.score);
  results.push({test:'slight first-run native jitter stays ranked; in-game slider never counts as a hit;1.2s result lock preserves score during repeated taps',pass:true});
  await sleep(150);assert.ok(await c.ev('window.__nativeNow()')>outcome.time+100);
  const own=requests.slice(before);assert.equal(own.filter(p=>p.endsWith('drum-atlas.wav')).length,2);assert.equal(own.some(p=>p.includes('backing')||p.endsWith('.mp4')),false);
  assert.ok(own.every(p=>p.startsWith(prefix)),JSON.stringify(own));assert.deepEqual(c.errors,[]);
  results.push({test:'host-only production bundle under /toy/test-package/: one native player, audible native video,18 original drum cues, continued outro, no full-song request or root-absolute resource',...outcome,pass:true});
  await c.wait("!document.getElementById('retry').disabled && document.getElementById('result').dataset.locked==='false'");
  const shot=await c.call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/host-production-result.png',Buffer.from(shot.data,'base64'));
  await c.ev("document.getElementById('choose').click()");
  const beforeCal=await c.ev('({calls:window.__nativeCalls.length,sounds:window.__starts.length})');
  await c.ev("document.getElementById('calibrate').click()");
  await c.wait("document.getElementById('panel').dataset.screen==='calibrating'&&!document.getElementById('cancel-calibration').disabled");
  const cal=await c.ev(`new Promise((resolve,reject)=>{let index=8,total=0;const until=performance.now()+18000;const timer=setInterval(()=>{
   const now=window.__nativeNow();while(index<30&&now>=44062.5+index*468.75+14+85){document.body.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));index++;total++;}
   const area=document.getElementById('calibration');if(['saved','failed'].includes(area.dataset.status)){clearInterval(timer);resolve({status:area.dataset.status,offset:Number(area.dataset.offsetMs),samples:Number(area.dataset.sampleCount),total,calls:window.__nativeCalls.length,sounds:window.__starts.length});}
   else if(performance.now()>until){clearInterval(timer);reject(new Error('native continuous calibration timeout'));}
  },2);})`);
  assert.equal(cal.status,'saved',JSON.stringify(cal));assert.ok(cal.offset>=80&&cal.offset<=100);assert.equal(cal.total,22);assert.equal(cal.samples,20);
  assert.equal(cal.calls-beforeCal.calls,1);assert.equal(cal.sounds,beforeCal.sounds);
  results.push({test:'production native calibration: join4s late in a continuous14s pass, exactly one seek and no drum feedback',...cal,pass:true});

 }finally{await c.close();}
 await writeFile('.cache/browser-host.json',JSON.stringify({results,requests},null,2));console.log(JSON.stringify(results,null,2));
}finally{await new Promise(r=>server.close(r));}
