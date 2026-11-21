import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try {module=await import('../player.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const enabled={skip:!module};
function fixture(){let listener;const calls=[];let off=false;const initial={position:0,duration:170000,timestamp:Date.now(),rate:0,playing:false,muted:false};
 const toy={async isSupport(a){return ['onPlayerChange','getPlayerState','setPlayerState'].includes(a);},onPlayerChange(fn){listener=fn;fn(initial);return()=>{off=true};},async getPlayerState(){return initial;},async setPlayerState(req){calls.push(req);}};
 return{toy,calls,emit:s=>listener({...initial,timestamp:Date.now(),...s}),getOff:()=>off};}
test('player adapter exists',()=>assert.equal(typeof module?.createPlayer,'function'));
test('native seek awaits actual player state, not merely Promise<void>',enabled,async()=>{
 const f=fixture();const p=await module.createPlayer(null,{toy:f.toy});let applied=false;const pending=p.seekAndPlay(75000).then(()=>applied=true);
 await new Promise(r=>setTimeout(r,10));assert.equal(applied,false);assert.deepEqual(f.calls[0],{position:75000,playing:true,muted:false});
 f.emit({position:75000,playing:true,muted:false,rate:1});await pending;assert.equal(applied,true);assert.equal(p.playing(),true);p.destroy();assert.equal(f.getOff(),true);
});
test('native pause blocks the local audio clock immediately',enabled,async()=>{
 const f=fixture(),p=await module.createPlayer(null,{toy:f.toy});f.emit({position:75000,playing:true,rate:1,muted:false});assert.equal(p.playing(),true);
 await p.pause();assert.equal(p.playing(),false);f.emit({position:75010,playing:false,rate:0,muted:false});assert.equal(p.playing(),false);p.destroy();
});
test('external native jumps are reported but commanded jumps are not',enabled,async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});
 const pending=p.seekAndPlay(75000);f.emit({position:75000,playing:true,muted:false,rate:1});await pending;assert.equal(jumps.length,0);
 f.emit({position:83000,playing:true,muted:false,rate:1});assert.equal(jumps.length,1);p.destroy();
});

test('a 200ms native correction is tolerated instead of falsely marking a seek',enabled,async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});
 const pending=p.seekAndPlay(75000);f.emit({position:75000,playing:true,muted:false,rate:1});await pending;
 f.emit({position:74800,playing:true,muted:false,rate:1});assert.equal(jumps.length,0);p.destroy();
});
test('normal small heartbeat corrections and buffering do not falsely mark a seek',enabled,async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});
 const pending=p.seekAndPlay(75000);f.emit({position:75000,playing:true,muted:false,rate:1});await pending;
 f.emit({position:75005,playing:true,muted:false,rate:1});
 f.emit({position:75005,playing:true,muted:false,rate:0});assert.equal(jumps.length,0);p.destroy();
});

test('buffer transition compares source sampling times instead of bridge arrival time',enabled,async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});
 const stamp=Date.now()-200,pending=p.seekAndPlay(75000);
 f.emit({position:75000,playing:true,muted:false,rate:1,timestamp:stamp});await pending;
 f.emit({position:75010,playing:true,muted:false,rate:0,timestamp:stamp+10});
 assert.equal(jumps.length,0);p.destroy();
});
test('a small buffering correction does not mark the run as practice',enabled,async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});
 const pending=p.seekAndPlay(75000);f.emit({position:75000,playing:true,muted:false,rate:1});await pending;
 f.emit({position:74800,playing:true,muted:false,rate:0});assert.equal(jumps.length,0);p.destroy();
});

test('host starts and resumes audible video; a muted state is not an acknowledged audible start',enabled,async()=>{
 const f=fixture(),p=await module.createPlayer(null,{toy:f.toy});let applied=false;
 const pending=p.seekAndPlay(75000).then(()=>{applied=true});
 try{
  assert.deepEqual(f.calls[0],{position:75000,playing:true,muted:false});
  f.emit({position:75000,playing:true,muted:true,rate:1});await new Promise(r=>setTimeout(r,5));assert.equal(applied,false);
  f.emit({position:75000,playing:true,muted:false,rate:1});await pending;assert.equal(p.playing(),true);
  await p.pause();await p.resume();assert.deepEqual(f.calls.at(-1),{playing:true,muted:false});
 }finally{p.destroy();await pending.catch(()=>{});}
});

test('production without a supported host rejects clearly without touching a local video element',async()=>{
 await assert.rejects(module.createPlayer(null,{toy:{async isSupport(){return false;}},requireHost:true}),/半屏|配套视频/);
});

test('stable playback tolerates750ms jitter but catches a2s seek after settling',async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});const t=Date.now();
 const pending=p.seekAndPlay(75000);f.emit({position:75000,playing:true,rate:1,timestamp:t});await pending;
 f.emit({position:79500,playing:true,rate:1,timestamp:t+5000});assert.equal(jumps.length,0);
 f.emit({position:78000,playing:true,rate:1,timestamp:t+5500});assert.equal(jumps.length,1);p.destroy();
});
test('first3s and buffering recovery tolerate1.5s corrections, not a large jump',async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});const t=Date.now();
 const pending=p.seekAndPlay(75000);f.emit({position:75000,playing:true,rate:1,timestamp:t});await pending;
 f.emit({position:74800,playing:true,rate:1,timestamp:t+900});assert.equal(jumps.length,0);
 f.emit({position:74800,playing:true,rate:0,timestamp:t+1800});assert.equal(jumps.length,0);
 f.emit({position:75000,playing:true,rate:1,timestamp:t+2500});assert.equal(jumps.length,0);
 f.emit({position:79000,playing:true,rate:0,timestamp:t+2600});assert.equal(jumps.length,1);p.destroy();
});
test('out-of-order native samples cannot rewind the clock or mark a jump',async()=>{
 const f=fixture(),jumps=[],p=await module.createPlayer(null,{toy:f.toy,onSeek:t=>jumps.push(t)});const t=Date.now();
 f.emit({position:75000,playing:true,rate:1,timestamp:t});f.emit({position:67000,playing:true,rate:1,timestamp:t-1000});
 assert.equal(jumps.length,1); // Initial actual jump from the zero fixture only.
 assert.ok(p.now()>=75000);p.destroy();
});
