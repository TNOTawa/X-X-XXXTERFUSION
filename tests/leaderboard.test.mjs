import test from 'node:test';
import assert from 'node:assert/strict';

let adapter;
try {
  adapter = await import('../leaderboard.mjs');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

function create(options = {}) {
  assert.equal(typeof adapter?.Leaderboards, 'function', 'leaderboard.mjs must export Leaderboards');
  return new adapter.Leaderboards({ storage: null, ...options });
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

// These cases catch coercion, shared difficulty/version keys, decreasing bests,
// corrupt persisted values and storage failures escaping the adapter.
test('exports the difficulty-to-board mapping', () => {
  assert.deepEqual(adapter?.DIFFICULTY_BOARDS, { easy: 1, normal: 2, hard: 3 });
});

test('local best starts empty, accepts zero and never decreases', () => {
  const boards = create();
  assert.equal(boards.bestLocal('easy'), null);
  assert.equal(boards.recordLocal('easy', 0), 0);
  assert.equal(boards.bestLocal('easy'), 0);
  assert.equal(boards.recordLocal('easy', 900001), 900001);
  assert.equal(boards.recordLocal('easy', 10), 900001);
  assert.equal(boards.recordLocal('easy', 1010000), 1010000);
  assert.equal(boards.bestLocal('easy'), 1010000);
  assert.equal(boards.bestLocal('normal'), null);
  assert.equal(boards.bestLocal('hard'), null);
});

test('local storage persists only numeric bests isolated by version and difficulty', () => {
  const storage = memoryStorage();
  const first = create({ storage });
  first.recordLocal('easy', 11);
  first.recordLocal('normal', 22);
  first.recordLocal('hard', 33);
  const second = create({ storage });
  assert.equal(second.bestLocal('easy'), 11);
  assert.equal(second.bestLocal('normal'), 22);
  assert.equal(second.bestLocal('hard'), 33);
  assert.equal(second.recordLocal('easy', 1), 11);
  const nextVersion = create({ storage, version: 'xterfusion-v4' });
  assert.equal(nextVersion.bestLocal('easy'), null);
  nextVersion.recordLocal('easy', 44);
  assert.equal(first.bestLocal('easy'), 11);
  assert.equal(create({ storage, version: 'xterfusion-v3' }).bestLocal('hard'), 33);
  assert.equal(storage.values.size, 4);
  for (const value of storage.values.values()) assert.equal(typeof JSON.parse(value), 'number');
});

test('multiple instances observe higher local bests before recording', () => {
  const storage = memoryStorage();
  const a = create({ storage });
  const b = create({ storage });
  a.recordLocal('easy', 100);
  b.recordLocal('easy', 300);
  assert.equal(a.recordLocal('easy', 200), 300);
  assert.equal(create({ storage }).bestLocal('easy'), 300);
});

test('corrupt or non-integer stored scores are ignored and can be repaired', () => {
  const storage = memoryStorage();
  create({ storage }).recordLocal('easy', 10);
  const key = [...storage.values.keys()][0];
  for (const corrupt of ['{', '', 'null', 'false', '[]', '{}', '"10"', '-1', '1010001', '0.5', '1e999']) {
    storage.setItem(key, corrupt);
    const boards = create({ storage });
    assert.equal(boards.bestLocal('easy'), null, corrupt);
    assert.equal(boards.recordLocal('easy', 0), 0, corrupt);
    assert.equal(create({ storage }).bestLocal('easy'), 0, corrupt);
  }
});

test('corruption or stale storage cannot reduce an in-memory best', () => {
  const storage = memoryStorage();
  const boards = create({ storage });
  boards.recordLocal('hard', 1000);
  const key = [...storage.values.keys()][0];
  storage.setItem(key, '{');
  assert.equal(boards.bestLocal('hard'), 1000);
  storage.setItem(key, '0');
  assert.equal(boards.recordLocal('hard', 1), 1000);
  assert.equal(create({ storage }).bestLocal('hard'), 1000);
});

test('storage read/write failures retain session-local bests', () => {
  for (const storage of [
    {},
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } },
    { getItem() { return '800'; }, setItem() { throw new Error('quota'); } },
  ]) {
    const boards = create({ storage });
    assert.equal(boards.recordLocal('normal', 900), 900);
    assert.equal(boards.recordLocal('normal', 1), 900);
    assert.equal(boards.bestLocal('normal'), 900);
  }
});

test('default localStorage is used, while a throwing global getter is safe', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = memoryStorage();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    create({ storage: undefined }).recordLocal('easy', 123);
    assert.equal(create({ storage: undefined }).bestLocal('easy'), 123);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
    const boards = create({ storage: undefined });
    assert.equal(boards.bestLocal('easy'), null);
    assert.equal(boards.recordLocal('easy', 50), 50);
    assert.equal(boards.bestLocal('easy'), 50);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('local methods reject unknown difficulties including inherited property names', () => {
  const boards = create();
  for (const difficulty of ['', 'EASY', 'toString', '__proto__', 'constructor', 1, null, undefined, {}, ['easy']]) {
    assert.throws(() => boards.bestLocal(difficulty), RangeError);
    assert.throws(() => boards.recordLocal(difficulty, 10), RangeError);
  }
});

test('local score validation rejects coercion, fractions, non-finite and out-of-range values', () => {
  const boards = create();
  for (const units of [-1, 1010001, 0.1, NaN, Infinity, -Infinity, '100', null, undefined, true, {}, 1n]) {
    assert.throws(() => boards.recordLocal('easy', units), RangeError);
    assert.equal(boards.bestLocal('easy'), null);
  }
});

// The only SDK used by this suite is this strict, in-memory fake. Access to
// authorization, profile APIs or any other unspecified SDK member fails.
function fakeSdk(overrides = {}) {
  const calls = [];
  const implementations = {
    isSupport: async () => true,
    getRankList: async () => [],
    submitScore: async ({ score }) => ({ score }),
    getMyRank: async () => ({ ranked: false, rank: null, score: 0 }),
    ...overrides,
  };
  const toy = new Proxy({}, {
    get(_target, method) {
      assert.ok(Object.hasOwn(implementations, method), 'Unexpected SDK access: ' + String(method));
      const implementation = implementations[method];
      if (typeof implementation !== 'function') return implementation;
      return async function (...args) {
        assert.equal(this, toy, 'SDK receiver must be preserved');
        calls.push([method, ...args]);
        return implementation(...args);
      };
    },
  });
  return { toy, calls };
}

const row = { rank: 1, score: 0, nickname: 'Guest-visible player', avatar: '' };

test('init probes capabilities once, awaits booleans and performs no data calls', async () => {
  const { toy, calls } = fakeSdk({ isSupport: async method => method === 'getRankList' });
  const boards = create({ toy });
  assert.deepEqual(calls, []);
  assert.deepEqual(await Promise.all([boards.init(), boards.init()]), [true, true]);
  assert.equal(await boards.init(), true);
  assert.deepEqual(calls.map(call => call[0]), ['isSupport', 'isSupport', 'isSupport']);
  assert.deepEqual(calls.map(call => call[1]).sort(), ['getMyRank', 'getRankList', 'submitScore']);
  assert.deepEqual(await boards.submit('easy', 0), { score: 0, rank: null, ranked: false, status: 'local' });
  assert.equal(calls.length, 3);
});

test('absent SDK, missing support API and rejected support checks fall back to local', async () => {
  for (const toy of [null, {}, { isSupport: async () => false }, {
    isSupport() { throw new Error('unsupported runtime'); },
  }, { isSupport: async () => { throw new Error('bridge disconnected'); } }]) {
    const boards = create({ toy });
    assert.equal(await boards.init(), false);
    boards.recordLocal('hard', 123);
    assert.deepEqual(await boards.read('hard'), { remote: false, entries: [], status: 'local' });
    assert.deepEqual(await boards.submit('hard', 0), { score: 123, rank: null, ranked: false, status: 'local' });
  }
});

test('advertised capabilities without callable methods are unavailable', async () => {
  const { toy, calls } = fakeSdk({ getRankList: undefined, submitScore: undefined, getMyRank: undefined });
  const boards = create({ toy });
  assert.equal(await boards.init(), false);
  assert.deepEqual(await boards.read('easy'), { remote: false, entries: [], status: 'local' });
  assert.deepEqual(await boards.submit('easy', 0), { score: 0, rank: null, ranked: false, status: 'local' });
  assert.ok(calls.every(call => call[0] === 'isSupport'));
});

test('each guest read fetches exactly once on the isolated all-time difficulty board', async () => {
  const { toy, calls } = fakeSdk({ getRankList: async ({ board }) => board === 2 ? [] : [row] });
  const boards = create({ toy });
  boards.recordLocal('easy', 1010000);
  assert.deepEqual(calls, []);
  assert.deepEqual(await boards.read('easy'), { remote: true, entries: [row], status: 'remote' });
  assert.deepEqual(await boards.read('normal'), { remote: true, entries: [], status: 'remote' });
  assert.deepEqual(await boards.read('hard'), { remote: true, entries: [row], status: 'remote' });
  assert.deepEqual(calls.filter(call => call[0] !== 'isSupport'), [
    ['getRankList', { board: 1, period: 'all', limit: 10 }],
    ['getRankList', { board: 2, period: 'all', limit: 10 }],
    ['getRankList', { board: 3, period: 'all', limit: 10 }],
  ]);
});

test('read is explicit, never polls and never returns a stale cached list', async t => {
  t.mock.method(globalThis, 'setInterval', () => assert.fail('polling is forbidden'));
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('automatic retry timers are forbidden'));
  let response = [row];
  const { toy, calls } = fakeSdk({ getRankList: async () => response });
  const boards = create({ toy });
  await boards.init();
  assert.ok(calls.every(call => call[0] === 'isSupport'));
  assert.deepEqual((await boards.read('easy')).entries, [row]);
  response = [];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call[0] === 'getRankList').length, 1);
  assert.deepEqual((await boards.read('easy')).entries, []);
  assert.equal(calls.filter(call => call[0] === 'getRankList').length, 2);
});

test('remote entries are bounded to ten, copied and retain SDK ranks and identities', async () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    rank: i + 7, score: 100 - i, nickname: 'player ' + i, avatar: 'avatar-' + i,
  }));
  const { toy } = fakeSdk({ getRankList: async () => entries });
  const result = await create({ toy }).read('hard');
  assert.equal(result.entries.length, 10);
  assert.deepEqual(result.entries, entries.slice(0, 10));
  result.entries[0].nickname = 'changed by consumer';
  assert.equal(entries[0].nickname, 'player 0');
});

test('invalid remote entries are not replaced with fabricated players or scores', async () => {
  const entries = [null, { ...row, rank: 0 }, { ...row, score: -1 }, { ...row, score: '0' },
    { rank: 2, score: 10 }, { ...row, nickname: null }, { ...row, avatar: null }, row];
  const { toy } = fakeSdk({ getRankList: async () => entries });
  assert.deepEqual(await create({ toy }).read('easy'), { remote: true, entries: [row], status: 'remote' });
});

test('read accepts direct arrays only, not guessed SDK response wrappers', async () => {
  for (const response of [null, undefined, {}, { entries: [row] }, { list: [row] }, 'invalid']) {
    const { toy } = fakeSdk({ getRankList: async () => response });
    assert.deepEqual(await create({ toy }).read('easy'), { remote: true, entries: [], status: 'unavailable' });
  }
});

test('network read failure remains remote-unavailable and retries only on another explicit read', async () => {
  let unavailable = true;
  const { toy, calls } = fakeSdk({ getRankList: async () => {
    if (unavailable) throw new Error('network down');
    return [row];
  } });
  const boards = create({ toy });
  boards.recordLocal('easy', 123);
  assert.deepEqual(await boards.read('easy'), { remote: true, entries: [], status: 'unavailable' });
  assert.equal(calls.filter(call => call[0] === 'getRankList').length, 1);
  unavailable = false;
  assert.deepEqual(await boards.read('easy'), { remote: true, entries: [row], status: 'remote' });
  assert.equal(calls.filter(call => call[0] === 'getRankList').length, 2);
});

test('read readiness does not depend on submission or private rank support', async () => {
  const { toy, calls } = fakeSdk({ isSupport: async method => {
    if (method !== 'getRankList') throw new Error('private feature unavailable');
    return true;
  }, getRankList: async () => [row] });
  const boards = create({ toy });
  assert.equal(await boards.init(), true);
  assert.deepEqual(await boards.read('normal'), { remote: true, entries: [row], status: 'remote' });
  assert.deepEqual(await boards.submit('normal', 10), { score: 10, rank: null, ranked: false, status: 'local' });
  assert.deepEqual(calls.filter(call => call[0] !== 'isSupport'), [
    ['getRankList', { board: 2, period: 'all', limit: 10 }],
  ]);
});

test('submit uses the requested units but returns the SDK historical best and explicit personal rank', async () => {
  const { toy, calls } = fakeSdk({
    submitScore: async () => ({ score: 900000 }),
    getMyRank: async () => ({ ranked: true, rank: 27, score: 900000 }),
  });
  const boards = create({ toy });
  boards.recordLocal('hard', 1000000);
  assert.deepEqual(await boards.submit('hard', 500000), {
    score: 900000, rank: 27, ranked: true, status: 'remote',
  });
  assert.equal(boards.bestLocal('hard'), 1000000);
  assert.equal(boards.bestLocal('easy'), null);
  assert.deepEqual(calls.filter(call => call[0] !== 'isSupport'), [
    ['submitScore', { board: 3, score: 500000 }],
    ['getMyRank', { board: 3, period: 'all' }],
  ]);
});

test('zero historical score and a ranked zero score remain valid', async () => {
  const { toy } = fakeSdk({
    submitScore: async () => ({ score: 0 }),
    getMyRank: async () => ({ ranked: true, rank: 1, score: 0 }),
  });
  assert.deepEqual(await create({ toy }).submit('easy', 0), {
    score: 0, rank: 1, ranked: true, status: 'remote',
  });
});

test('ranked false is authoritative even when rank and score are present', async () => {
  const { toy } = fakeSdk({
    submitScore: async () => ({ score: 0 }),
    getMyRank: async () => ({ ranked: false, rank: 42, score: 0 }),
  });
  assert.deepEqual(await create({ toy }).submit('normal', 0), {
    score: 0, rank: null, ranked: false, status: 'remote',
  });
});

test('submission response is not a rank source when getMyRank is unsupported', async () => {
  const { toy, calls } = fakeSdk({
    isSupport: async method => method !== 'getMyRank',
    submitScore: async () => ({ score: 100, rank: 1, ranked: true }),
  });
  assert.deepEqual(await create({ toy }).submit('easy', 100), {
    score: 100, rank: null, ranked: false, status: 'remote',
  });
  assert.deepEqual(calls.filter(call => call[0] !== 'isSupport'), [
    ['submitScore', { board: 1, score: 100 }],
  ]);
});

test('not-logged-in or unavailable getMyRank never fails an accepted submission or invents rank', async () => {
  for (const getMyRank of [undefined, async () => { throw new Error('not logged in'); },
    async () => { throw new Error('rank endpoint offline'); }]) {
    const { toy, calls } = fakeSdk({ getMyRank });
    const boards = create({ toy });
    assert.deepEqual(await boards.submit('hard', 1010000), {
      score: 1010000, rank: null, ranked: false, status: 'remote',
    });
    assert.equal(boards.bestLocal('hard'), 1010000);
    assert.equal(calls.filter(call => call[0] === 'submitScore').length, 1);
    assert.equal(calls.filter(call => call[0] === 'getMyRank').length, getMyRank ? 1 : 0);
  }
});

test('rejected getMyRank capability check leaves successful submission usable', async () => {
  const { toy, calls } = fakeSdk({ isSupport: async method => {
    if (method === 'getMyRank') throw new Error('bridge error');
    return true;
  } });
  assert.deepEqual(await create({ toy }).submit('normal', 15), {
    score: 15, rank: null, ranked: false, status: 'remote',
  });
  assert.equal(calls.filter(call => call[0] === 'getMyRank').length, 0);
});

test('missing, non-boolean or malformed personal rank results do not imply ranking', async () => {
  for (const response of [null, {}, { rank: 1, score: 10 },
    { ranked: 'true', rank: 1, score: 10 }, { ranked: 1, rank: 1, score: 10 },
    { ranked: true, rank: 0, score: 10 }, { ranked: true, rank: '1', score: 10 },
    { ranked: true, rank: 1.5, score: 10 }]) {
    const { toy } = fakeSdk({ getMyRank: async () => response });
    assert.deepEqual(await create({ toy }).submit('easy', 10), {
      score: 10, rank: null, ranked: false, status: 'remote',
    });
  }
});

test('a successful submission does not replace the local best with online account history', async () => {
  const { toy } = fakeSdk({ submitScore: async () => ({ score: 900000 }) });
  const boards = create({ toy });
  assert.deepEqual(await boards.submit('easy', 100), {
    score: 900000, rank: null, ranked: false, status: 'remote',
  });
  assert.equal(boards.bestLocal('easy'), 100);
});

test('submission works independently of guest-list availability', async () => {
  const { toy, calls } = fakeSdk({ isSupport: async method => method !== 'getRankList' });
  const boards = create({ toy });
  assert.equal(await boards.init(), false);
  assert.deepEqual(await boards.read('normal'), { remote: false, entries: [], status: 'local' });
  assert.deepEqual(await boards.submit('normal', 12), { score: 12, rank: null, ranked: false, status: 'remote' });
  assert.equal(calls.filter(call => call[0] === 'getRankList').length, 0);
});

test('SDK submission errors propagate once with no implicit rank lookup or retry', async t => {
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('automatic retries are forbidden'));
  t.mock.method(globalThis, 'setInterval', () => assert.fail('automatic loops are forbidden'));
  const failure = new Error('manual retry required');
  let failing = true;
  const { toy, calls } = fakeSdk({ submitScore: async ({ score }) => {
    if (failing) throw failure;
    return { score };
  } });
  const boards = create({ toy });
  await assert.rejects(boards.submit('easy', 600), error => error === failure);
  assert.equal(boards.bestLocal('easy'), 600);
  assert.equal(calls.filter(call => call[0] === 'submitScore').length, 1);
  assert.equal(calls.filter(call => call[0] === 'getMyRank').length, 0);
  failing = false;
  assert.deepEqual(await boards.submit('easy', 600), { score: 600, rank: null, ranked: false, status: 'remote' });
  assert.equal(calls.filter(call => call[0] === 'submitScore').length, 2);
});

test('malformed submission responses reject rather than inventing an accepted score', async () => {
  for (const response of [null, undefined, {}, { score: '1' }, { score: null },
    { score: -1 }, { score: 1010001 }, { score: 0.5 }, { score: Infinity }]) {
    const { toy, calls } = fakeSdk({ submitScore: async () => response });
    const boards = create({ toy });
    await assert.rejects(boards.submit('easy', 1), TypeError);
    assert.equal(boards.bestLocal('easy'), 1);
    assert.equal(calls.filter(call => call[0] === 'submitScore').length, 1);
    assert.equal(calls.filter(call => call[0] === 'getMyRank').length, 0);
  }
});

test('invalid remote arguments reject before SDK checks, writes or network calls', async () => {
  const { toy, calls } = fakeSdk();
  const storage = memoryStorage();
  const boards = create({ toy, storage });
  for (const difficulty of ['', 'EASY', 'toString', '__proto__', 1, null, undefined]) {
    await assert.rejects(boards.read(difficulty), RangeError);
    await assert.rejects(boards.submit(difficulty, 1), RangeError);
  }
  for (const units of [-1, 1010001, 0.5, NaN, Infinity, '0', null, undefined, true]) {
    await assert.rejects(boards.submit('normal', units), RangeError);
  }
  assert.deepEqual(calls, []);
  assert.equal(storage.values.size, 0);
  assert.equal(boards.bestLocal('normal'), null);
});

test('concurrent explicit operations keep board-specific scores and ranks separate', async () => {
  const { toy, calls } = fakeSdk({
    submitScore: async ({ board }) => ({ score: board * 100 }),
    getMyRank: async ({ board }) => ({ ranked: true, rank: board + 10, score: board * 100 }),
  });
  const boards = create({ toy });
  assert.deepEqual(await Promise.all([
    boards.submit('easy', 1), boards.submit('normal', 2), boards.submit('hard', 3),
  ]), [
    { score: 100, rank: 11, ranked: true, status: 'remote' },
    { score: 200, rank: 12, ranked: true, status: 'remote' },
    { score: 300, rank: 13, ranked: true, status: 'remote' },
  ]);
  assert.equal(boards.bestLocal('easy'), 1);
  assert.equal(boards.bestLocal('normal'), 2);
  assert.equal(boards.bestLocal('hard'), 3);
  assert.equal(calls.filter(call => call[0] === 'isSupport').length, 3);
  assert.equal(calls.filter(call => call[0] === 'getRankList').length, 0);
});

test('storage failures do not prevent remote reads or submissions', async () => {
  const { toy } = fakeSdk({ getRankList: async () => [row] });
  const boards = create({ toy, storage: {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
  } });
  assert.deepEqual(await boards.read('easy'), { remote: true, entries: [row], status: 'remote' });
  assert.deepEqual(await boards.submit('hard', 0), { score: 0, rank: null, ranked: false, status: 'remote' });
  assert.equal(boards.bestLocal('hard'), 0);
});
