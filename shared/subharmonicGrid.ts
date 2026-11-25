/**
 * nootropic.fm v7.0 — Offline Sub-Harmonic Tempo Grid & AM Phase-Lock Math
 *
 * Ensures every remastered studio stem sits on an integer sub-harmonic BPM
 * of our target clinical entrainment bands (6 / 10 / 16 / 40 Hz), so each
 * musical beat contains an exact whole number of AM modulation cycles and
 * never drifts out of phase with the clinical oscillator.
 */

export const SUBHARMONIC_GRID_BPMS = [60, 75, 80, 96, 100, 120] as const;
export type SubHarmonicGridBpm = (typeof SUBHARMONIC_GRID_BPMS)[number];

export const NEURAL_ANCHOR_FREQS_HZ = [6, 10, 16, 40] as const;

export interface StudioStemV7Entry {
  sourceKey: string;
  opusKey: string;
  aacKey: string;
  opusUrl: string;
  aacUrl: string;
  opusBytes: number;
  aacBytes: number;
  nativeBpm: number;
  subHarmonicBpm: number;
  alignedBandsHz: number[];
  downbeatOffsetMs: number;
  lufs: number;
  truePeakDbtp: number;
  sampleRate: 48000;
  durationSec: number;
}

/**
 * True when (60 * neuralHz) / bpm is an exact positive integer (to numerical precision),
 * meaning every musical beat aligns identically to neuralHz cycles.
 */
export function isExactSubHarmonic(bpm: number, neuralHz: number): boolean {
  if (!Number.isFinite(bpm) || !Number.isFinite(neuralHz) || bpm <= 0 || neuralHz <= 0) {
    return false;
  }
  const cyclesPerBeat = (60 * neuralHz) / bpm;
  return Math.abs(cyclesPerBeat - Math.round(cyclesPerBeat)) < 1e-4;
}

/**
 * Returns which canonical neural bands (6, 10, 16, 40 Hz) lock cleanly onto `bpm`.
 */
export function getAlignedNeuralBands(bpm: number): number[] {
  if (!Number.isFinite(bpm) || bpm <= 0) return [];
  return NEURAL_ANCHOR_FREQS_HZ.filter((hz) => isExactSubHarmonic(bpm, hz));
}

/**
 * Picks the cleanest integer sub-harmonic target BPM in [60, 75, 80, 96, 100, 120]
 * within a low-artifact RubberBand stretch window (within +/-14%).
 * `variantIndex` lets twin tracks at the same native BPM cover different neural bands
 * (e.g. 92 BPM track-1 -> 96 BPM [16/40 Hz], track-2 -> 100 BPM [10/40 Hz]).
 */
export function pickSubHarmonicTargetBpm(nativeBpm: number, variantIndex = 0): number {
  if (!Number.isFinite(nativeBpm) || nativeBpm <= 0) return 0;

  const candidates = SUBHARMONIC_GRID_BPMS
    .map((candidate) => ({
      bpm: candidate,
      ratio: candidate / nativeBpm,
      logDist: Math.abs(Math.log(candidate / nativeBpm)),
    }))
    .filter((c) => c.ratio >= 0.855 && c.ratio <= 1.145)
    .sort((a, b) => a.logDist - b.logDist);

  if (candidates.length === 0) {
    // Fallback to absolute closest grid BPM if unusual native tempo
    return [...SUBHARMONIC_GRID_BPMS].sort(
      (a, b) => Math.abs(Math.log(a / nativeBpm)) - Math.abs(Math.log(b / nativeBpm))
    )[0];
  }

  // When two grid BPMs are both within +/-11% (e.g. 92 -> [96, 100], 88 -> [96, 80], 68 -> [75, 60]),
  // alternate across variantIndex so genres offer both Alpha (10 Hz) and SMR/Gamma (16/40 Hz) locks.
  if (variantIndex % 2 === 1 && candidates.length >= 2 && candidates[1].logDist <= 0.125) {
    return candidates[1].bpm;
  }

  return candidates[0].bpm;
}

/**
 * Picks the optimal BPM scale factor from an already-snapped `stemBpm` when the live
 * protocol demands an exact lock on `activeNeuralHz` and no bpmRamp is running.
 * Since remastered stems sit in {60, 75, 80, 96, 100, 120}, the needed micro-correction
 * to hit another sub-harmonic grid point is typically 0% (already exact!) or at most 4-8%.
 */
export function pickPlaybackGridRate(
  stemBpm: number,
  activeNeuralHz: number,
  tune432Ratio = 1
): { targetGridBpm: number; tempoScale: number; totalRate: number; isSubHarmonicLocked: boolean } {
  const safe432 = Number.isFinite(tune432Ratio) && tune432Ratio > 0.9 && tune432Ratio < 1.1 ? tune432Ratio : 1;
  if (!Number.isFinite(stemBpm) || stemBpm <= 0) {
    return {
      targetGridBpm: 0,
      tempoScale: 1,
      totalRate: safe432,
      isSubHarmonicLocked: false,
    };
  }

  if (isExactSubHarmonic(stemBpm, activeNeuralHz)) {
    return {
      targetGridBpm: stemBpm,
      tempoScale: 1,
      totalRate: safe432,
      isSubHarmonicLocked: true,
    };
  }

  // If the stem is snapped to e.g. 96 BPM (exact 16/40 Hz) while activeNeuralHz is 10 Hz (Alpha) or 6 Hz (Theta),
  // compute the nearest candidate BPM `bpm` such that (60 * activeNeuralHz) / bpm is an integer k
  // closest to stemBpm, within [0.88, 1.12] tempo range.
  const exactCycles = (60 * activeNeuralHz) / stemBpm;
  const kLow = Math.max(1, Math.floor(exactCycles));
  const kHigh = Math.max(1, Math.ceil(exactCycles));
  const candidateBpms = [kLow, kHigh]
    .map((k) => (60 * activeNeuralHz) / k)
    .filter((b) => b >= 50 && b <= 150)
    .sort((a, b) => Math.abs(Math.log(a / stemBpm)) - Math.abs(Math.log(b / stemBpm)));

  const bestBpm = candidateBpms[0] ?? stemBpm;
  const rawScale = bestBpm / stemBpm;
  if (rawScale >= 0.88 && rawScale <= 1.12) {
    return {
      targetGridBpm: bestBpm,
      tempoScale: rawScale,
      totalRate: rawScale * safe432,
      isSubHarmonicLocked: true,
    };
  }

  return {
    targetGridBpm: stemBpm,
    tempoScale: 1,
    totalRate: safe432,
    isSubHarmonicLocked: false,
  };
}

/**
 * Computes the minimal non-negative `delaySec >= 0` from `scheduleStartSec` so that
 * when playback of a stem starts at `(scheduleStartSec + delaySec)`, its first musical
 * downbeat at `+downbeatOffsetMs` aligns to the exact peak (+1) crest of an AM sine LFO
 * that started at `amOriginSec` with `neuralHz` Hz.
 *
 * Web Audio OscillatorNode('sine') starts at sin(0) = 0 and reaches its first +1 crest
 * at +0.25 cycles (`crestCycleFraction = 0.25`).
 */
export function computeDownbeatPhaseDelaySec(opts: {
  amOriginSec: number;
  scheduleStartSec: number;
  downbeatOffsetMs: number;
  neuralHz: number;
  crestCycleFraction?: number;
}): number {
  const { amOriginSec, scheduleStartSec, downbeatOffsetMs, neuralHz } = opts;
  const crestFrac = opts.crestCycleFraction ?? 0.25;
  if (
    !Number.isFinite(amOriginSec) ||
    !Number.isFinite(scheduleStartSec) ||
    !Number.isFinite(downbeatOffsetMs) ||
    !Number.isFinite(neuralHz) ||
    neuralHz <= 0
  ) {
    return 0;
  }

  const period = 1 / neuralHz;
  const downbeatSec = scheduleStartSec + Math.max(0, downbeatOffsetMs) / 1000;
  const firstCrestSec = amOriginSec + crestFrac * period;
  const delta = downbeatSec - firstCrestSec;
  const phaseMod = ((delta % period) + period) % period;
  if (phaseMod < 1e-6 || period - phaseMod < 1e-6) {
    return 0;
  }
  return period - phaseMod;
}

/**
 * Converts a legacy `.mp3` R2 object key into canonical `v7/` Opus and AAC-LC object keys.
 */
export function buildV7StemKeys(sourceKey: string): { opusKey: string; aacKey: string } {
  const stemNoExt = sourceKey.replace(/^\/+/, '').replace(/\.[^.]+$/, '');
  return {
    opusKey: `v7/${stemNoExt}.opus`,
    aacKey: `v7/${stemNoExt}.m4a`,
  };
}
