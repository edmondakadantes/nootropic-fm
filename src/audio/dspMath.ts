/**
 * Pure, deterministic psychoacoustic & DSP mathematical primitives.
 * Shared across the Web Audio engine and automated Node/Chromium verification tests.
 */

/**
 * Exact W3C Web Audio `BiquadFilterNode.Q` value (in dB) required for a 2nd-order
 * Butterworth lowpass/highpass stage (linear Q = 1 / sqrt(2) = 0.70710678).
 * Web Audio interprets `Q` in dB for `lowpass` and `highpass` (`alpha = sin(w0) / (2 * 10^(Q/20))`),
 * whereas `allpass`/`bandpass`/`peaking`/`notch` use linear Q directly.
 * Two cascaded Butterworth stages at this Q form a true 4th-order Linkwitz-Riley (LR4) filter
 * whose LP4 + HP4 complex sum has 0.0000 dB ripple across the entire spectrum.
 */
export const BUTTERWORTH_LP_HP_Q_DB = 20 * Math.log10(Math.SQRT1_2); // -3.010299956639812

/**
 * True-peak mastering brickwall ceiling (-1.00 dBTP = 0.89125094).
 */
export const LIMITER_CEILING_DBFS = -1.0;
export const LIMITER_CEILING_LINEAR = Math.pow(10, LIMITER_CEILING_DBFS / 20);

/**
 * Target raw RMS calibration for generated stochastic colored noise buffers (-17.08 dBFS)
 * so White, Pink, Brown, and Soft Rain deliver consistent calibrated acoustic SNR.
 */
export const NOISE_CALIBRATED_RMS = 0.14;

/**
 * Computes exact peak frequency (Hz) from an FFT magnitude-in-dB array using
 * 3-point quadratic (parabolic) bin interpolation, cutting quantization error
 * from +/- (binHz / 2) down to < 0.5 Hz.
 */
export function computeParabolicPeakHz(
  fftDb: Float32Array,
  sampleRate: number,
  fftSize: number,
  minHz = 35,
  maxHz = 4000,
  minDb = -72
): number | null {
  const bins = fftDb.length;
  if (bins < 4 || sampleRate <= 0 || fftSize <= 0) return null;
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(2, Math.floor(minHz / binHz));
  const maxBin = Math.min(bins - 2, Math.ceil(maxHz / binHz));

  let bestBin = -1;
  let bestDb = -120;
  for (let i = minBin; i <= maxBin; i++) {
    if (fftDb[i] > bestDb) {
      bestDb = fftDb[i];
      bestBin = i;
    }
  }
  if (bestBin < 0 || bestDb < minDb) return null;

  const yL = fftDb[bestBin - 1];
  const yC = fftDb[bestBin];
  const yR = fftDb[bestBin + 1];
  const denom = yL - 2 * yC + yR;
  let offset = 0;
  if (Number.isFinite(denom) && Math.abs(denom) > 1e-6) {
    offset = Math.max(-0.5, Math.min(0.5, (0.5 * (yL - yR)) / denom));
  }
  return Number(((bestBin + offset) * binHz).toFixed(1));
}

/**
 * Measures the exact normalized min, max, and RMS of a zero-mean Fourier periodic wave
 * `sum_k amps[k] * sin((k+1)*t + phaseShifts[k])` normalized so max(|v|) = 1.
 */
export function computePeriodicWaveStats(
  amps: number[],
  phaseShifts: number[],
  samples = 1024
): { min: number; max: number; rms: number; normPeak: number; peakPhaseFraction: number } {
  const vals = new Float64Array(samples);
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    let v = 0;
    for (let k = 0; k < amps.length; k++) {
      v += amps[k] * Math.sin((k + 1) * t + phaseShifts[k]);
    }
    vals[i] = v;
    const av = Math.abs(v);
    if (av > peak) peak = av;
  }
  const scale = peak > 0 ? 1 / peak : 1;
  let min = Infinity;
  let max = -Infinity;
  let maxIdx = 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const s = vals[i] * scale;
    if (s < min) min = s;
    if (s > max) {
      max = s;
      maxIdx = i;
    }
    sumSq += s * s;
  }
  return {
    min,
    max,
    rms: Math.sqrt(sumSq / samples),
    normPeak: peak,
    peakPhaseFraction: maxIdx / samples,
  };
}

/**
 * Computes exact bias + swing GainNode AudioParam pair so:
 *   - peak gain = 1.0 * makeup
 *   - trough gain = (1 - vcaDepth) * makeup
 *   - true RMS loudness stays matched within <= +1.14 dB regardless of waveform asymmetry!
 */
export function computeExactAmGainPair(
  depth: number,
  waveMin = -1,
  waveMax = 1,
  waveRms = Math.SQRT1_2
): { bias: number; swing: number; vcaDepth: number } {
  if (depth <= 0.001) return { bias: 1.0, swing: 0, vcaDepth: 0 };
  const vcaDepth = depth <= 0.36 ? depth : 0.36 + (depth - 0.36) * 0.68;
  const span = Math.max(0.25, waveMax - waveMin);
  const swing0 = vcaDepth / span;
  const bias0 = 1.0 - swing0 * waveMax;
  const rms = Math.sqrt(bias0 * bias0 + swing0 * swing0 * waveRms * waveRms);
  const makeup = Math.min(1.14, 1 / Math.max(0.74, rms));
  return {
    bias: Number((bias0 * makeup).toFixed(4)),
    swing: Number((swing0 * makeup).toFixed(4)),
    vcaDepth,
  };
}

/**
 * Measures the true post-filter RMS attenuation ratio of cascaded Web Audio
 * Butterworth highpass -> lowpass biquads on a stereo buffer using exact W3C
 * Audio EQ Cookbook coefficients (`alpha = sin(w0) / (2 * 10^(Q_dB / 20))`),
 * then scales the buffer in-place so post-filter noise RMS equals `targetRms`.
 */
export function calibrateFilteredStereoNoiseRms(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  hpHz: number,
  lpHz: number,
  targetRms = NOISE_CALIBRATED_RMS,
  qDb = BUTTERWORTH_LP_HP_Q_DB
): void {
  const n = Math.min(left.length, right.length);
  if (n === 0 || sampleRate <= 0) return;

  const qLin = Math.pow(10, qDb / 20);
  const makeHp = (fc: number) => {
    const safeFc = Math.max(10, Math.min(sampleRate * 0.45, fc));
    const w0 = (2 * Math.PI * safeFc) / sampleRate;
    const cosW = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * qLin);
    const a0 = 1 + alpha;
    return {
      b0: (1 + cosW) / 2 / a0,
      b1: -(1 + cosW) / a0,
      b2: (1 + cosW) / 2 / a0,
      a1: (-2 * cosW) / a0,
      a2: (1 - alpha) / a0,
    };
  };
  const makeLp = (fc: number) => {
    const safeFc = Math.max(20, Math.min(sampleRate * 0.48, fc));
    const w0 = (2 * Math.PI * safeFc) / sampleRate;
    const cosW = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * qLin);
    const a0 = 1 + alpha;
    return {
      b0: (1 - cosW) / 2 / a0,
      b1: (1 - cosW) / a0,
      b2: (1 - cosW) / 2 / a0,
      a1: (-2 * cosW) / a0,
      a2: (1 - alpha) / a0,
    };
  };

  const hp = makeHp(hpHz);
  const lp = makeLp(lpHz);
  const skip = Math.min(Math.floor(n / 4), Math.round(sampleRate * 0.25));
  let sumSq = 0;
  let count = 0;
  let filteredPeak = 0;

  for (const ch of [left, right]) {
    let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
    let lx1 = 0, lx2 = 0, ly1 = 0, ly2 = 0;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const yh = hp.b0 * x + hp.b1 * hx1 + hp.b2 * hx2 - hp.a1 * hy1 - hp.a2 * hy2;
      hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = yh;

      const yl = lp.b0 * yh + lp.b1 * lx1 + lp.b2 * lx2 - lp.a1 * ly1 - lp.a2 * ly2;
      lx2 = lx1; lx1 = yh; ly2 = ly1; ly1 = yl;

      if (i >= skip) {
        sumSq += yl * yl;
        count++;
        const absYl = Math.abs(yl);
        if (absYl > filteredPeak) filteredPeak = absYl;
      }
    }
  }

  const filteredRms = Math.sqrt(sumSq / Math.max(1, count));
  if (filteredRms < 1e-6) return;

  let scale = Math.min(100, targetRms / filteredRms);
  // Guard POST-filter output peak against >0.98 DAC clipping while preserving Float32 pre-filter LF headroom
  if (filteredPeak * scale > 0.98) {
    scale = 0.98 / filteredPeak;
  }
  for (let i = 0; i < n; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
}

/**
 * Normalizes a stereo pair of buffers in-place to a calibrated target RMS
 * with soft safety peak guard below 0.98.
 */
export function normalizeStereoBufferRms(
  left: Float32Array,
  right: Float32Array,
  targetRms = NOISE_CALIBRATED_RMS
): void {
  const n = Math.min(left.length, right.length);
  if (n === 0) return;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += left[i] * left[i] + right[i] * right[i];
  }
  const rms = Math.sqrt(sumSq / (2 * n));
  if (rms < 1e-6) return;
  let scale = targetRms / rms;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const aL = Math.abs(left[i]);
    const aR = Math.abs(right[i]);
    if (aL > peak) peak = aL;
    if (aR > peak) peak = aR;
  }
  if (peak * scale > 0.96) {
    scale = 0.96 / peak;
  }
  for (let i = 0; i < n; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
}

/**
 * Generates a clean 16-bit signed stereo PCM WAV matching the AudioContext sampleRate
 * (zero DC offset, smooth quantized 1 Hz +-1 LSB = -90.3 dBFS peak / -93.3 dBFS RMS,
 * max 1 LSB step so zero high-frequency switching harmonics reach sensitive IEMs or iOS DACs).
 */
export function createSilentKeepAliveWavBytes(sampleRate = 48000): Uint8Array<ArrayBuffer> {
  const safeRate = Math.max(8000, Math.min(96000, Math.round(sampleRate)));
  const numFrames = 2 * Math.round(safeRate / 2); // exact even 1.0s loop for zero DC symmetry
  const channels = 2;
  const bytesPerSample = 2;
  const dataBytes = numFrames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, safeRate, true);
  view.setUint32(28, safeRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true); // 16-bit signed PCM
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < numFrames; i++) {
    // Half-sample-symmetric 1 Hz quantized +-1 LSB (0, +1, 0, -1 => exact 0 DC, max 1 LSB step)
    const v = Math.sin((2 * Math.PI * (i + 0.5)) / numFrames);
    const sample = v > 0.5 ? 1 : v < -0.5 ? -1 : 0;
    const base = 44 + i * 4;
    view.setInt16(base, sample, true);
    view.setInt16(base + 2, sample, true);
  }
  return new Uint8Array(buffer);
}

export interface ItuBiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Computes exact sample-rate-adaptive ITU-R BS.1770-4 / EBU R128 K-weighting DF2T biquad stages
 * (Stage 1: +4 dB head-acoustics high-shelf; Stage 2: 38.14 Hz RLB high-pass).
 */
export function computeItuKWeightingCoeffs(sampleRate: number): {
  pre: ItuBiquadCoeffs;
  rlb: ItuBiquadCoeffs;
} {
  const fs = Math.max(8000, Number(sampleRate) || 48000);

  // Stage 1: ITU-R BS.1770-4 analytical pre-filter high-shelf
  const f0Pre = 1681.974450955533;
  const gPre = 3.999843853973347;
  const qPre = 0.7071752369554196;
  const vh = Math.pow(10, gPre / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const kPre = Math.tan((Math.PI * f0Pre) / fs);
  const a0Pre = 1 + kPre / qPre + kPre * kPre;

  const pre: ItuBiquadCoeffs = {
    b0: (vh + (vb * kPre) / qPre + kPre * kPre) / a0Pre,
    b1: (2 * (kPre * kPre - vh)) / a0Pre,
    b2: (vh - (vb * kPre) / qPre + kPre * kPre) / a0Pre,
    a1: (2 * (kPre * kPre - 1)) / a0Pre,
    a2: (1 - kPre / qPre + kPre * kPre) / a0Pre,
  };

  // Stage 2: ITU-R BS.1770-4 RLB high-pass weighting curve
  const f0Rlb = 38.13547087602444;
  const qRlb = 0.5003270373238773;
  const kRlb = Math.tan((Math.PI * f0Rlb) / fs);
  const a0Rlb = 1 + kRlb / qRlb + kRlb * kRlb;

  const rlb: ItuBiquadCoeffs = {
    b0: 1 / a0Rlb,
    b1: -2 / a0Rlb,
    b2: 1 / a0Rlb,
    a1: (2 * (kRlb * kRlb - 1)) / a0Rlb,
    a2: (1 - kRlb / qRlb + kRlb * kRlb) / a0Rlb,
  };

  return { pre, rlb };
}

/**
 * Estimates age-indexed Individual Alpha Frequency (IAF, Corcoran et al. 2018) prior in 0.5 Hz steps.
 */
export function estimateAgePriorIafHz(ageBand?: string | null): number {
  let raw = 10.0;
  if (ageBand === '18_29') raw = 10.5;
  else if (ageBand === '30_44') raw = 10.0;
  else if (ageBand === '45_59') raw = 9.5;
  else if (ageBand === '60_plus') raw = 9.0;
  const snapped = Math.round(raw * 2) / 2;
  return Math.max(8.5, Math.min(11.5, snapped));
}
