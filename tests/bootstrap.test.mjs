import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const nodes={loading:{textContent:''},error:{hidden:true,textContent:''}};const buttons=[{disabled:true},{disabled:true}];
 const handlers={},timers=[];let cleared=0;
 const window={addEventListener:(name,fn)=>handlers[name]=fn};const document={body:{dataset:{}},getElementById:id=>nodes[id],querySelectorAll:()=>buttons};
 const context={window,document,setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout:()=>cleared++};
 vm.runInNewContext(readFileSync(new URL('../tools/toy_bootstrap.js',import.meta.url),'utf8'),context);
 return{window,document,nodes,buttons,handlers,timers,cleared:()=>cleared};
}
test('module entry/dependency load failure is visible instead of an infinite audio-loading message',()=>{
 const f=fixture();f.handlers.error({target:{tagName:'SCRIPT',src:'https://cdn.example/app.js'}});
 assert.equal(f.document.body.dataset.boot,'failed');assert.equal(f.nodes.error.hidden,false);
 assert.ok(f.nodes.error.textContent.includes('脚本'));assert.ok(f.nodes.loading.textContent.includes('失败'));
 assert.ok(f.buttons.every(b=>b.disabled));
});
test('startup timeout identifies its current stage and cannot enable a late completion',()=>{
 const f=fixture();f.window.__toyBoot.setPhase('正在连接 B站播放器');f.timers[0]();
 assert.equal(f.nodes.error.hidden,false);assert.ok(f.nodes.error.textContent.includes('B站播放器'));
 assert.equal(f.window.__toyBoot.ready(),false);
});
test('successful boot clears its watchdog and ignores later unrelated game errors',()=>{
 const f=fixture();assert.equal(f.window.__toyBoot.ready(),true);assert.equal(f.cleared(),1);
 f.handlers.error({message:'later game error'});assert.equal(f.nodes.error.hidden,true);assert.equal(f.document.body.dataset.boot,'ready');
});
