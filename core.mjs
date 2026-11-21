import { classifyTiming, HIT_WINDOW_MS } from './scoring.mjs';

// Judgement uses source-video milliseconds. Calibration is never snapped or quantized.
export class RhythmSession {
  constructor(chart, { difficulty, roundCount = 3, offsetMs = 0, inputOffsetMs = 0, hitWindowMs = HIT_WINDOW_MS } = {}) {
    const selected = difficulty ? chart.difficulties?.find(item => item.id === difficulty) : null;
    if (difficulty && !selected) throw new Error(`Unknown difficulty: ${difficulty}`);
    this.rounds = chart.rounds.slice(0, selected?.roundCount ?? roundCount);
    if (selected?.includeChallenge) this.rounds.push(...(chart.challengeRounds || []));
    if (!this.rounds.length) throw new Error('At least one round is required');
    this.difficulty = difficulty || null;
    this.offsetMs = offsetMs;
    this.inputOffsetMs = inputOffsetMs;
    this.hitWindowMs = Math.min(HIT_WINDOW_MS, Math.max(1, hitWindowMs));
    this.targets = this.rounds.flatMap(round => round.notes.map(note => ({ ...note, roundId: round.id, status: 'pending' })));
    this.combo = 0;
    this.maxCombo = 0;
    this.extra = 0;
    this.practiceReasons = new Set();
    if (hitWindowMs !== HIT_WINDOW_MS) this.invalidate('自定义判定窗口');
    // The very last target keeps its full late window even when close to the section end.
    this.endVideoMs = Math.max(this.rounds.at(-1).endMs,
      this.targets.at(-1).midiMs+this.hitWindowMs+1)+offsetMs+inputOffsetMs;
  }

  phaseAt(videoMs) {
    const midiMs = videoMs-this.offsetMs;
    if (midiMs < this.rounds[0].demoStartMs) return { kind: 'prelude', round: this.rounds[0] };
    for (const round of this.rounds) {
      if (midiMs < round.demoStartMs) return { kind: 'gap', round };
      if (midiMs < round.answerStartMs) return { kind: 'demo', round };
      if (midiMs < round.endMs) return { kind: 'answer', round };
    }
    return { kind: 'complete', round: this.rounds.at(-1) };
  }

  hit(videoMs) {
    const judgedMs = videoMs-this.inputOffsetMs;
    const phase = this.phaseAt(judgedMs);
    const candidates = this.targets.filter(note => note.status === 'pending'
      && (phase.kind !== 'demo' || note.id === phase.round.notes[0]?.id)
      && Math.abs(judgedMs-note.midiMs-this.offsetMs) <= this.hitWindowMs);
    candidates.sort((a,b) => Math.abs(judgedMs-a.midiMs-this.offsetMs)-Math.abs(judgedMs-b.midiMs-this.offsetMs));
    const note = candidates[0];
    if (!note) {
      // Permit the lead-in to the first response, but do not score unrelated demo taps.
      const first = phase.round.notes[0]?.midiMs+this.offsetMs;
      const anticipating = phase.kind === 'demo' && judgedMs >= first-this.hitWindowMs;
      const lateTail = phase.kind === 'complete' && judgedMs <= this.targets.at(-1).midiMs+this.offsetMs+this.hitWindowMs;
      if (phase.kind !== 'answer' && !anticipating && !lateTail) return { rating: 'ignored' };
      this.extra++;
      this.combo = 0;
      return { rating: 'extra' };
    }
    const errorMs = judgedMs-note.midiMs-this.offsetMs;
    note.status = 'hit';
    note.errorMs = errorMs;
    note.rating = classifyTiming(errorMs);
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    return { rating: note.rating, errorMs, note };
  }

  advance(videoMs, playing = true) {
    if (!playing) return [];
    const judgedMs = videoMs-this.inputOffsetMs;
    const missed = [];
    for (const note of this.targets) {
      if (note.status === 'pending' && judgedMs > note.midiMs+this.offsetMs+this.hitWindowMs) {
        note.status = 'miss';
        this.combo = 0;
        missed.push(note);
      }
    }
    return missed;
  }

  invalidate(reason) { this.practiceReasons.add(reason); }

  seek(videoMs) {
    this.invalidate('跳转练习');
    const judgedMs = videoMs-this.inputOffsetMs;
    for (const note of this.targets) {
      note.status = judgedMs > note.midiMs+this.offsetMs+this.hitWindowMs ? 'skipped' : 'pending';
      delete note.errorMs;
      delete note.rating;
    }
    this.combo = 0;
    this.maxCombo = 0;
    this.extra = 0;
  }

  summary() {
    const count = status => this.targets.filter(note => note.status === status).length;
    const hits = this.targets.filter(note => note.status === 'hit');
    const ratings = Object.fromEntries(['criticalPerfect','perfect','great','good'].map(rating => [rating,hits.filter(note=>note.rating===rating).length]));
    const skipped = count('skipped'), pending = count('pending');
    return { total: this.targets.length, hit: hits.length, miss: count('miss'), skipped, pending,
      ...ratings, extra: this.extra, combo: this.combo, maxCombo: this.maxCombo,
      meanErrorMs: hits.length ? hits.reduce((sum,note)=>sum+note.errorMs,0)/hits.length : null,
      eligible: !this.practiceReasons.size && !skipped && !pending,
      practiceReasons: [...this.practiceReasons] };
  }
}

export class HostClock {
  constructor() { this.sample = null; this.anchorMs = 0; this.monotonicMs = 0; this.rate = 0; }
  update(state, wallMs = Date.now(), monotonicMs = performance.now()) {
    this.sample = state;
    this.rate = state.playing && Number.isFinite(state.rate) ? Math.max(0, state.rate) : 0;
    const age = Number.isFinite(state.timestamp) ? Math.max(0, wallMs-state.timestamp) : 0;
    this.anchorMs = state.position + age*this.rate;
    this.monotonicMs = monotonicMs;
  }
  position(monotonicMs = performance.now()) {
    let position = Math.max(0, this.anchorMs+Math.max(0, monotonicMs-this.monotonicMs)*this.rate);
    if (this.sample?.duration > 0) position = Math.min(position, this.sample.duration);
    return position;
  }
}
