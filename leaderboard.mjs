// Scores are integer percentage * 10000 units, not floating-point percentages.
export const DIFFICULTY_BOARDS = Object.freeze({ easy: 1, normal: 2, hard: 3 });
const MAX_UNITS = 1010000;

function boardFor(difficultyId) {
  if (typeof difficultyId !== 'string' || !Object.hasOwn(DIFFICULTY_BOARDS, difficultyId)) {
    throw new RangeError('Unknown leaderboard difficulty');
  }
  return DIFFICULTY_BOARDS[difficultyId];
}

function validUnits(units) {
  return Number.isInteger(units) && units >= 0 && units <= MAX_UNITS;
}

function validateUnits(units) {
  if (!validUnits(units)) throw new RangeError('Score must be an integer from 0 to 1010000');
}

function validRank(rank) {
  return Number.isSafeInteger(rank) && rank > 0;
}

// Remote boards belong to the current Toy. Versioning affects local storage only.
export class Leaderboards {
  #toy;
  #initialization;
  #supported = { getRankList: false, submitScore: false, getMyRank: false };
  #storage;
  #version;
  #bests = new Map();

  constructor({ toy = null, storage, version = 'xterfusion-v3' } = {}) {
    // Accessing localStorage itself can throw (for example, in a sandboxed frame).
    if (storage === undefined) {
      try { storage = globalThis.localStorage; } catch { storage = null; }
    }
    this.#toy = toy;
    this.#storage = storage;
    this.#version = version;
  }

  #key(difficultyId) {
    return 'toy-leaderboards:' + JSON.stringify([this.#version, difficultyId]);
  }

  bestLocal(difficultyId) {
    boardFor(difficultyId);
    let best = this.#bests.get(difficultyId) ?? null;
    try {
      const stored = JSON.parse(this.#storage?.getItem(this.#key(difficultyId)) ?? 'null');
      if (validUnits(stored)) best = best === null ? stored : Math.max(best, stored);
    } catch { /* Corruption or denied storage must not lose the session best. */ }
    if (best !== null) this.#bests.set(difficultyId, best);
    return best;
  }

  recordLocal(difficultyId, units) {
    boardFor(difficultyId);
    validateUnits(units);
    const best = Math.max(this.bestLocal(difficultyId) ?? 0, units);
    this.#bests.set(difficultyId, best);
    try { this.#storage?.setItem(this.#key(difficultyId), JSON.stringify(best)); }
    catch { /* Keep the in-memory best if persistence is unavailable or full. */ }
    return best;
  }

  /** Probe once; public list readiness is independent of private capabilities. */
  async init() {
    if (!this.#initialization) {
      this.#initialization = (async () => {
        const methods = ['getRankList', 'submitScore', 'getMyRank'];
        const supported = await Promise.all(methods.map(async method => {
          try {
            return typeof this.#toy?.isSupport === 'function'
              && await this.#toy.isSupport(method) === true
              && typeof this.#toy[method] === 'function';
          } catch { return false; }
        }));
        methods.forEach((method, index) => { this.#supported[method] = supported[index]; });
        return this.#supported.getRankList;
      })();
    }
    return this.#initialization;
  }

  /** One guest/public request per call; local bests are never global entries. */
  async read(difficultyId) {
    const board = boardFor(difficultyId);
    if (!await this.init()) return { remote: false, entries: [], status: 'local' };
    try {
      const list = await this.#toy.getRankList({ board, period: 'all', limit: 10 });
      if (!Array.isArray(list)) throw new TypeError('Expected a direct RankItem array');
      const entries = list.slice(0, 10)
        .filter(item => item && validRank(item.rank) && validUnits(item.score)
          && typeof item.nickname === 'string' && typeof item.avatar === 'string')
        .map(({ rank, score, nickname, avatar }) => ({ rank, score, nickname, avatar }));
      return { remote: true, entries, status: 'remote' };
    } catch {
      return { remote: true, entries: [], status: 'unavailable' };
    }
  }

  /** Explicit UI action only. A failed SDK submission rejects for manual retry. */
  async submit(difficultyId, units) {
    const board = boardFor(difficultyId);
    const localBest = this.recordLocal(difficultyId, units);
    await this.init();
    if (!this.#supported.submitScore) {
      return { score: localBest, rank: null, ranked: false, status: 'local' };
    }

    // submitScore reports historical best, not rank or necessarily this attempt.
    const submitted = await this.#toy.submitScore({ board, score: units });
    if (!validUnits(submitted?.score)) throw new TypeError('Invalid submitScore historical best');
    const result = { score: submitted.score, rank: null, ranked: false, status: 'remote' };
    if (this.#supported.getMyRank) {
      try {
        const mine = await this.#toy.getMyRank({ board, period: 'all' });
        if (mine?.ranked === true && validRank(mine.rank)) {
          result.rank = mine.rank;
          result.ranked = true;
        }
      } catch { /* Accepted submission; private rank can be unavailable for guests. */ }
    }
    return result;
  }
}
