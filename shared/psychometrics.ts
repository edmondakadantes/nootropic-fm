/**
 * v7.0 Psychometrics, Stratified Sham Control, & Hierarchical Empirical-Bayes Bandit Math.
 * Pure, deterministic, zero-DOM primitives shared across browser, Worker, and automated audits.
 */

import type { PersonalNeuralMemory, TimeOfDayBucket } from './types';

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

export interface FactorizedMarginalInput {
  alpha: number;
  beta: number;
  trials: number;
  weight?: number;
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
 * Two-level Hierarchical Empirical-Bayes Normal-Normal Shrinkage Posterior with Factorized Marginal Pooling:
 *   mu_{u,a} ~ N(theta_a, tau^2),   y_{u,a,t} ~ N(mu_{u,a}, sigma_meas^2)
 * Pools factorized 2D marginals ((goal×state), (goal×env), (goal×role)) during 5D cohort cold-start,
 * transitions smoothly to exact 5D cohort cell evidence, and shrinks single-user noisy averages
 * toward the cohort until a listener accumulates ~8+ paired sessions on that protocol arm.
 */
export function computeHierarchicalArmPosterior(opts: {
  priorAlpha: number;
  priorBeta: number;
  cohortAlpha?: number;
  cohortBeta?: number;
  cohortTrials?: number;
  marginals?: FactorizedMarginalInput[];
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

  // Factorized marginal pooling bridges 24,320-cell 5D sparsity and tapers cleanly as exact 5D trials grow
  const exactCohortN = Math.max(0, opts.cohortTrials ?? 0);
  const marginalTaper = 1 / (1 + exactCohortN / 8);
  let margAlphaAdd = 0;
  let margBetaAdd = 0;
  if (Array.isArray(opts.marginals)) {
    for (const m of opts.marginals) {
      if (!m || !(m.trials > 0)) continue;
      const w = Math.max(0.05, Math.min(1.0, m.weight ?? 0.35)) * marginalTaper;
      margAlphaAdd += Math.max(0, m.alpha - opts.priorAlpha) * w;
      margBetaAdd += Math.max(0, m.beta - opts.priorBeta) * w;
    }
  }

  const popAlpha =
    opts.priorAlpha +
    margAlphaAdd +
    (typeof opts.cohortAlpha === 'number' ? Math.max(0, opts.cohortAlpha - opts.priorAlpha) : 0) +
    (typeof opts.armGenreAlpha === 'number'
      ? Math.max(0, opts.armGenreAlpha - opts.priorAlpha) * agShrink * 1.2
      : 0);

  const popBeta =
    opts.priorBeta +
    margBetaAdd +
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

export type NeuralEffectTier = 'min' | 'standard' | 'max';

export const NEURAL_EFFECT_MULT: Record<NeuralEffectTier, number> = {
  min: 0.56,
  standard: 1.0,
  max: 1.48,
};

export interface ComputedIsoBridge {
  stabilizeHz: number;
  stabilizeDurationSec: number;
  rampDurationSec: number;
  stabilizeEffectScale: number;
  reasonLabel: string;
}

/**
 * Computes a 2-Stage Iso-Principle Bridge when a listener enters from an anxious, stressed,
 * over-caffeinated, or burned-out state yet requests an activating Focus / Energy protocol:
 * Stage 1 (0–3m) stabilizes autonomic tension at 10–11.5 Hz Alpha (~38% gentle envelope),
 * then smoothly glides over 60s into the full 14–16 Hz Focus plateau (~65% Standard).
 */
export function computeIsoBridgeForState(input: {
  currentState: string;
  microStateId?: string | null;
  targetState: string;
  targetHz: number;
  safetyMode?: boolean;
}): ComputedIsoBridge | undefined {
  if (input.safetyMode || input.targetHz <= 12) return undefined;
  const ms = input.microStateId ?? '';
  const isHyperOrFragile =
    input.currentState === 'anxious' ||
    input.currentState === 'stressed' ||
    ms === 'burned_out' ||
    ms === 'screen_fatigue' ||
    ms === 'wired_but_tired' ||
    ms === 'overcaffeinated' ||
    ms === 'anxious_racing' ||
    ms === 'overwhelmed';
  if (!isHyperOrFragile) return undefined;

  const wantsActivation =
    input.targetState === 'alert_focus' ||
    input.targetState === 'energy_lift' ||
    (input.targetState === 'deep_flow' &&
      (input.currentState === 'anxious' || ms === 'burned_out' || ms === 'overcaffeinated'));
  if (!wantsActivation) return undefined;

  const stabilizeHz =
    input.currentState === 'anxious' || ms === 'burned_out' || ms === 'anxious_racing'
      ? 10.0
      : 11.5;
  return {
    stabilizeHz,
    stabilizeDurationSec: 180,
    rampDurationSec: 60,
    stabilizeEffectScale: 0.58,
    reasonLabel: `2-Stage Iso-Bridge · 3m ${stabilizeHz} Hz Calm → ${input.targetHz} Hz`,
  };
}

/**
 * Smartly auto-selects the initial Neural Effect tier (Min ~36% / Standard ~65% / Max ~94%)
 * from Second 1 based on the listener's current mental state, target goal, Iso-Bridge status,
 * learned Bandit preference, noise sensitivity, and road-safety context.
 */
export function pickSmartInitialEffectTier(input: {
  currentState: string;
  microStateId?: string | null;
  targetState: string;
  safetyMode?: boolean;
  noiseSensitivity?: 'low' | 'medium' | 'high';
  preferredModMult?: number | null;
}): { tier: NeuralEffectTier; modMult: number; autoReason: string } {
  if (input.safetyMode) {
    return { tier: 'min', modMult: NEURAL_EFFECT_MULT.min, autoReason: 'Auto · Road-safe' };
  }
  if (typeof input.preferredModMult === 'number' && Number.isFinite(input.preferredModMult)) {
    if (input.preferredModMult >= 1.24) {
      return { tier: 'max', modMult: NEURAL_EFFECT_MULT.max, autoReason: 'Auto · Saved pref' };
    }
    if (input.preferredModMult <= 0.78) {
      return { tier: 'min', modMult: NEURAL_EFFECT_MULT.min, autoReason: 'Auto · Saved pref' };
    }
  }
  const ms = input.microStateId ?? '';
  if (input.targetState === 'sleep_winddown') {
    return { tier: 'min', modMult: NEURAL_EFFECT_MULT.min, autoReason: 'Auto · Sleep gentle' };
  }
  if (input.noiseSensitivity === 'high') {
    return { tier: 'min', modMult: NEURAL_EFFECT_MULT.min, autoReason: 'Auto · Gentle comfort' };
  }

  // Check if 2-Stage Iso-Bridge handles fragile/anxious -> focus/energy transition
  const hasIsoBridge = Boolean(
    computeIsoBridgeForState({
      currentState: input.currentState,
      microStateId: ms,
      targetState: input.targetState,
      targetHz: 16,
      safetyMode: input.safetyMode,
    })
  );
  if (hasIsoBridge) {
    return {
      tier: 'standard',
      modMult: NEURAL_EFFECT_MULT.standard,
      autoReason: 'Auto · 2-Stage Iso-Bridge',
    };
  }

  // Anxious / Stressed / Burned Out aiming for Calm Reset or gentle Deep Flow -> Min Effect (~36%)
  if (
    input.targetState === 'calm_reset' ||
    input.currentState === 'anxious' ||
    input.currentState === 'stressed' ||
    ms === 'burned_out' ||
    ms === 'screen_fatigue'
  ) {
    return { tier: 'min', modMult: NEURAL_EFFECT_MULT.min, autoReason: 'Auto · Gentle calm' };
  }

  // Tired / Brain Fog / Distracted / Low-Mood Energy Rescue -> Max Effect (~94%) from Second 1!
  const isDeficitRescue =
    ((input.currentState === 'fatigued' ||
      input.currentState === 'distracted' ||
      ms === 'brain_fog' ||
      ms === 'sleep_deprived' ||
      ms === 'procrastinating' ||
      ms === 'distracted_scattered') &&
      (input.targetState === 'energy_lift' ||
        input.targetState === 'alert_focus' ||
        input.targetState === 'deep_flow')) ||
    (ms === 'low_mood' && input.targetState === 'energy_lift');

  if (isDeficitRescue) {
    return { tier: 'max', modMult: NEURAL_EFFECT_MULT.max, autoReason: 'Auto · Max boost' };
  }

  return { tier: 'standard', modMult: NEURAL_EFFECT_MULT.standard, autoReason: 'Auto · Balanced' };
}

const VALID_CHRONO_BUCKETS: ReadonlySet<string> = new Set([
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
]);

function clampNumber(val: unknown, fallback: number, min: number, max: number, decimals = 2): number {
  const n = typeof val === 'number' ? val : typeof val === 'string' ? Number(val) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(min, Math.min(max, n));
  const factor = Math.pow(10, decimals);
  return Math.round(clamped * factor) / factor;
}

export function agePriorIafHz(ageBand?: string): number {
  switch (ageBand) {
    case '18-24':
      return 10.4;
    case '25-34':
      return 10.2;
    case '35-44':
      return 10.0;
    case '45-54':
      return 9.8;
    case '55+':
      return 9.5;
    default:
      return 10.0;
  }
}

export function createDefaultNeuralMemory(ageBand?: string): PersonalNeuralMemory {
  return {
    calibrationPct: 0,
    learnedSessions: 0,
    personalIafHz: agePriorIafHz(ageBand),
    focusOffsetHz: 0,
    focusModMult: 1.0,
    calmModMult: 1.0,
    preferredNoiseMult: 1.0,
    fatigueDipMinute: null,
    peakChronoBucket: null,
    dipChronoBucket: null,
    activeAvgPvtDeltaMs: null,
    shamAvgPvtDeltaMs: null,
    causalLiftMs: null,
    activePvtCount: 0,
    shamPvtCount: 0,
    lastInsightLine: 'Ready to learn from your first session and calibrate to your nervous system.',
  };
}

export function parsePersonalNeuralMemory(
  raw: unknown,
  ageBand?: string
): PersonalNeuralMemory {
  const def = createDefaultNeuralMemory(ageBand);
  if (!raw) return def;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return def;
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return def;

  const peakRaw = typeof obj.peakChronoBucket === 'string' ? obj.peakChronoBucket : '';
  const dipRaw = typeof obj.dipChronoBucket === 'string' ? obj.dipChronoBucket : '';
  const activeCount = Math.max(0, Math.round(clampNumber(obj.activePvtCount, 0, 0, 10_000, 0)));
  const shamCount = Math.max(0, Math.round(clampNumber(obj.shamPvtCount, 0, 0, 10_000, 0)));
  const activeAvg =
    typeof obj.activeAvgPvtDeltaMs === 'number' && Number.isFinite(obj.activeAvgPvtDeltaMs)
      ? Math.round(Math.max(-400, Math.min(400, obj.activeAvgPvtDeltaMs)))
      : null;
  const shamAvg =
    typeof obj.shamAvgPvtDeltaMs === 'number' && Number.isFinite(obj.shamAvgPvtDeltaMs)
      ? Math.round(Math.max(-400, Math.min(400, obj.shamAvgPvtDeltaMs)))
      : null;
  const causalLift =
    activeAvg !== null && shamAvg !== null
      ? Math.round(shamAvg - activeAvg)
      : typeof obj.causalLiftMs === 'number' && Number.isFinite(obj.causalLiftMs)
        ? Math.round(obj.causalLiftMs)
        : null;

  return {
    calibrationPct: Math.round(clampNumber(obj.calibrationPct, def.calibrationPct, 0, 100, 0)),
    learnedSessions: Math.round(clampNumber(obj.learnedSessions, def.learnedSessions, 0, 100_000, 0)),
    personalIafHz: clampNumber(obj.personalIafHz, def.personalIafHz, 8.6, 11.6, 1),
    focusOffsetHz: clampNumber(obj.focusOffsetHz, def.focusOffsetHz, -1.4, 1.6, 1),
    focusModMult: clampNumber(obj.focusModMult, def.focusModMult, 0.65, 1.35, 2),
    calmModMult: clampNumber(obj.calmModMult, def.calmModMult, 0.65, 1.35, 2),
    preferredNoiseMult: clampNumber(obj.preferredNoiseMult, def.preferredNoiseMult, 0.4, 1.6, 2),
    fatigueDipMinute:
      typeof obj.fatigueDipMinute === 'number' && Number.isFinite(obj.fatigueDipMinute)
        ? Math.round(clampNumber(obj.fatigueDipMinute, 18, 8, 45, 0))
        : null,
    peakChronoBucket: VALID_CHRONO_BUCKETS.has(peakRaw) ? (peakRaw as TimeOfDayBucket) : null,
    dipChronoBucket: VALID_CHRONO_BUCKETS.has(dipRaw) ? (dipRaw as TimeOfDayBucket) : null,
    activeAvgPvtDeltaMs: activeAvg,
    shamAvgPvtDeltaMs: shamAvg,
    causalLiftMs: causalLift,
    activePvtCount: activeCount,
    shamPvtCount: shamCount,
    ...(typeof obj.topProtocolId === 'string' ? { topProtocolId: obj.topProtocolId } : {}),
    ...(typeof obj.topProtocolName === 'string' ? { topProtocolName: obj.topProtocolName } : {}),
    ...(typeof obj.topProtocolFitPct === 'number' && Number.isFinite(obj.topProtocolFitPct)
      ? { topProtocolFitPct: Math.round(clampNumber(obj.topProtocolFitPct, 70, 0, 100, 0)) }
      : {}),
    lastInsightLine:
      typeof obj.lastInsightLine === 'string' && obj.lastInsightLine.trim().length > 0
        ? obj.lastInsightLine.trim().slice(0, 200)
        : def.lastInsightLine,
    ...(typeof obj.updatedAt === 'string' ? { updatedAt: obj.updatedAt } : {}),
  };
}

/**
 * Updates the continuous per-listener Personal Neural Memory vector after each session debrief.
 * Combines goal-separated AM dose, Beta frequency micro-tuning, motor-tapping IAF calibration,
 * 1/f noise resonance, learned mid-session attention-dip anticipation, circadian windows, and Active-vs-Sham PVT lift.
 */
export function updatePersonalNeuralMemory(
  prevInput: PersonalNeuralMemory,
  input: {
    targetState: string;
    timeOfDayBucket?: TimeOfDayBucket;
    isControlTrial: boolean;
    reward: number;
    deltaScore: number;
    completionRatio: number;
    actualDurationSec: number;
    baseModulationHz: number;
    feedbackTags?: string[];
    liveAdjustments?: Array<{ atSec: number; control: string; delta: number }>;
    pvtDeltaMs?: number | null;
    tappingMeanItiMs?: number | null;
    tappingCvPct?: number | null;
    hrvRmssdMs?: number | null;
    topProtocol?: { id: string; name: string; fitPct: number };
    chronoScores?: Partial<Record<TimeOfDayBucket, { avgReward: number; trials: number }>>;
    nowIso?: string;
  }
): PersonalNeuralMemory {
  const prev = parsePersonalNeuralMemory(prevInput);
  const tags = Array.isArray(input.feedbackTags) ? input.feedbackTags : [];
  const adjs = Array.isArray(input.liveAdjustments) ? input.liveAdjustments : [];
  const isCalmGoal =
    input.targetState === 'calm_reset' || input.targetState === 'sleep_winddown';
  const countThisSession = input.actualDurationSec >= 60;
  const learnedSessions = prev.learnedSessions + (countThisSession ? 1 : 0);

  let focusModMult = prev.focusModMult;
  let calmModMult = prev.calmModMult;
  let focusOffsetHz = prev.focusOffsetHz;
  let preferredNoiseMult = prev.preferredNoiseMult;
  let personalIafHz = prev.personalIafHz;
  let fatigueDipMinute = prev.fatigueDipMinute;

  const netModTweak = adjs
    .filter((a) => a.control === 'modulation')
    .reduce((acc, a) => acc + a.delta, 0);
  const netNoiseTweak = adjs
    .filter((a) => a.control === 'noise')
    .reduce((acc, a) => acc + a.delta, 0);

  const insights: string[] = [];

  if (!input.isControlTrial) {
    let multDelta = 0;
    if (tags.includes('A bit too intense') || tags.includes('Modulation felt distracting')) {
      multDelta -= 0.08;
    }
    if (tags.includes('Wanted stronger focus')) {
      multDelta += 0.06;
    }
    if (netModTweak !== 0) {
      multDelta += Math.max(-0.1, Math.min(0.1, netModTweak * 0.35));
    }
    if (multDelta !== 0) {
      if (isCalmGoal) {
        calmModMult = clampNumber(prev.calmModMult + multDelta, 1.0, 0.65, 1.35, 2);
        insights.push(`Calm AM dose tuned to ${Math.round(calmModMult * 100)}%`);
      } else {
        focusModMult = clampNumber(prev.focusModMult + multDelta, 1.0, 0.65, 1.35, 2);
        insights.push(`Focus AM dose tuned to ${Math.round(focusModMult * 100)}%`);
      }
    }

    if (!isCalmGoal && input.baseModulationHz >= 13 && input.baseModulationHz <= 22) {
      let hzStep = 0;
      if (tags.includes('Wanted stronger focus') || (input.reward >= 0.78 && netModTweak > 0)) {
        hzStep += 0.25;
      } else if (tags.includes('A bit too intense') || tags.includes('Modulation felt distracting')) {
        hzStep -= 0.3;
      }
      if (hzStep !== 0) {
        focusOffsetHz = clampNumber(prev.focusOffsetHz + hzStep, 0, -1.4, 1.6, 1);
        insights.push(
          `Beta focus offset shifted to ${focusOffsetHz >= 0 ? '+' : ''}${focusOffsetHz.toFixed(1)} Hz`
        );
      }
    }

    if (netNoiseTweak !== 0) {
      const noiseDelta = Math.max(-0.15, Math.min(0.15, netNoiseTweak * 0.4));
      preferredNoiseMult = clampNumber(prev.preferredNoiseMult + noiseDelta, 1.0, 0.4, 1.6, 2);
      insights.push(`1/f stochastic floor set to ${Math.round(preferredNoiseMult * 100)}%`);
    }

    // Detect mid-session fatigue dip minute from early-exit duration (>=8 min) or late live boost
    let observedDipMin: number | null = null;
    if (input.completionRatio >= 0.25 && input.completionRatio < 0.78 && input.actualDurationSec >= 480) {
      observedDipMin = Math.max(8, Math.min(45, Math.round(input.actualDurationSec / 60)));
    } else {
      const midTweak = adjs.find((a) => a.atSec >= 480 && (a.control === 'modulation' || a.control === 'intensity'));
      if (midTweak) {
        observedDipMin = Math.max(8, Math.min(45, Math.round(midTweak.atSec / 60)));
      }
    }
    if (observedDipMin !== null) {
      fatigueDipMinute =
        prev.fatigueDipMinute !== null
          ? Math.round(clampNumber(prev.fatigueDipMinute * 0.65 + observedDipMin * 0.35, 18, 8, 45, 0))
          : observedDipMin;
      insights.push(`Proactive pre-dip lift armed before min ${Math.max(4, fatigueDipMinute - 2)}`);
    }
  }

  // Motor continuation tapping -> Individual Alpha Frequency harmonic prior (8.6–11.6 Hz)
  if (
    typeof input.tappingMeanItiMs === 'number' &&
    Number.isFinite(input.tappingMeanItiMs) &&
    input.tappingMeanItiMs >= 350 &&
    input.tappingMeanItiMs <= 1200 &&
    (input.tappingCvPct === null || input.tappingCvPct === undefined || input.tappingCvPct <= 14)
  ) {
    const rawHz = 1000 / input.tappingMeanItiMs;
    const candidateIaf = clampNumber(rawHz * 6, prev.personalIafHz, 8.6, 11.6, 2);
    personalIafHz = clampNumber(prev.personalIafHz * 0.78 + candidateIaf * 0.22, 10.0, 8.6, 11.6, 1);
    insights.push(`Personal IAF refined to ${personalIafHz.toFixed(1)} Hz`);
  }

  // Active vs. Blind Sham PVT reaction speed running averages
  let activeAvgPvtDeltaMs = prev.activeAvgPvtDeltaMs;
  let shamAvgPvtDeltaMs = prev.shamAvgPvtDeltaMs;
  let activePvtCount = prev.activePvtCount ?? 0;
  let shamPvtCount = prev.shamPvtCount ?? 0;
  if (typeof input.pvtDeltaMs === 'number' && Number.isFinite(input.pvtDeltaMs)) {
    const clampedPvt = Math.max(-400, Math.min(400, input.pvtDeltaMs));
    if (input.isControlTrial) {
      shamAvgPvtDeltaMs =
        shamAvgPvtDeltaMs === null || shamPvtCount === 0
          ? Math.round(clampedPvt)
          : Math.round((shamAvgPvtDeltaMs * shamPvtCount + clampedPvt) / (shamPvtCount + 1));
      shamPvtCount += 1;
    } else {
      activeAvgPvtDeltaMs =
        activeAvgPvtDeltaMs === null || activePvtCount === 0
          ? Math.round(clampedPvt)
          : Math.round((activeAvgPvtDeltaMs * activePvtCount + clampedPvt) / (activePvtCount + 1));
      activePvtCount += 1;
      if (clampedPvt < 0) {
        insights.push(`PVT reaction accelerated ${Math.abs(Math.round(clampedPvt))} ms today`);
      }
    }
  }
  const causalLiftMs =
    activeAvgPvtDeltaMs !== null && shamAvgPvtDeltaMs !== null
      ? Math.round(shamAvgPvtDeltaMs - activeAvgPvtDeltaMs)
      : prev.causalLiftMs;

  // Chronotype best / dip windows across circadian buckets
  let peakChronoBucket = prev.peakChronoBucket;
  let dipChronoBucket = prev.dipChronoBucket;
  if (input.chronoScores) {
    const entries = (Object.entries(input.chronoScores) as Array<
      [TimeOfDayBucket, { avgReward: number; trials: number } | undefined]
    >).filter((e): e is [TimeOfDayBucket, { avgReward: number; trials: number }] =>
      Boolean(e[1] && e[1].trials >= 1 && VALID_CHRONO_BUCKETS.has(e[0]))
    );
    if (entries.length >= 2) {
      const sorted = [...entries].sort((a, b) => b[1].avgReward - a[1].avgReward);
      if (sorted[0][1].avgReward >= 0.62) {
        peakChronoBucket = sorted[0][0];
      }
      const lowest = sorted[sorted.length - 1];
      if (lowest[0] !== sorted[0][0] && lowest[1].avgReward < 0.58) {
        dipChronoBucket = lowest[0];
      } else if (lowest[0] === peakChronoBucket) {
        dipChronoBucket = null;
      }
    }
  }

  // Bayesian shrinkage maturity (0..98%)
  const shrinkageW = learnedSessions > 0 ? (learnedSessions * 0.018) / (learnedSessions * 0.018 + 0.095) : 0;
  let calibrationPct = Math.round(shrinkageW * 84);
  if (activePvtCount > 0 || (typeof input.tappingMeanItiMs === 'number' && input.tappingMeanItiMs > 0) || (typeof input.hrvRmssdMs === 'number' && input.hrvRmssdMs > 0)) {
    calibrationPct += 8;
  }
  if (causalLiftMs !== null) {
    calibrationPct += 6;
  }
  calibrationPct = Math.max(0, Math.min(98, calibrationPct));

  const lastInsightLine =
    insights.length > 0
      ? insights.join(' · ')
      : causalLiftMs !== null && causalLiftMs > 0
        ? `Measured ${causalLiftMs} ms faster reaction on Active vs. Blind Control`
        : learnedSessions > 0
          ? `Absorbed ${learnedSessions} session${learnedSessions === 1 ? '' : 's'} into your personal acoustic model`
          : prev.lastInsightLine;

  return {
    calibrationPct,
    learnedSessions,
    personalIafHz,
    focusOffsetHz,
    focusModMult,
    calmModMult,
    preferredNoiseMult,
    fatigueDipMinute,
    peakChronoBucket,
    dipChronoBucket,
    activeAvgPvtDeltaMs,
    shamAvgPvtDeltaMs,
    causalLiftMs,
    activePvtCount,
    shamPvtCount,
    ...(input.topProtocol
      ? {
          topProtocolId: input.topProtocol.id,
          topProtocolName: input.topProtocol.name,
          topProtocolFitPct: Math.round(input.topProtocol.fitPct),
        }
      : prev.topProtocolId
        ? {
            topProtocolId: prev.topProtocolId,
            topProtocolName: prev.topProtocolName,
            topProtocolFitPct: prev.topProtocolFitPct,
          }
        : {}),
    lastInsightLine,
    updatedAt: input.nowIso ?? new Date().toISOString(),
  };
}
