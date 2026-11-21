import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RhythmSession} from '../core.mjs';
import {scoreRun} from '../scoring.mjs';
const chart=JSON.parse(await readFile(new URL('./fixtures/chart.json',import.meta.url),'utf8'));
for(const [difficulty,total]of [['easy',18],['normal',66],['hard',162]]){
 test(`${difficulty}: all exact calibrated inputs yield theoretical 101.0000%`,()=>{
  const session=new RhythmSession(chart,{difficulty,offsetMs:14});
  for(const n of session.targets){session.advance(n.midiMs+14,true);assert.equal(session.hit(n.midiMs+14).rating,'criticalPerfect');}
  session.advance(session.endVideoMs,true);const summary=session.summary(),score=scoreRun(summary);
  assert.equal(summary.total,total);assert.equal(summary.eligible,true);assert.equal(summary.pending,0);
  assert.equal(score.percentage,'101.0000%');assert.equal(score.grade,'SSS+');assert.equal(score.theoretical,true);
 });
}
test('early demo-ending input retains negative timing and reduces achievement normally',()=>{
 const s=new RhythmSession(chart,{difficulty:'easy',offsetMs:14});
 for(const [i,n]of s.targets.entries()){const at=n.midiMs+14-(i===0?40:0);s.advance(at,true);const result=s.hit(at);if(i===0){assert.equal(result.errorMs,-40);assert.equal(result.rating,'great');}}
 s.advance(s.endVideoMs,true);assert.equal(s.summary().eligible,true);assert.equal(scoreRun(s.summary()).percentage,'99.8333%');
});
test('all misses remain a valid completed C result; skipped notes cannot be ranked',()=>{
 const s=new RhythmSession(chart,{difficulty:'hard'});s.advance(s.endVideoMs,true);assert.equal(s.summary().miss,162);assert.equal(s.summary().eligible,true);assert.equal(scoreRun(s.summary()).grade,'C');
 s.seek(s.endVideoMs);assert.equal(s.summary().eligible,false);
});
