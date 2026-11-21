/**
 * Simplified maimai-inspired achievement scoring, not a full BREAK replica.
 * Pure functions: no I/O, shared mutable results, or caller-input mutation.
 */
export const HIT_WINDOW_MS = 100;
const MAX_UNITS = 1010000;
const GRADES = [
  [1005000, 'SSS+'], [1000000, 'SSS'], [995000, 'SS+'], [990000, 'SS'],
  [980000, 'S+'], [970000, 'S'], [940000, 'AAA'], [900000, 'AA'],
  [800000, 'A'], [750000, 'BBB'], [700000, 'BB'], [600000, 'B'],
];

/** Invalid/non-finite values are misses; numeric strings are not coerced. */
export function classifyTiming(errorMs) {
  if (!Number.isFinite(errorMs)) return 'miss';
  const error = Math.abs(errorMs);
  if (error <= 16.67) return 'criticalPerfect';
  if (error <= 33.33) return 'perfect';
  if (error <= 66.67) return 'great';
  if (error <= HIT_WINDOW_MS) return 'good';
  return 'miss';
}

// Helpers accept finite numbers only: floor fractions, then clamp to 0..1010000.
// Non-numbers and non-finite numbers (including either infinity) become zero.
function normalizeUnits(units) {
  return Number.isFinite(units) ? Math.max(0, Math.min(MAX_UNITS, Math.floor(units))) : 0;
}

/** Format clamped integer units without floating-point decimal rounding. */
export function formatAchievement(units) {
  const value = normalizeUnits(units);
  return `${Math.floor(value / 10000)}.${String(value % 10000).padStart(4, '0')}%`;
}

/** Inclusive grade thresholds; every score below B is C (there is no D). */
export function gradeForUnits(units) {
  const value = normalizeUnits(units);
  for (const [threshold, grade] of GRADES) {
    if (value >= threshold) return grade;
  }
  return 'C';
}

function result(units, theoretical = false) {
  return { units, percentage: formatAchievement(units), grade: gradeForUnits(units), theoretical };
}

/**
 * total is the full chart size, never just the number of judged notes.
 *
 * Input policy: total and all counts must be non-negative safe integers, with
 * total > 0. Missing/undefined counts default to zero. Zero/invalid totals,
 * malformed inputs, invalid counts, or CP+P+Great+Good+miss > total reject the
 * entire run with { units: 0, percentage: '0.0000%', grade: 'C', theoretical: false }.
 * No coercion or silent truncation of counts. Extra taps are independent of
 * chart judgements and may exceed total. Pending notes earn no points.
 *
 * BigInt intermediates preserve the exact floor even at MAX_SAFE_INTEGER;
 * outputs remain bounded Number units. Negative penalized scores clamp to zero.
 */
export function scoreRun(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return result(0);
  const {
    total, criticalPerfect = 0, perfect = 0, great = 0, good = 0, miss = 0, extra = 0,
  } = input;
  const counts = [criticalPerfect, perfect, great, good, miss, extra];
  if (!Number.isSafeInteger(total) || total <= 0 ||
      counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
    return result(0);
  }

  const [cp, p, g, gd, m, e] = counts.map(count => BigInt(count));
  const chartSize = BigInt(total);
  if (cp + p + g + gd + m > chartSize) return result(0);

  const weighted = 101n * cp + 100n * p + 80n * g + 50n * gd - 50n * e;
  // For negative numerators the final clamp is zero, regardless of floor.
  const rawUnits = weighted > 0n ? weighted * 10000n / chartSize : 0n;
  const units = Number(rawUnits > BigInt(MAX_UNITS) ? BigInt(MAX_UNITS) : rawUnits);
  return result(units, criticalPerfect === total && miss === 0 && extra === 0);
}
