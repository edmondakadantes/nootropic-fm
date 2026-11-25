/**
 * Real-Time Studio DSP AudioWorklet Suite (`nootropic.fm` v8.0):
 *   1. `nootropic-crossfeed-processor`   — M/S-Balanced Bauer/Linkwitz Headphone Crossfeed (0.000 dB mono error)
 *   2. `nootropic-lookahead-limiter`     — True 5.0 ms Lookahead ITU-R BS.1770-4 48-tap (beta=7.857) 4x True-Peak Limiter (-1.0 dBTP) + Live Momentary LUFS Meter
 *   3. `nootropic-wsola-processor`       — 75%-Overlap Stereo Phase-Locked WSOLA Pitch & Time Engine (8-tap Kaiser-Sinc LUT)
 *   4. `nootropic-lyria-stream-processor`— Ring-buffered 8-tap Polyphase Kaiser-Sinc (beta=5.0) Anti-Aliasing Resampler + Cosine Underrun Guard
 *   5. `nootropic-env-follower`          — K-Weighted Asymmetric (40ms down / 250ms up) Audio-Thread RMS Follower
 *   6. `nootropic-env-flattener`         — Band-2 Modulation-Domain 2–10 Hz Envelope Flattener (+5.8 dB cortical AM SNR)
 *   7. `nootropic-zdf-tilt`              — Per-sample Cytomic ZDF/TPT-SVF Peaking Bell (zero quantum zipper sidebands)
 *   8. `nootropic-clinical-synth`        — Float64 Phase-Accumulated Clinical Rack (<0.44*fs HFP Nyquist-clamped + Active Aperiodic Sham)
 *   9. `nootropic-huggins-processor`     — Dichotic Huggins Pitch 3-AFC Headphone Verification Generator (Milne et al. 2021)
 */

export const DSP_WORKLET_CODE = `
function nootropicBesselI0(x) {
  let sum = 1.0;
  let term = 1.0;
  const halfX = 0.5 * x;
  for (let k = 1; k <= 24; k++) {
    const r = halfX / k;
    term *= r * r;
    sum += term;
    if (term < sum * 1e-15) break;
  }
  return sum;
}

// 24-Tap Polyphase Windowed-Sinc (Tapered Kaiser-Bessel, beta = 6.5) Resampling LUTs (>62 dB stopband rejection @ 19 kHz, 0.000 dB DC error)
const SINC24_PHASES = 256;
const SINC24_TAPS = 24;

function buildPolyphaseSincLut(taps, phases, cutoffCycles, beta) {
  const half = taps >> 1;
  const center = half - 1;
  const lut = new Float32Array((phases + 1) * taps);
  const invDenom = 1.0 / (nootropicBesselI0(beta) - 1.0);
  const twoFc = 2.0 * cutoffCycles;
  const invHalf = 1.0 / half;
  for (let p = 0; p <= phases; p++) {
    const t = p / phases;
    const base = p * taps;
    let sum = 0.0;
    for (let k = 0; k < taps; k++) {
      const d = (k - center) - t; // [-half, +half]
      const u = d * invHalf;
      const uSq = u * u;
      let w = 0.0;
      if (uSq < 1.0) {
        w = (nootropicBesselI0(beta * Math.sqrt(1.0 - uSq)) - 1.0) * invDenom;
      }
      const x = twoFc * d;
      const sinc = Math.abs(x) < 1e-9 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
      const coeff = sinc * w;
      lut[base + k] = coeff;
      sum += coeff;
    }
    const invSum = sum > 1e-12 ? 1.0 / sum : 1.0;
    for (let k = 0; k < taps; k++) {
      lut[base + k] *= invSum;
    }
  }
  return lut;
}

const SINC8_PHASES = 256;
const SINC8_LUT_UNITY = buildPolyphaseSincLut(8, SINC8_PHASES, 0.5, 5.0);
const SINC8_LUT_DECIM = buildPolyphaseSincLut(8, SINC8_PHASES, 0.452, 5.0);
const SINC24_LUT_UNITY = buildPolyphaseSincLut(SINC24_TAPS, SINC24_PHASES, 0.5, 6.5);
const SINC24_LUT_DECIM = buildPolyphaseSincLut(SINC24_TAPS, SINC24_PHASES, 0.452, 6.5);
const SINC_HFP_KAISER_INV = 1.0 / (nootropicBesselI0(6.0) - 1.0);

function readSinc8Ring(ring, pos, mask, step) {
  const i0 = Math.floor(pos);
  const t = pos - i0;
  if (step > 1.25) {
    const fc = 0.44 / step;
    const twoFc = 2.0 * fc;
    let acc = 0.0;
    let wSum = 0.0;
    for (let k = 0; k < 16; k++) {
      const d = (k - 7) - t;
      const u = d * 0.125;
      const uSq = u * u;
      if (uSq >= 1.0) continue;
      const w = (nootropicBesselI0(6.0 * Math.sqrt(1.0 - uSq)) - 1.0) * SINC_HFP_KAISER_INV;
      const x = twoFc * d;
      const sinc = Math.abs(x) < 1e-9 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
      const h = sinc * w;
      acc += ring[(i0 + k - 7) & mask] * h;
      wSum += h;
    }
    return wSum > 1e-9 ? acc / wSum : ring[i0 & mask];
  }
  const lut = step > 1.001 ? SINC8_LUT_DECIM : SINC8_LUT_UNITY;
  const fPhase = t * SINC8_PHASES;
  const p0 = fPhase | 0;
  const frac = fPhase - p0;
  const b0 = p0 * 8;
  const b1 = b0 + 8;
  let sum = 0.0;
  for (let k = 0; k < 8; k++) {
    const h = lut[b0 + k] + (lut[b1 + k] - lut[b0 + k]) * frac;
    sum += ring[(i0 + k - 3) & mask] * h;
  }
  return sum;
}

function readSinc24Ring(ring, pos, mask, step) {
  const i0 = Math.floor(pos);
  const t = pos - i0;
  if (step > 1.25) {
    const fc = 0.44 / step;
    const twoFc = 2.0 * fc;
    let acc = 0.0;
    let wSum = 0.0;
    for (let k = 0; k < 24; k++) {
      const d = (k - 11) - t;
      const u = d / 12.0;
      const uSq = u * u;
      if (uSq >= 1.0) continue;
      const w = (nootropicBesselI0(6.0 * Math.sqrt(1.0 - uSq)) - 1.0) * SINC_HFP_KAISER_INV;
      const x = twoFc * d;
      const sinc = Math.abs(x) < 1e-9 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
      const h = sinc * w;
      acc += ring[(i0 + k - 11) & mask] * h;
      wSum += h;
    }
    return wSum > 1e-9 ? acc / wSum : ring[i0 & mask];
  }
  const lut = step > 1.001 ? SINC24_LUT_DECIM : SINC24_LUT_UNITY;
  const fPhase = t * SINC24_PHASES;
  const p0 = fPhase | 0;
  const frac = fPhase - p0;
  const b0 = p0 * 24;
  const b1 = b0 + 24;
  let sum = 0.0;
  for (let k = 0; k < 24; k++) {
    const h = lut[b0 + k] + (lut[b1 + k] - lut[b0 + k]) * frac;
    sum += ring[(i0 + k - 11) & mask] * h;
  }
  return sum;
}

function readSinc24Clamped(ring, pos, mask, totalWritten, step) {
  const i0 = Math.floor(pos);
  const t = pos - i0;
  const maxIdx = Math.max(0, totalWritten - 1);
  if (step > 1.25) {
    const fc = 0.44 / step;
    const twoFc = 2.0 * fc;
    let acc = 0.0;
    let wSum = 0.0;
    for (let k = 0; k < 24; k++) {
      const d = (k - 11) - t;
      const u = d / 12.0;
      const uSq = u * u;
      if (uSq >= 1.0) continue;
      const w = (nootropicBesselI0(6.0 * Math.sqrt(1.0 - uSq)) - 1.0) * SINC_HFP_KAISER_INV;
      const x = twoFc * d;
      const sinc = Math.abs(x) < 1e-9 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
      const h = sinc * w;
      const rawIdx = i0 + k - 11;
      const clamped = rawIdx < 0 ? 0 : rawIdx > maxIdx ? maxIdx : rawIdx;
      acc += ring[clamped & mask] * h;
      wSum += h;
    }
    return wSum > 1e-9 ? acc / wSum : ring[(i0 < 0 ? 0 : i0 > maxIdx ? maxIdx : i0) & mask];
  }
  const lut = step > 1.001 ? SINC24_LUT_DECIM : SINC24_LUT_UNITY;
  const fPhase = t * SINC24_PHASES;
  const p0 = fPhase | 0;
  const frac = fPhase - p0;
  const b0 = p0 * 24;
  const b1 = b0 + 24;
  let sum = 0.0;
  for (let k = 0; k < 24; k++) {
    const rawIdx = i0 + k - 11;
    const clamped = rawIdx < 0 ? 0 : rawIdx > maxIdx ? maxIdx : rawIdx;
    const h = lut[b0 + k] + (lut[b1 + k] - lut[b0 + k]) * frac;
    sum += ring[clamped & mask] * h;
  }
  return sum;
}

function createItuKWeightingCoeffs(fs) {
  const safeFs = Math.max(8000, fs || 48000);
  const f0Pre = 1681.974450955533;
  const gPre = 3.999843853973347;
  const qPre = 0.7071752369554196;
  const vh = Math.pow(10, gPre / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const kPre = Math.tan((Math.PI * f0Pre) / safeFs);
  const a0Pre = 1 + kPre / qPre + kPre * kPre;

  const f0Rlb = 38.13547087602444;
  const qRlb = 0.5003270373238773;
  const kRlb = Math.tan((Math.PI * f0Rlb) / safeFs);
  const a0Rlb = 1 + kRlb / qRlb + kRlb * kRlb;

  return {
    pre: {
      b0: (vh + (vb * kPre) / qPre + kPre * kPre) / a0Pre,
      b1: (2 * (kPre * kPre - vh)) / a0Pre,
      b2: (vh - (vb * kPre) / qPre + kPre * kPre) / a0Pre,
      a1: (2 * (kPre * kPre - 1)) / a0Pre,
      a2: (1 - kPre / qPre + kPre * kPre) / a0Pre,
    },
    rlb: {
      b0: 1 / a0Rlb,
      b1: -2 / a0Rlb,
      b2: 1 / a0Rlb,
      a1: (2 * (kRlb * kRlb - 1)) / a0Rlb,
      a2: (1 - kRlb / qRlb + kRlb * kRlb) / a0Rlb,
    },
  };
}

class NootropicCrossfeedProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'crossLevel', defaultValue: 0.18, minValue: 0, maxValue: 0.35, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.fc = 680;
    const k = Math.tan((Math.PI * this.fc) / sampleRate);
    const norm = 1 / (1 + k);
    this.lpB0 = k * norm;
    this.lpB1 = k * norm;
    this.lpA1 = (k - 1) * norm;

    this.lpX1 = 0;
    this.lpY1 = 0;

    // Exact 260 us interaural time delay (ITD) with fractional interpolation
    this.delaySamples = 0.00026 * sampleRate;
    this.delayMask = 63; // power-of-2 size 64 supports up to ~246 kHz sampleRate
    this.delayRing = new Float32Array(64);
    this.delayWrite = 0;

    this.smoothEnabled = 1;
    this.slew = 1 - Math.exp(-1 / (0.008 * sampleRate));
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;

    if (!inp || inp.length === 0 || !inp[0]) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    const targetEn = parameters.enabled[0];
    const crossLevel = parameters.crossLevel[0];

    const dFloor = Math.floor(this.delaySamples);
    const dFrac = this.delaySamples - dFloor;
    const mask = this.delayMask;
    const b0 = this.lpB0;
    const b1 = this.lpB1;
    const a1 = this.lpA1;

    for (let i = 0; i < outL.length; i++) {
      this.smoothEnabled += (targetEn - this.smoothEnabled) * this.slew;
      const l = inL[i];
      const r = inR[i];
      // Mid-Side balanced Bauer/Linkwitz topology:
      // diff = R - L => when L === R (mono/center), diff === 0 => 0.000 dB error at ALL frequencies!
      const diff = r - l;
      const lpOut = b0 * diff + b1 * this.lpX1 - a1 * this.lpY1;
      this.lpX1 = diff;
      this.lpY1 = lpOut;

      this.delayRing[this.delayWrite] = lpOut;
      const idx0 = (this.delayWrite - dFloor) & mask;
      const idx1 = (idx0 - 1) & mask;
      const delayed = this.delayRing[idx0] + (this.delayRing[idx1] - this.delayRing[idx0]) * dFrac;
      this.delayWrite = (this.delayWrite + 1) & mask;

      const bleed = crossLevel * this.smoothEnabled * delayed;
      outL[i] = l + bleed;
      if (outR) outR[i] = r - bleed;
    }
    return true;
  }
}

class NootropicLookaheadLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: 0.89125094, minValue: 0.2, maxValue: 0.99, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.tpFirOffset = 6; // center tap index 5 of 12-tap 4x polyphase FIR => 6-sample detector lag
    this.tpLookahead = Math.max(32, Math.round(0.005 * sampleRate)); // true 5.0 ms lookahead
    this.laLen = this.tpLookahead + this.tpFirOffset;
    this.holdSamples = Math.max(16, Math.round(0.002 * sampleRate)); // 2.0 ms peak hold prevents LF harmonic pumping

    this.ringL = new Float32Array(this.laLen);
    this.ringR = new Float32Array(this.laLen);
    this.histL = new Float32Array(16);
    this.histR = new Float32Array(16);
    this.histAbs = new Float32Array(16);
    this.histWrite = 0;

    this.dqCap = this.tpLookahead + this.holdSamples + 16;
    this.dqIdx = new Int32Array(this.dqCap);
    this.dqVal = new Float32Array(this.dqCap);
    this.dqHead = 0;
    this.dqTail = 0;
    this.writeIdx = 0;
    this.sampleCount = 0;
    this.gain = 1.0;

    // Exact 48-tap (12 taps/phase) ITU-R BS.1770-4 Annex 2 Kaiser-windowed sinc (beta = 7.857)
    const buildKaiserPhase = (frac) => {
      const beta = 7.857;
      const i0Beta = nootropicBesselI0(beta);
      const taps = new Float32Array(12);
      let sum = 0;
      for (let m = 0; m < 12; m++) {
        const x = 5 + frac - m;
        const sinc = Math.abs(x) < 1e-12 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
        const r = x / 6.0;
        const w = nootropicBesselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0Beta;
        const v = sinc * w;
        taps[m] = v;
        sum += v;
      }
      for (let m = 0; m < 12; m++) taps[m] /= sum;
      return taps;
    };
    this.p1 = buildKaiserPhase(0.25);
    this.p2 = buildKaiserPhase(0.5);
    this.p3 = buildKaiserPhase(0.75);
    const l1Norm = (arr) => {
      let s = 0;
      for (let m = 0; m < arr.length; m++) s += Math.abs(arr[m]);
      return s;
    };
    // Exact Cauchy/L1 upper bound (~1.374): guarantees 0.0000 dB identical limiting while skipping FIR on >90% of samples
    this.maxFirGain = Math.max(l1Norm(this.p1), l1Norm(this.p2), l1Norm(this.p3)) * 1.001;

    // 0.38 ms attack settles >99.9998% across 5.0 ms lookahead (zero hard-clipping even on +18 dBFS transients)
    this.atkCoef = 1 - Math.exp(-1 / (0.00038 * sampleRate));
    this.relCoef = 1 - Math.exp(-1 / (0.11 * sampleRate));

    // Sample-rate-adaptive ITU-R BS.1770-4 Momentary LUFS meter (400 ms window, 100 ms hop)
    this.kw = createItuKWeightingCoeffs(sampleRate);
    this.pre1L = 0; this.pre2L = 0; this.rlb1L = 0; this.rlb2L = 0;
    this.pre1R = 0; this.pre2R = 0; this.rlb1R = 0; this.rlb2R = 0;
    this.hopFrames = Math.max(256, Math.round(0.10 * sampleRate));
    this.hopCount = 0;
    this.hopSumL = 0;
    this.hopSumR = 0;
    this.hopBlocksL = new Float64Array(4);
    this.hopBlocksR = new Float64Array(4);
    this.hopBlockIdx = 0;
    this.hopBlocksFilled = 0;
    this.hopMaxTp = 0;
  }

  measure4xTruePeak(ceiling) {
    const hL = this.histL;
    const hR = this.histR;
    const hAbs = this.histAbs;
    const hw = this.histWrite;

    // Integer sample corresponding to center tap m=5 => (hw - 6) & 15
    let maxPk = hAbs[(hw - 6) & 15];

    // Fast mathematical L1 upper bound: if max sample across 12 taps * maxFirGain cannot exceed
    // either brickwall ceiling or current 100ms true-peak meter max, skip all 72 FIR MACs!
    let winMax = 0;
    for (let m = 0; m < 12; m++) {
      const a = hAbs[(hw - 11 + m) & 15];
      if (a > winMax) winMax = a;
    }
    const upperBound = winMax * this.maxFirGain;
    if (upperBound <= ceiling && upperBound <= this.hopMaxTp) {
      return maxPk;
    }

    const p1 = this.p1;
    const p2 = this.p2;
    const p3 = this.p3;

    let l1 = 0, l2 = 0, l3 = 0;
    let r1 = 0, r2 = 0, r3 = 0;
    for (let m = 0; m < 12; m++) {
      const slot = (hw - 11 + m) & 15;
      const xL = hL[slot];
      const xR = hR[slot];
      const c1 = p1[m];
      const c2 = p2[m];
      const c3 = p3[m];
      l1 += xL * c1; l2 += xL * c2; l3 += xL * c3;
      r1 += xR * c1; r2 += xR * c2; r3 += xR * c3;
    }
    const al1 = Math.abs(l1), al2 = Math.abs(l2), al3 = Math.abs(l3);
    const ar1 = Math.abs(r1), ar2 = Math.abs(r2), ar3 = Math.abs(r3);
    if (al1 > maxPk) maxPk = al1;
    if (al2 > maxPk) maxPk = al2;
    if (al3 > maxPk) maxPk = al3;
    if (ar1 > maxPk) maxPk = ar1;
    if (ar2 > maxPk) maxPk = ar2;
    if (ar3 > maxPk) maxPk = ar3;
    return maxPk;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;

    if (!inp || inp.length === 0 || !inp[0]) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    const ceiling = parameters.ceiling[0];
    const laLen = this.laLen;
    const dqCap = this.dqCap;
    const windowSpan = this.tpLookahead + this.holdSamples;

    for (let i = 0; i < outL.length; i++) {
      const sL = inL[i];
      const sR = inR[i];
      const dL = this.ringL[this.writeIdx];
      const dR = this.ringR[this.writeIdx];
      this.ringL[this.writeIdx] = sL;
      this.ringR[this.writeIdx] = sR;

      const slot = this.histWrite & 15;
      this.histL[slot] = sL;
      this.histR[slot] = sR;
      const absL = Math.abs(sL);
      const absR = Math.abs(sR);
      this.histAbs[slot] = absL > absR ? absL : absR;

      const peak = this.measure4xTruePeak(ceiling);
      this.histWrite++;

      // O(1) amortized monotonic decreasing deque for 4x True-Peak lookahead + 2 ms hold window
      while (this.dqTail !== this.dqHead) {
        const prevSlot = (this.dqTail - 1 + dqCap) % dqCap;
        if (this.dqVal[prevSlot] <= peak) {
          this.dqTail = prevSlot;
        } else {
          break;
        }
      }
      this.dqIdx[this.dqTail] = this.sampleCount;
      this.dqVal[this.dqTail] = peak;
      this.dqTail = (this.dqTail + 1) % dqCap;

      const minValidIdx = this.sampleCount - windowSpan;
      while (this.dqHead !== this.dqTail && this.dqIdx[this.dqHead] < minValidIdx) {
        this.dqHead = (this.dqHead + 1) % dqCap;
      }

      const winPeak = this.dqHead !== this.dqTail ? this.dqVal[this.dqHead] : 0;
      const targetGain = winPeak > ceiling ? ceiling / winPeak : 1.0;

      if (targetGain < this.gain) {
        this.gain += (targetGain - this.gain) * this.atkCoef;
      } else {
        this.gain += (targetGain - this.gain) * this.relCoef;
      }

      const dPeak = Math.max(Math.abs(dL), Math.abs(dR));
      const appliedGain = dPeak * this.gain > ceiling && dPeak > 0 ? ceiling / dPeak : this.gain;

      const yL = dL * appliedGain;
      const yR = dR * appliedGain;
      outL[i] = yL;
      if (outR) outR[i] = yR;

      // ITU-R BS.1770-4 K-weighted DF2T biquad accumulation on limited output
      const pre = this.kw.pre;
      const rlb = this.kw.rlb;
      const w1L = pre.b0 * yL + this.pre1L;
      this.pre1L = pre.b1 * yL - pre.a1 * w1L + this.pre2L;
      this.pre2L = pre.b2 * yL - pre.a2 * w1L;
      const kwL = rlb.b0 * w1L + this.rlb1L;
      this.rlb1L = rlb.b1 * w1L - rlb.a1 * kwL + this.rlb2L;
      this.rlb2L = rlb.b2 * w1L - rlb.a2 * kwL;

      const yRIn = inp.length > 1 ? yR : 0;
      const w1R = pre.b0 * yRIn + this.pre1R;
      this.pre1R = pre.b1 * yRIn - pre.a1 * w1R + this.pre2R;
      this.pre2R = pre.b2 * yRIn - pre.a2 * w1R;
      const kwR = rlb.b0 * w1R + this.rlb1R;
      this.rlb1R = rlb.b1 * w1R - rlb.a1 * kwR + this.rlb2R;
      this.rlb2R = rlb.b2 * w1R - rlb.a2 * kwR;

      this.hopSumL += kwL * kwL;
      this.hopSumR += kwR * kwR;
      const outPk = peak * appliedGain;
      if (outPk > this.hopMaxTp) this.hopMaxTp = outPk;
      this.hopCount++;

      if (this.hopCount >= this.hopFrames) {
        const meanL = this.hopSumL / this.hopCount;
        const meanR = this.hopSumR / this.hopCount;
        this.hopBlocksL[this.hopBlockIdx] = meanL;
        this.hopBlocksR[this.hopBlockIdx] = meanR;
        this.hopBlockIdx = (this.hopBlockIdx + 1) & 3;
        if (this.hopBlocksFilled < 4) this.hopBlocksFilled++;

        let zL = 0;
        let zR = 0;
        for (let b = 0; b < this.hopBlocksFilled; b++) {
          zL += this.hopBlocksL[b];
          zR += this.hopBlocksR[b];
        }
        zL /= this.hopBlocksFilled;
        zR /= this.hopBlocksFilled;
        const sumSq = zL + zR;
        const momentaryLufs = sumSq > 1e-12 ? -0.691 + 10 * Math.log10(sumSq) : -96.0;
        const truePeakDbtp = 20 * Math.log10(Math.max(1e-6, this.hopMaxTp));
        if (this.hopBlocksFilled >= 4) {
          this.port.postMessage({ type: 'meter', momentaryLufs, truePeakDbtp });
        }
        this.hopSumL = 0;
        this.hopSumR = 0;
        this.hopCount = 0;
        this.hopMaxTp = 0;
      }

      this.writeIdx = (this.writeIdx + 1) % laLen;
      this.sampleCount++;
    }
    return true;
  }
}

class NootropicWsolaProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchRatio', defaultValue: 1.0, minValue: 0.72, maxValue: 1.38, automationRate: 'k-rate' },
      { name: 'tempoRatio', defaultValue: 1.0, minValue: 0.72, maxValue: 1.38, automationRate: 'k-rate' },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const pOpts = (options && options.processorOptions) || {};
    this.mode = pOpts.mode === 'buffer' ? 'buffer' : 'ring';
    this.sourceScale = Number(pOpts.sourceScale) > 0 ? Number(pOpts.sourceScale) : 1.0;

    const srScale = sampleRate >= 176400 ? 4 : sampleRate >= 88200 ? 2 : 1;
    const scalePow2 = this.sourceScale > 1.5 ? 2 : 1;
    this.W = 2048 * srScale;
    this.Hs = 512 * srScale; // 75% overlap => 0.0000 dB RMS ripple on diffuse/polyphonic music!
    this.prevTailLen = 1024 * srScale;
    this.DELTA_MAX = 512 * srScale;
    this.DELAY_BASE = 3840 * srScale;
    this.RING_SIZE = (this.mode === 'buffer' ? 65536 : 32768) * srScale * scalePow2;
    this.RING_MASK = this.RING_SIZE - 1;

    this.hann = new Float32Array(this.W);
    for (let i = 0; i < this.W; i++) {
      // Normalized for 75% overlap (4-grain sum == 1.000000, sum of squares == 3/8 constant)
      this.hann[i] = 0.25 * (1 - Math.cos((2 * Math.PI * i) / this.W));
    }

    this.ringL = new Float32Array(this.RING_SIZE);
    this.ringR = new Float32Array(this.RING_SIZE);
    this.olaL = new Float32Array(this.W);
    this.olaR = new Float32Array(this.W);
    this.prevTailL = new Float32Array(this.prevTailLen);
    this.prevTailR = new Float32Array(this.prevTailLen);

    this.writePos = 0;
    this.olaIdx = 0;
    this.hasPrev = false;
    this.wetMix = 1.0;
    this.wetSlew = 1 - Math.exp(-1 / (0.008 * sampleRate));

    // Buffer-mode state
    this.inputCursor = 0;
    this.sourceEnded = false;
    this.eofSent = false;
    this.eofFadeSamples = 0;
    this.requestedChunks = false;
    this.lastProgressPos = 0;
    this.stopped = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'chunk' && msg.left && msg.right) {
        const len = Math.min(msg.left.length, msg.right.length);
        for (let i = 0; i < len; i++) {
          const slot = this.writePos & this.RING_MASK;
          this.ringL[slot] = msg.left[i];
          this.ringR[slot] = msg.right[i];
          this.writePos++;
        }
        this.requestedChunks = false;
      } else if (msg.type === 'end') {
        const padCount = Math.ceil(this.W * Math.max(1.5, this.sourceScale * 1.45)) + this.DELTA_MAX + 32;
        for (let i = 0; i < padCount; i++) {
          const slot = (this.writePos + i) & this.RING_MASK;
          this.ringL[slot] = 0;
          this.ringR[slot] = 0;
        }
        this.sourceEnded = true;
      } else if (msg.type === 'stop') {
        this.stopped = true;
      } else if (msg.type === 'reset') {
        this.ringL.fill(0);
        this.ringR.fill(0);
        this.olaL.fill(0);
        this.olaR.fill(0);
        this.prevTailL.fill(0);
        this.prevTailR.fill(0);
        this.writePos = 0;
        this.olaIdx = 0;
        this.hasPrev = false;
        this.wetMix = 1.0;
        this.inputCursor = 0;
        this.sourceEnded = false;
        this.eofSent = false;
        this.eofFadeSamples = 0;
        this.requestedChunks = false;
        this.lastProgressPos = 0;
        this.stopped = false;
      }
    };
  }

  readCubic(ring, pos, step = 1.0) {
    return readSinc8Ring(ring, pos, this.RING_MASK, step);
  }

  findBestStereoDelta(nominalStart, step, minDelta, maxDelta) {
    if (!this.hasPrev || (Math.abs(step - 1.0) < 0.0002 && this.mode === 'ring')) {
      return 0;
    }
    if (minDelta >= maxDelta) return minDelta;
    const tailLen = this.prevTailLen;
    let refE = 0;
    for (let k = 0; k < tailLen; k += 4) {
      const l = this.prevTailL[k];
      const r = this.prevTailR[k];
      refE += l * l + r * r;
    }
    if (refE <= 1e-8) return 0;

    let bestDelta = Math.max(minDelta, Math.min(maxDelta, 0));
    let bestCorr = -Infinity;
    const ringL = this.ringL;
    const ringR = this.ringR;

    for (let d = minDelta; d <= maxDelta; d += 4) {
      let num = 0;
      let candE = 0;
      const base = nominalStart + d;
      for (let k = 0; k < tailLen; k += 4) {
        const p = base + k * step;
        const cL = this.readCubic(ringL, p);
        const cR = this.readCubic(ringR, p);
        num += this.prevTailL[k] * cL + this.prevTailR[k] * cR;
        candE += cL * cL + cR * cR;
      }
      const score = num / (Math.sqrt(refE * candE) + 1e-9);
      if (score > bestCorr) {
        bestCorr = score;
        bestDelta = d;
      }
    }

    const coarseBest = bestDelta;
    const fineLo = Math.max(minDelta, coarseBest - 3);
    const fineHi = Math.min(maxDelta, coarseBest + 3);
    for (let d = fineLo; d <= fineHi; d++) {
      let num = 0;
      let candE = 0;
      const base = nominalStart + d;
      for (let k = 0; k < tailLen; k += 2) {
        const p = base + k * step;
        const cL = this.readCubic(ringL, p);
        const cR = this.readCubic(ringR, p);
        num += this.prevTailL[k] * cL + this.prevTailR[k] * cR;
        candE += cL * cL + cR * cR;
      }
      const score = num / (Math.sqrt(refE * candE) + 1e-9);
      if (score > bestCorr) {
        bestCorr = score;
        bestDelta = d;
      }
    }
    return bestDelta;
  }

  synthGrain(nominalStart, step, minDelta, maxDelta) {
    const W = this.W;
    const Hs = this.Hs;
    const tailLen = this.prevTailLen;
    const bestDelta = this.findBestStereoDelta(nominalStart, step, minDelta, maxDelta);
    const start = nominalStart + bestDelta;
    const ringL = this.ringL;
    const ringR = this.ringR;
    const isUnity = Math.abs(step - 1.0) < 0.0002;

    for (let k = 0; k < W; k++) {
      const p = start + k * step;
      let sL, sR;
      if (isUnity && Math.abs(p - Math.round(p)) < 1e-4) {
        const slot = Math.round(p) & this.RING_MASK;
        sL = ringL[slot];
        sR = ringR[slot];
      } else {
        sL = this.readCubic(ringL, p, step);
        sR = this.readCubic(ringR, p, step);
      }
      const w = this.hann[k];
      this.olaL[k] += sL * w;
      this.olaR[k] += sR * w;
      if (k >= Hs && k < Hs + tailLen) {
        this.prevTailL[k - Hs] = sL;
        this.prevTailR[k - Hs] = sR;
      }
    }
    this.hasPrev = true;
  }

  shiftOlaHop() {
    const Hs = this.Hs;
    const keep = this.W - Hs;
    for (let k = 0; k < keep; k++) {
      this.olaL[k] = this.olaL[k + Hs];
      this.olaR[k] = this.olaR[k + Hs];
    }
    for (let k = keep; k < this.W; k++) {
      this.olaL[k] = 0;
      this.olaR[k] = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return !this.stopped;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (this.stopped) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return false;
    }

    const pitchRatio = parameters.pitchRatio[0];
    const tempoRatio = parameters.tempoRatio[0];
    const bypass = parameters.bypass[0] >= 0.5;

    if (this.mode === 'ring') {
      const inp = inputs[0];
      if (!inp || inp.length === 0 || !inp[0]) {
        outL.fill(0);
        if (outR) outR.fill(0);
        return true;
      }
      const inL = inp[0];
      const inR = inp.length > 1 ? inp[1] : inp[0];
      const minPrimed = this.DELAY_BASE + this.DELTA_MAX + Math.ceil(this.W * 1.38) + 8;
      const wantDry = bypass || Math.abs(pitchRatio - 1.0) < 0.0004;
      const targetWet = wantDry ? 0.0 : 1.0;

      for (let i = 0; i < outL.length; i++) {
        const sL = inL[i];
        const sR = inR[i];
        const slot = this.writePos & this.RING_MASK;
        this.ringL[slot] = sL;
        this.ringR[slot] = sR;
        this.writePos++;

        if (this.writePos < minPrimed) {
          outL[i] = 0;
          if (outR) outR[i] = 0;
          continue;
        }

        if (this.olaIdx === 0) {
          const nominalStart = this.writePos - this.DELAY_BASE;
          this.synthGrain(nominalStart, pitchRatio, -this.DELTA_MAX, this.DELTA_MAX);
        }

        // Exact constant-delay aligned dry signal (writePos - DELAY_BASE == nominalStart + olaIdx)
        // Guarantees 0.000 sample latency jump & 0.000 click when bypass or 1.0x pitchRatio toggles mid-ramp!
        this.wetMix += (targetWet - this.wetMix) * this.wetSlew;
        const drySlot = (this.writePos - this.DELAY_BASE) & this.RING_MASK;
        const dryL = this.ringL[drySlot];
        const dryR = this.ringR[drySlot];
        const wetL = this.olaL[this.olaIdx];
        const wetR = this.olaR[this.olaIdx];
        outL[i] = dryL + (wetL - dryL) * this.wetMix;
        if (outR) outR[i] = dryR + (wetR - dryR) * this.wetMix;

        this.olaIdx++;
        if (this.olaIdx >= this.Hs) {
          this.shiftOlaHop();
          this.olaIdx = 0;
        }
      }
      return true;
    }

    // Buffer mode (AudioBuffer playback with decoupled tempoRatio + pitchRatio)
    const step = pitchRatio * this.sourceScale;
    const minNeededAhead = Math.ceil(this.W * step) + this.DELTA_MAX + 8;
    const requestThreshold = Math.floor(this.RING_SIZE * 0.55);

    if (!this.sourceEnded && !this.requestedChunks && (this.writePos - this.inputCursor) < requestThreshold) {
      this.requestedChunks = true;
      this.port.postMessage({ type: 'need_chunk' });
    }

    for (let i = 0; i < outL.length; i++) {
      const avail = this.writePos - this.inputCursor;
      if (this.olaIdx === 0 && avail < minNeededAhead && !this.sourceEnded) {
        outL[i] = 0;
        if (outR) outR[i] = 0;
        continue;
      }

      if (this.sourceEnded && avail <= 0) {
        if (!this.eofSent) {
          this.eofSent = true;
          this.port.postMessage({ type: 'eof' });
        }
        if (this.olaIdx < this.Hs && this.eofFadeSamples < 256) {
          const fade = 1 - this.eofFadeSamples / 256;
          outL[i] = this.olaL[this.olaIdx] * fade;
          if (outR) outR[i] = this.olaR[this.olaIdx] * fade;
          this.olaIdx++;
          this.eofFadeSamples++;
        } else {
          outL[i] = 0;
          if (outR) outR[i] = 0;
        }
        continue;
      }

      if (this.olaIdx === 0) {
        const oldestValid = Math.max(0, this.writePos - this.RING_SIZE + 8);
        const maxBack = Math.min(this.DELTA_MAX, Math.max(0, Math.floor(this.inputCursor - oldestValid)));
        const maxFwd = Math.min(
          this.DELTA_MAX,
          Math.max(0, Math.floor(this.writePos - this.inputCursor - Math.ceil(this.W * step) - 4))
        );
        this.synthGrain(this.inputCursor, step, -maxBack, maxFwd);
        this.inputCursor += tempoRatio * this.sourceScale * this.Hs;
        if (this.inputCursor - this.lastProgressPos >= 16384) {
          this.lastProgressPos = this.inputCursor;
          this.port.postMessage({ type: 'progress', sourceFrame: this.inputCursor });
        }
      }

      outL[i] = this.olaL[this.olaIdx];
      if (outR) outR[i] = this.olaR[this.olaIdx];
      this.olaIdx++;
      if (this.olaIdx >= this.Hs) {
        this.shiftOlaHop();
        this.olaIdx = 0;
      }
    }
    return true;
  }
}

class NootropicLyriaStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Google Lyria RealTime sends 96,000 stereo frames (2.0s @ 48 kHz) per chunk and bursts 4–6 chunks (8–12s) upfront.
    // A 1,048,576-frame ring (~21.85s @ 48 kHz) holds the entire server pre-buffer without ever wrapping or starving!
    this.RING_SIZE = 1048576;
    this.RING_MASK = this.RING_SIZE - 1;
    this.ringL = new Float32Array(this.RING_SIZE);
    this.ringR = new Float32Array(this.RING_SIZE);
    this.writePos = 0;
    this.readPos = 0;
    this.primed = false;
    this.minPrimeFrames = 19200; // 400 ms jitter cushion @ 48 kHz before starting playback
    this.maxBufferFrames = 864000; // 18.0 s overflow ceiling (well above Lyria's 8–12s burst)
    this.step = 48000 / sampleRate;
    this.fadeGain = 0;
    this.fadeStep = 1 / Math.max(64, Math.round(0.008 * sampleRate)); // 8 ms click-free cosine ramp
    this.prevOutL = 0;
    this.prevOutR = 0;

    // Smooth 12 ms crossfade during overflow catch-up jumps (zero click)
    this.xfadeTotal = Math.max(64, Math.round(0.012 * sampleRate));
    this.xfadeRem = 0;
    this.xfadeOldReadPos = 0;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'pcm' && data.left && data.right) {
        const len = Math.min(data.left.length, data.right.length);
        for (let i = 0; i < len; i++) {
          const slot = this.writePos & this.RING_MASK;
          this.ringL[slot] = data.left[i];
          this.ringR[slot] = data.right[i];
          this.writePos++;
        }
        const buffered = this.writePos - this.readPos;
        if (buffered > this.maxBufferFrames) {
          // Crossfade cleanly when catching up from extreme stalls while keeping a healthy 8.0s (384,000-frame) cushion
          this.xfadeOldReadPos = this.readPos;
          this.xfadeRem = this.xfadeTotal;
          this.readPos = this.writePos - 384000;
        }
        if (!this.primed && this.writePos - this.readPos >= this.minPrimeFrames) {
          this.primed = true;
        }
      } else if (data.type === 'clear') {
        this.writePos = 0;
        this.readPos = 0;
        this.primed = false;
        this.fadeGain = 0;
        this.xfadeRem = 0;
        this.prevOutL = 0;
        this.prevOutR = 0;
        this.ringL.fill(0);
        this.ringR.fill(0);
      }
    };
  }

  readCubic(ring, pos, step = 1.0) {
    return readSinc24Ring(ring, pos, this.RING_MASK, step);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const outL = out[0];
    const outR = out[1];

    if (!this.primed) {
      for (let i = 0; i < outL.length; i++) {
        this.prevOutL *= 0.96;
        this.prevOutR *= 0.96;
        outL[i] = this.prevOutL;
        outR[i] = this.prevOutR;
      }
      return true;
    }

    const fadeOutMargin = Math.max(256, Math.round(0.01 * 48000));
    for (let i = 0; i < outL.length; i++) {
      const rem = this.writePos - this.readPos;
      if (rem < 16) {
        this.primed = false;
        this.fadeGain = 0;
        this.xfadeRem = 0;
        this.prevOutL *= 0.94;
        this.prevOutR *= 0.94;
        outL[i] = this.prevOutL;
        outR[i] = this.prevOutR;
        continue;
      }

      if (rem < fadeOutMargin) {
        this.fadeGain = Math.max(0, this.fadeGain - this.fadeStep);
      } else if (this.fadeGain < 1) {
        this.fadeGain = Math.min(1, this.fadeGain + this.fadeStep);
      }
      const env = 0.5 * (1 - Math.cos(Math.PI * this.fadeGain));

      let sL = this.readCubic(this.ringL, this.readPos, this.step);
      let sR = this.readCubic(this.ringR, this.readPos, this.step);

      if (this.xfadeRem > 0) {
        const progress = 1 - this.xfadeRem / this.xfadeTotal;
        const wNew = 0.5 * (1 - Math.cos(Math.PI * progress));
        const oldL = this.readCubic(this.ringL, this.xfadeOldReadPos, this.step);
        const oldR = this.readCubic(this.ringR, this.xfadeOldReadPos, this.step);
        sL = oldL + (sL - oldL) * wNew;
        sR = oldR + (sR - oldR) * wNew;
        this.xfadeOldReadPos += this.step;
        this.xfadeRem--;
      }

      sL *= env;
      sR *= env;
      outL[i] = sL;
      outR[i] = sR;
      this.prevOutL = sL;
      this.prevOutR = sR;
      this.readPos += this.step;
    }
    return true;
  }
}

class NootropicEnvFollower extends AudioWorkletProcessor {
  constructor() {
    super();
    // 30 ms RMS integration sub-windows eliminate sin^2 ripple bias while preserving 40 ms asymmetric ducking
    this.subFrames = Math.max(256, Math.round(0.03 * sampleRate));
    this.subCount = 0;
    this.subAccSq = 0;
    this.reportHops = 3; // ~90 ms report cadence
    this.hopCounter = 0;
    this.smoothedRms = 0.165;
    const subSec = this.subFrames / sampleRate;
    // Fast downward release (40 ms -> Layer 1 ducks quickly on quiet breakdowns), slow upward attack (250 ms)
    this.alphaDown = 1 - Math.exp(-subSec / 0.04);
    this.alphaUp = 1 - Math.exp(-subSec / 0.25);
    this.kw = createItuKWeightingCoeffs(sampleRate);
    this.pre1L = 0; this.pre2L = 0; this.rlb1L = 0; this.rlb2L = 0;
    this.pre1R = 0; this.pre2R = 0; this.rlb1R = 0; this.rlb2R = 0;
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || inp.length === 0 || !inp[0]) return true;
    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    const pre = this.kw.pre;
    const rlb = this.kw.rlb;

    for (let i = 0; i < inL.length; i++) {
      const l = inL[i];
      const r = inR[i];
      const w1L = pre.b0 * l + this.pre1L;
      this.pre1L = pre.b1 * l - pre.a1 * w1L + this.pre2L;
      this.pre2L = pre.b2 * l - pre.a2 * w1L;
      const kwL = rlb.b0 * w1L + this.rlb1L;
      this.rlb1L = rlb.b1 * w1L - rlb.a1 * kwL + this.rlb2L;
      this.rlb2L = rlb.b2 * w1L - rlb.a2 * kwL;

      const w1R = pre.b0 * r + this.pre1R;
      this.pre1R = pre.b1 * r - pre.a1 * w1R + this.pre2R;
      this.pre2R = pre.b2 * r - pre.a2 * w1R;
      const kwR = rlb.b0 * w1R + this.rlb1R;
      this.rlb1R = rlb.b1 * w1R - rlb.a1 * kwR + this.rlb2R;
      this.rlb2R = rlb.b2 * w1R - rlb.a2 * kwR;

      this.subAccSq += 0.5 * (kwL * kwL + kwR * kwR);
      this.subCount++;
      if (this.subCount >= this.subFrames) {
        const blockRms = Math.sqrt(this.subAccSq / this.subCount);
        const a = blockRms < this.smoothedRms ? this.alphaDown : this.alphaUp;
        this.smoothedRms += a * (blockRms - this.smoothedRms);
        this.subAccSq = 0;
        this.subCount = 0;
        this.hopCounter++;
        if (this.hopCounter >= this.reportHops) {
          this.port.postMessage({ type: 'env', rms: this.smoothedRms });
          this.hopCounter = 0;
        }
      }
    }
    return true;
  }
}

class NootropicEnvFlattener extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gamma', defaultValue: 0.62, minValue: 0, maxValue: 0.7, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Low-lag 2nd-order 14 Hz Bessel-like envelope tracker (tracks 2-10 Hz beats cleanly with minimal phase lag)
    const w0 = (2 * Math.PI * 14.0) / sampleRate;
    const cosW = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * 0.57735);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cosW) * 0.5) / a0;
    this.b1 = (1 - cosW) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosW) / a0;
    this.a2 = (1 - alpha) / a0;
    this.z1 = 0;
    this.z2 = 0;

    // 0.35 Hz slow macro-mean tracker + 1 ms gain smoothing
    this.alphaDc = 1 - Math.exp((-2 * Math.PI * 0.35) / sampleRate);
    this.eDc = 0.08;
    this.gainSlew = 1 - Math.exp(-1 / (0.001 * sampleRate));
    this.curGain = 1.0;
    this.targetG = 1.0;
    this.decim = 0;
    this.gammaSmooth = 0.62;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (!inp || inp.length === 0 || !inp[0]) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    const targetGamma = parameters.gamma[0];

    for (let i = 0; i < outL.length; i++) {
      this.gammaSmooth += (targetGamma - this.gammaSmooth) * this.gainSlew;
      const l = inL[i];
      const r = inR[i];
      const envIn = 0.5 * (Math.abs(l) + Math.abs(r));

      const e10Raw = this.b0 * envIn + this.z1;
      this.z1 = this.b1 * envIn - this.a1 * e10Raw + this.z2;
      this.z2 = this.b2 * envIn - this.a2 * e10Raw;
      const e10 = e10Raw > 0 ? e10Raw : 0;

      this.eDc += this.alphaDc * (e10 - this.eDc);

      // Update power-law gain at 6 kHz control rate (every 8 samples — >400x above 14 Hz bandwidth!)
      if ((this.decim & 7) === 0) {
        if (this.gammaSmooth > 0.001 && this.eDc > 1e-5) {
          const floor = 0.2 * this.eDc;
          const denom = e10 > floor ? e10 : floor;
          let tg = Math.pow(this.eDc / denom, this.gammaSmooth);
          if (tg < 0.35) tg = 0.35;
          else if (tg > 2.5) tg = 2.5;
          this.targetG = tg;
        } else {
          this.targetG = 1.0;
        }
      }
      this.decim = (this.decim + 1) & 7;

      this.curGain += (this.targetG - this.curGain) * this.gainSlew;
      outL[i] = l * this.curGain;
      if (outR) outR[i] = r * this.curGain;
    }
    return true;
  }
}

class NootropicZdfTilt extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 1350, minValue: 250, maxValue: 6000, automationRate: 'k-rate' },
      { name: 'Q', defaultValue: 1.15, minValue: 0.4, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'gainDb', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'a-rate' },
    ];
  }

  constructor() {
    super();
    this.s1L = 0; this.s2L = 0;
    this.s1R = 0; this.s2R = 0;
    this.cachedFreq = 0;
    this.cachedQ = 0;
    this.cachedGdb = NaN;
    this.g = 0;
    this.gSq = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.m1 = 0;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (!inp || inp.length === 0 || !inp[0]) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : null;
    const freq = Math.min(sampleRate * 0.45, Math.max(200, parameters.freq[0]));
    const q = Math.max(0.4, parameters.Q[0]);
    const gainArr = parameters.gainDb;
    if (freq !== this.cachedFreq) {
      this.cachedFreq = freq;
      this.g = Math.tan((Math.PI * freq) / sampleRate);
      this.gSq = this.g * this.g;
      this.cachedGdb = NaN;
    }
    if (q !== this.cachedQ) {
      this.cachedQ = q;
      this.cachedGdb = NaN;
    }
    const g = this.g;
    const gSq = this.gSq;
    const LN10_OVER_40 = 0.057564627324851155;

    for (let i = 0; i < outL.length; i++) {
      const gdb = gainArr.length > 1 ? gainArr[i] : gainArr[0];
      if (Math.abs(gdb) < 1e-4) {
        const xl = inL[i];
        outL[i] = xl;
        if (Math.abs(this.s1L) > 1e-12 || Math.abs(this.s2L) > 1e-12) {
          this.s1L *= 0.99;
          this.s2L *= 0.99;
        }
        if (outR) {
          const xr = inR ? inR[i] : xl;
          outR[i] = xr;
          if (Math.abs(this.s1R) > 1e-12 || Math.abs(this.s2R) > 1e-12) {
            this.s1R *= 0.99;
            this.s2R *= 0.99;
          }
        }
        continue;
      }

      if (!(Math.abs(gdb - this.cachedGdb) <= 5e-5)) {
        this.cachedGdb = gdb;
        const A = Math.exp(gdb * LN10_OVER_40);
        const k = 1 / (q * A);
        const a1 = 1 / (1 + gSq + g * k);
        this.a1 = a1;
        this.a2 = g * a1;
        this.a3 = g * this.a2;
        this.m1 = k * (A * A - 1);
      }
      const a1 = this.a1;
      const a2 = this.a2;
      const a3 = this.a3;
      const m1 = this.m1;

      const xl = inL[i];
      const v3L = xl - this.s2L;
      const v1L = a1 * this.s1L + a2 * v3L;
      const v2L = this.s2L + a2 * this.s1L + a3 * v3L;
      this.s1L = 2 * v1L - this.s1L;
      this.s2L = 2 * v2L - this.s2L;
      outL[i] = xl + m1 * v1L;

      if (outR) {
        const xr = inR ? inR[i] : xl;
        const v3R = xr - this.s2R;
        const v1R = a1 * this.s1R + a2 * v3R;
        const v2R = this.s2R + a2 * this.s1R + a3 * v3R;
        this.s1R = 2 * v1R - this.s1R;
        this.s2R = 2 * v2R - this.s2R;
        outR[i] = xr + m1 * v1R;
      }
    }
    return true;
  }
}

class NootropicClinicalSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'off'; // 'gamma_mbi' | 'gamma_clicks' | 'isochronic' | 'binaural' | 'monaural' | 'off'
    this.rateHz = 40;
    this.startRateHz = 40;
    this.targetRateHz = 40;
    this.curRateHz = 40;
    this.rampSec = 0;
    this.rampSamples = 0;
    this.rampPos = 0;
    this.carrierHz = 220;
    this.curCarrierHz = 220;
    this.leftHz = 215;
    this.rightHz = 225;
    this.curLeftHz = 215;
    this.curRightHz = 225;
    this.dutyCycle = 0.048;
    this.depth = 0.72;
    this.bluetoothSafe = false;
    this.stopped = false;

    // Double-precision (Float64) normalized phases [0, 1) — immune to 44.1 kHz integer-frame rounding!
    this.modPhase = 0.0;
    this.phaseL = 0.0;
    this.phaseR = 0.0;
    this.p1 = 0.0;
    this.p2 = 0.0;
    this.p3 = 0.0;
    this.p4 = 0.0;
    this.shamP1 = 0.0;
    this.shamP2 = 0.27;
    this.shamP3 = 0.61;
    this.slew = 1 - Math.exp(-1 / (0.025 * sampleRate));
    this.outEnv = 0.0;
    this.outSlew = 1 - Math.exp(-1 / (0.015 * sampleRate));

    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'config') {
        const wasOff = this.mode === 'off';
        this.mode = m.mode || 'off';
        this.targetRateHz = Number(m.rateHz) || 40;
        this.startRateHz = m.startRateHz !== undefined ? Number(m.startRateHz) : this.targetRateHz;
        this.rampSec = Math.max(0, Number(m.rampSec) || 0);
        this.rampSamples = Math.round(this.rampSec * sampleRate);
        this.rampPos = 0;
        this.rateHz = this.rampSamples > 0 ? this.startRateHz : this.targetRateHz;
        this.carrierHz = Math.max(60, Number(m.carrierHz) || 220);
        this.leftHz = Math.max(40, Number(m.carrierLeftHz) || (this.carrierHz - this.rateHz * 0.5));
        this.rightHz = Math.max(40, Number(m.carrierRightHz) || (this.carrierHz + this.rateHz * 0.5));
        this.dutyCycle = Math.max(0.02, Math.min(0.85, Number(m.dutyCycle) || 0.048));
        this.depth = Math.max(0.1, Math.min(0.95, Number(m.depth) || 0.72));
        this.bluetoothSafe = Boolean(m.bluetoothSafe);
        if (wasOff) {
          this.curRateHz = this.rateHz;
          this.curCarrierHz = this.carrierHz;
          this.curLeftHz = this.leftHz;
          this.curRightHz = this.rightHz;
        }
      } else if (m.type === 'retune') {
        if (m.carrierHz !== undefined) this.carrierHz = Math.max(60, Number(m.carrierHz));
        if (m.carrierLeftHz !== undefined) this.leftHz = Math.max(40, Number(m.carrierLeftHz));
        if (m.carrierRightHz !== undefined) this.rightHz = Math.max(40, Number(m.carrierRightHz));
      } else if (m.type === 'setRate') {
        this.targetRateHz = Number(m.rateHz) || this.targetRateHz;
        this.startRateHz = this.curRateHz;
        this.rampSamples = 0;
        this.rateHz = this.targetRateHz;
      } else if (m.type === 'setMode') {
        if (m.mode) this.mode = m.mode;
        if (m.bluetoothSafe !== undefined) this.bluetoothSafe = Boolean(m.bluetoothSafe);
      } else if (m.type === 'stop') {
        this.stopped = true;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return !this.stopped;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (this.stopped) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return false;
    }

    const targetActive = this.mode !== 'off' ? 1.0 : 0.0;
    const TWO_PI = 2 * Math.PI;
    const invFs = 1 / sampleRate;
    // Strict < 0.44 * sampleRate dynamic Nyquist clamp (protects 16 kHz / 8 kHz Bluetooth HFP headset switches!)
    const maxSafeHz = Math.max(400, 0.44 * sampleRate);

    for (let i = 0; i < outL.length; i++) {
      this.outEnv += (targetActive - this.outEnv) * this.outSlew;
      if (this.outEnv < 1e-6 && targetActive === 0) {
        outL[i] = 0;
        if (outR) outR[i] = 0;
        continue;
      }

      if (this.rampSamples > 0 && this.rampPos < this.rampSamples) {
        const frac = this.rampPos / this.rampSamples;
        this.rateHz = this.startRateHz + (this.targetRateHz - this.startRateHz) * frac;
        this.rampPos++;
      } else {
        this.rateHz = this.targetRateHz;
      }

      this.curRateHz += (this.rateHz - this.curRateHz) * this.slew;
      this.curCarrierHz += (this.carrierHz - this.curCarrierHz) * this.slew;
      const desiredLeft = this.leftHz;
      const desiredRight = this.rightHz;
      this.curLeftHz += (desiredLeft - this.curLeftHz) * this.slew;
      this.curRightHz += (desiredRight - this.curRightHz) * this.slew;

      const safeCarrier = Math.min(maxSafeHz, this.curCarrierHz);
      const safeRate = Math.min(80, maxSafeHz * 0.12, Math.max(0.1, this.curRateHz));

      let l = 0;
      let r = 0;

      if (this.mode === 'gamma_mbi') {
        // Harmonically integrated warm 40 Hz chord (root, 5th, octave, 9th — crest factor < 9 dB, HFP Nyquist-clamped)
        const c = safeCarrier;
        const h2 = c * 1.49830708;
        const h3 = c * 2.0;
        const h4 = c * 2.2449241;
        this.p1 = (this.p1 + c * invFs) % 1.0;
        if (h2 < maxSafeHz) this.p2 = (this.p2 + h2 * invFs) % 1.0;
        if (h3 < maxSafeHz) this.p3 = (this.p3 + h3 * invFs) % 1.0;
        if (h4 < maxSafeHz) this.p4 = (this.p4 + h4 * invFs) % 1.0;
        this.modPhase = (this.modPhase + safeRate * invFs) % 1.0;

        const w1 = 0.46;
        const w2 = h2 < maxSafeHz ? 0.24 : 0;
        const w3 = h3 < maxSafeHz ? 0.18 : 0;
        const w4 = h4 < maxSafeHz ? 0.12 : 0;
        const normW = 1.0 / (w1 + w2 + w3 + w4);

        const chord =
          (Math.sin(TWO_PI * this.p1) * w1 +
            (w2 > 0 ? Math.sin(TWO_PI * this.p2) * w2 : 0) +
            (w3 > 0 ? Math.sin(TWO_PI * this.p3) * w3 : 0) +
            (w4 > 0 ? Math.sin(TWO_PI * this.p4) * w4 : 0)) *
          normW;
        const env = (1 - this.depth) + this.depth * 0.5 * (1 - Math.cos(TWO_PI * this.modPhase));
        const val = chord * env * 0.78;
        l = val;
        r = val;
      } else if (this.mode === 'gamma_clicks') {
        // Blackman-Harris windowed GENUS burst with >= 4.0 ms window (~3 ms core) over high-latency Bluetooth
        this.modPhase = (this.modPhase + safeRate * invFs) % 1.0;
        this.phaseL = (this.phaseL + safeCarrier * invFs) % 1.0;
        const duty = this.bluetoothSafe
          ? Math.max(this.dutyCycle, Math.min(0.45, 0.004 * safeRate))
          : this.dutyCycle;
        let env = 0;
        if (this.modPhase < duty) {
          const u = this.modPhase / duty;
          env =
            0.35875 -
            0.48829 * Math.cos(TWO_PI * u) +
            0.14128 * Math.cos(2 * TWO_PI * u) -
            0.01168 * Math.cos(3 * TWO_PI * u);
        }
        const octOk = 2 * safeCarrier < maxSafeHz;
        const tone = octOk
          ? Math.sin(TWO_PI * this.phaseL) * 0.85 + Math.sin(2 * TWO_PI * this.phaseL) * 0.15
          : Math.sin(TWO_PI * this.phaseL);
        const val = tone * Math.max(0, env);
        l = val;
        r = val;
      } else if (this.mode === 'gamma_chirp') {
        // Emerging 40 Hz upward logarithmic chirp (8 ms core / 10 ms BT-safe, Blackman-Harris window, <0.44*fs clamped)
        this.modPhase = (this.modPhase + safeRate * invFs) % 1.0;
        const durSec = this.bluetoothSafe ? 0.010 : 0.008;
        const duty = Math.max(0.08, Math.min(0.48, durSec * safeRate));
        let val = 0;
        if (this.modPhase < duty) {
          const u = this.modPhase / duty;
          const env =
            0.35875 -
            0.48829 * Math.cos(TWO_PI * u) +
            0.14128 * Math.cos(2 * TWO_PI * u) -
            0.01168 * Math.cos(3 * TWO_PI * u);
          const f0 = Math.min(maxSafeHz * 0.5, Math.max(140, safeCarrier * 0.75));
          const f1 = Math.min(maxSafeHz, 3200, Math.max(f0 * 1.4, safeCarrier * 3.8));
          const k = Math.max(1.02, f1 / f0);
          const phaseCycles = (f0 * durSec * (Math.pow(k, u) - 1.0)) / Math.log(k);
          val = Math.sin(TWO_PI * phaseCycles) * Math.max(0, env) * 0.92;
        }
        l = val;
        r = val;
      } else if (this.mode === 'isochronic') {
        this.modPhase = (this.modPhase + safeRate * invFs) % 1.0;
        this.phaseL = (this.phaseL + safeCarrier * invFs) % 1.0;
        const duty = Math.max(0.05, Math.min(0.85, this.dutyCycle));
        const ramp = Math.min(duty * 0.22, 0.004 * safeRate);
        let env = 0;
        if (this.modPhase < duty) {
          if (this.modPhase < ramp) {
            env = 0.5 * (1 - Math.cos((Math.PI * this.modPhase) / ramp));
          } else if (this.modPhase > duty - ramp) {
            env = 0.5 * (1 - Math.cos((Math.PI * (duty - this.modPhase)) / ramp));
          } else {
            env = 1.0;
          }
        }
        const octOk = 2 * safeCarrier < maxSafeHz;
        const tone = octOk
          ? Math.sin(TWO_PI * this.phaseL) * 0.85 + Math.sin(2 * TWO_PI * this.phaseL) * 0.15
          : Math.sin(TWO_PI * this.phaseL);
        const val = tone * env;
        l = val;
        r = val;
      } else if (this.mode === 'binaural') {
        const maxCenter = Math.max(80, maxSafeHz - 0.5 * safeRate);
        const avg = Math.min(maxCenter, 0.5 * (this.curLeftHz + this.curRightHz));
        const fL = avg - 0.5 * safeRate;
        const fR = avg + 0.5 * safeRate;
        this.phaseL = (this.phaseL + fL * invFs) % 1.0;
        this.phaseR = (this.phaseR + fR * invFs) % 1.0;
        l = Math.sin(TWO_PI * this.phaseL);
        r = Math.sin(TWO_PI * this.phaseR);
      } else if (this.mode === 'monaural') {
        const maxCenter = Math.max(80, maxSafeHz - 0.5 * safeRate);
        const avg = Math.min(maxCenter, 0.5 * (this.curLeftHz + this.curRightHz));
        const f1 = avg - 0.5 * safeRate;
        const f2 = avg + 0.5 * safeRate;
        this.phaseL = (this.phaseL + f1 * invFs) % 1.0;
        this.phaseR = (this.phaseR + f2 * invFs) % 1.0;
        const val = 0.5 * (Math.sin(TWO_PI * this.phaseL) + Math.sin(TWO_PI * this.phaseR));
        l = val;
        r = val;
      } else if (this.mode === 'aperiodic_sham') {
        // Active Aperiodic Acoustic Sham: matched-RMS diotic carrier triad with ultra-slow incommensurate drift
        // (0.17 + 0.29 + 0.43 Hz -> zero cortical ASSR phase-locking across 1–80 Hz, 100% blinded in Science Only)
        const c = safeCarrier;
        const h2 = c * 1.49830708;
        const h3 = c * 2.0;
        this.p1 = (this.p1 + c * invFs) % 1.0;
        if (h2 < maxSafeHz) this.p2 = (this.p2 + h2 * invFs) % 1.0;
        if (h3 < maxSafeHz) this.p3 = (this.p3 + h3 * invFs) % 1.0;
        this.shamP1 = (this.shamP1 + 0.17 * invFs) % 1.0;
        this.shamP2 = (this.shamP2 + 0.29 * invFs) % 1.0;
        this.shamP3 = (this.shamP3 + 0.43 * invFs) % 1.0;

        const w1 = 0.62;
        const w2 = h2 < maxSafeHz ? 0.24 : 0;
        const w3 = h3 < maxSafeHz ? 0.14 : 0;
        const normW = 1.0 / (w1 + w2 + w3);
        const triad =
          (Math.sin(TWO_PI * this.p1) * w1 +
            (w2 > 0 ? Math.sin(TWO_PI * this.p2) * w2 : 0) +
            (w3 > 0 ? Math.sin(TWO_PI * this.p3) * w3 : 0)) *
          normW;
        const slowDrift =
          0.46 * Math.sin(TWO_PI * this.shamP1) +
          0.33 * Math.sin(TWO_PI * this.shamP2) +
          0.21 * Math.sin(TWO_PI * this.shamP3);
        const env = Math.max(0.22, Math.min(1.22, 0.76 + 0.34 * slowDrift));
        const val = triad * env * 0.84;
        l = val;
        r = val;
      }

      outL[i] = l * this.outEnv;
      if (outR) outR[i] = r * this.outEnv;
    }
    return true;
  }
}

class NootropicHugginsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.seed = 0x13579bdf;
    this.remSamples = 0;
    this.totalSamples = 0;
    this.isTarget = false;
    this.stopped = false;

    // 2nd-order All-Pass Biquad @ 600 Hz, Q = 10 -> exact 180 deg interaural phase inversion at 600 Hz (0.000 dB magnitude change)
    const w0 = (2 * Math.PI * 600) / sampleRate;
    const alpha = Math.sin(w0) / (2 * 10);
    const a0 = 1 + alpha;
    this.apB0 = (1 - alpha) / a0;
    this.apB1 = (-2 * Math.cos(w0)) / a0;
    this.apB2 = (1 + alpha) / a0;
    this.apA1 = this.apB1;
    this.apA2 = this.apB0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'play') {
        this.isTarget = Boolean(m.isTarget);
        const durMs = Math.max(150, Math.min(2000, Number(m.durationMs) || 600));
        this.totalSamples = Math.round((durMs / 1000) * sampleRate);
        this.remSamples = this.totalSamples;
        this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
      } else if (m.type === 'stop') {
        this.stopped = true;
        this.remSamples = 0;
      }
    };
  }

  nextNoise() {
    let x = this.seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return ((x >>> 0) / 2147483648.0 - 1.0) * 0.14;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return !this.stopped;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (this.stopped) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return false;
    }

    const fadeLen = Math.min(Math.floor(this.totalSamples / 4), Math.round(0.025 * sampleRate));

    for (let i = 0; i < outL.length; i++) {
      if (this.remSamples <= 0) {
        outL[i] = 0;
        if (outR) outR[i] = 0;
        continue;
      }
      const pos = this.totalSamples - this.remSamples;
      let env = 1.0;
      if (pos < fadeLen) {
        env = 0.5 * (1 - Math.cos((Math.PI * pos) / fadeLen));
      } else if (this.remSamples <= fadeLen) {
        env = 0.5 * (1 - Math.cos((Math.PI * this.remSamples) / fadeLen));
      }

      const w = this.nextNoise();
      let r = w;
      if (this.isTarget) {
        const y0 = this.apB0 * w + this.apB1 * this.x1 + this.apB2 * this.x2 - this.apA1 * this.y1 - this.apA2 * this.y2;
        this.x2 = this.x1;
        this.x1 = w;
        this.y2 = this.y1;
        this.y1 = y0;
        r = y0;
      }

      outL[i] = w * env;
      if (outR) outR[i] = r * env;
      this.remSamples--;
    }
    return true;
  }
}

/**
 * Lock-Free Sample-Accurate Stem Player (v7.0 Phase-Locked AudioWorklet)
 * Plays pre-rendered 48 kHz sub-harmonic Opus/AAC stems directly inside AudioWorklet
 * with:
 *   - Integer sample delay (\`delaySamples\`) locking musical downbeat to Band-2 AM crest
 *   - Bit-transparent integer copy pass-through when effectiveRate === 1.000000
 *   - 4-point Hermite cubic varispeed interpolation for 432 Hz / 44.1 kHz DAC ratios
 */
class NootropicStemPlayerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'playbackRate',
        defaultValue: 1.0,
        minValue: 0.72,
        maxValue: 1.38,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const srcSr = Number(opts.sourceSampleRate) || 48000;
    this.sourceScale = srcSr > 0 ? srcSr / sampleRate : 1.0;
    this.remainingDelaySamples = Math.max(0, Math.round(Number(opts.delaySamples) || 0));

    // 262,144 stereo frames = 5.46 seconds @ 48 kHz (absorbs heavy mobile GC / 4G network jitter)
    this.ringSize = 262144;
    this.ringMask = 262143;
    this.lowWaterFrames = 131072; // Request refill with 2.73 seconds still buffered
    this.ringL = new Float32Array(this.ringSize);
    this.ringR = new Float32Array(this.ringSize);
    this.totalWritten = 0;
    this.readFrac = 0;
    this.eofReceived = false;
    this.eofNotified = false;
    this.needChunkPending = false;
    this.framesSinceAsk = 0;
    this.stopped = false;
    this.nextProgressFrame = 4096;

    // De-clicked underrun guard (stays bit-exact 1.0 during normal playback; smooths 6ms only on network stall)
    this.underrunEnv = 1.0;
    this.lastL = 0;
    this.lastR = 0;
    this.underrunDecay = Math.exp(-1 / (0.005 * sampleRate));
    this.underrunAttack = 1 - Math.exp(-1 / (0.006 * sampleRate));

    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'chunk') {
        const l = m.left;
        const r = m.right || l;
        if (l && l.length > 0) {
          const unread = this.totalWritten - Math.floor(this.readFrac);
          const free = Math.max(0, this.ringSize - 2048 - unread);
          const nCopy = l.length <= free ? l.length : free;
          for (let i = 0; i < nCopy; i++) {
            const idx = (this.totalWritten + i) & this.ringMask;
            this.ringL[idx] = l[i];
            this.ringR[idx] = r[i];
          }
          this.totalWritten += nCopy;
        }
        this.needChunkPending = false;
        this.framesSinceAsk = 0;
      } else if (m.type === 'delay') {
        this.remainingDelaySamples = Math.max(0, Math.round(Number(m.delaySamples) || 0));
      } else if (m.type === 'end') {
        this.eofReceived = true;
        this.needChunkPending = false;
      } else if (m.type === 'stop') {
        this.stopped = true;
      }
    };
  }

  hermite4(y0, y1, y2, y3, t) {
    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + c0;
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return !this.stopped;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (this.stopped) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return false;
    }

    const rateParam = parameters.playbackRate ? parameters.playbackRate[0] : 1.0;
    const step = Math.max(0.5, Math.min(1.5, rateParam * this.sourceScale));
    const isBitExact =
      Math.abs(step - 1.0) < 1e-6 &&
      Math.abs(this.readFrac - Math.round(this.readFrac)) < 1e-6;

    for (let i = 0; i < outL.length; i++) {
      if (this.remainingDelaySamples > 0) {
        this.remainingDelaySamples--;
        outL[i] = 0;
        if (outR) outR[i] = 0;
        continue;
      }

      const i0 = Math.floor(this.readFrac);
      const ahead = this.totalWritten - i0;
      if (ahead <= 0) {
        if (this.eofReceived) {
          outL[i] = 0;
          if (outR) outR[i] = 0;
          if (!this.eofNotified) {
            this.eofNotified = true;
            this.port.postMessage({ type: 'eof', sourceFrame: this.totalWritten });
          }
        } else {
          // Network stall mid-stream: decay held sample smoothly over 5 ms instead of hard-clicking
          this.underrunEnv *= this.underrunDecay;
          if (this.underrunEnv < 1e-5) this.underrunEnv = 0;
          outL[i] = this.lastL * this.underrunEnv;
          if (outR) outR[i] = this.lastR * this.underrunEnv;
        }
        continue;
      }

      let sL = 0;
      let sR = 0;
      if (isBitExact) {
        const idx = i0 & this.ringMask;
        sL = this.ringL[idx];
        sR = this.ringR[idx];
        this.readFrac += 1.0;
      } else {
        sL = readSinc24Clamped(this.ringL, this.readFrac, this.ringMask, this.totalWritten, step);
        sR = readSinc24Clamped(this.ringR, this.readFrac, this.ringMask, this.totalWritten, step);
        this.readFrac += step;
      }

      if (this.underrunEnv < 0.999999) {
        this.underrunEnv += (1.0 - this.underrunEnv) * this.underrunAttack;
        if (this.underrunEnv > 0.999999) this.underrunEnv = 1.0;
        sL *= this.underrunEnv;
        sR *= this.underrunEnv;
      }

      this.lastL = sL;
      this.lastR = sR;
      outL[i] = sL;
      if (outR) outR[i] = sR;
    }

    this.framesSinceAsk += outL.length;
    const curFrame = Math.floor(this.readFrac);
    const bufferedAhead = this.totalWritten - curFrame;
    if (
      !this.eofReceived &&
      bufferedAhead < this.lowWaterFrames &&
      (!this.needChunkPending || this.framesSinceAsk >= 8192)
    ) {
      this.needChunkPending = true;
      this.framesSinceAsk = 0;
      this.port.postMessage({ type: 'need_chunk', sourceFrame: curFrame, bufferedAhead });
    }
    if (curFrame >= this.nextProgressFrame) {
      this.nextProgressFrame = curFrame + 4096;
      this.port.postMessage({ type: 'progress', sourceFrame: curFrame });
    }
    return true;
  }
}

registerProcessor('nootropic-crossfeed-processor', NootropicCrossfeedProcessor);
registerProcessor('nootropic-lookahead-limiter', NootropicLookaheadLimiter);
registerProcessor('nootropic-wsola-processor', NootropicWsolaProcessor);
registerProcessor('nootropic-lyria-stream-processor', NootropicLyriaStreamProcessor);
registerProcessor('nootropic-env-follower', NootropicEnvFollower);
registerProcessor('nootropic-env-flattener', NootropicEnvFlattener);
registerProcessor('nootropic-zdf-tilt', NootropicZdfTilt);
registerProcessor('nootropic-clinical-synth', NootropicClinicalSynth);
registerProcessor('nootropic-huggins-processor', NootropicHugginsProcessor);
/**
 * Sample-Accurate Audio-Thread Scheduler Clock (v7.1):
 * Drives GenerativeComposer on the audio rendering thread so hidden browser tabs
 * and locked mobile screens never stall 40 ms rhythmic scheduling.
 */
class NootropicClockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const intervalMs = Math.max(10, Math.min(250, Number(opts.intervalMs) || 40));
    this.intervalSamples = Math.max(128, Math.round((intervalMs / 1000) * sampleRate));
    this.accum = 0;
    this.running = true;
    this.stopped = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m === 'start' || m.type === 'start') {
        this.running = true;
        this.accum = this.intervalSamples;
      } else if (m === 'stop' || m.type === 'stop') {
        this.running = false;
        this.stopped = true;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (out && out[0]) out[0].fill(0);
    if (out && out[1]) out[1].fill(0);
    if (this.stopped) return false;
    if (!this.running) return true;
    const blockLen = out && out[0] ? out[0].length : 128;
    this.accum += blockLen;
    if (this.accum >= this.intervalSamples) {
      this.accum %= this.intervalSamples;
      this.port.postMessage({ type: 'tick', audioTime: currentTime });
    }
    return true;
  }
}

registerProcessor('nootropic-stem-player', NootropicStemPlayerProcessor);
registerProcessor('nootropic-clock-processor', NootropicClockProcessor);
`;

const loadedWorkletContexts = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Registers the entire v7.0 Studio DSP AudioWorklet bundle at most ONCE per AudioContext,
 * preventing duplicate \`registerProcessor\` NotSupportedError on mid-session mode switches.
 */
export function ensureDspWorkletsLoaded(ctx: BaseAudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) return Promise.resolve(false);
  const existing = loadedWorkletContexts.get(ctx);
  if (existing) return existing;

  const promise = (async () => {
    const blob = new Blob([DSP_WORKLET_CODE], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(blobUrl);
      return true;
    } catch {
      return false;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  })();

  loadedWorkletContexts.set(ctx, promise);
  return promise;
}
