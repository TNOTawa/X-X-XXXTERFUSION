// Dedicated headless Edge only; real playback time and real DOM input paths.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.LAB_URL||'http://127.0.0.1:8765',debug=process.env.CDP_URL||'http://127.0.0.1:9228';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const instrumentation=`(()=>{
 if(!sessionStorage.getItem('calibration-smoke-seeded')){localStorage.setItem('xterfusion-lab-v1',JSON.stringify({inputOffset:30,mediaOffset:14}));sessionStorage.setItem('calibration-smoke-seeded','1');}
 window.__audioTrace={starts:[]};
 const proto=(window.AudioContext||window.webkitAudioContext).prototype,original=proto.createBufferSource;
 proto.createBufferSource=function(...args){const source=original.apply(this,args),start=source.start.bind(source);
 source.start=function(...values){window.__audioTrace.starts.push(values);return start(...values);};return source;};
})();`;
async function openLab(){
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
 await call('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation});
 await call('Emulation.setDeviceMetricsOverride',{width:1360,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:base});await call('Page.bringToFront');
 await wait("!!document.querySelector('[data-difficulty]') && !document.querySelector('[data-difficulty]').disabled");
 return{call,ev,wait,shot,exceptions,badResponses,async close(){const closed=new Promise(resolve=>{socket.addEventListener('close',resolve,{once:true});setTimeout(resolve,1000);});await fetch(`${debug}/json/close/${target.id}`).catch(()=>{});await closed;if(socket.readyState===WebSocket.OPEN)socket.close();}};
}

const results=[];await mkdir('.cache',{recursive:true});const c=await openLab();
async function click(selector){const p=await c.ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
 await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}
async function runCalibration(tap=true,startIndex=8){
 await c.wait("!document.getElementById('cancel-calibration').disabled && !document.getElementById('pv').paused && !document.getElementById('pv').seeking");
 return c.ev(`new Promise((resolve,reject)=>{
 let index=${startIndex},last=0,total=0,seeks=0;const video=document.getElementById('pv'),deadline=performance.now()+20000;
 const timer=setInterval(()=>{const now=video.currentTime*1000;
 if(now<last-1000)seeks++;last=now;
 if(${tap}&&!video.paused&&!video.seeking&&now>=44062.5+468.75*${startIndex}+14+85){while(index<30&&now>=44062.5+468.75*index+14+85){document.body.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));index++;total++;}}
 const area=document.getElementById('calibration');if(['saved','failed'].includes(area.dataset.status)){clearInterval(timer);resolve({status:area.dataset.status,offset:Number(area.dataset.offsetMs),input:Number(document.getElementById('input-offset').value),samples:Number(area.dataset.sampleCount),total,seeks,note:document.getElementById('calibration-note').textContent,hitSounds:window.__audioTrace.starts.filter(a=>a.length===3).length});}
 else if(performance.now()>deadline){clearInterval(timer);reject(new Error('calibration timeout '+document.body.innerText));}
 },2);
 })`);
}
try{
 assert.equal(await c.ev("Number(document.getElementById('input-offset').value)"),30);
 await click('#calibrate');
 await c.wait("document.getElementById('panel').dataset.screen==='calibrating' && !document.getElementById('cancel-calibration').disabled");
 await c.ev("document.getElementById('pv').pause()");await c.wait("!document.getElementById('resume-calibration').hidden");
 assert.equal(await c.ev("getComputedStyle(document.getElementById('resume-calibration')).pointerEvents"),'auto');
 await click('#resume-calibration');const first=await runCalibration();
 assert.equal(first.status,'saved');assert.ok(first.offset>=80&&first.offset<=100,JSON.stringify(first));assert.ok(first.samples>=18);assert.equal(first.total,22);assert.equal(first.seeks,0);assert.equal(first.hitSounds,0);results.push({test:'one continuous pass permits joining4s late, with no internal seek; replaces old30ms; no hit sample',...first});
 const saved=first.input;
 await c.call('Page.reload');await c.wait("document.querySelector('[data-difficulty]') && !document.querySelector('[data-difficulty]').disabled && document.getElementById('panel').dataset.screen==='menu'");
 assert.equal(await c.ev("Number(document.getElementById('input-offset').value)"),saved);
 assert.ok(await c.ev("document.getElementById('calibration-summary').textContent.includes('已校准')"));results.push({test:'local calibration restored on reload',offset:saved});
 await click('#calibrate');const second=await runCalibration();assert.equal(second.status,'saved');assert.ok(second.offset>=80&&second.offset<=100,JSON.stringify(second));assert.equal(second.hitSounds,0);assert.equal(second.seeks,0);results.push({test:'repeat calibration does not accumulate old compensation',...second});
 await click('#retry-calibration');const failed=await runCalibration(false);assert.equal(failed.status,'failed');assert.equal(failed.input,second.input);results.push({test:'insufficient samples preserve saved compensation',...failed});
 await click('#cancel-calibration');assert.equal(await c.ev("document.getElementById('panel').dataset.screen"),'menu');
 await click('#calibrate');await c.wait("!document.getElementById('cancel-calibration').disabled");await click('#cancel-calibration');assert.equal(await c.ev("document.getElementById('panel').dataset.screen"),'menu');
 assert.equal(c.exceptions.length,0,JSON.stringify(c.exceptions));assert.equal(c.badResponses.length,0,JSON.stringify(c.badResponses));
 await writeFile('.cache/browser-calibration.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await c.close();}
