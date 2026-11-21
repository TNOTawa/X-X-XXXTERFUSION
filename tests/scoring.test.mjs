import test, { before } from 'node:test';
import assert from 'node:assert/strict';

let scoring;
before(async () => {
  await assert.doesNotReject(async () => {
    scoring = await import('../scoring.mjs');
  }, 'scoring.mjs must provide the pure scoring API');
});

const zero = { units: 0, percentage: '0.0000%', grade: 'C', theoretical: false };

test('exports the approved scoring API and hit window', () => {
  assert.equal(scoring.HIT_WINDOW_MS, 100);
  for (const name of ['classifyTiming', 'scoreRun', 'formatAchievement', 'gradeForUnits']) {
    assert.equal(typeof scoring[name], 'function', name);
  }
});

test('timing boundaries are inclusive and symmetric for early and late hits', () => {
  const cases = [
    [0, 'criticalPerfect'], [16.669999, 'criticalPerfect'],
    [16.67, 'criticalPerfect'], [16.670001, 'perfect'],
    [33.329999, 'perfect'], [33.33, 'perfect'], [33.330001, 'great'],
    [66.669999, 'great'], [66.67, 'great'], [66.670001, 'good'],
    [99.999999, 'good'], [100, 'good'], [100.000001, 'miss'], [1000, 'miss'],
  ];
  for (const [error, expected] of cases) {
    assert.equal(scoring.classifyTiming(error), expected, `late ${error}`);
    assert.equal(scoring.classifyTiming(-error), expected, `early ${error}`);
  }
});

test('invalid timing inputs are misses without numeric coercion', () => {
  for (const error of [undefined, null, NaN, Infinity, -Infinity, '0', '', true, {}, [], 0n, Symbol('error')]) {
    assert.equal(scoring.classifyTiming(error), 'miss');
  }
});

test('162 critical perfects produce an exact theoretical 101 percent', () => {
  assert.deepEqual(scoring.scoreRun({ total: 162, criticalPerfect: 162 }), {
    units: 1010000, percentage: '101.0000%', grade: 'SSS+', theoretical: true,
  });
});

test('all Perfect yields exactly 100 percent but is not theoretical', () => {
  assert.deepEqual(scoring.scoreRun({ total: 162, perfect: 162 }), {
    units: 1000000, percentage: '100.0000%', grade: 'SSS', theoretical: false,
  });
});

test('Great and Good use their approved weights', () => {
  assert.deepEqual(scoring.scoreRun({ total: 1, great: 1 }), {
    units: 800000, percentage: '80.0000%', grade: 'A', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 1, good: 1 }), {
    units: 500000, percentage: '50.0000%', grade: 'C', theoretical: false,
  });
});

test('mixed judgements use the full chart denominator, including pending notes', () => {
  assert.deepEqual(scoring.scoreRun({
    total: 10, criticalPerfect: 2, perfect: 3, great: 1, good: 2, miss: 1,
  }), { units: 682000, percentage: '68.2000%', grade: 'B', theoretical: false });
  assert.deepEqual(scoring.scoreRun({ total: 162, criticalPerfect: 81 }), {
    units: 505000, percentage: '50.5000%', grade: 'C', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 162 }), zero);
});

test('misses score no points and prevent a theoretical result', () => {
  assert.deepEqual(scoring.scoreRun({ total: 2, criticalPerfect: 1, miss: 1 }), {
    units: 505000, percentage: '50.5000%', grade: 'C', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 162, miss: 162 }), zero);
});

test('each extra applies a penalty independently of the chart judgement count', () => {
  assert.deepEqual(scoring.scoreRun({ total: 10, perfect: 10, extra: 1 }), {
    units: 950000, percentage: '95.0000%', grade: 'AAA', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 10, perfect: 10, extra: 2 }), {
    units: 900000, percentage: '90.0000%', grade: 'AA', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 1, criticalPerfect: 1, extra: 1 }), {
    units: 510000, percentage: '51.0000%', grade: 'C', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 1, perfect: 1, extra: 100 }), zero);
  assert.deepEqual(scoring.scoreRun({ total: 10, extra: 1 }), zero);
});

test('fractional units are floored rather than rounded', () => {
  assert.deepEqual(scoring.scoreRun({ total: 3, criticalPerfect: 1 }), {
    units: 336666, percentage: '33.6666%', grade: 'C', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total: 3, perfect: 1 }), {
    units: 333333, percentage: '33.3333%', grade: 'C', theoretical: false,
  });
});

test('safe-integer-sized charts retain exact scores and extra penalties', () => {
  const total = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(scoring.scoreRun({ total, criticalPerfect: total }), {
    units: 1010000, percentage: '101.0000%', grade: 'SSS+', theoretical: true,
  });
  assert.deepEqual(scoring.scoreRun({ total, criticalPerfect: total, extra: 1 }), {
    units: 1009999, percentage: '100.9999%', grade: 'SSS+', theoretical: false,
  });
  assert.deepEqual(scoring.scoreRun({ total, perfect: total, extra: 1 }), {
    units: 999999, percentage: '99.9999%', grade: 'SS+', theoretical: false,
  });
});

test('zero, missing, invalid, or unsafe total produces a safe zero result', () => {
  for (const total of [0, -1, 1.5, NaN, Infinity, -Infinity, '162', null, undefined, true, {}, [], 1n, Symbol('total'), Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(scoring.scoreRun({ total, criticalPerfect: 1 }), zero);
  }
  for (const input of [undefined, null, 1, 'run', true, [], 1n, Symbol('run')]) {
    assert.deepEqual(scoring.scoreRun(input), zero);
  }
  assert.deepEqual(scoring.scoreRun(), zero);
});

test('invalid counts reject the whole run instead of inflating or poisoning scores', () => {
  const invalid = [-1, 0.5, NaN, Infinity, -Infinity, '1', null, true, {}, [], 1n, Symbol('count'), Number.MAX_SAFE_INTEGER + 1];
  for (const field of ['criticalPerfect', 'perfect', 'great', 'good', 'miss', 'extra']) {
    for (const value of invalid) {
      assert.deepEqual(scoring.scoreRun({ total: 2, perfect: 1, [field]: value }), zero, field);
    }
    assert.deepEqual(scoring.scoreRun({ total: 1, perfect: 1, [field]: undefined }),
      field === 'perfect' ? zero : {
        units: 1000000, percentage: '100.0000%', grade: 'SSS', theoretical: false,
      });
  }
});

test('over-counted chart judgements reject the whole run, including overflowing sums', () => {
  for (const input of [
    { total: 1, criticalPerfect: 2 },
    { total: 1, perfect: 2 },
    { total: 1, great: 2 },
    { total: 1, good: 2 },
    { total: 1, miss: 2 },
    { total: 2, criticalPerfect: 1, perfect: 1, miss: 1 },
    { total: Number.MAX_SAFE_INTEGER, criticalPerfect: Number.MAX_SAFE_INTEGER, perfect: 1 },
  ]) {
    assert.deepEqual(scoring.scoreRun(input), zero);
  }
});

test('achievement formatting preserves exactly four decimals and the percent sign', () => {
  for (const [units, expected] of [
    [0, '0.0000%'], [1, '0.0001%'], [10, '0.0010%'], [9999, '0.9999%'],
    [10000, '1.0000%'], [123456, '12.3456%'], [999999, '99.9999%'],
    [1000000, '100.0000%'], [1005000, '100.5000%'], [1010000, '101.0000%'],
  ]) {
    assert.equal(scoring.formatAchievement(units), expected);
  }
});

test('every grade transition uses its inclusive unit threshold with no D grade', () => {
  const thresholds = [
    [600000, 'B', 'C'], [700000, 'BB', 'B'], [750000, 'BBB', 'BB'],
    [800000, 'A', 'BBB'], [900000, 'AA', 'A'], [940000, 'AAA', 'AA'],
    [970000, 'S', 'AAA'], [980000, 'S+', 'S'], [990000, 'SS', 'S+'],
    [995000, 'SS+', 'SS'], [1000000, 'SSS', 'SS+'], [1005000, 'SSS+', 'SSS'],
  ];
  for (const [units, grade, below] of thresholds) {
    assert.equal(scoring.gradeForUnits(units - 1), below, `${units} - 1`);
    assert.equal(scoring.gradeForUnits(units), grade, `${units}`);
    assert.equal(scoring.gradeForUnits(units + 1), grade, `${units} + 1`);
    assert.equal(scoring.scoreRun({ total: 1010000, criticalPerfect: units }).grade, grade);
  }
  assert.equal(scoring.gradeForUnits(0), 'C');
  assert.equal(scoring.gradeForUnits(1010000), 'SSS+');
});

test('unit helpers floor fractions, clamp finite values, and reject invalid inputs', () => {
  for (const units of [undefined, null, NaN, Infinity, -Infinity, '1000000', true, {}, [], 1n, Symbol('units'), -1, -0]) {
    assert.equal(scoring.formatAchievement(units), '0.0000%');
    assert.equal(scoring.gradeForUnits(units), 'C');
  }
  assert.equal(scoring.formatAchievement(123456.9), '12.3456%');
  assert.equal(scoring.gradeForUnits(999999.9), 'SS+');
  for (const units of [1010001, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
    assert.equal(scoring.formatAchievement(units), '101.0000%');
    assert.equal(scoring.gradeForUnits(units), 'SSS+');
  }
});

test('scoring is deterministic and does not mutate frozen caller input', () => {
  const input = Object.freeze({ total: 10, criticalPerfect: 2, perfect: 3, great: 1, good: 2, miss: 1 });
  const expected = { units: 682000, percentage: '68.2000%', grade: 'B', theoretical: false };
  const first = scoring.scoreRun(input);
  assert.deepEqual(first, expected);
  first.units = 0;
  assert.deepEqual(scoring.scoreRun(input), expected);
  assert.deepEqual(input, { total: 10, criticalPerfect: 2, perfect: 3, great: 1, good: 2, miss: 1 });
});
