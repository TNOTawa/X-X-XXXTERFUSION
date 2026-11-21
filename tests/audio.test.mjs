import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try { module = await import('../sample-audio.mjs'); } catch (error) { if(error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const enabled = { skip: !module };
function fixture() {
  const sources=[];
  const param=()=>({value:1,setValueAtTime(){},linearRampToValueAtTime(){}});
  const node=()=>({gain:param(),connect(){},disconnect(){}});
  const context={currentTime:10,state:'running',destination:{},sources,
    createGain:node, createDynamicsCompressor:()=>({connect(){},threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()}),
    createBufferSource(){const s={...node(),playbackRate:{value:1},starts:[],stopped:false,
      start(...args){this.starts.push(args);},stop(){this.stopped=true;}};sources.push(s);return s;},
    createMediaElementSource(){return node();},async resume(){this.state='running';},async close(){this.state='closed';}};
  const audio=new module.SampleAudio(context,{backingEnabled:true});
  audio.setAssets({backingOffsetMs:0,cues:{a:{offsetSeconds:.2,durationSeconds:.12},b:{offsetSeconds:.5,durationSeconds:.04}}}, {duration:170}, {duration:2});
  return {audio,context,sources};
}
test('sample audio implementation exists',()=>assert.equal(typeof module?.SampleAudio,'function'));
test('only successful judgements play the original drum cue',enabled,()=>{
 const {audio,sources}=fixture();
 for(const rating of ['ignored','extra','miss']) assert.equal(audio.playHit({rating,note:{id:'a'}}),false);
 assert.equal(sources.length,0);
 assert.equal(audio.playHit({rating:'perfect',note:{id:'a'}}),true);
 assert.deepEqual(sources[0].starts[0],[10,.2,.12]);
});
test('rapid correct hits create independent predecoded sources, without debounce',enabled,()=>{
 const {audio,context,sources}=fixture();audio.playHit({rating:'perfect',note:{id:'a'}});context.currentTime+=.044;
 audio.playHit({rating:'great',note:{id:'b'}});assert.equal(sources.length,2);
 assert.equal(sources[1].starts[0][0],10.044);
});
test('unknown cues and disabled hit sound remain silent',enabled,()=>{
 const {audio,sources}=fixture();assert.equal(audio.playHit({rating:'perfect',note:{id:'unknown'}}),false);
 audio.hitsEnabled=false;assert.equal(audio.playHit({rating:'perfect',note:{id:'a'}}),false);assert.equal(sources.length,0);
});
test('backing starts at video time and does not restart on ordinary frames',enabled,()=>{
 const {audio,context,sources}=fixture();audio.sync(75000,true,1);assert.deepEqual(sources[0].starts[0],[10,75]);
 context.currentTime+=.02;audio.sync(75020,true,1);assert.equal(sources.length,1);
});
test('pause stops both backing and current sample tails',enabled,()=>{
 const {audio,sources}=fixture();audio.sync(75000,true,1);audio.playHit({rating:'perfect',note:{id:'a'}});
 audio.sync(75030,false,1);assert.ok(sources.every(s=>s.stopped));
});
test('seek or playback-rate change rebases the backing',enabled,()=>{
 const {audio,context,sources}=fixture();audio.sync(75000,true,1);context.currentTime+=.02;audio.sync(81000,true,1);
 assert.ok(sources[0].stopped);assert.equal(sources[1].starts[0][1],81);
 audio.sync(81000,true,.5);assert.equal(sources[2].playbackRate.value,.5);
});
test('original PV audio is routed through a zero-gain branch',enabled,()=>{
 const {audio}=fixture();const video={muted:false};audio.attachVideo(video,{muted:true});assert.equal(video.muted,true);assert.equal(audio.videoSilence.gain.value,0);
});
test('suspended audio never pretends to be playing a backing track',enabled,()=>{
 const {audio,context,sources}=fixture();context.state='suspended';audio.sync(75000,true,1);assert.equal(sources.length,0);
});

test('starting the backing after resume does not cancel a newly successful hit',enabled,()=>{
 const {audio,sources}=fixture();audio.playHit({rating:'perfect',note:{id:'a'}});
 audio.sync(75000,true,1);assert.equal(sources[0].stopped,false);assert.equal(sources.length,2);
});
test('drift-only backing corrections preserve active sample tails',enabled,()=>{
 const {audio,context,sources}=fixture();audio.sync(75000,true,1);audio.playHit({rating:'perfect',note:{id:'a'}});
 context.currentTime+=.02;audio.sync(75100,true,1);
 assert.equal(sources[0].stopped,true);assert.equal(sources[1].stopped,false);
});

test('Critical Perfect also restores the real drum sample',enabled,()=>{
 const {audio,sources}=fixture();assert.equal(audio.playHit({rating:'criticalPerfect',note:{id:'a'}}),true);assert.equal(sources.length,1);
});

test('Toy audio loads only the drum atlas, even when a legacy manifest has a backing URL',enabled,async()=>{
 const {context}=fixture();context.decodeAudioData=async()=>({duration:2});
 const audio=new module.SampleAudio(context,{backingEnabled:false}),requested=[];
 await audio.load({backingUrl:'/forbidden-full-song.wav',atlasUrl:'./data/drum-atlas.wav',cues:{a:{offsetSeconds:.2,durationSeconds:.12}}},async url=>{
  requested.push(url);return{ok:true,arrayBuffer:async()=>new ArrayBuffer(2)};
 });
 assert.deepEqual(requested,['./data/drum-atlas.wav']);assert.equal(audio.backingBuffer,null);
 audio.playHit({rating:'perfect',note:{id:'a'}});audio.sync(77000,true,1);
 assert.equal(context.sources.length,1);assert.equal(context.sources[0].stopped,false);
 audio.sync(77010,false,1);assert.equal(context.sources[0].stopped,true);
});
test('local rendered video keeps its own backing audio instead of being silenced',enabled,()=>{
 const {audio}=fixture(),video={muted:true,defaultMuted:true};audio.attachVideo(video,{muted:false});
 assert.equal(video.muted,false);assert.equal(video.defaultMuted,false);assert.equal(audio.videoSource,undefined);
});

test('drum gain defaults to150percent and can be adjusted without altering backing gain',()=>{
 const {audio}=fixture();assert.equal(audio.hitVolume,150);assert.equal(audio.hitGain.gain.value,1.5);
 const backing=audio.backingGain.gain.value;assert.equal(audio.setHitVolume(240),240);assert.equal(audio.hitGain.gain.value,2.4);
 assert.equal(audio.backingGain.gain.value,backing);audio.setHitVolume(0);assert.equal(audio.playHit({rating:'perfect',note:{id:'a'}}),false);
 assert.equal(audio.setHitVolume(999),300);assert.equal(audio.setHitVolume(-1),0);assert.equal(audio.setHitVolume(NaN),150);
});
