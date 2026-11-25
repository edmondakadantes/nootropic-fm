/**
 * v7.0 Psychometrics, Stratified Sham Control, & Hierarchical Empirical-Bayes Bandit Math.
 * Pure, deterministic, zero-DOM primitives shared across browser, Worker, and automated audits.
 */

export interface PvtMetrics {
  medianMs: number;
  meanInvRt: number; // mean(1000 / rtMs) in s^-1
  lapses: number; // RT > 500 ms
  anticipations: number; // RT < 100 ms (excluded from valid trials)
  trialCount: number;
  fastest10PctMs: number;
  slowest10PctMs: number;
  decileSpreadMs: number;
}

export function computePvtMetrics(rawTrialsMs: number[]): PvtMetrics {
  let anticipations = 0;
  const valid: number[] = [];
  for (const rt of rawTrialsMs) {
    if (!Number.isFinite(rt)) continue;
    if (rt < 100) {
      anticipations++;
      continue;
    }
    if (rt <= 3000) {
      valid.push(Math.round(rt));
    }
  }

  if (valid.length === 0) {
    return {
      medianMs: 0,
      meanInvRt: 0,
      lapses: 0,
      anticipations,
      trialCount: 0,
      fastest10PctMs: 0,
      slowest10PctMs: 0,
      decileSpreadMs: 0,
    };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : Math.round(sorted[mid]);

  let invSum = 0;
  let lapses = 0;
  for (const ms of valid) {
    invSum += 1000 / ms;
    if (ms > 500) lapses++;
  }
  const meanInvRt = Number((invSum / valid.length).toFixed(3));

  const decileCount = Math.max(1, Math.round(sorted.length * 0.1));
  let fastSum = 0;
  let slowSum = 0;
  for (let i = 0; i < decileCount; i++) {
    fastSum += sorted[i];
    slowSum += sorted[sorted.length - 1 - i];
  }
  const fastest10PctMs = Math.round(fastSum / decileCount);
  const slowest10PctMs = Math.round(slowSum / decileCount);
  const decileSpreadMs = Math.max(0, slowest10PctMs - fastest10PctMs);

  return {
    medianMs,
    meanInvRt,
    lapses,
    anticipations,
    trialCount: valid.length,
    fastest10PctMs,
    slowest10PctMs,
    decileSpreadMs,
  };
}

/**
 * Stratified within-user 25% blind sham allocator (exactly 1 blind control trial per 4-session block).
 * `recentControlFlags` MUST be ordered newest-first (most recent session at index 0).
 */
export function assignStratifiedShamControl(opts: {
  recentControlFlags: boolean[];
  researchConsent: boolean;
  allowControlTrial?: boolean;
  ephemeralMode?: boolean;
  blockSize?: number;
  rng?: () => number;
}): boolean {
  if (opts.ephemeralMode || opts.allowControlTrial === false || opts.researchConsent !== true) {
    return false;
  }
  const blockSize = Math.max(2, Math.round(opts.blockSize ?? 4));
  const blockPos = opts.recentControlFlags.length % blockSize;
  const currentOpenBlock = opts.recentControlFlags.slice(0, blockPos);
  if (currentOpenBlock.some(Boolean)) {
    return false;
  }
  const remainingSlots = blockSize - blockPos;
  return (opts.rng ?? Math.random)() < 1 / remainingSlots;
}

export interface HierarchicalPosterior {
  mean: number;
  variance: number;
  stdDev: number;
  shrinkageWeight: number;
  populationMean: number;
  userMean: number | null;
}

/**
 * Two-level Hierarchical Empirical-Bayes Normal-Normal Shrinkage Posterior:
 *   mu_{u,a} ~ N(theta_a, tau^2),   y_{u,a,t} ~ N(mu_{u,a}, sigma_meas^2)
 * Pools population-level cohort efficacy `theta_a` while shrinking noisy single-user averages
 * toward the cohort until a listener accumulates ~8+ paired sessions on that protocol arm.
 */
export function computeHierarchicalArmPosterior(opts: {
  priorAlpha: number;
  priorBeta: number;
  cohortAlpha?: number;
  cohortBeta?: number;
  cohortTrials?: number;
  armGenreAlpha?: number;
  armGenreBeta?: number;
  armGenreTrials?: number;
  profileAlpha?: number;
  profileBeta?: number;
  profileTrials?: number;
  tauSq?: number;
  measVar?: number;
}): HierarchicalPosterior {
  const tauSq = opts.tauSq ?? 0.018;
  const measVar = opts.measVar ?? 0.095;

  const agShrink =
    typeof opts.armGenreTrials === 'number' && opts.armGenreTrials > 0
      ? Math.min(1, opts.armGenreTrials / 5)
      : 0;

  const popAlpha =
    opts.priorAlpha +
    (typeof opts.cohortAlpha === 'number' ? Math.max(0, opts.cohortAlpha - opts.priorAlpha) : 0) +
    (typeof opts.armGenreAlpha === 'number'
      ? Math.max(0, opts.armGenreAlpha - opts.priorAlpha) * agShrink * 1.2
      : 0);

  const popBeta =
    opts.priorBeta +
    (typeof opts.cohortBeta === 'number' ? Math.max(0, opts.cohortBeta - opts.priorBeta) : 0) +
    (typeof opts.armGenreBeta === 'number'
      ? Math.max(0, opts.armGenreBeta - opts.priorBeta) * agShrink * 1.2
      : 0);

  const popTotal = Math.max(1e-6, popAlpha + popBeta);
  const populationMean = popAlpha / popTotal;
  const popVar = (popAlpha * popBeta) / (popTotal * popTotal * (popTotal + 1));

  const nEff = Math.max(0, opts.profileTrials ?? 0);
  let userMean: number | null = null;
  if (nEff > 0) {
    const uSucc =
      typeof opts.profileAlpha === 'number' ? Math.max(0, opts.profileAlpha - opts.priorAlpha) : 0;
    const uFail =
      typeof opts.profileBeta === 'number' ? Math.max(0, opts.profileBeta - opts.priorBeta) : 0;
    const uTotal = uSucc + uFail;
    userMean = uTotal > 1e-6 ? uSucc / uTotal : populationMean;
  }

  const w = nEff > 0 ? (nEff * tauSq) / (nEff * tauSq + measVar) : 0;
  const mean = (1 - w) * populationMean + w * (userMean ?? populationMean);
  const condVar = nEff > 0 ? (tauSq * measVar) / (nEff * tauSq + measVar) : tauSq;
  const variance = condVar + (1 - w) * (1 - w) * popVar;

  return {
    mean,
    variance,
    stdDev: Math.sqrt(Math.max(1e-8, variance)),
    shrinkageWeight: w,
    populationMean,
    userMean,
  };
}

export function sampleStandardNormal(rng: () => number = Math.random): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleHierarchicalThompson(
  posterior: HierarchicalPosterior,
  rng: () => number = Math.random
): number {
  const raw = posterior.mean + posterior.stdDev * sampleStandardNormal(rng);
  return Math.max(0.02, Math.min(0.98, raw));
}
