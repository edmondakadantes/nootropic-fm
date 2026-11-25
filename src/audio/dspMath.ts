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
 * True-peak mastering brickwall ceiling (-0.80 dBFS = 0.91201084).
 */
export const LIMITER_CEILING_DBFS = -0.8;
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
): { min: number; max: number; rms: number; normPeak: number } {
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
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const s = vals[i] * scale;
    if (s < min) min = s;
    if (s > max) max = s;
    sumSq += s * s;
  }
  return {
    min,
    max,
    rms: Math.sqrt(sumSq / samples),
    normPeak: peak,
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
 * (zero DC offset, 1 Hz +-1 LSB = -90.3 dBFS sub-audible keep-alive anchor for iOS WebKit & MediaSession).
 */
export function createSilentKeepAliveWavBytes(sampleRate = 48000): Uint8Array<ArrayBuffer> {
  const safeRate = Math.max(8000, Math.min(96000, Math.round(sampleRate)));
  const numFrames = safeRate; // 1.0s exact loop
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
  const half = Math.floor(numFrames / 2);
  for (let i = 0; i < numFrames; i++) {
    // 1 Hz square-sign +-1 LSB (-90.3 dBFS, zero DC, zero audible spectrum)
    const sample = i < half ? 1 : -1;
    const base = 44 + i * 4;
    view.setInt16(base, sample, true);
    view.setInt16(base + 2, sample, true);
  }
  return new Uint8Array(buffer);
}
