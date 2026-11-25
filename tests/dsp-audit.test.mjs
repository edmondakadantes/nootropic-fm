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
  computeExactAmGainPair,
  computeParabolicPeakHz,
  computePeriodicWaveStats,
  createSilentKeepAliveWavBytes,
  normalizeStereoBufferRms,
} from '../src/audio/dspMath.ts';
import { DSP_WORKLET_CODE } from '../src/audio/dspWorklets.ts';

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
    Int32Array,
    Uint8Array,
    Number,
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

  // Brickwall ceiling -0.80 dBFS
  assert.ok(Math.abs(db(LIMITER_CEILING_LINEAR) - LIMITER_CEILING_DBFS) < 1e-9);

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

  // Silent keepalive WAV: sample-rate parity, zero DC, -90.3 dBFS
  for (const wavRate of [44100, 48000]) {
    const wav = createSilentKeepAliveWavBytes(wavRate);
    const dv = new DataView(wav.buffer);
    assert.equal(dv.getUint32(24, true), wavRate);
    assert.equal(wav.byteLength, 44 + wavRate * 4);
    let dcSum = 0;
    let maxAbs = 0;
    for (let i = 0; i < wavRate; i++) {
      const l = dv.getInt16(44 + i * 4, true);
      const r = dv.getInt16(44 + i * 4 + 2, true);
      assert.equal(l, r);
      dcSum += l;
      if (Math.abs(l) > maxAbs) maxAbs = Math.abs(l);
    }
    assert.equal(dcSum, 0, 'Keepalive WAV must have exact zero DC offset');
    assert.equal(maxAbs, 1, 'Keepalive WAV must stay at +-1 LSB (-90.3 dBFS)');
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

    // Verify no RMS energy dip at loop head seam (first 1024 frames vs body)
    let headSq = 0;
    for (let i = 0; i < 1024; i++) headSq += l[i] * l[i] + r[i] * r[i];
    const headRms = Math.sqrt(headSq / 2048);
    const bodyRms = rms;
    assert.ok(
      Math.abs(db(headRms) - db(bodyRms)) < 2.0,
      `Noise ${color} seam head RMS dip detected: head=${headRms.toFixed(4)} vs body=${bodyRms.toFixed(4)}`
    );
  }

  // Verify periodic pulse buffer loop seam continuity at fractional Hz (e.g. Schumann 7.83 Hz + 40 Hz GENUS)
  for (const cfg of [
    { pulseRateHz: 40, carrierHz: 440, dutyCycle: 0.04, mode: 'gamma_click' },
    { pulseRateHz: 7.83, carrierHz: 256, dutyCycle: 0.5, mode: 'isochronic' },
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
});

test('3. AudioWorklet DSP: Lookahead Limiter brickwall 0.000 dB overshoot + 0% THD below ceiling', () => {
  const reg = loadWorkletProcessors(48000);
  const LimiterCtor = reg.get('nootropic-lookahead-limiter');
  assert.ok(LimiterCtor, 'nootropic-lookahead-limiter must be registered');
  const lim = new LimiterCtor();
  const params = { ceiling: new Float32Array([LIMITER_CEILING_LINEAR]) };

  // Sub-ceiling pure 1 kHz sine (0.85 < 0.912) -> must pass with zero nonlinear distortion!
  const subFrames = 128 * 38; // 4864 frames (~101 ms, exact 128-frame worklet blocks)
  const inL = new Float32Array(subFrames);
  const inR = new Float32Array(subFrames);
  const outL = new Float32Array(subFrames);
  const outR = new Float32Array(subFrames);
  for (let i = 0; i < subFrames; i++) {
    inL[i] = 0.85 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
    inR[i] = 0.85 * Math.cos((2 * Math.PI * 1000 * i) / 48000);
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

  // Also verify NootropicEnvFollower RMS tracking convergence in Node worklet thread
  const EnvCtor = reg.get('nootropic-env-follower');
  assert.ok(EnvCtor, 'nootropic-env-follower must be registered');
  const envNode = new EnvCtor();
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
  const expectedRms = 0.25 * Math.SQRT1_2;
  assert.ok(Math.abs(lastRms - expectedRms) < 0.004, `Env follower RMS expected ${expectedRms.toFixed(4)}, got ${lastRms.toFixed(4)}`);
});

test('7. Real Headless Chromium (OfflineAudioContext + AudioWorklet) Full LR4 + Crossfeed + Limiter Proof', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found on host');
    return;
  }

  const testHtml = `<!doctype html><html><body><script type="module">
const BUTTERWORTH_LP_HP_Q_DB = ${BUTTERWORTH_LP_HP_Q_DB};
const LIMITER_CEILING_LINEAR = ${LIMITER_CEILING_LINEAR};
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

  return {
    brokenMaxAbsDb: brokenLr4.maxAbsDb,
    fixedMaxAbsDb: fixedLr4.maxAbsDb,
    fixedErrs: fixedLr4.errs,
    limiterMaxPeak: maxPeak,
    ceiling: LIMITER_CEILING_LINEAR,
    monoDiff: maxMonoDiff,
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
        timeoutId = setTimeout(() => rej(new Error('Chromium Web Audio timeout')), 20000);
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
  const { brokenMaxAbsDb, fixedMaxAbsDb, limiterMaxPeak, ceiling, monoDiff } = payload.res;
  assert.ok(brokenMaxAbsDb > 6.5, `Sanity check failed: old SQRT1_2 Q expected >6.5 dB hump, got ${brokenMaxAbsDb}`);
  assert.ok(fixedMaxAbsDb < 0.08, `Chromium LR4 with BUTTERWORTH_LP_HP_Q_DB deviated ${fixedMaxAbsDb.toFixed(4)} dB`);
  assert.ok(limiterMaxPeak <= ceiling + 1e-5, `Chromium limiter overshot ceiling: ${limiterMaxPeak} > ${ceiling}`);
  assert.ok(monoDiff < 1e-6, `Chromium crossfeed + limiter stereo mono symmetry error: ${monoDiff}`);
});
