import test from 'node:test';
import assert from 'node:assert/strict';
let core;
try { core = await import('../core.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const enabled = { skip: !core };
const chart = { rounds: [{ id: 1, demoStartMs: 1000, answerStartMs: 2000, endMs: 3000,
  beatsPerPhrase: 2, demoNotes: [{ midiMs: 1000, pitches: [60] }],
  notes: [{ id: 'a', midiMs: 2000, pitches: [60, 64, 67] }, { id: 'b', midiMs: 2200, pitches: [62] }] }] };

test('judgement implementation exists', () => assert.equal(typeof core?.RhythmSession, 'function'));
test('material offset is applied to phase and targets', enabled, () => {
  const s = new core.RhythmSession(chart, { offsetMs: 100 });
  assert.equal(s.phaseAt(2050).kind, 'demo');
  assert.equal(s.phaseAt(2100).kind, 'answer');
  assert.equal(s.hit(2100).rating, 'criticalPerfect');
});
test('a piano chord is one judgement and cannot score twice', enabled, () => {
  const s = new core.RhythmSession(chart);
  assert.equal(s.hit(2000).note.id, 'a');
  assert.equal(s.hit(2001).rating, 'extra');
  assert.equal(s.summary().hit, 1);
});
test('nearest unmatched target supports rapid hits without debounce', enabled, () => {
  const fast = structuredClone(chart);
  fast.rounds[0].notes[1].midiMs = 2044;
  const s = new core.RhythmSession(fast);
  assert.equal(s.hit(2000).note.id, 'a');
  assert.equal(s.hit(2044).note.id, 'b');
  assert.equal(s.summary().hit, 2);
});
test('input calibration is independent of material alignment', enabled, () => {
  const s = new core.RhythmSession(chart, { offsetMs: 100, inputOffsetMs: 50 });
  const hit = s.hit(2150);
  assert.equal(hit.errorMs, 0);
  assert.equal(s.phaseAt(2050).kind, 'demo');
});
test('paused clocks do not generate misses', enabled, () => {
  const s = new core.RhythmSession(chart);
  s.advance(2800, false);
  assert.equal(s.summary().miss, 0);
  s.advance(2800, true);
  assert.equal(s.summary().miss, 2);
});
test('seeking skips earlier targets rather than generating a miss storm', enabled, () => {
  const s = new core.RhythmSession(chart);
  s.seek(2400);
  s.advance(2450, true);
  assert.equal(s.summary().miss, 0);
  assert.equal(s.summary().skipped, 2);
});
test('demo taps are ignored and negative offsets work', enabled, () => {
  const s = new core.RhythmSession(chart, { offsetMs: -100 });
  assert.equal(s.hit(1500).rating, 'ignored');
  assert.equal(s.hit(1900).rating, 'criticalPerfect');
});
test('host clock extrapolates from sample age with actual rate', enabled, () => {
  const clock = new core.HostClock();
  clock.update({ position: 1000, timestamp: 9000, rate: 1.5, playing: true, duration: 10000 }, 9100, 20);
  assert.equal(clock.position(220), 1450);
});
test('host pause and buffering rate zero freeze time', enabled, () => {
  const clock = new core.HostClock();
  clock.update({ position: 3000, timestamp: 1000, rate: 0, playing: true, duration: 10000 }, 1100, 10);
  assert.equal(clock.position(2010), 3000);
  clock.update({ position: 4000, timestamp: 1000, rate: 1, playing: false, duration: 10000 }, 1100, 10);
  assert.equal(clock.position(2010), 4000);
});
test('host interpolation clamps known duration', enabled, () => {
  const clock = new core.HostClock();
  clock.update({ position: 9900, timestamp: 1000, rate: 1, playing: true, duration: 10000 }, 1000, 0);
  assert.equal(clock.position(1000), 10000);
});

test('late-demo press is judged with its actual negative error',enabled,()=>{
 const s=new core.RhythmSession(chart);
 const result=s.hit(1951);assert.equal(result.rating,'great');assert.equal(result.errorMs,-49);
 assert.equal(s.summary().hit,1);assert.equal(s.hit(1952).rating,'extra');
});

test('negative input calibration keeps the first target hittable at its corrected boundary',enabled,()=>{
 const s=new core.RhythmSession(chart,{inputOffsetMs:-100});
 assert.equal(s.phaseAt(1900).kind,'demo');
 assert.equal(s.hit(1900).rating,'criticalPerfect');
 assert.equal(s.summary().hit,1);
});

test('early answer input is allowed from exactly 100ms, not before',enabled,()=>{
 const s=new core.RhythmSession(chart);
 assert.equal(s.hit(1899.9).rating,'ignored');
 assert.equal(s.hit(1900).rating,'good');
 assert.equal(s.hit(1901).rating,'extra');
});
test('hard difficulty includes follow-along tail and exposes independent chart totals',enabled,async()=>{
 const actual=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/chart.json',import.meta.url),'utf8'));
 const easy=new core.RhythmSession(actual,{difficulty:'easy'}),normal=new core.RhythmSession(actual,{difficulty:'normal'}),hard=new core.RhythmSession(actual,{difficulty:'hard'});
 assert.equal(easy.targets.length,18);assert.equal(normal.targets.length,66);assert.equal(hard.targets.length,162);
 assert.equal(hard.phaseAt(actual.challengeRounds[0].answerStartMs+1000).kind,'answer');assert.equal(hard.phaseAt(actual.challengeRounds[0].answerStartMs+1000).round.kind,'stream');
 assert.ok(hard.endVideoMs > hard.targets.at(-1).midiMs+100);
});
test('seek and playback-rate changes disqualify a run from public ranking',enabled,()=>{
 const s=new core.RhythmSession(chart);s.invalidate('变速');s.seek(2400);
 assert.equal(s.summary().eligible,false);assert.ok(s.summary().practiceReasons.length>=2);
});
test('completion grace accepts the final late hit without awarding pending targets',enabled,()=>{
 const tiny={rounds:[{id:1,demoStartMs:1000,answerStartMs:2000,endMs:2050,notes:[{id:'a',midiMs:2040,pitches:[60]}],demoNotes:[]}]};
 const s=new core.RhythmSession(tiny);assert.equal(s.hit(2110).rating,'good');assert.equal(s.summary().pending,0);
});

test('demo lead-in opens only the first response note, not later dense notes',enabled,()=>{
 const dense=structuredClone(chart);dense.rounds[0].notes[1].midiMs=2044;
 const s=new core.RhythmSession(dense);assert.equal(s.hit(1950).note.id,'a');
 assert.equal(s.hit(1951).rating,'extra');assert.equal(s.summary().hit,1);
 assert.equal(s.hit(2044).note.id,'b');
});
