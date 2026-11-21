/** MIDI strong beats; callers add media alignment, never existing input compensation. */
export const CALIBRATION_BEAT_MS = Object.freeze(
  Array.from({ length: 11 }, (_, index) => 44062.5 + index * 468.75),
);

// One continuous stable128-BPM passage:44.0625..57.65625s, with no repeat seek.
export const CONTINUOUS_CALIBRATION_BEAT_MS = Object.freeze(
  Array.from({length:30},(_,index)=>44062.5+index*468.75),
);

const BEAT_INTERVAL_MS = 468.75;
const WARMUP_TAPS = 2;
const MIN_INLIERS_PER_ROUND = 6;
const MIN_TOTAL_INLIERS = 12;
const MAX_EXTRA_TAPS_PER_ROUND = 2;
const DUPLICATE_INTERVAL_MS = 120;
// Strictly less than half a beat: an extra press cannot steal an adjacent beat.
const MATCH_TOLERANCE_MS = 180;
const MAD_SCALE = 1.4826;
// Subtracting ~44000ms player times adds tiny floating-point error at boundaries.
const TIME_EPSILON_MS = 1e-8;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustJitter(values, center) {
  return MAD_SCALE * median(values.map(value => Math.abs(value - center)));
}

function summarizeRound(round) {
  const errors = round?.matches.slice(WARMUP_TAPS).map(tap => tap.errorMs) ?? [];
  if (!errors.length) return { inliers: [], center: null, jitter: 0, extras: round?.rejected ?? 0 };
  const initialCenter = median(errors);
  // A small floor tolerates ordinary clock quantization even when MAD is zero.
  const cutoff = Math.max(20, 3 * robustJitter(errors, initialCenter));
  const inliers = errors.filter(error => Math.abs(error - initialCenter) <= cutoff);
  const center = median(inliers);
  return {
    inliers, center, jitter: robustJitter(inliers, center),
    extras: round.rejected + errors.length - inliers.length,
  };
}

/**
 * Pure, synchronous calibration in raw source-video milliseconds.
 * Production uses rounds:1,joinAnywhere:true and CONTINUOUS_CALIBRATION_BEAT_MS.
 * Join at any beat, tap immediately; first two MATCHES are automatically discarded.
 * A coarse reference only selects the nearest beat; it is NOT added to the result.
 * Periodic-only matching has a half-beat ambiguity for very large unknown latency.
 * Legacy defaults below remain supported for callers requiring anchored passes.
 *
 * Call beginRound(0), feed the first pass, then beginRound(1) and replay the SAME
 * 44s section (not a continuation of its timeline). Indices are zero-based and
 * must advance one at a time up to rounds - 1. Calling beginRound again with the
 * CURRENT index is a no-op: it preserves samples, chronology and failure state.
 * Skipping, rewinding or using an invalid index throws RangeError without edits.
 * Use a new session to retry; a completed/invalid past round cannot be reopened.
 *
 * The first accepted press MUST belong to beat zero and be in [-250, +350]ms of
 * that target. A first press later than this permanently fails the round rather
 * than searching for a later beat. As with any periodic-only signal, a missed
 * beat plus an early latency that aliases INTO this first window is inherently
 * indistinguishable from a genuine first press; callers must cue the first beat.
 * Subsequent matching uses the estimated signed offset, a 180ms residual window,
 * strictly increasing beat indices, and a 120ms inter-press duplicate guard.
 * tap().index is the zero-based beat; count includes the two warm-up matches.
 * accepted means matched, not necessarily a final statistical inlier.
 *
 * Each round drops its first two MATCHES (not its first two calls) as warm-up.
 * Inliers are within max(20ms, 3 * scaled MAD) of the post-warm-up median. Jitter
 * is scaled MAD (1.4826 * median absolute deviation), checked per round AND pooled.
 * At most two extras per round are allowed, including every rejected press and
 * every matched post-warm-up outlier. Missed beats do not count as extra presses.
 * Invalid/nonfinite input is rejected and counted without changing the clock;
 * decreasing raw time permanently fails the round. A new round resets its clock.
 *
 * result() is a non-consuming snapshot. sampleCount counts post-warm-up inliers;
 * roundOffsets has one median per configured round (null without usable taps).
 * Failures have no offsetMs. A success's signed median REPLACES the old input
 * offset; there is intentionally no old-setting, clock, storage or DOM input.
 */
export class CalibrationSession {
  #targets;
  #roundCount;
  #joinAnywhere;
  #referenceOffsetMs;
  #rounds = [];
  #activeIndex = -1;

  constructor({ mediaOffsetMs = 14, rounds = 2, joinAnywhere = false, beats = CALIBRATION_BEAT_MS, referenceOffsetMs = 0 } = {}) {
    if (!Number.isFinite(mediaOffsetMs)) throw new TypeError('mediaOffsetMs must be a finite number');
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError('rounds must be a positive integer');
    if(joinAnywhere && rounds!==1)throw new RangeError('Continuous calibration uses one pass');
    if(!Number.isFinite(referenceOffsetMs)||Math.abs(referenceOffsetMs)>350)throw new RangeError('Invalid coarse latency reference');
    if(!Array.isArray(beats)||!beats.length||beats.some((v,i)=>!Number.isFinite(v)||(i&&Math.abs(v-beats[i-1]-BEAT_INTERVAL_MS)>.001)))throw new RangeError('Invalid stable beat schedule');
    this.#joinAnywhere=joinAnywhere;
    this.#referenceOffsetMs=referenceOffsetMs;
    this.#targets = beats.map(time => time + mediaOffsetMs);
    this.#roundCount = rounds;
  }

  beginRound(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#roundCount
      || (index !== this.#activeIndex && index !== this.#activeIndex + 1)) {
      throw new RangeError('Begin rounds sequentially from zero; only the active round is idempotent');
    }
    if (index === this.#activeIndex) return;
    this.#rounds.push({ rawTimes: [], matches: [], rejected: 0, failure: null });
    this.#activeIndex = index;
  }

  tap(videoMs) {
    const round = this.#rounds[this.#activeIndex];
    const reject = reason => {
      if (round) round.rejected++;
      return { accepted: false, reason };
    };
    if (!Number.isFinite(videoMs) || videoMs < 0) return reject('invalid-time');
    if (!round) return reject('round-not-started');

    const previousRawMs = round.rawTimes.at(-1);
    if (previousRawMs !== undefined && videoMs < previousRawMs) {
      if(this.#joinAnywhere && previousRawMs-videoMs<=1500)return {accepted:false,reason:'clock-correction'};
      round.failure ??= 'non-monotonic-time';
      return reject(round.failure);
    }
    // Retain uncorrected chronological times, including rejected finite presses.
    round.rawTimes.push(videoMs);
    if (round.failure) return reject(round.failure);
    // Pre-window noise must not debounce away the first legitimate anchor.
    if (round.matches.length && previousRawMs !== undefined && videoMs - previousRawMs < DUPLICATE_INTERVAL_MS) {
      return reject('duplicate');
    }

    let index = 0;
    if (!round.matches.length && this.#joinAnywhere) {
      // A periodic signal identifies phase modulo one beat. The existing setting
      // is only a coarse matching reference; errors remain raw, never accumulated.
      index=Math.round((videoMs-this.#targets[0]-this.#referenceOffsetMs)/BEAT_INTERVAL_MS);
      if(index<0||index>=this.#targets.length)return reject('outside-window');
    } else if (!round.matches.length) {
      const firstError = videoMs - this.#targets[0];
      if (firstError < -250) return reject('outside-window');
      if (firstError > 350) {
        round.failure = 'first-target-missed';
        return reject(round.failure);
      }
    } else {
      const scored = round.matches.slice(WARMUP_TAPS);
      const acquiring=this.#joinAnywhere && scored.length<2;
      const estimate = acquiring?this.#referenceOffsetMs:median((scored.length ? scored : round.matches).map(tap => tap.errorMs));
      // Find the nearest estimated beat BEFORE checking monotonicity; restricting
      // the search to unmatched beats would turn second presses into false hits.
      index = Math.round((videoMs - this.#targets[0] - estimate) / BEAT_INTERVAL_MS);
      if (index <= round.matches.at(-1).index) return reject('duplicate');
      if (index >= this.#targets.length) return reject('outside-window');
      if (Math.abs(videoMs - this.#targets[index] - estimate) > (acquiring?BEAT_INTERVAL_MS/2:MATCH_TOLERANCE_MS)) {
        return reject('outside-window');
      }
    }

    const errorMs = videoMs - this.#targets[index];
    round.matches.push({ videoMs, index, errorMs });
    return { accepted: true, index, errorMs, count: round.matches.length };
  }

  result() {
    const summaries = Array.from({ length: this.#roundCount }, (_, index) => summarizeRound(this.#rounds[index]));
    const inliers = summaries.flatMap(round => round.inliers);
    const sampleCount = inliers.length;
    const roundOffsets = summaries.map(round => round.center);
    const failure = reason => ({ ok: false, sampleCount, roundOffsets, reason });

    const invalidRound = this.#rounds.find(round => round.failure);
    if (invalidRound) return failure(invalidRound.failure);
    if(this.#joinAnywhere){
      // Check temporal halves BEFORE pooled outlier rejection, otherwise a real
      // sustained drift could be discarded as one big group of apparent extras.
      const errors=this.#rounds[0]?.matches.slice(WARMUP_TAPS).map(t=>t.errorMs)||[];
      const middle=Math.floor(errors.length/2);
      if(middle>=MIN_INLIERS_PER_ROUND&&Math.abs(median(errors.slice(0,middle))-median(errors.slice(middle)))>40)return failure('segments-disagree');
    }
    if (summaries.some(round => round.extras > (this.#joinAnywhere?4:MAX_EXTRA_TAPS_PER_ROUND))) return failure('excess-extra-taps');
    if (sampleCount < MIN_TOTAL_INLIERS || summaries.some(round => round.inliers.length < (this.#joinAnywhere?MIN_TOTAL_INLIERS:MIN_INLIERS_PER_ROUND))) {
      return failure('insufficient-taps');
    }
    if(this.#joinAnywhere){
      const middle=Math.floor(inliers.length/2);
      if(Math.abs(median(inliers.slice(0,middle))-median(inliers.slice(middle)))>40)return failure('segments-disagree');
    }
    if (Math.max(...roundOffsets) - Math.min(...roundOffsets) > 40) return failure('rounds-disagree');

    const offsetMs = median(inliers);
    const jitterMs = robustJitter(inliers, offsetMs);
    if (jitterMs > 35 + TIME_EPSILON_MS || summaries.some(round => round.jitter > 35 + TIME_EPSILON_MS)) {
      return failure('unstable');
    }
    if (Math.abs(offsetMs) > 350) return failure('offset-out-of-range');
    return { ok: true, offsetMs, jitterMs, sampleCount, roundOffsets };
  }
}
