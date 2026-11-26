import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BUTTERWORTH_LP_HP_Q_DB,
  LIMITER_CEILING_DBFS,
  LIMITER_CEILING_LINEAR,
  NOISE_CALIBRATED_RMS,
  calibrateFilteredStereoNoiseRms,
  computeExactAmGainPair,
  computeItuKWeightingCoeffs,
  computeParabolicPeakHz,
  computePeriodicWaveStats,
  createSilentKeepAliveWavBytes,
  estimateAgePriorIafHz,
  normalizeStereoBufferRms,
} from '../src/audio/dspMath.ts';
import { DSP_WORKLET_CODE } from '../src/audio/dspWorklets.ts';
import ts from 'typescript';

function applyTestBiquad(input, sampleRate, type, cutoffHz, qDb = BUTTERWORTH_LP_HP_Q_DB) {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const qLin = Math.pow(10, qDb / 20);
  const alpha = sinW0 / (2 * qLin);
  const a0 = 1 + alpha;
  let b0;
  let b1;
  let b2;
  if (type === 'lowpass') {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
  } else {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
  }
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadWorkletProcessors(sampleRate = 48000) {
  const registry = new Map();
  class MockAudioWorkletProcessor {
    constructor() {
      const listeners = [];
      const selfPort = {
        postMessage: (msg) => {
          for (const fn of listeners) fn({ data: msg });
        },
        set onmessage(fn) {
          this._on = fn;
        },
        get onmessage() {
          return this._on;
        },
      };
      this.port = {
        _outbox: [],
        postMessage: (msg) => {
          this.port._outbox.push(msg);
        },
        onmessage: null,
        _deliver: (msg) => {
          if (typeof this.port.onmessage === 'function') {
            this.port.onmessage({ data: msg });
          }
        },
      };
      void listeners;
      void selfPort;
    }
  }
  const sandbox = {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    registerProcessor: (name, Ctor) => registry.set(name, Ctor),
    sampleRate,
    Math,
    Float32Array,
    Float64Array,
    Int32Array,
    Uint8Array,
    Array,
    Number,
    Boolean,
    Infinity,
  };
  vm.runInNewContext(DSP_WORKLET_CODE, sandbox);
  return registry;
}

function goertzelMag(samples, sampleRate, freqHz) {
  const n = samples.length;
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    const q0 = coeff * q1 - q2 + samples[i] * w;
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * Math.cos(omega);
  const imag = q2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag) / (n * 0.25);
}

function measureFinePeakHz(samples, sampleRate, minHz, maxHz, stepHz = 0.25) {
  let bestHz = minHz;
  let bestMag = -1;
  for (let f = minHz; f <= maxHz; f += stepHz) {
    const m = goertzelMag(samples, sampleRate, f);
    if (m > bestMag) {
      bestMag = m;
      bestHz = f;
    }
  }
  let fineHz = bestHz;
  let fineMag = bestMag;
  for (let f = bestHz - stepHz; f <= bestHz + stepHz; f += 0.02) {
    const m = goertzelMag(samples, sampleRate, f);
    if (m > fineMag) {
      fineMag = m;
      fineHz = f;
    }
  }
  return { hz: fineHz, mag: fineMag };
}

function db(val) {
  return 20 * Math.log10(Math.max(1e-12, val));
}

function findEdgeExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

test('1. dspMath primitives: LR4 Q_dB, limiter ceiling, exact AM wave compensation, parabolic FFT peak, silent WAV', () => {
  // Butterworth Q in dB for Web Audio lowpass/highpass
  const linearQ = Math.pow(10, BUTTERWORTH_LP_HP_Q_DB / 20);
  assert.ok(Math.abs(linearQ - Math.SQRT1_2) < 1e-12, `Expected SQRT1_2 linear Q, got ${linearQ}`);

  // Brickwall ceiling -1.00 dBTP
  assert.ok(Math.abs(db(LIMITER_CEILING_LINEAR) - LIMITER_CEILING_DBFS) < 1e-9);
  assert.equal(estimateAgePriorIafHz('18_29'), 10.5);
  assert.equal(estimateAgePriorIafHz('60_plus'), 9.0);
  assert.equal(estimateAgePriorIafHz(null), 10.0);
  const kw48 = computeItuKWeightingCoeffs(48000);
  const kw44 = computeItuKWeightingCoeffs(44100);
  assert.ok(Math.abs(kw48.pre.b0 - 1.53512485958697) < 1e-6);
  assert.ok(Number.isFinite(kw44.pre.b0) && Math.abs(kw44.rlb.b1 + 2 * kw44.rlb.b0) < 1e-9);

  // Asymmetric 3-harmonic cortical salience wave AM normalization
  const amps = [1.0, 0.24, 0.07];
  const shifts = [0, -Math.PI / 4, -Math.PI / 2];
  const stats = computePeriodicWaveStats(amps, shifts, 2048);
  assert.ok(Math.abs(Math.max(Math.abs(stats.min), Math.abs(stats.max)) - 1.0) < 1e-3);
  assert.ok(stats.min > -0.75 && stats.max > 0.99, `Unexpected salience bounds min=${stats.min} max=${stats.max}`);

  for (const depth of [0.18, 0.32, 0.48, 0.72]) {
    const { bias, swing, vcaDepth } = computeExactAmGainPair(depth, stats.min, stats.max, stats.rms);
    const peakGain = bias + swing * stats.max;
    const troughGain = bias + swing * stats.min;
    const achievedDepth = 1 - troughGain / peakGain;
    assert.ok(troughGain > 0.25, `Gain dipped unsafe low at depth=${depth}: ${troughGain}`);
    assert.ok(peakGain <= 1.25, `Makeup peak exceeded limit: ${peakGain}`);
    assert.ok(
      Math.abs(achievedDepth - vcaDepth) < 1e-3,
      `AM modulation depth error at depth=${depth}: expected ${vcaDepth}, got ${achievedDepth}`
    );
  }

  // Parabolic FFT peak accuracy (< 0.5 Hz at 23.4375 Hz/bin!)
  const sr = 48000;
  const fftSize = 2048;
  for (const targetHz of [40.0, 220.0, 432.0, 997.4]) {
    const signal = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
      signal[i] = hann * Math.sin((2 * Math.PI * targetHz * i) / sr);
    }
    const bins = fftSize / 2;
    const fftDb = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < fftSize; i++) {
        const ang = (2 * Math.PI * b * i) / fftSize;
        re += signal[i] * Math.cos(ang);
        im -= signal[i] * Math.sin(ang);
      }
      fftDb[b] = db(Math.sqrt(re * re + im * im) / (fftSize * 0.25));
    }
    const peak = computeParabolicPeakHz(fftDb, sr, fftSize, 35, 4000, -72);
    assert.ok(peak !== null && Math.abs(peak - targetHz) < 0.5, `Target ${targetHz} Hz measured ${peak} Hz`);
  }

  // Silent keepalive WAV: sample-rate parity, zero DC, -90.3 dBFS, <=1 LSB transitions
  for (const wavRate of [44100, 48000, 96000]) {
    const wav = createSilentKeepAliveWavBytes(wavRate);
    const dv = new DataView(wav.buffer);
    assert.equal(dv.getUint32(24, true), wavRate);
    assert.equal(wav.byteLength, 44 + wavRate * 4);
    let dcSum = 0;
    let maxAbs = 0;
    let maxDelta = 0;
    let prevSample = dv.getInt16(44 + (wavRate - 1) * 4, true);
    for (let i = 0; i < wavRate; i++) {
      const l = dv.getInt16(44 + i * 4, true);
      const r = dv.getInt16(44 + i * 4 + 2, true);
      assert.equal(l, r);
      dcSum += l;
      if (Math.abs(l) > maxAbs) maxAbs = Math.abs(l);
      maxDelta = Math.max(maxDelta, Math.abs(l - prevSample));
      prevSample = l;
    }
    assert.equal(dcSum, 0, 'Keepalive WAV must have exact zero DC offset');
    assert.equal(maxAbs, 1, 'Keepalive WAV must stay at +-1 LSB (-90.3 dBFS)');
    assert.ok(maxDelta <= 1, `Keepalive WAV stepped ${maxDelta} LSB across adjacent frames`);
  }

  // Direct normalizeStereoBufferRms edge-case verification
  const rawL = new Float32Array(1024);
  const rawR = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    rawL[i] = 0.02 * Math.sin((2 * Math.PI * 100 * i) / 48000);
    rawR[i] = 0.01 * Math.cos((2 * Math.PI * 100 * i) / 48000);
  }
  normalizeStereoBufferRms(rawL, rawR, NOISE_CALIBRATED_RMS);
  let normSq = 0;
  for (let i = 0; i < 1024; i++) normSq += rawL[i] * rawL[i] + rawR[i] * rawR[i];
  const measuredNormRms = Math.sqrt(normSq / 2048);
  assert.ok(Math.abs(measuredNormRms - NOISE_CALIBRATED_RMS) < 1e-3);

  // Post-filter RMS calibration across broadband harmonics + HP(120 Hz) -> LP(4200 Hz)
  const filtSr = 48000;
  const filtLen = filtSr * 2;
  const filtL = new Float32Array(filtLen);
  const filtR = new Float32Array(filtLen);
  for (let i = 0; i < filtLen; i++) {
    const t = i / filtSr;
    filtL[i] =
      0.7 * Math.sin(2 * Math.PI * 65 * t) +
      0.5 * Math.sin(2 * Math.PI * 440 * t) +
      0.4 * Math.sin(2 * Math.PI * 1800 * t) +
      0.6 * Math.sin(2 * Math.PI * 9500 * t);
    filtR[i] =
      0.6 * Math.cos(2 * Math.PI * 80 * t) +
      0.5 * Math.cos(2 * Math.PI * 620 * t) +
      0.4 * Math.cos(2 * Math.PI * 2400 * t) +
      0.7 * Math.cos(2 * Math.PI * 11000 * t);
  }
  calibrateFilteredStereoNoiseRms(filtL, filtR, filtSr, 120, 4200, NOISE_CALIBRATED_RMS, BUTTERWORTH_LP_HP_Q_DB);
  const postL = applyTestBiquad(applyTestBiquad(filtL, filtSr, 'highpass', 120), filtSr, 'lowpass', 4200);
  const postR = applyTestBiquad(applyTestBiquad(filtR, filtSr, 'highpass', 120), filtSr, 'lowpass', 4200);
  let postSq = 0;
  const skipTransient = 4800;
  for (let i = skipTransient; i < filtLen; i++) {
    postSq += postL[i] * postL[i] + postR[i] * postR[i];
  }
  const postRms = Math.sqrt(postSq / (2 * (filtLen - skipTransient)));
  const postErrDb = Math.abs(20 * Math.log10(postRms / NOISE_CALIBRATED_RMS));
  assert.ok(postErrDb < 0.15, `Post-filter RMS calibrated error ${postErrDb.toFixed(4)} dB exceeded 0.15 dB`);
});

test('2. Real Noise & Periodic Pulse calibration: RMS parity across noise colors & exact zero-seam loops', async () => {
  const { transform } = await import('esbuild');
  const rackSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src/audio/MedicalStimulusRack.ts'), 'utf8');
  const mathSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src/audio/dspMath.ts'), 'utf8');
  const compiledMath = await transform(mathSrc, { loader: 'ts', format: 'cjs' });
  const compiledRack = await transform(rackSrc, { loader: 'ts', format: 'cjs' });

  const mathMod = { exports: {} };
  vm.runInNewContext(compiledMath.code, {
    exports: mathMod.exports,
    module: mathMod,
    Float32Array,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Math,
    Number,
  });

  const rackMod = { exports: {} };
  const rackRequire = (id) => {
    if (id === './dspMath') return mathMod.exports;
    if (id === '../../shared/studySpec') {
      return {
        computeHarmonicCarrierHz: () => 220,
        snrDbToLinearGain: () => 0.1,
      };
    }
    return {};
  };
  vm.runInNewContext(compiledRack.code, {
    exports: rackMod.exports,
    module: rackMod,
    require: rackRequire,
    Float32Array,
    Uint8Array,
    Math,
    Number,
  });
  const rackExports = rackMod.exports;

  const fakeCtx = {
    sampleRate: 48000,
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (c) => data[c],
      };
    },
  };

  for (const color of ['white', 'pink', 'brown', 'soft_rain']) {
    const buf = rackExports.createCalibratedNoiseBuffer(fakeCtx, color, 6);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      sumSq += l[i] * l[i] + r[i] * r[i];
    }
    const rms = Math.sqrt(sumSq / (2 * buf.length));
    const diffDb = Math.abs(db(rms) - db(NOISE_CALIBRATED_RMS));
    assert.ok(diffDb < 0.15, `Noise ${color} RMS ${rms.toFixed(4)} deviated ${diffDb.toFixed(3)} dB from ${NOISE_CALIBRATED_RMS}`);

    // Verify no RMS energy dip at loop head seam (first 4096 frames vs body, avoiding LF 1/f 21ms bias)
    let headSq = 0;
    const headLen = Math.min(4096, buf.length);
    for (let i = 0; i < headLen; i++) headSq += l[i] * l[i] + r[i] * r[i];
    const headRms = Math.sqrt(headSq / (2 * headLen));
    const bodyRms = rms;
    assert.ok(
      Math.abs(db(headRms) - db(bodyRms)) < 2.0,
      `Noise ${color} seam head RMS dip detected: head=${headRms.toFixed(4)} vs body=${bodyRms.toFixed(4)}`
    );
  }

  // Verify periodic pulse buffer loop seam continuity at fractional Hz (0.75 Hz, 7.83 Hz Schumann, 40 Hz GENUS)
  for (const cfg of [
    { pulseRateHz: 40, carrierHz: 440, dutyCycle: 0.04, mode: 'gamma_click' },
    { pulseRateHz: 7.83, carrierHz: 256, dutyCycle: 0.5, mode: 'isochronic' },
    { pulseRateHz: 0.75, carrierHz: 180, dutyCycle: 0.5, mode: 'isochronic' },
  ]) {
    const pBuf = rackExports.createPeriodicPulseBuffer(fakeCtx, cfg);
    const pL = pBuf.getChannelData(0);
    const seamStep = Math.abs(pL[0] - pL[pL.length - 1]);
    const prevStep = Math.abs(pL[pL.length - 1] - pL[pL.length - 2]);
    assert.ok(
      seamStep <= Math.max(0.02, prevStep * 1.6),
      `Loop seam click detected for ${cfg.pulseRateHz}Hz ${cfg.mode}: seamStep=${seamStep.toFixed(5)} vs prev=${prevStep.toFixed(5)}`
    );
  }

  // Verify post-filter RMS parity across White/Pink/Brown/Soft Rain (<= 0.35 dB spread)
  const bpRmsDb = [];
  for (const color of ['white', 'pink', 'brown', 'soft_rain']) {
    const nBuf = rackExports.createCalibratedNoiseBuffer(fakeCtx, color, 6, { hpHz: 115, lpHz: 4200 });
    const fL = applyTestBiquad(applyTestBiquad(nBuf.getChannelData(0), fakeCtx.sampleRate, 'highpass', 115), fakeCtx.sampleRate, 'lowpass', 4200);
    const fR = applyTestBiquad(applyTestBiquad(nBuf.getChannelData(1), fakeCtx.sampleRate, 'highpass', 115), fakeCtx.sampleRate, 'lowpass', 4200);
    let sq = 0;
    const skip = 9600;
    for (let i = skip; i < fL.length; i++) sq += fL[i] * fL[i] + fR[i] * fR[i];
    const rms = Math.sqrt(sq / (2 * (fL.length - skip)));
    bpRmsDb.push(20 * Math.log10(rms / NOISE_CALIBRATED_RMS));
  }
  const maxBpErr = Math.max(...bpRmsDb.map((v) => Math.abs(v)));
  assert.ok(maxBpErr < 0.35, `Post-filter noise colors deviated up to ${maxBpErr.toFixed(3)} dB: ${bpRmsDb.map((d) => d.toFixed(2)).join(', ')}`);

  // Verify compiled StereoRainBed loop-fold fix (no 0.5s duplicate echo & smooth wrap seam)
  const rainSrcPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/audio/StereoRainBed.ts');
  const rainJs = ts.transpileModule(fs.readFileSync(rainSrcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const rainMod = { exports: {} };
  const dspShim = {
    BUTTERWORTH_LP_HP_Q_DB,
    LIMITER_CEILING_DBFS,
    LIMITER_CEILING_LINEAR,
    NOISE_CALIBRATED_RMS,
    calibrateFilteredStereoNoiseRms,
    computeExactAmGainPair,
    computeParabolicPeakHz,
    computePeriodicWaveStats,
    createSilentKeepAliveWavBytes,
    normalizeStereoBufferRms,
  };
  new Function('module', 'exports', 'require', rainJs)(rainMod, rainMod.exports, (id) => {
    if (id.includes('dspMath')) return dspShim;
    throw new Error(`Unexpected StereoRainBed import: ${id}`);
  });
  let capturedRainBuffer = null;
  const makeParam = (v = 0) => ({
    value: v,
    setValueAtTime(val) { this.value = val; },
    setTargetAtTime(val) { this.value = val; },
    linearRampToValueAtTime(val) { this.value = val; },
    exponentialRampToValueAtTime(val) { this.value = val; },
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
  });
  const makeNode = () => ({
    gain: makeParam(1),
    frequency: makeParam(1000),
    Q: makeParam(0),
    type: 'lowpass',
    loop: false,
    buffer: null,
    connect() { return this; },
    disconnect() {},
    start() {},
    stop() {},
  });
  const rainCtx = {
    sampleRate: 48000,
    currentTime: 0,
    createBuffer(ch, len, sr) {
      const chs = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: (c) => chs[c] };
    },
    createBufferSource() {
      const n = makeNode();
      return new Proxy(n, {
        set(target, prop, val) {
          target[prop] = val;
          if (prop === 'buffer' && val) capturedRainBuffer = val;
          return true;
        },
      });
    },
    createGain: makeNode,
    createBiquadFilter: makeNode,
  };
  const rainBed = new rainMod.exports.StereoRainBed();
  rainBed.attach(rainCtx, makeNode(), false);
  rainBed.setActive(true);
  assert.ok(capturedRainBuffer, 'StereoRainBed did not generate buffer');
  const rL = capturedRainBuffer.getChannelData(0);
  const fadeSamples = Math.floor(0.5 * 48000);
  let maxDupDiff = 0;
  for (let i = 0; i < 2000; i++) {
    maxDupDiff = Math.max(maxDupDiff, Math.abs(rL[i] - rL[rL.length - fadeSamples + i]));
  }
  assert.ok(maxDupDiff > 1e-4, `StereoRainBed duplicated head and tail over 0.5s window: diff=${maxDupDiff}`);
  const rainSeamStep = Math.abs(rL[0] - rL[rL.length - 1]);
  let maxRainStep = 0;
  for (let i = 1; i < rL.length; i++) {
    maxRainStep = Math.max(maxRainStep, Math.abs(rL[i] - rL[i - 1]));
  }
  assert.ok(
    rainSeamStep <= Math.max(0.05, maxRainStep * 0.9),
    `StereoRainBed loop seam click: seamStep=${rainSeamStep.toFixed(4)} vs maxInterior=${maxRainStep.toFixed(4)}`
  );
  rainBed.stop();
});

test('3. AudioWorklet DSP: Lookahead Limiter brickwall 0.000 dB overshoot + 0% THD below ceiling', () => {
  const reg = loadWorkletProcessors(48000);
  const LimiterCtor = reg.get('nootropic-lookahead-limiter');
  assert.ok(LimiterCtor, 'nootropic-lookahead-limiter must be registered');
  const lim = new LimiterCtor();
  const params = { ceiling: new Float32Array([LIMITER_CEILING_LINEAR]) };

  // Sub-ceiling pure 1 kHz sine (0.85 < 0.89125) -> must pass with zero nonlinear distortion!
  const subFrames = 128 * 38; // 4864 frames (~101 ms, exact 128-frame worklet blocks)
  const inL = new Float32Array(subFrames);
  const inR = new Float32Array(subFrames);
  const outL = new Float32Array(subFrames);
  const outR = new Float32Array(subFrames);
  for (let i = 0; i < subFrames; i++) {
    // Raised-cosine 5 ms fade-in avoids illegal non-bandlimited 0 -> 0.85 Dirac step at i=0
    const fadeIn = i < 256 ? 0.5 * (1 - Math.cos((Math.PI * i) / 256)) : 1.0;
    inL[i] = fadeIn * 0.85 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
    inR[i] = fadeIn * 0.85 * Math.cos((2 * Math.PI * 1000 * i) / 48000);
  }
  for (let off = 0; off < subFrames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    lim.process(
      [[inL.subarray(off, off + 128), inR.subarray(off, off + 128)]],
      [[oL, oR]],
      params
    );
    outL.set(oL, off);
    outR.set(oR, off);
  }
  const laLen = lim.laLen; // 240 samples (5.0 ms @ 48 kHz)
  let maxErrSub = 0;
  for (let i = laLen + 256; i < subFrames; i++) {
    maxErrSub = Math.max(
      maxErrSub,
      Math.abs(outL[i] - inL[i - laLen]),
      Math.abs(outR[i] - inR[i - laLen])
    );
  }
  assert.ok(maxErrSub < 1e-6, `Lookahead limiter introduced sub-ceiling distortion: ${maxErrSub}`);

  // Massive +6 dBFS dual-tone transient step -> must NEVER exceed ceiling even by 1e-6!
  const limHot = new LimiterCtor();
  const hotFrames = 128 * 38;
  let maxOut = 0;
  let maxStereoGainDelta = 0;
  for (let off = 0; off < hotFrames; off += 128) {
    const hL = new Float32Array(128);
    const hR = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const idx = off + k;
      hL[k] = idx >= 256 && idx < 2400 ? 2.0 * Math.sin((2 * Math.PI * 1000 * idx) / 48000) : 0.2;
      hR[k] = idx >= 256 && idx < 2400 ? 1.4 * Math.sin((2 * Math.PI * 1000 * idx) / 48000) : 0.14;
    }
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    limHot.process([[hL, hR]], [[oL, oR]], params);
    for (let k = 0; k < 128; k++) {
      maxOut = Math.max(maxOut, Math.abs(oL[k]), Math.abs(oR[k]));
      maxStereoGainDelta = Math.max(maxStereoGainDelta, Math.abs(oR[k] - 0.7 * oL[k]));
    }
  }
  assert.ok(
    maxOut <= LIMITER_CEILING_LINEAR + 1e-6,
    `Limiter overshot ceiling ${LIMITER_CEILING_LINEAR}: maxOut=${maxOut}`
  );
  assert.ok(maxStereoGainDelta < 1e-6, `Stereo image tilted during limiting: delta=${maxStereoGainDelta}`);

  // Verify 4x True-Peak ISP capping on fs/4 = 12 kHz signal whose sample peaks sit below ceiling
  const LimCtorIsp = lim.constructor;
  const limIsp = new LimCtorIsp({ processorOptions: { ceilingLinear: LIMITER_CEILING_LINEAR } });
  const ispBlocks = 30;
  const ispLen = ispBlocks * 128;
  const ispInL = new Float32Array(ispLen);
  const ispInR = new Float32Array(ispLen);
  const ispOutL = new Float32Array(ispLen);
  const ispOutR = new Float32Array(ispLen);
  for (let i = 0; i < ispLen; i++) {
    const s = 0.9 * Math.SQRT2 * Math.sin(Math.PI / 4 + (i * Math.PI) / 2);
    ispInL[i] = s;
    ispInR[i] = 0.7 * s;
  }
  for (let b = 0; b < ispBlocks; b++) {
    const off = b * 128;
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    limIsp.process([[ispInL.subarray(off, off + 128), ispInR.subarray(off, off + 128)]], [[oL, oR]], params);
    ispOutL.set(oL, off);
    ispOutR.set(oR, off);
  }
  let maxIspTruePeak = 0;
  for (let i = 1024; i < ispLen - 32; i++) {
    maxIspTruePeak = Math.max(maxIspTruePeak, Math.hypot(ispOutL[i], ispOutL[i + 1]));
  }
  assert.ok(
    maxIspTruePeak <= LIMITER_CEILING_LINEAR + 0.005,
    `fs/4 ISP overshot ceiling ${LIMITER_CEILING_LINEAR.toFixed(4)}: truePeak=${maxIspTruePeak.toFixed(4)}`
  );
});

test('4. AudioWorklet DSP: M/S-Balanced Bauer Crossfeed achieves 0.000 dB mono flatness error', () => {
  const reg = loadWorkletProcessors(48000);
  const XfCtor = reg.get('nootropic-crossfeed-processor');
  const xf = new XfCtor();
  const params = {
    enabled: new Float32Array([1]),
    crossLevel: new Float32Array([0.18]),
  };

  // Identical L === R mono multi-tone sweep: must suffer literally 0.000 dB comb error!
  let maxMonoErr = 0;
  for (let off = 0; off < 4800; off += 128) {
    const mono = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const t = (off + k) / 48000;
      mono[k] =
        0.25 * Math.sin(2 * Math.PI * 190 * t) +
        0.25 * Math.sin(2 * Math.PI * 680 * t) +
        0.25 * Math.sin(2 * Math.PI * 1313 * t) +
        0.25 * Math.sin(2 * Math.PI * 4500 * t);
    }
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    xf.process([[mono, mono]], [[oL, oR]], params);
    for (let k = 0; k < 128; k++) {
      maxMonoErr = Math.max(maxMonoErr, Math.abs(oL[k] - mono[k]), Math.abs(oR[k] - mono[k]));
    }
  }
  assert.ok(maxMonoErr < 1e-6, `Mono sum error expected 0, got ${maxMonoErr}`);

  // Hard-panned left signal: 180 Hz cross-bleed must exceed 10 kHz cross-bleed by > 15 dB
  const measureBleedR = (freqHz) => {
    const xfFreq = new XfCtor();
    let sqR = 0;
    let count = 0;
    for (let off = 0; off < 4800; off += 128) {
      const inL = new Float32Array(128);
      const inR = new Float32Array(128);
      for (let k = 0; k < 128; k++) {
        inL[k] = Math.sin((2 * Math.PI * freqHz * (off + k)) / 48000);
      }
      const oL = new Float32Array(128);
      const oR = new Float32Array(128);
      xfFreq.process([[inL, inR]], [[oL, oR]], params);
      if (off >= 1024) {
        for (let k = 0; k < 128; k++) {
          sqR += oR[k] * oR[k];
          count++;
        }
      }
    }
    return db(Math.sqrt(sqR / count));
  };
  const lowBleedDb = measureBleedR(180);
  const hiBleedDb = measureBleedR(10000);
  assert.ok(lowBleedDb > -22 && lowBleedDb < -12, `Expected gentle <680Hz bleed (-15..-18 dB), got ${lowBleedDb.toFixed(2)} dB`);
  assert.ok(lowBleedDb - hiBleedDb > 18, `Expected HF head-shadow rolloff >18 dB, got ${(lowBleedDb - hiBleedDb).toFixed(2)} dB`);
});

test('5. AudioWorklet DSP: Stereo Phase-Locked WSOLA (432 Hz, decoupled BPM+432, ring mode)', () => {
  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const WsolaCtor = reg.get('nootropic-wsola-processor');

  // Case A: Buffer mode A=440 -> A=432 + tempo=1.08 simultaneous decoupled test + stereo ITD preservation
  const wsolaBuf = new WsolaCtor({ processorOptions: { mode: 'buffer', sourceScale: 1.0 } });
  const totalIn = 48000; // 1.0 s
  const srcL = new Float32Array(totalIn);
  const srcR = new Float32Array(totalIn);
  const itdLag = 6;
  for (let i = 0; i < totalIn; i++) {
    const tL = i / sr;
    const tR = Math.max(0, i - itdLag) / sr;
    srcL[i] = 0.65 * Math.sin(2 * Math.PI * 440 * tL) + 0.2 * Math.sin(2 * Math.PI * 880 * tL);
    srcR[i] = 0.52 * Math.sin(2 * Math.PI * 440 * tR) + 0.16 * Math.sin(2 * Math.PI * 880 * tR);
  }

  let feedIdx = 0;
  let endSent = false;
  const pushChunk = () => {
    if (feedIdx >= totalIn) {
      if (!endSent) {
        endSent = true;
        wsolaBuf.port._deliver({ type: 'end' });
      }
      return;
    }
    const next = Math.min(totalIn, feedIdx + 16384);
    wsolaBuf.port._deliver({ type: 'chunk', left: srcL.slice(feedIdx, next), right: srcR.slice(feedIdx, next) });
    feedIdx = next;
    if (feedIdx >= totalIn && !endSent) {
      endSent = true;
      wsolaBuf.port._deliver({ type: 'end' });
    }
  };
  pushChunk();
  pushChunk();

  const outSamplesL = [];
  const outSamplesR = [];
  const bufParams = {
    pitchRatio: new Float32Array([432 / 440]),
    tempoRatio: new Float32Array([1.08]),
    bypass: new Float32Array([0]),
  };

  let eofReached = false;
  for (let blk = 0; blk < 600 && !eofReached; blk++) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    wsolaBuf.process([], [[oL, oR]], bufParams);
    while (wsolaBuf.port._outbox.length > 0) {
      const m = wsolaBuf.port._outbox.shift();
      if (m.type === 'need_chunk') pushChunk();
      else if (m.type === 'eof') eofReached = true;
    }
    if (!eofReached) {
      for (let i = 0; i < 128; i++) {
        outSamplesL.push(oL[i]);
        outSamplesR.push(oR[i]);
      }
    }
  }
  assert.ok(eofReached, 'WSOLA buffer mode must emit eof cleanly');
  const expectedFrames = totalIn / 1.08;
  assert.ok(
    Math.abs(outSamplesL.length - expectedFrames) < 2500,
    `Expected ~${expectedFrames.toFixed(0)} frames at 1.08x tempo, got ${outSamplesL.length}`
  );

  // Measure pitch on steady body (skip startup/tail)
  const steadyL = outSamplesL.slice(8000, 32000);
  const measured = measureFinePeakHz(steadyL, sr, 415, 450, 0.25);
  const centErr = 1200 * Math.log2(measured.hz / 432.0);
  assert.ok(Math.abs(centErr) < 2.0, `Expected 432.0 Hz (+-2 cents), got ${measured.hz.toFixed(2)} Hz (${centErr.toFixed(2)} cents)`);

  // Verify L/R stereo ITD phase coherence preserved (lagged by ~6 samples)
  let dot = 0;
  let normL = 0;
  let normR = 0;
  for (let i = 8000 + itdLag; i < 32000; i++) {
    const a = outSamplesL[i - itdLag];
    const b = outSamplesR[i];
    dot += a * b;
    normL += a * a;
    normR += b * b;
  }
  const corr = dot / Math.sqrt(normL * normR);
  assert.ok(corr > 0.96, `Stereo ITD correlation degraded under WSOLA: ${corr.toFixed(4)}`);

  // Case B: Ring mode compensating pre-sped HTMLAudioElement (1.09x rate -> recover exact 432 Hz)
  const wsolaRing = new WsolaCtor({ processorOptions: { mode: 'ring', sourceScale: 1.0 } });
  const ringInFrames = 32768;
  const ringOutL = [];
  const ringParams = {
    pitchRatio: new Float32Array([(432 / 440) / 1.09]),
    tempoRatio: new Float32Array([1.09]),
    bypass: new Float32Array([0]),
  };
  for (let off = 0; off < ringInFrames; off += 128) {
    const iL = new Float32Array(128);
    const iR = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const idx = off + k;
      const freq = 440 * 1.09; // pre-sped by <audio> playbackRate=1.09 preservesPitch=false
      iL[k] = 0.6 * Math.sin((2 * Math.PI * freq * idx) / sr);
      iR[k] = 0.6 * Math.sin((2 * Math.PI * freq * idx) / sr);
    }
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    wsolaRing.process([[iL, iR]], [[oL, oR]], ringParams);
    for (let k = 0; k < 128; k++) ringOutL.push(oL[k]);
  }
  const ringSteady = ringOutL.slice(12000, 30000);
  const ringPeak = measureFinePeakHz(ringSteady, sr, 415, 450, 0.25);
  const ringCents = 1200 * Math.log2(ringPeak.hz / 432.0);
  assert.ok(Math.abs(ringCents) < 2.5, `Ring WSOLA expected 432.0 Hz (+-2.5 cents), got ${ringPeak.hz.toFixed(2)} Hz`);

  // Verify 75%-overlap Hann diffuse noise flatness across Hs=512 hop cycle (< 0.25 dB ripple)
  const wsolaNoise = new wsolaRing.constructor({ processorOptions: { mode: 'ring', sourceSampleRate: sr } });
  const noiseTotal = 288000; // 6.0s @ 48 kHz -> ~562 hops for low stochastic bin variance
  const noiseOut = new Float32Array(noiseTotal);
  let seed = 0x12345678;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const noiseParams = { ...ringParams, bypass: new Float32Array([0]) };
  for (let b = 0; b < Math.floor(noiseTotal / 128); b++) {
    const iL = new Float32Array(128);
    const iR = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      iL[k] = 0.35 * nextRand();
      iR[k] = 0.35 * nextRand();
    }
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    wsolaNoise.process([[iL, iR]], [[oL, oR]], noiseParams);
    noiseOut.set(oL, b * 128);
  }
  const hopCycle = 512;
  const numBins = 8;
  const binSq = new Float64Array(numBins);
  const binCount = new Int32Array(numBins);
  for (let i = 24000; i < noiseTotal - 2048; i++) {
    const bin = Math.floor(((i % hopCycle) / hopCycle) * numBins);
    binSq[bin] += noiseOut[i] * noiseOut[i];
    binCount[bin]++;
  }
  const binDb = Array.from({ length: numBins }, (_, idx) => 10 * Math.log10(binSq[idx] / binCount[idx]));
  const noiseRippleDb = Math.max(...binDb) - Math.min(...binDb);
  assert.ok(noiseRippleDb < 0.25, `WSOLA 75%-Hann diffuse noise ripple too high: ${noiseRippleDb.toFixed(3)} dB`);

  // Verify dynamic bypass toggle (0 -> 1 -> 0) crossfades clicklessly without 80ms delay jump
  const wsolaSwitch = new wsolaRing.constructor({ processorOptions: { mode: 'ring', sourceSampleRate: sr } });
  const swBlocks = 280;
  const swOut = new Float32Array(swBlocks * 128);
  let swPhase = 0;
  const swInc = (2 * Math.PI * 220) / sr;
  for (let b = 0; b < swBlocks; b++) {
    const iL = new Float32Array(128);
    const iR = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const s = 0.5 * Math.sin(swPhase);
      iL[k] = s;
      iR[k] = s;
      swPhase += swInc;
    }
    const bypassVal = b >= 120 && b < 200 ? 1 : 0;
    const swParams = { ...ringParams, bypass: new Float32Array([bypassVal]) };
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    wsolaSwitch.process([[iL, iR]], [[oL, oR]], swParams);
    swOut.set(oL, b * 128);
  }
  let maxSwitchStep = 0;
  for (let i = 10000; i < swOut.length - 128; i++) {
    maxSwitchStep = Math.max(maxSwitchStep, Math.abs(swOut[i] - swOut[i - 1]));
  }
  assert.ok(maxSwitchStep < 0.03, `WSOLA bypass toggle caused transient click: maxStep=${maxSwitchStep.toFixed(4)}`);
});

test('6. AudioWorklet DSP: Lyria 48->44.1 kHz Catmull-Rom Cubic Resampler + Cosine Underrun Guard', () => {
  const outSr = 44100;
  const reg = loadWorkletProcessors(outSr);
  const LyriaCtor = reg.get('nootropic-lyria-stream-processor');
  const lyria = new LyriaCtor();

  // Push 48 kHz 1000 Hz stereo PCM split across irregular 1440-frame chunks
  const inFrames = 24000; // 0.5 s @ 48 kHz
  const chunkSize = 1440;
  for (let off = 0; off < inFrames; off += chunkSize) {
    const n = Math.min(chunkSize, inFrames - off);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const s = 0.7 * Math.sin((2 * Math.PI * 1000 * (off + k)) / 48000);
      l[k] = s;
      r[k] = s * 0.5;
    }
    lyria.port._deliver({ type: 'pcm', left: l, right: r });
  }

  // Render full buffer + underrun tail (~0.55 s @ 44.1 kHz)
  const outFrames = Math.round(outSr * 0.55);
  const rendered = [];
  for (let off = 0; off < outFrames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    lyria.process([], [[oL, oR]]);
    for (let k = 0; k < 128; k++) rendered.push(oL[k]);
  }

  // Steady region pitch must match 1000.0 Hz cleanly at 44.1 kHz output!
  const steady = rendered.slice(2000, 14000);
  const peak = measureFinePeakHz(steady, outSr, 980, 1020, 0.25);
  assert.ok(Math.abs(peak.hz - 1000.0) < 0.6, `Expected 1000 Hz after 48->44.1k resampling, got ${peak.hz} Hz`);

  // Verify no click / step jump across chunk boundaries OR during underrun tail
  let maxSampleStep = 0;
  const maxTheoreticalStep = 0.7 * 2 * Math.PI * (1000 / outSr) * 1.35;
  for (let i = 1; i < rendered.length; i++) {
    const diff = Math.abs(rendered[i] - rendered[i - 1]);
    if (diff > maxSampleStep) maxSampleStep = diff;
  }
  assert.ok(
    maxSampleStep < maxTheoreticalStep,
    `Detected sample discontinuity/click in Lyria stream: maxStep=${maxSampleStep.toFixed(4)} vs limit=${maxTheoreticalStep.toFixed(4)}`
  );
  // Tail after underrun settles cleanly near zero
  const endTail = Math.abs(rendered[rendered.length - 1]);
  assert.ok(endTail < 0.01, `Expected smooth fade to zero on underrun, ended at ${endTail}`);

  // Burst-overflow catchup (>144000 buffered 48k frames) on non-periodic 317 Hz wave must crossfade clicklessly
  const lyriaBurst = new LyriaCtor();
  let burstInIdx = 0;
  const push317 = (count) => {
    const l = new Float32Array(count);
    const r = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const s = 0.7 * Math.sin((2 * Math.PI * 317 * burstInIdx++) / 48000);
      l[k] = s;
      r[k] = s;
    }
    lyriaBurst.port._deliver({ type: 'pcm', left: l, right: r });
  };
  push317(12000);
  const burstRendered = [];
  for (let b = 0; b < 40; b++) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    lyriaBurst.process([], [[oL, oR]]);
    for (let k = 0; k < 128; k++) burstRendered.push(oL[k]);
  }
  for (let c = 0; c < 40; c++) push317(4000); // Push 160,000 samples (> 144,000 cap)
  for (let b = 0; b < 120; b++) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    lyriaBurst.process([], [[oL, oR]]);
    for (let k = 0; k < 128; k++) burstRendered.push(oL[k]);
  }
  let burstMaxStep = 0;
  const burstMaxAllowed = 0.7 * 2 * Math.PI * (317 / outSr) * 1.8;
  for (let i = 1000; i < burstRendered.length; i++) {
    burstMaxStep = Math.max(burstMaxStep, Math.abs(burstRendered[i] - burstRendered[i - 1]));
  }
  assert.ok(
    burstMaxStep < burstMaxAllowed,
    `Lyria overflow catch-up caused click: maxStep=${burstMaxStep.toFixed(4)} vs limit=${burstMaxAllowed.toFixed(4)}`
  );

  // Also verify NootropicEnvFollower ITU-R BS.1770-4 K-weighted RMS + asymmetric (40ms down / 250ms up) tracking
  const EnvCtor = reg.get('nootropic-env-follower');
  assert.ok(EnvCtor, 'nootropic-env-follower must be registered');
  const envNode = new EnvCtor();
  const kwOut = computeItuKWeightingCoeffs(outSr);
  const probeIn = new Float32Array(outSr);
  for (let i = 0; i < outSr; i++) probeIn[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / outSr);
  const evalDf2t = (buf, c) => {
    const o = new Float32Array(buf.length);
    let w1 = 0, w2 = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = c.b0 * buf[i] + w1;
      w1 = c.b1 * buf[i] - c.a1 * y + w2;
      w2 = c.b2 * buf[i] - c.a2 * y;
      o[i] = y;
    }
    return o;
  };
  const kwFiltered = evalDf2t(evalDf2t(probeIn, kwOut.pre), kwOut.rlb);
  let kwSq = 0;
  for (let i = Math.round(outSr * 0.25); i < outSr; i++) kwSq += kwFiltered[i] * kwFiltered[i];
  const expectedKwRms = Math.sqrt(kwSq / (outSr - Math.round(outSr * 0.25)));

  for (let off = 0; off < outSr * 2; off += 128) {
    const iL = new Float32Array(128);
    const iR = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const s = 0.25 * Math.sin((2 * Math.PI * 220 * (off + k)) / outSr);
      iL[k] = s;
      iR[k] = s;
    }
    envNode.process([[iL, iR]]);
  }
  const envMsgs = envNode.port._outbox.filter((m) => m.type === 'env');
  assert.ok(envMsgs.length >= 10, 'Env follower must emit regular 90 ms telemetry messages');
  const lastRms = envMsgs[envMsgs.length - 1].rms;
  assert.ok(
    Math.abs(lastRms - expectedKwRms) < 0.002,
    `Env follower K-weighted RMS expected ${expectedKwRms.toFixed(4)}, got ${lastRms.toFixed(4)}`
  );
});

test('7. Real Headless Chromium (OfflineAudioContext + AudioWorklet) Full LR4 + Crossfeed + Limiter + Bus Isolation Proof', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found on host');
    return;
  }

  // Build deterministic calibrated stereo noise buffers (White, Pink, Brown) using calibrateFilteredStereoNoiseRms
  const noiseSr = 48000;
  const noiseLen = noiseSr * 2;
  const noisePayloads = {};
  for (const color of ['white', 'pink', 'brown']) {
    const chL = new Float32Array(noiseLen);
    const chR = new Float32Array(noiseLen);
    let seed = color === 'white' ? 101 : color === 'pink' ? 202 : 303;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };
    const mkColor = (arr) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
      for (let i = 0; i < noiseLen; i++) {
        const w = rnd();
        if (color === 'white') {
          arr[i] = w;
        } else if (color === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520;
          b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.0168980;
          arr[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          br = br * 0.992 + w * 0.04;
          arr[i] = br;
        }
      }
    };
    mkColor(chL);
    mkColor(chR);
    calibrateFilteredStereoNoiseRms(chL, chR, noiseSr, 115, 4200, NOISE_CALIBRATED_RMS, BUTTERWORTH_LP_HP_Q_DB);
    const interleaved = new Float32Array(noiseLen * 2);
    for (let i = 0; i < noiseLen; i++) {
      interleaved[i * 2] = chL[i];
      interleaved[i * 2 + 1] = chR[i];
    }
    noisePayloads[color] = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
  }

  const testHtml = `<!doctype html><html><body><script type="module">
const BUTTERWORTH_LP_HP_Q_DB = ${BUTTERWORTH_LP_HP_Q_DB};
const LIMITER_CEILING_LINEAR = ${LIMITER_CEILING_LINEAR};
const NOISE_CALIBRATED_RMS = ${NOISE_CALIBRATED_RMS};
const WORKLET_CODE = ${JSON.stringify(DSP_WORKLET_CODE)};

async function run() {
  const sr = 48000;
  const frames = Math.round(sr * 1.4);
  const ctx = new OfflineAudioContext(2, frames, sr);

  // Load AudioWorklet module twice via same WeakMap-like guard concept
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  // Measure real Chromium BiquadFilterNode 3-band LR4 crossover sum flatness vs broken Q
  const measureSumErrorDb = async (qLpHp) => {
    const c = new OfflineAudioContext(2, sr, sr);
    const freqs = [60, 190, 600, 1350, 4500, 9000];
    const oscs = freqs.map((f) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.14;
      o.connect(g);
      o.start(0);
      return g;
    });
    const bus = c.createGain();
    oscs.forEach((g) => g.connect(bus));

    const mkBiquad = (type, f, q) => {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };

    const low1 = mkBiquad('lowpass', 190, qLpHp);
    const low2 = mkBiquad('lowpass', 190, qLpHp);
    const apLowHi = mkBiquad('allpass', 4500, Math.SQRT1_2);

    const midHp1 = mkBiquad('highpass', 190, qLpHp);
    const midHp2 = mkBiquad('highpass', 190, qLpHp);
    const midLp1 = mkBiquad('lowpass', 4500, qLpHp);
    const midLp2 = mkBiquad('lowpass', 4500, qLpHp);

    const hi1 = mkBiquad('highpass', 4500, qLpHp);
    const hi2 = mkBiquad('highpass', 4500, qLpHp);
    const apHiLo = mkBiquad('allpass', 190, Math.SQRT1_2);

    bus.connect(low1); low1.connect(low2); low2.connect(apLowHi); apLowHi.connect(c.destination);
    bus.connect(midHp1); midHp1.connect(midHp2); midHp2.connect(midLp1); midLp1.connect(midLp2); midLp2.connect(c.destination);
    bus.connect(hi1); hi1.connect(hi2); hi2.connect(apHiLo); apHiLo.connect(c.destination);

    const rendered = await c.startRendering();
    const ch = rendered.getChannelData(0);
    // Single-tone exact coherent amplitude on steady second half
    const seg = ch.subarray(Math.round(sr * 0.5));
    const errs = freqs.map((f) => {
      let re = 0, im = 0, wSum = 0;
      const n = seg.length;
      for (let i = 0; i < n; i++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
        const ang = (2 * Math.PI * f * i) / sr;
        re += seg[i] * w * Math.cos(ang);
        im -= seg[i] * w * Math.sin(ang);
        wSum += w;
      }
      const amp = Math.sqrt(re * re + im * im) / (wSum * 0.5);
      return 20 * Math.log10(amp / 0.14);
    });
    return { errs, maxAbsDb: Math.max(...errs.map((v) => Math.abs(v))) };
  };

  const brokenLr4 = await measureSumErrorDb(Math.SQRT1_2);
  const fixedLr4 = await measureSumErrorDb(BUTTERWORTH_LP_HP_Q_DB);

  // Full signal chain test: mono/stereo burst -> Crossfeed -> Lookahead Limiter in Chromium
  const srcBuf = ctx.createBuffer(2, frames, sr);
  const bL = srcBuf.getChannelData(0);
  const bR = srcBuf.getChannelData(1);
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    const hot = i >= 12000 && i < 36000 ? 2.1 : 0.3;
    bL[i] = hot * Math.sin(2 * Math.PI * 1000 * t);
    bR[i] = hot * Math.sin(2 * Math.PI * 1000 * t);
  }
  const src = ctx.createBufferSource();
  src.buffer = srcBuf;
  const xf = new AudioWorkletNode(ctx, 'nootropic-crossfeed-processor', { outputChannelCount: [2] });
  const lim = new AudioWorkletNode(ctx, 'nootropic-lookahead-limiter', { outputChannelCount: [2] });
  lim.parameters.get('ceiling').setValueAtTime(LIMITER_CEILING_LINEAR, 0);
  src.connect(xf);
  xf.connect(lim);
  lim.connect(ctx.destination);
  src.start(0);

  const renderedChain = await ctx.startRendering();
  const outL = renderedChain.getChannelData(0);
  const outR = renderedChain.getChannelData(1);
  let maxPeak = 0;
  let maxMonoDiff = 0;
  for (let i = 0; i < frames; i++) {
    maxPeak = Math.max(maxPeak, Math.abs(outL[i]), Math.abs(outR[i]));
    maxMonoDiff = Math.max(maxMonoDiff, Math.abs(outL[i] - outR[i]));
  }

  // 7b. Chromium fs/4 = 12 kHz 4x True-Peak ISP capping in lookahead limiter
  const ispFrames = 16384;
  const ispCtx = new OfflineAudioContext(2, ispFrames, sr);
  const ispBlob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const ispUrl = URL.createObjectURL(ispBlob);
  await ispCtx.audioWorklet.addModule(ispUrl);
  URL.revokeObjectURL(ispUrl);
  const ispBuf = ispCtx.createBuffer(2, ispFrames, sr);
  const ispL = ispBuf.getChannelData(0);
  const ispR = ispBuf.getChannelData(1);
  for (let i = 0; i < ispFrames; i++) {
    const s = 0.9 * Math.SQRT2 * Math.sin(Math.PI / 4 + (i * Math.PI) / 2);
    ispL[i] = s;
    ispR[i] = s * 0.7;
  }
  const ispSrc = ispCtx.createBufferSource();
  ispSrc.buffer = ispBuf;
  const ispLim = new AudioWorkletNode(ispCtx, 'nootropic-lookahead-limiter', { outputChannelCount: [2] });
  ispLim.parameters.get('ceiling').setValueAtTime(LIMITER_CEILING_LINEAR, 0);
  ispSrc.connect(ispLim);
  ispLim.connect(ispCtx.destination);
  ispSrc.start(0);
  const ispRen = await ispCtx.startRendering();
  const ispOutL = ispRen.getChannelData(0);
  let ispTruePeak = 0;
  for (let i = 2048; i < ispFrames - 64; i++) {
    ispTruePeak = Math.max(ispTruePeak, Math.hypot(ispOutL[i], ispOutL[i + 1]));
  }

  // 7c. Pre-split speakerSafeEQ notch + 3-band LR4 phase coherence vs standalone notch
  const measureNotchSplitDelta = async () => {
    const testFreqs = [60, 190, 600, 1850, 4500, 9000];
    const renderCoherent = async (withLr4Split) => {
      const c = new OfflineAudioContext(2, sr, sr);
      const bus = c.createGain();
      testFreqs.forEach((f) => {
        const o = c.createOscillator();
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.value = 0.14;
        o.connect(g);
        g.connect(bus);
        o.start(0);
      });
      const notch = c.createBiquadFilter();
      notch.type = 'peaking';
      notch.frequency.value = 1850;
      notch.Q.value = 1.4;
      notch.gain.value = -3.0;
      bus.connect(notch);
      if (!withLr4Split) {
        notch.connect(c.destination);
      } else {
        const mkB = (type, f, q) => {
          const b = c.createBiquadFilter();
          b.type = type;
          b.frequency.value = f;
          b.Q.value = q;
          return b;
        };
        const low1 = mkB('lowpass', 190, BUTTERWORTH_LP_HP_Q_DB);
        const low2 = mkB('lowpass', 190, BUTTERWORTH_LP_HP_Q_DB);
        const apLow = mkB('allpass', 4500, Math.SQRT1_2);
        const midHp1 = mkB('highpass', 190, BUTTERWORTH_LP_HP_Q_DB);
        const midHp2 = mkB('highpass', 190, BUTTERWORTH_LP_HP_Q_DB);
        const midLp1 = mkB('lowpass', 4500, BUTTERWORTH_LP_HP_Q_DB);
        const midLp2 = mkB('lowpass', 4500, BUTTERWORTH_LP_HP_Q_DB);
        const hi1 = mkB('highpass', 4500, BUTTERWORTH_LP_HP_Q_DB);
        const hi2 = mkB('highpass', 4500, BUTTERWORTH_LP_HP_Q_DB);
        const apHi = mkB('allpass', 190, Math.SQRT1_2);
        notch.connect(low1); low1.connect(low2); low2.connect(apLow); apLow.connect(c.destination);
        notch.connect(midHp1); midHp1.connect(midHp2); midHp2.connect(midLp1); midLp1.connect(midLp2); midLp2.connect(c.destination);
        notch.connect(hi1); hi1.connect(hi2); hi2.connect(apHi); apHi.connect(c.destination);
      }
      const ren = await c.startRendering();
      const ch = ren.getChannelData(0).subarray(Math.round(sr * 0.5));
      return testFreqs.map((f) => {
        let re = 0, im = 0, wSum = 0;
        for (let i = 0; i < ch.length; i++) {
          const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (ch.length - 1)));
          const ang = (2 * Math.PI * f * i) / sr;
          re += ch[i] * w * Math.cos(ang);
          im -= ch[i] * w * Math.sin(ang);
          wSum += w;
        }
        return 20 * Math.log10(Math.sqrt(re * re + im * im) / (wSum * 0.5));
      });
    };
    const refDb = await renderCoherent(false);
    const splitDb = await renderCoherent(true);
    return Math.max(...refDb.map((v, i) => Math.abs(splitDb[i] - v)));
  };
  const speakerSafeLr4ErrDb = await measureNotchSplitDelta();

  // 7d. Layer 1 linear isolation from Layer 2 musicCompressor ducking
  const isoFrames = sr;
  const isoCtx = new OfflineAudioContext(2, isoFrames, sr);
  const isoBlob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const isoUrl = URL.createObjectURL(isoBlob);
  await isoCtx.audioWorklet.addModule(isoUrl);
  URL.revokeObjectURL(isoUrl);
  const masterSum = isoCtx.createGain();
  const l1Osc = isoCtx.createOscillator();
  l1Osc.frequency.value = 200;
  const l1Gain = isoCtx.createGain();
  l1Gain.gain.value = 0.2;
  l1Osc.connect(l1Gain);
  l1Gain.connect(masterSum);
  l1Osc.start(0);

  const l2Osc = isoCtx.createOscillator();
  l2Osc.frequency.value = 1000;
  const l2Env = isoCtx.createGain();
  l2Env.gain.setValueAtTime(0.05, 0);
  // 0.65 triggers >7 dB musicComp compression (-14 dB thresh) while keeping total peak (0.65+0.20=0.85) below master limiter
  l2Env.gain.setValueAtTime(0.65, 0.3);
  l2Env.gain.setValueAtTime(0.05, 0.7);
  const musicComp = isoCtx.createDynamicsCompressor();
  musicComp.threshold.value = -14;
  musicComp.knee.value = 6;
  musicComp.ratio.value = 4;
  musicComp.attack.value = 0.005;
  musicComp.release.value = 0.1;
  l2Osc.connect(l2Env);
  l2Env.connect(musicComp);
  musicComp.connect(masterSum);
  l2Osc.start(0);

  const isoLim = new AudioWorkletNode(isoCtx, 'nootropic-lookahead-limiter', { outputChannelCount: [2] });
  isoLim.parameters.get('ceiling').setValueAtTime(LIMITER_CEILING_LINEAR, 0);
  masterSum.connect(isoLim);
  isoLim.connect(isoCtx.destination);
  const isoRen = await isoCtx.startRendering();
  const isoCh = isoRen.getChannelData(0);
  const measure200HzAmp = (startSec, endSec) => {
    const s0 = Math.round(startSec * sr);
    const s1 = Math.round(endSec * sr);
    const len = s1 - s0;
    let re = 0, im = 0, wSum = 0;
    for (let i = 0; i < len; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
      const ang = (2 * Math.PI * 200 * (s0 + i)) / sr;
      re += isoCh[s0 + i] * w * Math.cos(ang);
      im -= isoCh[s0 + i] * w * Math.sin(ang);
      wSum += w;
    }
    return Math.sqrt(re * re + im * im) / (wSum * 0.5);
  };
  const l1Before = measure200HzAmp(0.06, 0.24);
  const l1During = measure200HzAmp(0.42, 0.64);
  const layer1DuckingDb = 20 * Math.log10(l1During / l1Before);

  // 7e. Chromium C++ BiquadFilterNode post-filter RMS parity across White/Pink/Brown
  const chromiumNoiseErrsDb = {};
  for (const color of ['white', 'pink', 'brown']) {
    const ab = await (await fetch('/noise/' + color + '.f32')).arrayBuffer();
    const interleaved = new Float32Array(ab);
    const nFrames = interleaved.length / 2;
    const nCtx = new OfflineAudioContext(2, nFrames, sr);
    const nBuf = nCtx.createBuffer(2, nFrames, sr);
    const nL = nBuf.getChannelData(0);
    const nR = nBuf.getChannelData(1);
    for (let i = 0; i < nFrames; i++) {
      nL[i] = interleaved[i * 2];
      nR[i] = interleaved[i * 2 + 1];
    }
    const nSrc = nCtx.createBufferSource();
    nSrc.buffer = nBuf;
    const hp = nCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 115;
    hp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
    const lp = nCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
    nSrc.connect(hp);
    hp.connect(lp);
    lp.connect(nCtx.destination);
    nSrc.start(0);
    const nRen = await nCtx.startRendering();
    const oL = nRen.getChannelData(0);
    const oR = nRen.getChannelData(1);
    let sq = 0;
    const skip = 12000;
    for (let i = skip; i < nFrames; i++) sq += oL[i] * oL[i] + oR[i] * oR[i];
    const rms = Math.sqrt(sq / (2 * (nFrames - skip)));
    chromiumNoiseErrsDb[color] = 20 * Math.log10(rms / NOISE_CALIBRATED_RMS);
  }

  return {
    brokenMaxAbsDb: brokenLr4.maxAbsDb,
    fixedMaxAbsDb: fixedLr4.maxAbsDb,
    fixedErrs: fixedLr4.errs,
    limiterMaxPeak: maxPeak,
    ceiling: LIMITER_CEILING_LINEAR,
    monoDiff: maxMonoDiff,
    ispTruePeak,
    speakerSafeLr4ErrDb,
    layer1DuckingDb,
    chromiumNoiseErrsDb,
  };
}

run()
  .then((res) => fetch('/result', { method: 'POST', body: JSON.stringify({ ok: true, res }) }))
  .catch((err) => fetch('/result', { method: 'POST', body: JSON.stringify({ ok: false, err: String(err) }) }));
</script></body></html>`;

  let resolveResult;
  const resultPromise = new Promise((res) => {
    resolveResult = res;
  });

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        res.writeHead(200, { Connection: 'close' });
        res.end('ok');
        resolveResult(JSON.parse(body));
      });
      return;
    }
    const noiseMatch = req.url?.match(/^\/noise\/(white|pink|brown)\.f32$/);
    if (noiseMatch) {
      const buf = noisePayloads[noiseMatch[1]];
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.byteLength, Connection: 'close' });
      res.end(buf);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
    res.end(testHtml);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nootropic-edge-dsp-'));
  let payload;
  const child = spawn(
    edgePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${userDataDir}`,
      `http://127.0.0.1:${port}/`,
    ],
    { stdio: 'ignore' }
  );
  let timeoutId;
  try {
    payload = await Promise.race([
      resultPromise,
      new Promise((_, rej) => {
        timeoutId = setTimeout(() => rej(new Error('Chromium Web Audio timeout')), 25000);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (process.platform === 'win32' && child.pid) {
      await new Promise((r) => {
        const tk = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        tk.on('close', r);
        tk.on('error', r);
      });
    } else {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    server.closeAllConnections?.();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore OS lock cleanup if any
    }
  }

  assert.equal(payload.ok, true, `Chromium test failed: ${payload.err}`);
  const {
    brokenMaxAbsDb,
    fixedMaxAbsDb,
    limiterMaxPeak,
    ceiling,
    monoDiff,
    ispTruePeak,
    speakerSafeLr4ErrDb,
    layer1DuckingDb,
    chromiumNoiseErrsDb,
  } = payload.res;
  assert.ok(brokenMaxAbsDb > 6.5, `Sanity check failed: old SQRT1_2 Q expected >6.5 dB hump, got ${brokenMaxAbsDb}`);
  assert.ok(fixedMaxAbsDb < 0.08, `Chromium LR4 with BUTTERWORTH_LP_HP_Q_DB deviated ${fixedMaxAbsDb.toFixed(4)} dB`);
  assert.ok(limiterMaxPeak <= ceiling + 1e-5, `Chromium limiter overshot ceiling: ${limiterMaxPeak} > ${ceiling}`);
  assert.ok(monoDiff < 1e-6, `Chromium crossfeed + limiter stereo mono symmetry error: ${monoDiff}`);
  assert.ok(ispTruePeak <= ceiling + 0.005, `Chromium fs/4 ISP overshot ceiling: ${ispTruePeak.toFixed(4)} > ${ceiling}`);
  assert.ok(speakerSafeLr4ErrDb < 0.08, `Chromium pre-split speakerSafeEQ LR4 delta ${speakerSafeLr4ErrDb.toFixed(4)} dB`);
  assert.ok(Math.abs(layer1DuckingDb) < 0.05, `Chromium Layer 1 suffered ducking: ${layer1DuckingDb.toFixed(4)} dB`);
  for (const [color, errDb] of Object.entries(chromiumNoiseErrsDb)) {
    assert.ok(Math.abs(errDb) < 0.25, `Chromium BiquadFilterNode ${color} noise RMS off by ${errDb.toFixed(3)} dB`);
  }
});

test('8. Live Headless Edge CDP E2E Smoke Test against Built App (dist/client)', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found on host');
    return;
  }

  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/client');
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/client/index.html missing — run npm run build before test:dsp');

  // Generate 5-second stereo 440 Hz 16-bit WAV fixture for /api/audio/stream/*
  const wavSr = 44100;
  const wavFrames = wavSr * 5;
  const wavBuf = Buffer.alloc(44 + wavFrames * 4);
  wavBuf.write('RIFF', 0);
  wavBuf.writeUInt32LE(36 + wavFrames * 4, 4);
  wavBuf.write('WAVE', 8);
  wavBuf.write('fmt ', 12);
  wavBuf.writeUInt32LE(16, 16);
  wavBuf.writeUInt16LE(1, 20);
  wavBuf.writeUInt16LE(2, 22);
  wavBuf.writeUInt32LE(wavSr, 24);
  wavBuf.writeUInt32LE(wavSr * 4, 28);
  wavBuf.writeUInt16LE(4, 32);
  wavBuf.writeUInt16LE(16, 34);
  wavBuf.write('data', 36);
  wavBuf.writeUInt32LE(wavFrames * 4, 40);
  for (let i = 0; i < wavFrames; i++) {
    const val = Math.round(0.32 * 32767 * Math.sin((2 * Math.PI * 440 * i) / wavSr));
    wavBuf.writeInt16LE(val, 44 + i * 4);
    wavBuf.writeInt16LE(val, 44 + i * 4 + 2);
  }

  const trackMeta = {
    key: 'electronic/test-track.wav',
    name: 'Test 440Hz Analog Pad',
    url: '/api/audio/stream/test-track.wav',
    size: wavBuf.byteLength,
    energy: 'medium',
    bpm: 120,
    lufs: -16,
    rootMidi: 57,
    keyLabel: 'A minor',
  };

  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
    '.wav': 'audio/wav',
  };

  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    if (cleanUrl === '/favicon.ico') {
      res.writeHead(204, { Connection: 'close' });
      res.end();
      return;
    }
    if (cleanUrl === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ ok: true, version: '6.2', mode: 'e2e', hasLiveMusicGen: false }));
      return;
    }
    if (cleanUrl === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({
        config: {
          regionRequiresOptIn: false,
          countryCode: 'US',
          hasLiveMusicGen: false,
          freeTrialSeconds: 300,
          referralBonusSeconds: 1800,
          proMonthlyUsd: 9,
          proAnnualUsd: 69,
          stripeEnabled: false,
          proStatus: 'free',
          maxCustomTracks: 0,
        },
      }));
      return;
    }
    if (cleanUrl === '/api/audio/catalog') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({
        tracksByGenre: {
          electronic: [trackMeta],
          lofi: [trackMeta],
          acoustic: [trackMeta],
          ambient: [trackMeta],
          rain: [trackMeta],
          focus: [trackMeta],
        },
        customTracks: [],
      }));
      return;
    }
    if (cleanUrl.startsWith('/api/audio/stream/')) {
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] ? Math.min(Number(m[2]), wavBuf.byteLength - 1) : wavBuf.byteLength - 1;
        res.writeHead(206, {
          'Content-Type': 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${wavBuf.byteLength}`,
          'Content-Length': end - start + 1,
          Connection: 'close',
        });
        res.end(wavBuf.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Content-Length': wavBuf.byteLength,
          Connection: 'close',
        });
        res.end(wavBuf);
      }
      return;
    }
    if (cleanUrl === '/api/studies/presets') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ presets: [] }));
      return;
    }
    if (cleanUrl === '/api/profile' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({
          profile: {
            id: 'anon_e2e_test_profile',
            displayName: 'Alex',
            age: 30,
            ageBand: '26-35',
            gender: 'male',
            role: 'knowledge_worker',
            texturePref: 'warm_pads',
            noiseSensitivity: 'medium',
            defaultDevice: 'headphones',
            primaryChallenge: 'distraction',
            researchConsent: true,
            planTier: 'pro',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          profileToken: 'tok_e2e_test',
          syncCode: 'NFM-TEST-E2E1',
        }));
      });
      return;
    }
    if (cleanUrl === '/api/protocol/start' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({
          recommendation: {
            sessionId: 'ses_e2e_test_1',
            cohortKey: '26-35|office|alert_focus',
            cohortLabel: 'Ages 26-35 · Office · Sharp Focus',
            arm: {
              id: 'beta-focus-16hz',
              name: '16 Hz Beta Attention',
              tagline: '16 Hz Beta AM · Deep Electronic',
              description: 'Rapid 16 Hz mid-band amplitude modulation fused into studio music.',
              targetStates: ['alert_focus', 'deep_flow'],
              drivingSafe: true,
              priorAlpha: 4.5,
              priorBeta: 1.4,
              baseParams: {
                modulationHz: 16,
                modulationDepth: 0.38,
                crossoverHz: 190,
                upperCrossoverHz: 4500,
                bpm: 108,
                pulseIntensity: 0.48,
                noiseColor: 'pink',
                noiseLevel: 0.06,
                harmonicMode: 'warm_min9',
                rootNoteHz: 146.83,
                filterCutoffHz: 2600,
                speakerSafeEQ: false,
                antiMonotonyCycleMin: 0,
                binauralOffsetHz: 0,
              },
              studyIds: ['woods-2024'],
            },
            params: {
              modulationHz: 16,
              modulationDepth: 0.38,
              crossoverHz: 190,
              upperCrossoverHz: 4500,
              bpm: 108,
              pulseIntensity: 0.48,
              noiseColor: 'pink',
              noiseLevel: 0.06,
              harmonicMode: 'warm_min9',
              rootNoteHz: 146.83,
              filterCutoffHz: 2600,
              speakerSafeEQ: false,
              antiMonotonyCycleMin: 0,
              binauralOffsetHz: 0,
              stereoAmSpread: true,
              genre: 'deep_electronic',
              genreSelectionMode: 'user_chosen',
              energyTier: 'focus',
            },
            isExploration: false,
            isControlTrial: false,
            ephemeralMode: false,
            safetyMode: false,
            safetyWarnings: [],
            audioSource: 'studio_library',
            fallbackCoreGenre: 'deep_electronic',
            personalizationSummary: ['Calibrated from 2D Brain Map + Profile Cohort'],
            formulaIngredients: [
              { role: 'Layer 1 · Science', compound: '16 Hz Beta AM', dose: '65% effect', evidenceTag: 'Woods 2024' },
              { role: 'Layer 2 · Music', compound: 'Deep Electronic', dose: 'Studio Mix', evidenceTag: 'Lyric-Free' },
            ],
            rationale: 'Matched peer-reviewed 16 Hz Beta AM protocol for Sharp Focus.',
            studies: [
              {
                id: 'woods-2024',
                authors: 'Woods, K. J. P., et al.',
                year: 2024,
                title: 'Rapid modulation in music supports attention',
                journal: 'Communications Biology',
                mechanism: '16 Hz Beta mid-band AM',
                soundEffect: 'Sustained attention',
                doiOrUrl: 'https://doi.org/10.1038/s42003-024-07026-3',
                summary: '16 Hz AM embedded in instrumental music supported sustained attention.',
                caveat: 'Adjust comfort live.',
                applicableTargets: ['alert_focus'],
              },
            ],
            livePubMedPapers: [],
            confidencePct: 91,
            cohortTrials: 24,
            profileTrials: 1,
            plannedDurationMin: 25,
            currentState: 'distracted',
            microStateId: 'brain_fog',
            microStateLabel: 'Brain Fog',
            arousalPct: 32,
            clarityPct: 28,
            targetState: 'alert_focus',
            baselineScore: 2,
            environment: 'office',
            device: 'headphones',
          },
        }));
      });
      return;
    }
    if (cleanUrl.startsWith('/api/')) {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    let filePath = path.resolve(distDir, relPath);
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', Connection: 'close' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nootropic-edge-e2e-'));

  let child;
  let ws;
  try {
    let resolvePort;
    const cdpPortPromise = new Promise((res, rej) => {
      resolvePort = { res, rej };
    });

    child = spawn(
      edgePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );

    let stderrBuf = '';
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderrBuf);
      if (m) resolvePort.res(Number(m[1]));
    });
    child.on('exit', (code) => {
      if (!stderrBuf.includes('DevTools listening')) {
        resolvePort.rej(new Error(`Edge exited early with code ${code}: ${stderrBuf}`));
      }
    });

    const cdpPort = await Promise.race([
      cdpPortPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Edge CDP startup timeout')), 12000)),
    ]);

    let pageTarget = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      pageTarget = list.find((tg) => tg.type === 'page') ?? null;
      if (pageTarget?.webSocketDebuggerUrl) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(pageTarget?.webSocketDebuggerUrl, 'Missing CDP page target');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    let msgId = 0;
    const pending = new Map();
    const runtimeErrors = [];
    const consoleErrors = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const ex = msg.params?.exceptionDetails;
        runtimeErrors.push(ex?.exception?.description || ex?.text || JSON.stringify(ex));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        consoleErrors.push(text);
      }
    });

    const sendCdp = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++msgId;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evalJs = async (expression) => {
      const out = await sendCdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) {
        throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || 'Eval failed');
      }
      return out.result?.value;
    };

    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');
    await sendCdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__testAudioContexts = [];
          window.__testWorkletNodes = [];
          const OrigAC = window.AudioContext || window.webkitAudioContext;
          if (OrigAC) {
            const PatchedAC = function(...args) {
              const ctx = new OrigAC(...args);
              window.__testAudioContexts.push(ctx);
              return ctx;
            };
            PatchedAC.prototype = OrigAC.prototype;
            Object.setPrototypeOf(PatchedAC, OrigAC);
            window.AudioContext = PatchedAC;
          }
          const OrigAWN = window.AudioWorkletNode;
          if (OrigAWN) {
            const PatchedAWN = function(ctx, name, opts) {
              const node = new OrigAWN(ctx, name, opts);
              node.addEventListener('processorerror', (err) => {
                window.__testWorkletNodes.push({ name, error: String(err) });
              });
              return node;
            };
            PatchedAWN.prototype = OrigAWN.prototype;
            Object.setPrototypeOf(PatchedAWN, OrigAWN);
            window.AudioWorkletNode = PatchedAWN;
          }
        })();
      `,
    });

    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });

    // Wait for Quick-Try button on HeroLandingView
    const waitUntil = async (fnExpr, timeoutMs = 10000, desc = 'condition') => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const val = await evalJs(fnExpr);
        if (val) return val;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`Timed out waiting for ${desc}`);
    };

    // Walk the real 5-step platform flow:
    // Step 1: Onboarding on Main Page -> Step 2: 2D Brain Map -> Step 3: Target -> Step 4: Music -> Scientific Studies Reveal -> Player
    await waitUntil(
      `(() => {
        const ageInput = document.querySelector('input[type="number"]');
        if (!ageInput) return false;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const tracker = ageInput._valueTracker;
        if (tracker) tracker.setValue('');
        nativeSetter.call(ageInput, '30');
        ageInput.dispatchEvent(new Event('input', { bubbles: true }));

        const btns = Array.from(document.querySelectorAll('button'));
        const maleBtn = btns.find((b) => /^male$/i.test((b.textContent || '').trim()));
        if (maleBtn) maleBtn.click();
        const roleBtn = btns.find((b) => /software|knowledge|student|creative|entrepreneur/i.test(b.textContent || ''));
        if (roleBtn) roleBtn.click();

        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
        return true;
      })()`,
      10000,
      'Step 1 Onboarding fields'
    );

    await waitUntil(
      `(() => {
        if (document.querySelector('[aria-label="Interactive 2D Neural State Compass"]')) return true;
        const ageInput = document.querySelector('input[type="number"]');
        if (ageInput && ageInput.value !== '30') {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          if (ageInput._valueTracker) ageInput._valueTracker.setValue('');
          nativeSetter.call(ageInput, '30');
          ageInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
        const nextBtn = Array.from(document.querySelectorAll('button')).find((b) => /continue:\\s*current state/i.test(b.textContent || ''));
        if (nextBtn) nextBtn.click();
        return Boolean(document.querySelector('[aria-label="Interactive 2D Neural State Compass"]'));
      })()`,
      12000,
      'Continue to Step 2 Brain Map'
    );

    // Step 2: 2D Brain Map (verify zero auto-drawn trajectory path, select Brain Fog, advance)
    await waitUntil(
      `(() => {
        const landmark = Array.from(document.querySelectorAll('button[data-landmark="true"]')).find((b) => /brain fog|stressed|distracted/i.test(b.textContent || ''));
        if (!landmark) return false;
        landmark.click();
        const paths = document.querySelectorAll('[aria-label="Interactive 2D Neural State Compass"] svg path');
        if (paths.length > 0) throw new Error('Expected zero auto-drawn trajectory bar on Step 2 Brain Map');
        return true;
      })()`,
      10000,
      'Step 2 2D Brain Map selection'
    );

    await waitUntil(
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => /next:\\s*target/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      5000,
      'Advance to Step 3 Target'
    );

    // Step 3: Target & Duration (verify trajectory bar draws ONLY after selecting target)
    await waitUntil(
      `(() => {
        const targetBtn = Array.from(document.querySelectorAll('button')).find((b) => /sharp alert focus/i.test(b.textContent || ''));
        if (!targetBtn) return false;
        targetBtn.click();
        return true;
      })()`,
      5000,
      'Select Sharp Alert Focus target'
    );

    await waitUntil(
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => /next:\\s*music style/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      5000,
      'Advance to Step 4 Music Style'
    );

    // Step 4: Launch Scientific Study Search
    await waitUntil(
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => /find scientific studies/i.test(b.textContent || ''));
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      })()`,
      5000,
      'Launch Scientific Studies search'
    );

    // Step 5: Scientific Research Reveal -> Skip trace or wait -> Apply Layers & Start -> PlayerView
    await waitUntil(
      `(() => {
        const skipBtn = Array.from(document.querySelectorAll('button')).find((b) => /^skip/i.test((b.textContent || '').trim()));
        if (skipBtn) skipBtn.click();
        const startBtn = Array.from(document.querySelectorAll('button')).find((b) => /apply layers\\s*&\\s*start/i.test(b.textContent || ''));
        if (!startBtn) return false;
        if (!/woods/i.test(document.body.innerText || '')) return false;
        startBtn.click();
        return true;
      })()`,
      10000,
      'Scientific Studies Blueprint -> Apply Layers & Start'
    );

    // Wait for PlayerView + running AudioContext + worklets initialized
    const initialPlayback = await waitUntil(
      `(() => {
        const ctx = (window.__testAudioContexts || []).find((c) => c.state === 'running');
        const hasCanvas = document.querySelectorAll('canvas').length >= 1;
        const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
        const hasPlayerUi = buttons.some((txt) => /studio mix|pure signal|live synth|science only|pause/i.test(txt));
        if (ctx && hasCanvas && hasPlayerUi) {
          return { state: ctx.state, sampleRate: ctx.sampleRate, buttons: buttons.slice(0, 25) };
        }
        return false;
      })()`,
      12000,
      'running AudioContext + PlayerView'
    );
    assert.equal(initialPlayback.state, 'running');
    assert.ok(initialPlayback.sampleRate === 44100 || initialPlayback.sampleRate === 48000);

    // Exercise carrier & monitor switching while active (Studio Mix, Pure Signal, Live Synth, Science Only, Nootropic Mix)
    const clickedControls = [];
    for (const labelRe of ['Studio Mix', 'Pure Signal', 'Science Only', 'Plain Music', 'Nootropic Mix', 'Live Synth']) {
      const matched = await evalJs(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) =>
          new RegExp(${JSON.stringify(labelRe)}, 'i').test(b.textContent || '')
        );
        if (btn && !btn.disabled) btn.click();
        return btn ? (btn.textContent || '').trim() : null;
      })()`);
      if (matched) clickedControls.push(matched);
      await new Promise((r) => setTimeout(r, 350));
    }

    // Verify engine telemetry + AudioContext state BEFORE pause, then click Pause and confirm transition
    const prePauseCheck = await evalJs(`(() => {
      const ctxs = window.__testAudioContexts || [];
      return {
        ctxCount: ctxs.length,
        runningCount: ctxs.filter((c) => c.state === 'running').length,
        states: ctxs.map((c) => c.state),
        workletErrors: window.__testWorkletNodes || [],
        bodyHasHz: /\\d+\\.?\\d*\\s*Hz/i.test(document.body.innerText || ''),
      };
    })()`);

    assert.ok(clickedControls.length >= 2, `Expected interactive carrier/monitor controls to click, got ${JSON.stringify(clickedControls)}`);
    assert.ok(prePauseCheck.ctxCount >= 1 && prePauseCheck.runningCount >= 1, `Expected running AudioContext before pause: ${JSON.stringify(prePauseCheck)}`);
    assert.equal(prePauseCheck.workletErrors.length, 0, `AudioWorklet processor errors: ${JSON.stringify(prePauseCheck.workletErrors)}`);
    assert.equal(prePauseCheck.bodyHasHz, true, 'Expected live Hz readout in PlayerView');

    const didClickPause = await evalJs(`(() => {
      const pauseBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        /pause/i.test(b.textContent || '') || /pause/i.test(b.getAttribute('aria-label') || '')
      );
      if (pauseBtn && !pauseBtn.disabled) {
        pauseBtn.click();
        return true;
      }
      return false;
    })()`);
    assert.equal(didClickPause, true, 'Expected active Pause button in PlayerView');
    await new Promise((r) => setTimeout(r, 200));
    const postPauseStates = await evalJs(`(window.__testAudioContexts || []).map((c) => c.state)`);
    assert.ok(
      postPauseStates.includes('suspended') || postPauseStates.includes('closed'),
      `Expected Pause click to suspend AudioContext, got ${JSON.stringify(postPauseStates)}`
    );

    assert.equal(runtimeErrors.length, 0, `Page runtime exceptions: ${runtimeErrors.join('; ')}`);
    assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join('; ')}`);
  } finally {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    if (process.platform === 'win32' && child?.pid) {
      await new Promise((r) => {
        const tk = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        tk.on('close', r);
        tk.on('error', r);
      });
    } else if (child) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    server.closeAllConnections?.();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore
    }
  }
});

test('9. v7 DSP: Band-2 2-10 Hz Envelope Flattener (+modulation SNR) & ZDF/TPT-SVF (zero 375 Hz zipper noise)', () => {
  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const FlatCtor = reg.get('nootropic-env-flattener');
  const ZdfCtor = reg.get('nootropic-zdf-tilt');
  assert.ok(FlatCtor && ZdfCtor, 'Expected v7 flattener & zdf worklets');

  // A. Modulation-domain SNR improvement: 440 Hz tone w/ strong 4 Hz musical beats (3.5:1 crest swing) + 16 Hz AM (m=0.36)
  const totalFrames = 128 * Math.ceil((8.0 * sr) / 128);
  const flatProc = new FlatCtor();
  const carrier = new Float32Array(totalFrames);
  const flatOut = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const t = i / sr;
    const rhythm4Hz = 0.64 + 0.36 * Math.sin(2 * Math.PI * 4.0 * t);
    carrier[i] = 0.35 * rhythm4Hz * Math.sin(2 * Math.PI * 440.0 * t);
  }
  for (let off = 0; off < totalFrames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    const seg = carrier.subarray(off, off + 128);
    flatProc.process([[seg, seg]], [[oL, oR]], { gamma: new Float32Array([0.62]) });
    flatOut.set(oL, off);
  }

  const startSteady = Math.round(3.0 * sr);
  const envRaw = new Float32Array(totalFrames - startSteady);
  const envFlat = new Float32Array(totalFrames - startSteady);
  for (let i = startSteady; i < totalFrames; i++) {
    const t = i / sr;
    const amGain = (1 + 0.36 * Math.sin(2 * Math.PI * 16.0 * t)) / 1.36;
    envRaw[i - startSteady] = Math.abs(carrier[i] * amGain);
    envFlat[i - startSteady] = Math.abs(flatOut[i] * amGain);
  }
  const rawSnrDb = db(goertzelMag(envRaw, sr, 16.0) / Math.max(1e-9, goertzelMag(envRaw, sr, 4.0)));
  const flatSnrDb = db(goertzelMag(envFlat, sr, 16.0) / Math.max(1e-9, goertzelMag(envFlat, sr, 4.0)));
  const snrGainDb = flatSnrDb - rawSnrDb;
  assert.ok(
    snrGainDb >= 3.0,
    `Expected >= +3.0 dB modulation-domain SNR boost from Band-2 flattener, got +${snrGainDb.toFixed(2)} dB (raw=${rawSnrDb.toFixed(2)}, flat=${flatSnrDb.toFixed(2)})`
  );

  // B. ZDF/TPT-SVF unity bypass + a-rate 40 Hz modulation (no 375 Hz render-quantum zipper sidebands!)
  const zdfBypass = new ZdfCtor();
  const zIn = new Float32Array(128);
  const zOut = new Float32Array(128);
  for (let i = 0; i < 128; i++) zIn[i] = 0.5 * Math.sin((2 * Math.PI * 1350 * i) / sr);
  zdfBypass.process([[zIn, zIn]], [[zOut, new Float32Array(128)]], {
    freq: new Float32Array([1350]),
    Q: new Float32Array([1.15]),
    gainDb: new Float32Array([0]),
  });
  let maxBypassErr = 0;
  for (let i = 0; i < 128; i++) maxBypassErr = Math.max(maxBypassErr, Math.abs(zOut[i] - zIn[i]));
  assert.ok(maxBypassErr < 1e-12, `ZDF unity bypass error: ${maxBypassErr}`);

  const zdfMod = new ZdfCtor();
  const zFrames = 128 * 375; // 1.000 s exact integer Hz bins
  const modOut = new Float32Array(zFrames);
  const winHann = new Float32Array(zFrames);
  for (let i = 0; i < zFrames; i++) {
    winHann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (zFrames - 1)));
  }
  for (let off = 0; off < zFrames; off += 128) {
    const iL = new Float32Array(128);
    const gDb = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const idx = off + k;
      iL[k] = 0.5 * Math.sin((2 * Math.PI * 750 * idx) / sr);
      gDb[k] = 3.0 * Math.sin((2 * Math.PI * 40 * idx) / sr);
    }
    const oL = new Float32Array(128);
    zdfMod.process([[iL, iL]], [[oL, new Float32Array(128)]], {
      freq: new Float32Array([1350]),
      Q: new Float32Array([1.15]),
      gainDb: gDb,
    });
    modOut.set(oL, off);
  }
  const windowed = new Float32Array(zFrames);
  for (let i = 0; i < zFrames; i++) windowed[i] = modOut[i] * winHann[i];
  const carrierMag = goertzelMag(windowed, sr, 750);
  const zipLoDb = db(goertzelMag(windowed, sr, 750 - 375) / carrierMag);
  const zipHiDb = db(goertzelMag(windowed, sr, 750 + 375) / carrierMag);
  assert.ok(zipLoDb < -105 && zipHiDb < -105, `ZDF zipper sidebands too high: ${zipLoDb.toFixed(1)} / ${zipHiDb.toFixed(1)} dBc`);
});

test('10. v7 Neuro-DSP: Clinical Synth 44.1 kHz exact 40.000 Hz Gamma-MBI (<10.5 dB crest) & +-30 Hz Noise Notch', () => {
  const sr = 44100;
  const reg = loadWorkletProcessors(sr);
  const SynthCtor = reg.get('nootropic-clinical-synth');
  assert.ok(SynthCtor, 'nootropic-clinical-synth must be registered');

  // Verify 44.1 kHz 40.000 Hz exactness (eliminating 1102.5-sample buffer rounding detune) + comfortable Gamma-MBI crest factor
  const synth = new SynthCtor();
  synth.port._deliver({
    type: 'config',
    mode: 'gamma_mbi',
    rateHz: 40.0,
    startRateHz: 40.0,
    rampSec: 0,
    carrierHz: 220,
    depth: 0.72,
    bluetoothSafe: false,
  });

  const frames = 128 * 1034; // ~3.00s @ 44.1 kHz
  const outL = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    synth.process([], [[oL, oR]]);
    outL.set(oL, off);
  }

  const start = Math.round(0.5 * sr);
  let sumSq = 0;
  let peak = 0;
  const rect = new Float32Array(frames - start);
  let rectMean = 0;
  for (let i = start; i < frames; i++) {
    const v = outL[i];
    sumSq += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
    rect[i - start] = v * v;
    rectMean += v * v;
  }
  rectMean /= rect.length;
  const rectWin = new Float32Array(rect.length);
  for (let i = 0; i < rect.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (rect.length - 1)));
    rectWin[i] = (rect[i] - rectMean) * w;
  }
  const rms = Math.sqrt(sumSq / rect.length);
  const crestDb = db(peak / rms);
  assert.ok(crestDb < 10.5, `Expected comfortable Gamma-MBI crest factor < 10.5 dB, got ${crestDb.toFixed(2)} dB`);

  const m40 = goertzelMag(rectWin, sr, 40.0);
  const mDetune = Math.max(goertzelMag(rectWin, sr, 39.0), goertzelMag(rectWin, sr, 41.0));
  assert.ok(m40 > mDetune * 6.0, `Expected sharp 40.000 Hz peak @ 44.1 kHz: m40=${m40.toFixed(4)} vs ±1 Hz=${mDetune.toFixed(4)}`);

  // Verify Bluetooth-safe click guard widens burst pulse >= 2.2x over 1.2 ms raw clicks (>= 3.0 ms envelope support)
  const synthBt = new SynthCtor();
  synthBt.port._deliver({
    type: 'config',
    mode: 'gamma_clicks',
    rateHz: 40.0,
    carrierHz: 1200,
    dutyCycle: 0.048,
    bluetoothSafe: true,
  });
  const synthRaw = new SynthCtor();
  synthRaw.port._deliver({
    type: 'config',
    mode: 'gamma_clicks',
    rateHz: 40.0,
    carrierHz: 1200,
    dutyCycle: 0.048,
    bluetoothSafe: false,
  });
  const btFrames = 128 * 120;
  const btOut = new Float32Array(btFrames);
  const rawClickOut = new Float32Array(btFrames);
  for (let off = 0; off < btFrames; off += 128) {
    const oBt = new Float32Array(128);
    const oRaw = new Float32Array(128);
    synthBt.process([], [[oBt, new Float32Array(128)]]);
    synthRaw.process([], [[oRaw, new Float32Array(128)]]);
    btOut.set(oBt, off);
    rawClickOut.set(oRaw, off);
  }
  // Compare smoothed burst support (sliding 0.45 ms peak envelope > 0.02) in steady tail
  const measureSupportMs = (buf) => {
    const wHalf = 10;
    const startIdx = btFrames - Math.round(0.4 * sr);
    let active = 0;
    for (let i = startIdx; i < btFrames - wHalf; i++) {
      let pk = 0;
      for (let j = -wHalf; j <= wHalf; j++) {
        const a = Math.abs(buf[i + j]);
        if (a > pk) pk = a;
      }
      if (pk > 0.02) active++;
    }
    const frac = active / (btFrames - wHalf - startIdx);
    return frac * 25.0; // per 25 ms cycle at 40 Hz
  };
  const rawSupportMs = measureSupportMs(rawClickOut);
  const btSupportMs = measureSupportMs(btOut);
  assert.ok(
    btSupportMs >= 2.8 && btSupportMs > rawSupportMs * 1.8,
    `Bluetooth-safe click width too narrow: bt=${btSupportMs.toFixed(2)} ms vs raw=${rawSupportMs.toFixed(2)} ms`
  );

  // Verify +-30 Hz peaking notch (-28 dB @ 220 Hz, Q = max(5.0, 220/28)) attenuates 220 Hz >= 18 dB while leaving 440 Hz clean (<1.5 dB)
  const w0 = (2 * Math.PI * 220) / 48000;
  const A = Math.pow(10, -28 / 40);
  const q = Math.max(5.0, 220 / 28);
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = 1 + alpha * A, b1 = -2 * Math.cos(w0), b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A, a1 = -2 * Math.cos(w0), a2 = 1 - alpha / A;
  const testTone = (f) => {
    const n = 9600;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    let inSq = 0, outSq = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * f * i) / 48000);
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (i >= 4800) { inSq += x * x; outSq += y * y; }
    }
    return 10 * Math.log10(outSq / inSq);
  };
  const gain220 = testTone(220);
  const gain440 = testTone(440);
  assert.ok(gain220 <= -18.0, `Expected <= -18 dB notch @ 220 Hz, got ${gain220.toFixed(2)} dB`);
  assert.ok(Math.abs(gain440) < 1.5, `Notch spilled into 440 Hz octave: ${gain440.toFixed(2)} dB`);
});

test('11. v7 Mastering: ITU-R BS.1770-4 48-tap Kaiser ISP brickwall (-1.0 dBTP) & EBU Tech 3341 LUFS calibration (44.1/48 kHz)', () => {
  for (const sr of [44100, 48000]) {
    const reg = loadWorkletProcessors(sr);
    const LimCtor = reg.get('nootropic-lookahead-limiter');
    const limMono = new LimCtor();
    const limStereo = new LimCtor();
    const params = { ceiling: new Float32Array([LIMITER_CEILING_LINEAR]) };

    // -2.0 dBFS 1 kHz reference sine stays below -1.0 dBTP limiter ceiling -> exact EBU Tech 3341 meter calibration
    const amp = Math.pow(10, -2.0 / 20); // 0.794328
    const frames = 128 * Math.ceil((1.2 * sr) / 128);
    const zeros = new Float32Array(128);
    for (let off = 0; off < frames; off += 128) {
      const iL = new Float32Array(128);
      for (let k = 0; k < 128; k++) iL[k] = amp * Math.sin((2 * Math.PI * 1000 * (off + k)) / sr);
      limMono.process([[iL, zeros]], [[new Float32Array(128), new Float32Array(128)]], params);
      limStereo.process([[iL, iL]], [[new Float32Array(128), new Float32Array(128)]], params);
    }
    const lastMono = limMono.port._outbox.filter((m) => m.type === 'meter').at(-1);
    const lastStereo = limStereo.port._outbox.filter((m) => m.type === 'meter').at(-1);
    assert.ok(lastMono && lastStereo, `Expected ITU-R BS.1770-4 meter output @ ${sr} Hz`);
    assert.ok(
      Math.abs(lastMono.momentaryLufs - -5.01) < 0.15,
      `EBU 1 kHz mono LUFS @ ${sr} Hz expected -5.01, got ${lastMono.momentaryLufs.toFixed(3)}`
    );
    assert.ok(
      Math.abs(lastStereo.momentaryLufs - -2.0) < 0.15,
      `EBU 1 kHz stereo LUFS @ ${sr} Hz expected -2.00, got ${lastStereo.momentaryLufs.toFixed(3)}`
    );
  }
});

test('12. v7 Headphone Verification: Huggins Pitch 600 Hz dichotic 180 deg phase shift vs flat magnitude & mono null', () => {
  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const HugCtor = reg.get('nootropic-huggins-processor');
  assert.ok(HugCtor, 'nootropic-huggins-processor must be registered');

  // Non-target round: strictly identical L == R
  const hugCtrl = new HugCtor();
  hugCtrl.port._deliver({ type: 'play', isTarget: false, durationMs: 600 });
  const ctrlFrames = 128 * 240;
  let maxCtrlDiff = 0;
  for (let off = 0; off < ctrlFrames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    hugCtrl.process([], [[oL, oR]]);
    for (let k = 0; k < 128; k++) maxCtrlDiff = Math.max(maxCtrlDiff, Math.abs(oL[k] - oR[k]));
  }
  assert.equal(maxCtrlDiff, 0, 'Control interval must have 0.000 interaural difference');

  // Target round: 180 deg phase flip @ 600 Hz (strong cancellation in L+R @ 600 Hz, flat |R|/|L| everywhere)
  const hugTgt = new HugCtor();
  hugTgt.port._deliver({ type: 'play', isTarget: true, durationMs: 600 });
  const tgtL = new Float32Array(ctrlFrames);
  const tgtR = new Float32Array(ctrlFrames);
  for (let off = 0; off < ctrlFrames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    hugTgt.process([], [[oL, oR]]);
    tgtL.set(oL, off);
    tgtR.set(oR, off);
  }
  const s0 = Math.round(0.15 * sr);
  const s1 = Math.round(0.45 * sr);
  const midL = tgtL.subarray(s0, s1);
  const midR = tgtR.subarray(s0, s1);
  const midSum = new Float32Array(midL.length);
  for (let i = 0; i < midL.length; i++) midSum[i] = 0.5 * (midL[i] + midR[i]);

  const cancel600Db = db(goertzelMag(midSum, sr, 600) / Math.max(1e-9, goertzelMag(midL, sr, 600)));
  const cancel1800Db = db(goertzelMag(midSum, sr, 1800) / Math.max(1e-9, goertzelMag(midL, sr, 1800)));
  const magDelta600Db = Math.abs(db(goertzelMag(midR, sr, 600) / Math.max(1e-9, goertzelMag(midL, sr, 600))));
  assert.ok(cancel600Db <= -12.0, `Expected >= 12 dB dichotic mono null @ 600 Hz, got ${cancel600Db.toFixed(2)} dB`);
  assert.ok(cancel1800Db > -1.0, `Expected near 0 dB mono delta far from 600 Hz, got ${cancel1800Db.toFixed(2)} dB`);
  assert.ok(magDelta600Db < 0.4, `All-pass filter altered magnitude @ 600 Hz by ${magDelta600Db.toFixed(3)} dB`);
});
