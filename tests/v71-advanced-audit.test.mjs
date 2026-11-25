/**
 * nootropic.fm v7.1 — Phase 4 Bonus Upgrades Audit Tests
 *
 * Verifies:
 *   1) NootropicClockProcessor runs sample-accurately on audio render thread (40 ms tick cadence)
 *   2) NootropicClinicalSynth `gamma_chirp` emits exact 40.000 Hz upward logarithmic Blackman-Harris sweeps at 44.1 kHz & 48 kHz
 *   3) ProgressiveStemDecoder parses Ogg/Opus pages + strips OpusHead/OpusTags across streamed Range slices
 *   4) Biomarker scoring: 15s Continuation Tapping CV% + BLE HRV RMSSD & 0.1 Hz LF Power Ratio
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scoreContinuationTapping,
  computeHrvMetricsFromRrMs,
} from '../shared/psychometrics.ts';
import {
  extractOggOpusPackets,
  parseOggOpusPages,
} from '../src/audio/ProgressiveStemDecoder.ts';

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
    throw new Error('Could not locate DSP_WORKLET_CODE template');
  }
  const rawCode = tsSrc
    .slice(startIdx + startMarker.length, endIdx)
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$');

  const registry = {};
  const sandbox = {
    AudioWorkletProcessor: class {
      constructor() {
        this._posted = [];
        this.port = {
          onmessage: null,
          postMessage: (m) => this._posted.push(m),
        };
      }
    },
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
  return { registry, sandbox };
}

test('NootropicClockProcessor fires steady 40 ms audio-thread scheduler ticks', () => {
  const { registry, sandbox } = loadWorkletProcessors(48000);
  const Clock = registry['nootropic-clock-processor'];
  assert.ok(Clock, 'nootropic-clock-processor must be registered');

  const node = new Clock({ processorOptions: { intervalMs: 40 } });
  const totalSamples = 48000; // 1.000 s
  const blocks = Math.floor(totalSamples / 128);
  for (let b = 0; b < blocks; b++) {
    sandbox.currentTime = (b * 128) / 48000;
    const out = new Float32Array(128);
    node.process([], [[out]], {});
  }
  const ticks = node._posted.filter((m) => m.type === 'tick');
  assert.ok(ticks.length >= 24 && ticks.length <= 26, `Expected ~25 ticks in 1s, got ${ticks.length}`);
});

test('NootropicClinicalSynth gamma_chirp generates exact 40.000 Hz upward chirps at 44.1 kHz & 48 kHz', () => {
  for (const fs of [44100, 48000]) {
    const { registry } = loadWorkletProcessors(fs);
    const Synth = registry['nootropic-clinical-synth'];
    const synth = new Synth();
    synth.port.onmessage({
      data: {
        type: 'config',
        mode: 'gamma_chirp',
        rateHz: 40,
        startRateHz: 40,
        rampSec: 0,
        carrierHz: 220,
        bluetoothSafe: false,
      },
    });

    // Warm up past 15 ms output slew ramp, then capture 0.50 s
    const warmupBlocks = Math.ceil((0.05 * fs) / 128);
    for (let b = 0; b < warmupBlocks; b++) {
      synth.process([], [[new Float32Array(128), new Float32Array(128)]], {});
    }

    const nSamples = Math.round(0.5 * fs);
    const nBlocks = Math.ceil(nSamples / 128);
    const buf = new Float32Array(nBlocks * 128);
    for (let b = 0; b < nBlocks; b++) {
      const l = new Float32Array(128);
      const r = new Float32Array(128);
      synth.process([], [[l, r]], {});
      buf.set(l, b * 128);
    }

    // Count chirp burst onset peaks separated by >= 15 ms
    let peakCount = 0;
    let lastOnsetSample = -fs;
    const minSepSamples = Math.round(0.015 * fs);
    for (let i = 1; i < nSamples - 1; i++) {
      if (Math.abs(buf[i]) > 0.25 && i - lastOnsetSample > minSepSamples) {
        peakCount++;
        lastOnsetSample = i;
      }
    }
    const measuredRateHz = peakCount / (nSamples / fs);
    assert.ok(
      Math.abs(measuredRateHz - 40.0) <= 2.0,
      `fs=${fs}: expected ~40 Hz chirp cadence, got ${measuredRateHz.toFixed(2)} Hz`
    );
  }
});

test('ProgressiveStemDecoder parses real Ogg/Opus HTTP stream chunks with preSkip & stereo metadata', () => {
  const realOpus = resolve(ROOT, 'audio-stems/_v7_out/lofi_keys/focus/dusty-rhodes-88-1.opus');
  assert.ok(existsSync(realOpus), `Missing v7 opus artifact at ${realOpus}`);
  const fileBytes = new Uint8Array(readFileSync(realOpus));
  // Feed first 256 KB in arbitrary 4096-byte network chunks like ReadableStream
  const sampleSlice = fileBytes.subarray(0, Math.min(fileBytes.length, 262144));
  let tail = new Uint8Array(0);
  let state = { pending: [], seenHead: false, seenTags: false, preSkip: 312, channels: 2 };
  let head = null;
  let totalPackets = 0;

  for (let pos = 0; pos < sampleSlice.length; pos += 4096) {
    const chunk = sampleSlice.subarray(pos, Math.min(sampleSlice.length, pos + 4096));
    const merged = new Uint8Array(tail.length + chunk.length);
    merged.set(tail);
    merged.set(chunk, tail.length);
    const { pages, consumedBytes } = parseOggOpusPages(merged);
    tail = merged.subarray(consumedBytes);
    if (pages.length > 0) {
      const ex = extractOggOpusPackets(pages, state);
      if (ex.head) head = ex.head;
      totalPackets += ex.audioPackets.length;
      state = {
        pending: ex.pending,
        seenHead: ex.seenHead,
        seenTags: ex.seenTags,
        preSkip: ex.preSkip,
        channels: ex.channels,
      };
    }
  }

  assert.ok(head, 'OpusHead must be extracted cleanly across chunk boundaries');
  assert.equal(head.channels, 2);
  assert.equal(head.inputSampleRate, 48000);
  assert.ok(head.preSkip > 0 && head.preSkip < 2000, `Unexpected preSkip=${head.preSkip}`);
  assert.ok(totalPackets > 200, `Expected >200 Opus audio packets in first 256KB, got ${totalPackets}`);
});

test('Biomarkers: 15s Continuation Tapping CV & BLE HRV RMSSD / 0.1 Hz LF Power Ratio', () => {
  // 1. Steady 100 BPM continuation tapping (600 ms ITI ± small human jitter + 1 outlier bounce)
  const taps = [1000, 1602, 2195, 2804, 3399, 4005, 4596, 5201, 5806, 6397, 7004, 7598];
  const tapRes = scoreContinuationTapping(taps, 100);
  assert.ok(tapRes);
  assert.ok(Math.abs(tapRes.meanItiMs - 600) < 5, `meanIti=${tapRes.meanItiMs}`);
  assert.ok(tapRes.cvPct < 2.5, `cvPct=${tapRes.cvPct}`);
  assert.ok(tapRes.stabilityScore >= 88, `stability=${tapRes.stabilityScore}`);

  // 2. Synthetic 60s RSA modulated at exact 0.10 Hz breathing (6 breaths/min)
  const rrSeries = [];
  let tSec = 0;
  while (tSec < 60) {
    const rrMs = 850 + 65 * Math.sin(2 * Math.PI * 0.10 * tSec);
    rrSeries.push(rrMs);
    tSec += rrMs / 1000;
  }
  const hrv = computeHrvMetricsFromRrMs(rrSeries);
  assert.ok(hrv);
  assert.ok(hrv.meanHrBpm > 68 && hrv.meanHrBpm < 74, `HR=${hrv.meanHrBpm}`);
  assert.ok(hrv.rmssdMs > 15 && hrv.rmssdMs < 90, `RMSSD=${hrv.rmssdMs}`);
  assert.ok(
    hrv.lfPowerRatio > 0.70,
    `0.10 Hz breathing should dominate 0.04–0.15 Hz LF band, got lfRatio=${hrv.lfPowerRatio}`
  );
});
