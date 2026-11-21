// Real-Edge integration checks; only the dedicated project headless profile/port is used.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.LAB_URL||'http://127.0.0.1:8765',debug=process.env.CDP_URL||'http://127.0.0.1:9228';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
const instrumentation=`(()=>{
 localStorage.removeItem('xterfusion-lab-v1');
 window.__audioTrace={starts:[],stops:[],nextId:0};
 const proto=(window.AudioContext||window.webkitAudioContext).prototype,original=proto.createBufferSource;
 proto.createBufferSource=function(...args){const source=original.apply(this,args),context=this,id=++window.__audioTrace.nextId;
 const start=source.start.bind(source),stop=source.stop.bind(source);
 source.start=function(...values){window.__audioTrace.starts.push({id,args:values,at:context.currentTime,duration:source.buffer?.duration});return start(...values);};
 source.stop=function(...values){window.__audioTrace.stops.push({id,at:context.currentTime});return stop(...values);};return source;};
})();`;
const fakeSdk=`window.__sdkCalls=[];window.toy={
 async isSupport(a){return ['getRankList','submitScore','getMyRank'].includes(a);},
 async getRankList(req){window.__sdkCalls.push({method:'read',req});return[{rank:1,score:1010000,nickname:'玩家甲',avatar:''},{rank:2,score:1005000,nickname:'<img src=x onerror=alert(1)>',avatar:''}];},
 async submitScore(req){window.__sdkCalls.push({method:'submit',req});return{score:1010000};},
 async getMyRank(req){window.__sdkCalls.push({method:'mine',req});return{ranked:true,rank:7,score:1010000};}
};`;
async function openLab(fake=false){
 const target=await(await fetch(`${debug}/json/new?about:blank`,{method:'PUT'})).json();
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let sequence=0;const pending=new Map(),exceptions=[],badResponses=[];
 socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const task=pending.get(data.id);if(task){pending.delete(data.id);data.error?task.reject(new Error(JSON.stringify(data.error))):task.resolve(data.result);}}
 if(data.method==='Runtime.exceptionThrown')exceptions.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);
 if(data.method==='Network.responseReceived'&&data.params.response.status>=400)badResponses.push(data.params.response.url);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
 const wait=async(expression,timeout=25000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await ev(expression))return;await sleep(40);}throw new Error('Timeout '+expression+'\n'+await ev('document.body.innerText'));};
 const shot=async path=>{const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path,Buffer.from(image.data,'base64'));};
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
 await call('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation+(fake?fakeSdk:'')});
 await call('Emulation.setDeviceMetricsOverride',{width:1360,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:base});await call('Page.bringToFront');
 await wait("!!document.querySelector('[data-difficulty]') && !document.querySelector('[data-difficulty]').disabled");
 return{call,ev,wait,shot,exceptions,badResponses,async close(){const closed=new Promise(resolve=>{socket.addEventListener('close',resolve,{once:true});setTimeout(resolve,1000);});await fetch(`${debug}/json/close/${target.id}`).catch(()=>{});await closed;if(socket.readyState===WebSocket.OPEN)socket.close();}};
}
async function automate(client,id,{earlyFirst=false,extra=false,alreadyStarted=false}={}){
 if(!alreadyStarted){await client.ev(`document.querySelector('[data-difficulty="${id}"]').click()`);}
 await client.wait("document.getElementById('panel').dataset.screen==='playing' && !document.getElementById('pv').paused && !document.getElementById('pv').seeking");
 return client.ev(`(async()=>{
  const chart=await(await fetch('/data/chart.json')).json();const difficulty=chart.difficulties.find(d=>d.id==='${id}');
  const rounds=chart.rounds.slice(0,difficulty.roundCount).concat(difficulty.includeChallenge?chart.challengeRounds:[]);
  const offset=Number(document.getElementById('media-offset').value)+Number(document.getElementById('input-offset').value);
  const notes=rounds.flatMap(r=>r.notes).map(n=>n.midiMs+offset);
  let i=0,extra=false,extraSilent=null,firstFeedback='',sawStream=false;
  const initial=window.__audioTrace.starts.filter(s=>s.args.length===3).length;
  const press=(keyboard=false)=>keyboard?document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',bubbles:true})):document.body.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,pointerType:'touch'}));
  return new Promise((resolve,reject)=>{const deadline=performance.now()+50000;const timer=setInterval(()=>{try{
   const now=document.getElementById('pv').currentTime*1000;
   while(i<notes.length&&now>=notes[i]-(i===0&&${earlyFirst}?40:4)){press(i===0&&${earlyFirst});if(i===0)firstFeedback=document.getElementById('feedback').textContent;i++;}
   if(document.getElementById('phase').textContent==='连打')sawStream=true;
   if(${extra}&&!extra&&now>=notes[0]+190&&now<notes[1]-110){const before=window.__audioTrace.starts.filter(s=>s.args.length===3).length;press();extra=true;extraSilent=before===window.__audioTrace.starts.filter(s=>s.args.length===3).length;}
   if(document.getElementById('panel').dataset.screen==='result'){
    clearInterval(timer);const counts=Object.fromEntries(['criticalPerfect','perfect','great','good','miss','extra'].map(k=>[k,Number(document.getElementById('count-'+k).textContent)]));
    resolve({id:'${id}',counts,units:Number(document.getElementById('result').dataset.units),score:document.getElementById('result-score').textContent,grade:document.getElementById('result-grade').textContent,
     eligible:document.getElementById('result').dataset.eligible,played:window.__audioTrace.starts.filter(s=>s.args.length===3).length-initial,firstFeedback,extra,extraSilent,sawStream,
     errorHidden:document.getElementById('error').hidden,paused:document.getElementById('pv').paused,time:document.getElementById('pv').currentTime});
   }else if(performance.now()>deadline){clearInterval(timer);reject(new Error('playthrough timeout'));}
  }catch(e){clearInterval(timer);reject(e);}},2);});
 })()`);
}
await mkdir('.cache',{recursive:true});
const local=await openLab();
try{
 assert.equal(await local.ev("getComputedStyle(document.getElementById('panel')).backgroundImage"),'none');
 assert.equal(await local.ev("!!document.getElementById('hit-pad')"),false);
 await local.wait("!document.getElementById('pv').seeking && document.getElementById('pv').readyState>=2");
 await local.shot('.cache/ui-minimal-desktop.png');
 await local.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
 assert.ok(await local.ev('document.documentElement.scrollWidth<=innerWidth'));await local.shot('.cache/ui-minimal-mobile.png');
 await local.call('Emulation.setDeviceMetricsOverride',{width:1360,height:1000,deviceScaleFactor:1,mobile:false});
 results.push({test:'solid-color panel / whole-page input / 390px layout',pass:true});
 await local.ev("document.querySelector('[data-difficulty=easy]').click()");await local.wait("document.getElementById('pv').currentTime>75.6");
 await local.ev("document.body.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}))");
 assert.equal(await local.ev('window.__audioTrace.starts.filter(s=>s.args.length===3).length'),0);
 await local.ev("document.getElementById('pause').focus();document.getElementById('pause').click()");await local.wait("document.getElementById('pv').paused");const paused=await local.ev("document.getElementById('pv').currentTime");await sleep(200);assert.equal(await local.ev("document.getElementById('pv').currentTime"),paused);
 await local.ev("document.getElementById('pause').focus();document.getElementById('pause').click()");
 assert.equal(await local.ev("document.activeElement===document.getElementById('pause')"),false);
 await local.ev("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");
 await local.wait("document.getElementById('pv').paused");
 await local.ev("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
 await local.wait("document.getElementById('phase').textContent==='暂停'");
 await local.ev("document.getElementById('pause').click()");
 results.push({test:'focused controls release keyboard hits; BFCache-style persisted restore remains playable',pass:true});
 const easy=await automate(local,'easy',{earlyFirst:true,alreadyStarted:true});
 assert.equal(easy.played,18);assert.equal(easy.counts.miss,0);assert.equal(easy.counts.great,1);assert.ok(easy.firstFeedback.includes('−'));assert.equal(easy.eligible,'true');assert.equal(easy.paused,false);assert.equal(easy.errorHidden,true);
 results.push({test:'easy 18-hit full-page playthrough; early first press keeps real negative timing',...easy,pass:true});
 const time=easy.time;await sleep(400);assert.ok(await local.ev('document.getElementById("pv").currentTime')>time+.2);
 await local.wait("document.getElementById('rank-status').textContent.includes('本地试玩')");assert.equal(await local.ev("document.querySelectorAll('#rank-list li').length"),0);
 results.push({test:'result music continues / local leaderboard never fabricates global players',pass:true});
 await local.wait("!document.getElementById('retry').disabled");await local.ev("document.getElementById('retry').click()");await local.wait("document.getElementById('panel').dataset.screen==='playing' && document.getElementById('pv').currentTime<76 && !document.getElementById('abort').disabled");
 await local.ev("document.getElementById('abort').click()");assert.equal(await local.ev("document.getElementById('panel').dataset.screen"),'menu');
 results.push({test:'one-click retry and return-to-difficulty menu',pass:true});
 const normal=await automate(local,'normal',{extra:true});assert.equal(normal.played,66);assert.equal(normal.counts.miss,0);assert.equal(normal.counts.extra,1);assert.equal(normal.extraSilent,true);assert.equal(normal.paused,false);
 assert.equal(normal.units,Math.floor((101*normal.counts.criticalPerfect+100*normal.counts.perfect+80*normal.counts.great+50*normal.counts.good-50)*10000/66));
 results.push({test:'normal 66-hit playthrough / wrong tap silent and penalized',...normal,pass:true});
 await local.wait("!document.getElementById('choose').disabled");await local.ev("document.getElementById('choose').click()");
 const hard=await automate(local,'hard');assert.equal(hard.played,162);assert.equal(hard.counts.miss,0);assert.equal(hard.counts.extra,0);assert.equal(hard.sawStream,true);assert.equal(hard.eligible,'true');assert.equal(hard.paused,false);assert.ok(hard.units>=1005000);assert.equal(hard.grade,'SSS+');
 await local.shot('.cache/ui-minimal-result.png');results.push({test:'hard 162-hit playthrough including 96 accelerated tail hits',...hard,pass:true});
 await local.wait("!document.getElementById('retry').disabled");await local.ev("document.getElementById('retry').click()");await local.wait("document.getElementById('pv').currentTime<76 && !document.getElementById('pv').seeking");
 await local.ev("document.getElementById('pv').playbackRate=1.25");await local.wait("!document.getElementById('practice-indicator').hidden");
 await local.ev("document.getElementById('pv').currentTime=112.0");await local.wait("document.getElementById('panel').dataset.screen==='result'");assert.equal(await local.ev("document.getElementById('result').dataset.eligible"),'false');assert.equal(await local.ev("document.getElementById('submit-score').hidden"),true);
 results.push({test:'rate-change/seek practice run cannot enter public ranking',pass:true});
 assert.deepEqual(local.exceptions,[]);assert.deepEqual(local.badResponses,[]);
}finally{await local.close();}
const remote=await openLab(true);
try{
 const run=await automate(remote,'easy');assert.equal(run.played,18);await remote.wait("document.querySelectorAll('#rank-list li').length===2");
 let calls=await remote.ev('window.__sdkCalls');assert.equal(calls.filter(c=>c.method==='submit').length,0);assert.equal(calls.filter(c=>c.method==='read').length,1);
 assert.equal(await remote.ev("document.querySelector('#rank-list img')"),null);assert.equal(await remote.ev("document.getElementById('submit-score').hidden"),false);
 assert.equal(await remote.ev("document.getElementById('submit-score').disabled"),true);
 await remote.ev("document.getElementById('submit-score').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
 assert.equal((await remote.ev('window.__sdkCalls')).filter(c=>c.method==='submit').length,0);
 await remote.wait("!document.getElementById('submit-score').disabled");await remote.ev("document.getElementById('submit-score').click()");await remote.wait("document.getElementById('rank-status').textContent.includes('第 7 名')");
 calls=await remote.ev('window.__sdkCalls');const submission=calls.find(c=>c.method==='submit');assert.equal(submission.req.board,1);assert.equal(submission.req.score,run.units);assert.equal(calls.filter(c=>c.method==='submit').length,1);assert.equal(calls.filter(c=>c.method==='mine').length,1);
 const count=calls.length;await sleep(400);assert.equal((await remote.ev('window.__sdkCalls')).length,count);assert.equal(await remote.ev("document.getElementById('pv').paused"),false);
 results.push({test:'fake SDK contract: explicit submission only, correct board/units, rank lookup, no polling/XSS',pass:true});
 assert.deepEqual(remote.exceptions,[]);assert.deepEqual(remote.badResponses,[]);
}finally{await remote.close();}
await writeFile('.cache/browser-smoke.json',JSON.stringify({results},null,2));console.log(JSON.stringify({results},null,2));
