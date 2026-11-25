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

export interface TappingBiomarkerResult {
  validTaps: number;
  intervalCount: number;
  meanItiMs: number;
  sdItiMs: number;
  cvPct: number;
  stabilityScore: number;
  driftMs: number;
}

/**
 * Scores a 15s Synchronization-Continuation motor tapping run.
 * Lower inter-tap interval CV% indicates steadier intrinsic motor-entrainment timing.
 */
export function scoreContinuationTapping(
  tapTimestampsMs: number[],
  targetBpm = 100
): TappingBiomarkerResult | null {
  if (!Array.isArray(tapTimestampsMs) || tapTimestampsMs.length < 4) return null;
  const sorted = [...tapTimestampsMs].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const itis: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i] - sorted[i - 1];
    if (dt >= 140 && dt <= 2500) itis.push(dt);
  }
  if (itis.length < 3) return null;

  // Reject gross missed-tap outliers (> 1.8x median ITI)
  const sortedIti = [...itis].sort((a, b) => a - b);
  const medIti = sortedIti[Math.floor(sortedIti.length / 2)];
  const cleanItis = itis.filter((v) => v >= medIti * 0.55 && v <= medIti * 1.65);
  const finalItis = cleanItis.length >= 3 ? cleanItis : itis;

  const meanItiMs = finalItis.reduce((s, v) => s + v, 0) / finalItis.length;
  const variance =
    finalItis.reduce((s, v) => s + (v - meanItiMs) * (v - meanItiMs), 0) /
    Math.max(1, finalItis.length - 1);
  const sdItiMs = Math.sqrt(Math.max(0, variance));
  const cvPct = (sdItiMs / Math.max(1, meanItiMs)) * 100;
  const targetItiMs = targetBpm > 0 ? 60000 / targetBpm : meanItiMs;
  const driftMs = meanItiMs - targetItiMs;
  const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - cvPct * 4.2)));

  return {
    validTaps: finalItis.length + 1,
    intervalCount: finalItis.length,
    meanItiMs: Number(meanItiMs.toFixed(1)),
    sdItiMs: Number(sdItiMs.toFixed(1)),
    cvPct: Number(cvPct.toFixed(2)),
    stabilityScore,
    driftMs: Number(driftMs.toFixed(1)),
  };
}

export interface HrvBiomarkerResult {
  beatCount: number;
  meanHrBpm: number;
  sdnnMs: number;
  rmssdMs: number;
  lfPowerRatio: number; // LF (0.04–0.15 Hz) / Total (0.04–0.40 Hz), tracks 0.1 Hz RSA resonance
}

/**
 * Computes time-domain (RMSSD, SDNN, HR) and frequency-domain (0.04–0.15 Hz LF ratio via
 * uniformly resampled 4 Hz Hann-windowed DFT) metrics from BLE Heart Rate RR intervals (ms).
 */
export function computeHrvMetricsFromRrMs(rrIntervalsMs: number[]): HrvBiomarkerResult | null {
  if (!Array.isArray(rrIntervalsMs) || rrIntervalsMs.length < 5) return null;
  const phys = rrIntervalsMs.filter((rr) => Number.isFinite(rr) && rr >= 300 && rr <= 2000);
  if (phys.length < 5) return null;

  const sorted = [...phys].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const nn = phys.filter((rr) => Math.abs(rr - med) <= med * 0.35);
  const series = nn.length >= 5 ? nn : phys;

  const meanNn = series.reduce((s, v) => s + v, 0) / series.length;
  const meanHrBpm = 60000 / Math.max(300, meanNn);
  const sdnnVar =
    series.reduce((s, v) => s + (v - meanNn) * (v - meanNn), 0) / Math.max(1, series.length - 1);
  const sdnnMs = Math.sqrt(Math.max(0, sdnnVar));

  let diffSqSum = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    diffSqSum += d * d;
  }
  const rmssdMs = Math.sqrt(diffSqSum / Math.max(1, series.length - 1));

  // Build cumulative time axis (sec) -> linear interpolation at fs = 4.0 Hz for LF (0.04-0.15 Hz)
  const timesSec = new Array<number>(series.length);
  timesSec[0] = series[0] / 1000;
  for (let i = 1; i < series.length; i++) {
    timesSec[i] = timesSec[i - 1] + series[i] / 1000;
  }
  const t0 = timesSec[0];
  const tEnd = timesSec[timesSec.length - 1];
  const durSec = tEnd - t0;

  let lfPowerRatio = 0;
  if (durSec >= 10) {
    const fs = 4.0;
    const nGrid = Math.max(32, Math.floor(durSec * fs));
    const grid = new Float64Array(nGrid);
    let srcIdx = 0;
    let sum = 0;
    for (let k = 0; k < nGrid; k++) {
      const t = t0 + k / fs;
      while (srcIdx + 1 < series.length && timesSec[srcIdx + 1] < t) {
        srcIdx++;
      }
      const ta = timesSec[srcIdx];
      const tb = timesSec[Math.min(series.length - 1, srcIdx + 1)];
      const va = series[srcIdx];
      const vb = series[Math.min(series.length - 1, srcIdx + 1)];
      const frac = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 0;
      const val = va + (vb - va) * frac;
      grid[k] = val;
      sum += val;
    }
    const meanVal = sum / nGrid;
    for (let k = 0; k < nGrid; k++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * k) / Math.max(1, nGrid - 1)));
      grid[k] = (grid[k] - meanVal) * hann;
    }

    let lfPower = 0;
    let totalPower = 0;
    const minBin = Math.max(1, Math.ceil((0.04 * nGrid) / fs));
    const maxBin = Math.floor((0.4 * nGrid) / fs);
    for (let b = minBin; b <= maxBin; b++) {
      const freq = (b * fs) / nGrid;
      const w = (2 * Math.PI * b) / nGrid;
      let re = 0;
      let im = 0;
      for (let n = 0; n < nGrid; n++) {
        re += grid[n] * Math.cos(w * n);
        im -= grid[n] * Math.sin(w * n);
      }
      const pwr = re * re + im * im;
      totalPower += pwr;
      if (freq <= 0.15) lfPower += pwr;
    }
    lfPowerRatio = totalPower > 1e-9 ? lfPower / totalPower : 0;
  }

  return {
    beatCount: series.length,
    meanHrBpm: Number(meanHrBpm.toFixed(1)),
    sdnnMs: Number(sdnnMs.toFixed(1)),
    rmssdMs: Number(rmssdMs.toFixed(1)),
    lfPowerRatio: Number(lfPowerRatio.toFixed(3)),
  };
}
