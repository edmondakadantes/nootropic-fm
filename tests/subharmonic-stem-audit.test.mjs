/**
 * nootropic.fm v7.0 — Phase 3 Sub-Harmonic Stems & Direct AudioWorklet Audit Tests
 *
 * Verifies:
 *   1) All 26 core stems in STUDIO_STEM_V7_MANIFEST satisfy exact integer sub-harmonic BPM grids
 *      and dual 256 kbps / 48 kHz Opus + AAC-LC encode specs.
 *   2) NootropicStemPlayerProcessor bit-transparent 1.0x pass-through & 4-pt Hermite varispeed.
 *   3) Zero-drift sample-accurate downbeat-to-AM-crest phase alignment (< 0.25 ms across 6/10/16/40 Hz).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBHARMONIC_GRID_BPMS,
  computeDownbeatPhaseDelaySec,
  getAlignedNeuralBands,
  isExactSubHarmonic,
  pickPlaybackGridRate,
} from '../shared/subharmonicGrid.ts';
import { STUDIO_STEM_V7_MANIFEST } from '../shared/studioStemManifest.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

function loadWorkletProcessors(sampleRate = 48000) {
  const tsSrc = readFileSync(resolve(ROOT, 'src/audio/dspWorklets.ts'), 'utf8');
  const startMarker = 'export const DSP_WORKLET_CODE = `';
  const startIdx = tsSrc.indexOf(startMarker);
  const endMarker = '`;\n\nconst loadedWorkletContexts';
  const endIdx = tsSrc.indexOf(endMarker, startIdx);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('Could not locate DSP_WORKLET_CODE template in src/audio/dspWorklets.ts');
  }
  const rawCode = tsSrc
    .slice(startIdx + startMarker.length, endIdx)
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$');

  const registry = {};
  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: (msg) => {
          this._posted?.push(msg);
        },
      };
      this._posted = [];
    }
  }
  const sandbox = {
    AudioWorkletProcessor,
    sampleRate,
    currentTime: 0,
    Math,
    Float32Array,
    Float64Array,
    Int32Array,
    Uint8Array,
    Number,
    Array,
    Boolean,
    String,
    Object,
    registerProcessor: (name, cls) => {
      registry[name] = cls;
    },
  };
  vm.runInNewContext(rawCode, sandbox);
  return registry;
}

test('STUDIO_STEM_V7_MANIFEST covers all 26 stems on exact sub-harmonic grids & dual codecs', () => {
  const entries = Object.values(STUDIO_STEM_V7_MANIFEST);
  assert.equal(entries.length, 26, `Expected 26 remastered stems, got ${entries.length}`);

  const gridSet = new Set(SUBHARMONIC_GRID_BPMS);
  for (const entry of entries) {
    assert.equal(entry.sampleRate, 48000, `${entry.sourceKey} must be 48000 Hz`);
    assert.ok(entry.opusKey.startsWith('v7/') && entry.opusKey.endsWith('.opus'));
    assert.ok(entry.aacKey.startsWith('v7/') && entry.aacKey.endsWith('.m4a'));
    assert.ok(entry.opusBytes > 16384, `${entry.sourceKey} opusBytes too small`);
    assert.ok(entry.aacBytes > 16384, `${entry.sourceKey} aacBytes too small`);
    assert.ok(entry.lufs >= -15.0 && entry.lufs <= -13.0, `${entry.sourceKey} LUFS=${entry.lufs}`);
    assert.ok(entry.truePeakDbtp <= -1.4, `${entry.sourceKey} TP=${entry.truePeakDbtp}`);
    assert.ok(entry.durationSec >= 20, `${entry.sourceKey} duration=${entry.durationSec}`);

    if (entry.subHarmonicBpm > 0) {
      assert.ok(
        gridSet.has(entry.subHarmonicBpm),
        `${entry.sourceKey} BPM ${entry.subHarmonicBpm} not in SUBHARMONIC_GRID_BPMS`
      );
      const expectedBands = getAlignedNeuralBands(entry.subHarmonicBpm);
      assert.deepEqual(entry.alignedBandsHz, expectedBands);
      assert.ok(
        entry.alignedBandsHz.length >= 1,
        `${entry.sourceKey} @ ${entry.subHarmonicBpm} BPM aligns with zero neural bands`
      );
      for (const hz of entry.alignedBandsHz) {
        assert.ok(isExactSubHarmonic(entry.subHarmonicBpm, hz));
      }
      const beatMs = 60000 / entry.subHarmonicBpm;
      assert.ok(
        entry.downbeatOffsetMs >= 0 && entry.downbeatOffsetMs < beatMs,
        `${entry.sourceKey} downbeat=${entry.downbeatOffsetMs}ms outside [0, ${beatMs}ms)`
      );
    } else {
      assert.equal(entry.downbeatOffsetMs, 0);
      assert.deepEqual(entry.alignedBandsHz, []);
    }
  }
});

test('NootropicStemPlayerProcessor bit-exact 1.0x pass-through & 432 Hz Hermite cubic varispeed', () => {
  const procs = loadWorkletProcessors(48000);
  const StemPlayer = procs['nootropic-stem-player'];
  assert.ok(StemPlayer, 'nootropic-stem-player must be registered');

  // 1) Bit-exact unity check (playbackRate=1.0, 48k -> 48k)
  const unity = new StemPlayer({
    processorOptions: { sourceSampleRate: 48000, delaySamples: 0 },
  });
  const srcL = new Float32Array(2048);
  const srcR = new Float32Array(2048);
  for (let i = 0; i < srcL.length; i++) {
    srcL[i] = Math.sin(2 * Math.PI * 220 * (i / 48000)) * 0.5;
    srcR[i] = Math.cos(2 * Math.PI * 330 * (i / 48000)) * 0.5;
  }
  unity.port.onmessage({ data: { type: 'chunk', left: srcL, right: srcR } });
  unity.port.onmessage({ data: { type: 'end' } });

  let maxErr = 0;
  for (let block = 0; block < 12; block++) {
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    unity.process([], [[outL, outR]], { playbackRate: new Float32Array([1.0]) });
    for (let i = 0; i < 128; i++) {
      const idx = block * 128 + i;
      maxErr = Math.max(maxErr, Math.abs(outL[i] - srcL[idx]), Math.abs(outR[i] - srcR[idx]));
    }
  }
  assert.ok(maxErr < 1e-7, `Expected bit-exact pass-through, maxErr=${maxErr}`);

  // 2) 4-point Hermite varispeed 440 Hz -> 432 Hz check
  const varispeed = new StemPlayer({
    processorOptions: { sourceSampleRate: 48000, delaySamples: 0 },
  });
  const nFrames = 24000; // 0.5s
  const toneL = new Float32Array(nFrames);
  const toneR = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    const v = Math.sin(2 * Math.PI * 440 * (i / 48000)) * 0.7;
    toneL[i] = v;
    toneR[i] = v;
  }
  varispeed.port.onmessage({ data: { type: 'chunk', left: toneL, right: toneR } });
  varispeed.port.onmessage({ data: { type: 'end' } });

  const captured = [];
  const rate432 = 432 / 440;
  for (let b = 0; b < 150; b++) {
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    varispeed.process([], [[outL, outR]], { playbackRate: new Float32Array([rate432]) });
    for (let i = 0; i < 128; i++) captured.push(outL[i]);
  }

  // Count upward zero-crossings in steady interior region (samples 2000..18000) to verify pitch = 432 Hz
  let crossings = 0;
  let firstCross = -1;
  let lastCross = -1;
  for (let i = 2001; i < 18000; i++) {
    if (captured[i - 1] <= 0 && captured[i] > 0) {
      const frac = -captured[i - 1] / (captured[i] - captured[i - 1]);
      const exactIdx = i - 1 + frac;
      if (firstCross < 0) firstCross = exactIdx;
      else crossings++;
      lastCross = exactIdx;
    }
  }
  const estHz = (crossings * 48000) / (lastCross - firstCross);
  assert.ok(
    Math.abs(estHz - 432.0) < 0.25,
    `Expected Hermite varispeed pitch 432.0 Hz, got ${estHz.toFixed(3)} Hz`
  );
});

test('Sample-accurate downbeat-to-AM-crest phase lock (< 0.25 ms across 6, 10, 16, 40 Hz)', () => {
  const procs = loadWorkletProcessors(48000);
  const StemPlayer = procs['nootropic-stem-player'];

  for (const neuralHz of [6, 10, 16, 40]) {
    for (const downbeatMs of [0, 45.5, 130.0, 425.25]) {
      const amOriginSec = 1.2345;
      const scheduleStartSec = 18.421;
      const crestFrac = 0.25;

      const delaySec = computeDownbeatPhaseDelaySec({
        amOriginSec,
        scheduleStartSec,
        downbeatOffsetMs: downbeatMs,
        neuralHz,
        crestCycleFraction: crestFrac,
      });

      const period = 1 / neuralHz;
      assert.ok(delaySec >= 0 && delaySec < period + 1e-9);

      const delaySamples = Math.round(delaySec * 48000);
      const downbeatSample = Math.round((downbeatMs / 1000) * 48000);
      const totalLen = Math.max(4096, downbeatSample + 256);

      const impL = new Float32Array(totalLen);
      const impR = new Float32Array(totalLen);
      impL[downbeatSample] = 1.0;
      impR[downbeatSample] = 1.0;

      const node = new StemPlayer({
        processorOptions: { sourceSampleRate: 48000, delaySamples },
      });
      node.port.onmessage({ data: { type: 'chunk', left: impL, right: impR } });
      node.port.onmessage({ data: { type: 'end' } });

      let impulseOutSample = -1;
      const maxBlocks = Math.ceil((delaySamples + totalLen) / 128) + 2;
      for (let b = 0; b < maxBlocks && impulseOutSample < 0; b++) {
        const outL = new Float32Array(128);
        const outR = new Float32Array(128);
        node.process([], [[outL, outR]], { playbackRate: new Float32Array([1.0]) });
        for (let i = 0; i < 128; i++) {
          if (outL[i] > 0.9) {
            impulseOutSample = b * 128 + i;
            break;
          }
        }
      }
      assert.ok(impulseOutSample >= 0, `Downbeat impulse never exited for ${neuralHz}Hz/${downbeatMs}ms`);

      const actualBeatSec = scheduleStartSec + impulseOutSample / 48000;
      const phaseCycles = (actualBeatSec - amOriginSec) * neuralHz - crestFrac;
      const cycleErr = Math.abs(phaseCycles - Math.round(phaseCycles));
      const errMs = (cycleErr / neuralHz) * 1000;
      assert.ok(
        errMs < 0.25,
        `${neuralHz} Hz / ${downbeatMs} ms phase error=${errMs.toFixed(4)} ms (>= 0.25 ms)`
      );
    }
  }

  // Also check pickPlaybackGridRate snaps cleanly onto active neural bands
  const r1 = pickPlaybackGridRate(96, 16, 1.0);
  assert.equal(r1.tempoScale, 1.0);
  assert.equal(r1.isSubHarmonicLocked, true);

  const r2 = pickPlaybackGridRate(100, 10, 432 / 440);
  assert.equal(r2.tempoScale, 1.0);
  assert.ok(Math.abs(r2.totalRate - 432 / 440) < 1e-6);
  assert.equal(r2.isSubHarmonicLocked, true);
});
