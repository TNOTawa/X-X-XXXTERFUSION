import test from 'node:test';
import assert from 'node:assert/strict';

let calibration;
try {
  calibration = await import('../calibration.mjs');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('calibration.mjs')) throw error;
}
const enabled = { skip: !calibration };
// Independent, hand-checked MIDI fixture: not derived from the exported schedule.
const BEATS = [44062.5, 44531.25, 45000, 45468.75, 45937.5, 46406.25,
  46875, 47343.75, 47812.5, 48281.25, 48750];
const targets = (mediaOffsetMs = 14) => BEATS.map(time => time + mediaOffsetMs);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `expected ${actual} to be approximately ${expected}`);

function feedRound(session, round, errors = 85, indices = BEATS.map((_, i) => i), mediaOffsetMs = 14) {
  session.beginRound(round);
  return indices.map(index => session.tap(targets(mediaOffsetMs)[index]
    + (Array.isArray(errors) ? errors[index] : errors)));
}

function complete(errors = 85, options = {}) {
  const session = new calibration.CalibrationSession(options);
  for (let round = 0; round < (options.rounds ?? 2); round++) {
    feedRound(session, round, errors, undefined, options.mediaOffsetMs ?? 14);
  }
  return session;
}

function assertFailure(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.equal('offsetMs' in result, false, 'a failure must not expose a usable offset');
}

test('calibration module exports the required schedule and session', () => {
  assert.equal(typeof calibration?.CalibrationSession, 'function');
  assert.deepEqual(calibration.CALIBRATION_BEAT_MS, BEATS);
});

for (const latency of [85, -65, 280, -250, 350]) {
  test(`two raw-video passes recover signed ${latency}ms latency without beat wrapping`, enabled, () => {
    const session = new calibration.CalibrationSession();
    for (let round = 0; round < 2; round++) {
      const taps = feedRound(session, round, latency);
      assert.deepEqual(taps.map(tap => tap.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const [index, tap] of taps.entries()) {
        assert.equal(tap.accepted, true);
        near(tap.errorMs, latency);
        assert.equal(tap.count, index + 1);
      }
    }
    const result = session.result();
    assert.equal(result.ok, true);
    near(result.offsetMs, latency);
    assert.equal(result.sampleCount, 18);
    assert.equal(result.jitterMs, 0);
    assert.deepEqual(result.roundOffsets, [latency, latency]);
  });
}

for (const mediaOffsetMs of [0, 500, -90]) {
  test(`media alignment ${mediaOffsetMs}ms is applied once, independently of input latency`, enabled, () => {
    const result = complete(85, { mediaOffsetMs }).result();
    assert.equal(result.ok, true);
    near(result.offsetMs, 85);
  });
}

test('deterministic jitter and an isolated matched outlier use median and scaled MAD', enabled, () => {
  const result = complete([65, 100, 77, 81, 85, 89, 93, 85, 81, 89, 225]).result();
  assert.equal(result.ok, true);
  near(result.offsetMs, 85);
  near(result.jitterMs, 5.9304);
  assert.equal(result.sampleCount, 16);
  assert.deepEqual(result.roundOffsets, [85, 85]);
});

test('occasional missed beats preserve indices; a rapid duplicate cannot consume the next beat', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) {
    session.beginRound(round);
    const accepted = [];
    for (const index of [0, 1, 2, 3, 5, 6, 7, 9, 10]) {
      const raw = targets()[index] + 85;
      const tap = session.tap(raw);
      assert.equal(tap.accepted, true);
      accepted.push(tap.index);
      if (index === 2) assert.deepEqual(session.tap(raw + 20), { accepted: false, reason: 'duplicate' });
    }
    assert.deepEqual(accepted, [0, 1, 2, 3, 5, 6, 7, 9, 10]);
  }
  const result = session.result();
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 85);
  assert.equal(result.sampleCount, 14);
});

test('a non-rapid second press on the same beat is still a duplicate', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) {
    session.beginRound(round);
    for (let index = 0; index < 11; index++) {
      assert.equal(session.tap(targets()[index] + 85).index, index);
      if (index === 3) assert.equal(session.tap(targets()[index] + 225).accepted, false);
    }
  }
  assert.equal(session.result().offsetMs, 85);
  assert.equal(session.result().sampleCount, 18);
});

test('the first two matched taps of EACH round are excluded as warm-up', enabled, () => {
  const session = new calibration.CalibrationSession();
  feedRound(session, 0, [0, 170, 85, 85, 85, 85, 85, 85, 85, 85, 85]);
  feedRound(session, 1, [170, 0, 85, 85, 85, 85, 85, 85, 85, 85, 85]);
  assert.deepEqual(session.result(), {
    ok: true, offsetMs: 85, jitterMs: 0, sampleCount: 18, roundOffsets: [85, 85],
  });
});

test('exactly six post-warm-up inliers in each round are enough', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) feedRound(session, round, 85, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(session.result().ok, true);
  assert.equal(session.result().sampleCount, 12);
});

test('five post-warm-up taps per round are insufficient', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) feedRound(session, round, 85, [0, 1, 2, 3, 4, 5, 6]);
  assertFailure(session.result(), 'insufficient-taps');
  assert.equal(session.result().sampleCount, 10);
});

test('a strong second round cannot make up for a round with fewer than six inliers', enabled, () => {
  const session = new calibration.CalibrationSession();
  feedRound(session, 0, 85, [0, 1, 2, 3, 4, 5, 6]);
  feedRound(session, 1);
  assertFailure(session.result(), 'insufficient-taps');
  assert.equal(session.result().sampleCount, 14);
});

test('unstarted and incomplete sessions cannot succeed', enabled, () => {
  const session = new calibration.CalibrationSession();
  assertFailure(session.result(), 'insufficient-taps');
  assert.equal(session.result().sampleCount, 0);
  feedRound(session, 0);
  assertFailure(session.result(), 'insufficient-taps');
});

test('round centers more than 40ms apart reject otherwise perfect passes', enabled, () => {
  const session = new calibration.CalibrationSession();
  feedRound(session, 0, 20);
  feedRound(session, 1, 80);
  assertFailure(session.result(), 'rounds-disagree');
  assert.deepEqual(session.result().roundOffsets, [20, 80]);
});

test('round centers exactly 40ms apart are allowed', enabled, () => {
  const session = new calibration.CalibrationSession();
  feedRound(session, 0, 65);
  feedRound(session, 1, 105);
  assert.equal(session.result().ok, true);
  assert.equal(session.result().offsetMs, 85);
  near(session.result().jitterMs, 29.652);
});

test('robust jitter above 35ms rejects matching but unstable taps', enabled, () => {
  const session = complete([85, 85, 35, 135, 35, 135, 85, 35, 135, 35, 135]);
  assertFailure(session.result(), 'unstable');
});

for (const latency of [85, -65, 280]) {
  test(`missing the first target at ${latency}ms must not re-anchor to a later target`, enabled, () => {
    const session = new calibration.CalibrationSession();
    const replies = feedRound(session, 0, latency, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(replies[0].accepted, false);
    assert.equal(replies[0].reason, 'first-target-missed');
    feedRound(session, 1, latency);
    assertFailure(session.result(), 'first-target-missed');
  });
}

test('a first press just beyond the anchor window permanently invalidates its round', enabled, () => {
  const session = new calibration.CalibrationSession();
  session.beginRound(0);
  assert.deepEqual(session.tap(targets()[0] + 350.01), { accepted: false, reason: 'first-target-missed' });
  for (let index = 1; index < 11; index++) session.tap(targets()[index] + 85);
  feedRound(session, 1);
  assertFailure(session.result(), 'first-target-missed');
});

test('an early rejected press is not warm-up and does not prevent a valid first anchor', enabled, () => {
  const session = new calibration.CalibrationSession();
  session.beginRound(0);
  assert.equal(session.tap(targets()[0] - 251).accepted, false);
  feedRound(session, 0);
  feedRound(session, 1);
  assert.equal(session.result().ok, true);
  assert.equal(session.result().sampleCount, 18);
});

for (const [warmup, latency] of [[340, 360], [-240, -360]]) {
  test(`stable absolute offset ${latency}ms is out of range even after valid warm-up anchors`, enabled, () => {
    const session = complete([warmup, warmup, ...Array(9).fill(latency)]);
    assertFailure(session.result(), 'offset-out-of-range');
  });
}

test('heavy rapid mashing cannot succeed by silently ignoring rejected presses', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) {
    session.beginRound(round);
    for (let raw = targets()[0] + 85; raw <= targets()[10] + 90; raw += 10) session.tap(raw);
  }
  assertFailure(session.result(), 'excess-extra-taps');
});

test('three duplicates invalidate a round even with all eleven good beats', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) {
    session.beginRound(round);
    for (let index = 0; index < 11; index++) {
      session.tap(targets()[index] + 85);
      if (index < 3) session.tap(targets()[index] + 100);
    }
  }
  assertFailure(session.result(), 'excess-extra-taps');
  assert.equal(session.result().sampleCount, 18);
});

test('rejected presses outside matching tolerance count against the extra budget', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) {
    session.beginRound(round);
    for (let index = 0; index < 11; index++) {
      session.tap(targets()[index] + 85);
      if (index >= 2 && index <= 4) assert.equal(session.tap(targets()[index] + 285).accepted, false);
    }
  }
  assertFailure(session.result(), 'excess-extra-taps');
});

test('matched statistical outliers also count as extras, not silently discarded presses', enabled, () => {
  const session = complete([85, 85, 85, 85, 85, 85, 85, 85, 205, 205, 205]);
  assertFailure(session.result(), 'excess-extra-taps');
  assert.equal(session.result().sampleCount, 12);
});

test('presses after the final beat cannot match it again or evade extra accounting', enabled, () => {
  const session = new calibration.CalibrationSession();
  feedRound(session, 0);
  for (const delay of [200, 400, 600]) assert.equal(session.tap(targets()[10] + 85 + delay).accepted, false);
  feedRound(session, 1);
  assertFailure(session.result(), 'excess-extra-taps');
});

for (const invalid of [NaN, Infinity, -Infinity, undefined, null, '44500', {}, -1]) {
  test(`invalid raw time ${String(invalid)} is rejected without poisoning the clock`, enabled, () => {
    const session = new calibration.CalibrationSession();
    session.beginRound(0);
    assert.deepEqual(session.tap(invalid), { accepted: false, reason: 'invalid-time' });
    feedRound(session, 0);
    feedRound(session, 1);
    assert.equal(session.result().offsetMs, 85);
  });
}

test('repeated invalid presses cannot bypass the excess-press budget', enabled, () => {
  const session = new calibration.CalibrationSession();
  session.beginRound(0);
  for (let i = 0; i < 3; i++) session.tap(NaN);
  feedRound(session, 0);
  feedRound(session, 1);
  assertFailure(session.result(), 'excess-extra-taps');
});

test('raw player time moving backwards is rejected and requires a new session', enabled, () => {
  const session = new calibration.CalibrationSession();
  session.beginRound(0);
  session.tap(targets()[0] + 85);
  session.tap(targets()[1] + 85);
  assert.deepEqual(session.tap(targets()[0] + 85), { accepted: false, reason: 'non-monotonic-time' });
  for (let index = 2; index < 11; index++) session.tap(targets()[index] + 85);
  feedRound(session, 1);
  assertFailure(session.result(), 'non-monotonic-time');
});

test('equal raw times are duplicates, not a new matched beat', enabled, () => {
  const session = new calibration.CalibrationSession();
  session.beginRound(0);
  const raw = targets()[0] + 85;
  assert.equal(session.tap(raw).count, 1);
  assert.deepEqual(session.tap(raw), { accepted: false, reason: 'duplicate' });
  assert.equal(session.tap(targets()[1] + 85).count, 2);
});

test('beginRound is zero-based, sequential, and idempotent only for the active round', enabled, () => {
  const session = new calibration.CalibrationSession();
  assert.deepEqual(session.tap(44000), { accepted: false, reason: 'round-not-started' });
  assert.throws(() => session.beginRound(1), RangeError);
  for (const invalid of [-1, 0.5, NaN, Infinity, '0', 2]) assert.throws(() => session.beginRound(invalid), RangeError);
  feedRound(session, 0, 85, [0, 1, 2]);
  session.beginRound(0);
  for (let index = 3; index < 11; index++) assert.equal(session.tap(targets()[index] + 85).count, index + 1);
  feedRound(session, 1);
  session.beginRound(1);
  assert.throws(() => session.beginRound(0), RangeError);
  assert.equal(session.result().sampleCount, 18);
  assert.equal(session.result().offsetMs, 85);
});

test('beginRound cannot erase invalid-round evidence by being called again', enabled, () => {
  const session = new calibration.CalibrationSession();
  session.beginRound(0);
  session.tap(targets()[0] + 351);
  session.beginRound(0);
  feedRound(session, 1);
  assertFailure(session.result(), 'first-target-missed');
});

test('custom round counts still require six inliers each and twelve total', enabled, () => {
  assertFailure(complete(85, { rounds: 1 }).result(), 'insufficient-taps');
  const result = complete(85, { rounds: 3 }).result();
  assert.equal(result.ok, true);
  assert.equal(result.sampleCount, 27);
  assert.deepEqual(result.roundOffsets, [85, 85, 85]);
});

test('invalid constructor options fail immediately', enabled, () => {
  for (const mediaOffsetMs of [NaN, Infinity, -Infinity, '14', null]) {
    assert.throws(() => new calibration.CalibrationSession({ mediaOffsetMs }), TypeError);
  }
  for (const rounds of [0, -1, 1.5, NaN, Infinity, '2', null]) {
    assert.throws(() => new calibration.CalibrationSession({ rounds }), RangeError);
  }
});

test('result is a repeatable detached snapshot and does not consume samples', enabled, () => {
  const session = complete();
  const snapshot = session.result();
  assert.deepEqual(session.result(), snapshot);
  snapshot.roundOffsets[0] = -999;
  assert.deepEqual(session.result().roundOffsets, [85, 85]);
});

test('recalibration returns absolute 85ms, never an increment from an old setting', enabled, () => {
  for (const oldSetting of [0, 85, -65, 280]) {
    let savedOffsetMs = oldSetting;
    const first = complete().result();
    assert.equal(first.ok, true);
    savedOffsetMs = first.offsetMs;
    const second = complete().result();
    assert.equal(second.ok, true);
    savedOffsetMs = second.offsetMs;
    assert.equal(savedOffsetMs, 85);
  }
});

test('an early rejected press cannot debounce away a valid negative-latency first anchor', enabled, () => {
  const session = new calibration.CalibrationSession();
  for (let round = 0; round < 2; round++) {
    session.beginRound(round);
    assert.equal(session.tap(targets()[0] - 251).accepted, false);
    const first = session.tap(targets()[0] - 200);
    assert.equal(first.accepted, true);
    assert.equal(first.index, 0);
    for (let index = 1; index < 11; index++) assert.equal(session.tap(targets()[index] - 200).index, index);
  }
  assert.equal(session.result().ok, true);
  assert.equal(session.result().offsetMs, -200);
});

test('an unstable round is rejected even if pooling with a steady round masks its MAD', enabled, () => {
  const session = new calibration.CalibrationSession();
  feedRound(session, 0, [85, 85, 35, 135, 35, 135, 85, 35, 135, 35, 135]);
  feedRound(session, 1, 85);
  assertFailure(session.result(), 'unstable');
});

test('two isolated outliers remain tolerated, including one immediately after warm-up', enabled, () => {
  const result = complete([85, 85, 205, 85, 85, 85, 85, 85, 85, 85, 205]).result();
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 85);
  assert.equal(result.sampleCount, 14);
});

for (const [jitterMs, ok] of [[35, true], [35.001, false]]) {
  test(`the inclusive 35ms robust jitter boundary handles ${jitterMs}ms without clock rounding errors`, enabled, () => {
    const deviation = jitterMs / 1.4826;
    const result = complete([85, 85, 85-deviation, 85+deviation, 85-deviation,
      85+deviation, 85, 85-deviation, 85+deviation, 85-deviation, 85+deviation]).result();
    assert.equal(result.ok, ok);
    if (ok) near(result.jitterMs, 35);
    else assertFailure(result, 'unstable');
  });
}

function continuous(options={}){
 assert.equal(calibration.CONTINUOUS_CALIBRATION_BEAT_MS?.length,30);
 const session=new calibration.CalibrationSession({rounds:1,joinAnywhere:true,beats:calibration.CONTINUOUS_CALIBRATION_BEAT_MS,...options});
 session.beginRound(0);return session;
}
test('a single30-beat continuous pass lasts14s within the stable MIDI tempo',()=>{
 const b=calibration.CONTINUOUS_CALIBRATION_BEAT_MS;assert.equal(b?.length,30);near(b[0],44062.5);near(b.at(-1),57656.25);
});
for(const start of [0,8,14,16])test('continuous calibration permits joining at beat'+start,()=>{
 const session=continuous();const b=calibration.CONTINUOUS_CALIBRATION_BEAT_MS;
 for(let i=start;i<30;i++)assert.equal(session.tap(b[i]+14+85).accepted,true);
 const r=session.result();assert.equal(r.ok,true);near(r.offsetMs,85);assert.equal(r.sampleCount,30-start-2);
});
test('late join with a previous coarse setting uses it for beat matching, never accumulation',()=>{
 const session=continuous({referenceOffsetMs:280});const b=calibration.CONTINUOUS_CALIBRATION_BEAT_MS;
 for(let i=10;i<30;i++)session.tap(b[i]+14+280);assert.equal(session.result().offsetMs,280);
});
test('a small backwards clock correction is ignored rather than permanently failing continuous calibration',()=>{
 const session=continuous();const b=calibration.CONTINUOUS_CALIBRATION_BEAT_MS;
 for(let i=8;i<30;i++){const raw=b[i]+14+85;session.tap(raw);if(i===16)assert.equal(session.tap(raw-150).reason,'clock-correction');}
 assert.equal(session.result().ok,true);assert.equal(session.result().offsetMs,85);
});
test('continuous calibration checks early/late stability and leaves too-late joining insufficient',()=>{
 let session=continuous();let b=calibration.CONTINUOUS_CALIBRATION_BEAT_MS;
 for(let i=0;i<30;i++)session.tap(b[i]+14+(i<15?40:110));assertFailure(session.result(),'segments-disagree');
 session=continuous();for(let i=24;i<30;i++)session.tap(b[i]+14+85);assertFailure(session.result(),'insufficient-taps');
});

test('an early acquisition tap cannot poison all later freely joined steady taps',()=>{
 const session=continuous();const b=calibration.CONTINUOUS_CALIBRATION_BEAT_MS;
 session.tap(b[0]+14-200);
 for(let i=0;i<30;i++)session.tap(b[i]+14+85);
 assert.equal(session.result().ok,true);assert.equal(session.result().offsetMs,85);
});
