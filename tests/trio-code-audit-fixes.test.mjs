import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { estimateAgePriorIafHz } from '../src/audio/dspMath.ts';
import * as psychometrics from '../shared/psychometrics.ts';
import { NEURAL_MICRO_STATES } from '../shared/neuralStates.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadBleHrvModule(mockNavigator) {
  const tsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/lib/bleHrv.ts'), 'utf8');
  const jsCode = ts.transpileModule(tsSrc, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const mod = { exports: {} };
  const fn = new vm.Script(
    `(function(exports, require, module, navigator) {\n${jsCode}\n})`,
    { filename: 'bleHrv.cjs' }
  ).runInThisContext();

  fn(
    mod.exports,
    (id) => {
      if (id.endsWith('psychometrics')) return psychometrics;
      throw new Error(`Unexpected require in bleHrv.ts: ${id}`);
    },
    mod,
    mockNavigator
  );
  return mod.exports;
}

test('estimateAgePriorIafHz maps canonical hyphenated AgeBand values and legacy aliases accurately', () => {
  assert.equal(estimateAgePriorIafHz('18-24'), 10.5);
  assert.equal(estimateAgePriorIafHz('25-34'), 10.0);
  assert.equal(estimateAgePriorIafHz('35-44'), 10.0);
  assert.equal(estimateAgePriorIafHz('45-54'), 9.5);
  assert.equal(estimateAgePriorIafHz('55+'), 9.0);

  // Preserve backward compatibility with legacy underscored band strings
  assert.equal(estimateAgePriorIafHz('18_29'), 10.5);
  assert.equal(estimateAgePriorIafHz('30_44'), 10.0);
  assert.equal(estimateAgePriorIafHz('45_59'), 9.5);
  assert.equal(estimateAgePriorIafHz('60_plus'), 9.0);
  assert.equal(estimateAgePriorIafHz(null), 10.0);
});

test('PsychoacousticEngine separates R2 activeTrackKey from musical activeTrackKeyLabel for bandit tracking and PlayerView display', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/audio/PsychoacousticEngine.ts'), 'utf8');
  const playerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PlayerView.tsx'), 'utf8');

  assert.match(engineSrc, /activeTrackKeyLabel\?:\s*string\s*\|\s*null;/);
  assert.match(engineSrc, /this\.activeTrackKey = track\.key;/);
  assert.match(engineSrc, /this\.activeTrackKey = opts\.track\.key;/);
  assert.match(engineSrc, /this\.activeTrackKeyLabel = track\.keyLabel \?\? null;/);
  assert.doesNotMatch(engineSrc, /this\.activeTrackKey = track\.keyLabel/);
  assert.doesNotMatch(engineSrc, /this\.activeTrackKey = opts\.track\.keyLabel/);

  // Telemetry snapshot exposes both R2 key and musical key label
  assert.match(
    engineSrc,
    /activeTrackKey:\s*this\.activeTrackKey,\s*\r?\n\s*activeTrackKeyLabel:\s*this\.activeTrackKeyLabel,/
  );

  // PlayerView passes activeTrackKey to debrief while displaying activeTrackKeyLabel in the Wave card
  assert.match(playerSrc, /activeTrackKeyRef\.current = telemetry\.activeTrackKey \?\? null;/);
  assert.match(playerSrc, /Key-locked · \{telemetry\.activeTrackKeyLabel\}/);
});

test('PlayerView preserves goal-separated neuralMemory dose, enforces Pro non-control consistency, and throttles BLE biomarker writes', () => {
  const playerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PlayerView.tsx'), 'utf8');

  assert.match(playerSrc, /preferredModMult:\s*goalModMult/);
  assert.match(playerSrc, /nowMs - lastBleBiomarkerSaveMsRef\.current >= 60_000/);

  // Ensure every engineRef.current?.start(...) in PlayerView honors `isPro ? false : recommendation.isControlTrial`
  const startCalls = playerSrc.match(/engineRef\.current\?\.start\([\s\S]*?\);/g) ?? [];
  assert.ok(startCalls.length >= 4);
  for (const call of startCalls) {
    assert.match(
      call,
      /isPro \? false : recommendation\.isControlTrial/,
      `Expected isPro non-control guard in start call: ${call}`
    );
  }
});

test('BLE HRV parser distinguishes HR-only vs genuine RR-interval packets and BleHrvMonitor never fabricates RR intervals from BPM', async () => {
  let notifyCb = null;
  const mockChar = {
    startNotifications: async () => {},
    addEventListener: (ev, cb) => {
      if (ev === 'characteristicvaluechanged') notifyCb = cb;
    },
  };
  const mockDevice = {
    name: 'Mock-Polar-H10',
    gatt: {
      connected: true,
      connect: async () => ({
        getPrimaryService: async () => ({
          getCharacteristic: async () => mockChar,
        }),
      }),
      disconnect: () => {
        mockDevice.gatt.connected = false;
      },
    },
    addEventListener: () => {},
  };
  const { parseBleHeartRateMeasurement, BleHrvMonitor } = loadBleHrvModule({
    bluetooth: {
      requestDevice: async () => mockDevice,
    },
  });

  // HR-only packet (flags=0x00, 68 BPM)
  const hrOnlyView = new DataView(new Uint8Array([0x00, 68]).buffer);
  const parsedHrOnly = parseBleHeartRateMeasurement(hrOnlyView);
  assert.equal(parsedHrOnly.hrBpm, 68);
  assert.deepEqual(parsedHrOnly.rrIntervalsMs, []);

  // HR + RR packet (flags=0x10, 62 BPM, RR=968 -> 968/1024*1000 = 945.3125 ms)
  const rrView = new DataView(new Uint8Array([0x10, 62, 0xc8, 0x03]).buffer);
  const parsedRr = parseBleHeartRateMeasurement(rrView);
  assert.equal(parsedRr.hrBpm, 62);
  assert.equal(parsedRr.rrIntervalsMs.length, 1);
  assert.ok(Math.abs(parsedRr.rrIntervalsMs[0] - (968 / 1024) * 1000) < 0.01);

  // Runtime BleHrvMonitor test: 12 HR-only packets must NOT synthesize RR buffer / HRV metrics
  const updates = [];
  const mon = new BleHrvMonitor();
  const ok = await mon.connect((s) => updates.push(s));
  assert.equal(ok, true);
  assert.ok(typeof notifyCb === 'function');

  for (let i = 0; i < 12; i++) {
    notifyCb({ target: { value: new DataView(new Uint8Array([0x00, 65 + (i % 5)]).buffer) } });
  }
  let snap = updates.at(-1);
  assert.equal(snap.latestHrBpm, 66);
  assert.equal(snap.metrics, null);

  // Feeding 12 genuine RR intervals produces real RMSSD/HRV metrics
  const genuineRrs = [900, 945, 895, 955, 910, 960, 885, 940, 905, 950, 915, 965];
  for (const ms of genuineRrs) {
    const rawUnits = Math.round((ms / 1000) * 1024);
    const lo = rawUnits & 0xff;
    const hi = (rawUnits >> 8) & 0xff;
    notifyCb({ target: { value: new DataView(new Uint8Array([0x10, 64, lo, hi]).buffer) } });
  }
  snap = updates.at(-1);
  assert.ok(snap.metrics !== null);
  assert.ok(snap.metrics.rmssdMs > 20);
  mon.disconnect();
});

test('MedicalStimulusRack, LyriaRealtimeClient, and VoiceConciergePlayer maintain clean concurrency & telemetry invariants', () => {
  const rackSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/audio/MedicalStimulusRack.ts'), 'utf8');
  const lyriaSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/audio/LyriaRealtimeClient.ts'), 'utf8');
  const voiceSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/audio/VoiceConciergePlayer.ts'), 'utf8');

  assert.match(
    rackSrc,
    /this\.primaryCarrierHz = Number\(\(\(leftHz \+ rightHz\) \/ 2\)\.toFixed\(2\)\);\s*\r?\n\s*this\.beatCenterHz = this\.primaryCarrierHz;/
  );
  assert.match(rackSrc, /spec\.entrainment\.type === 'isochronic_pulse'/);

  assert.ok((lyriaSrc.match(/if \(this\.ws !== ws\) return;/g) ?? []).length >= 5);
  assert.match(lyriaSrc, /erroredBeforeSettle = true/);

  assert.match(voiceSrc, /if \(this\.bufferCache\.size >= 8\)/);
  assert.match(voiceSrc, /pendingStopTimers\.clear\(\)/);
});

test('Worker updateBanditScope replaces implicit reward cleanly, /api/audio/stream handles HTTP 416, and App wires showcase presets', () => {
  const workerSrc = fs.readFileSync(path.join(ROOT_DIR, 'worker/index.ts'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/App.tsx'), 'utf8');

  assert.match(
    workerSrc,
    /\(prevAvgReward \* prevTrials - prevR \+ opts\.reward\)\s*\/\s*Math\.max\(1,\s*newTrials\)/
  );
  assert.match(workerSrc, /opts\.mode === 'return_bonus'\s*\?\s*prevAvgReward/);
  assert.match(workerSrc, /status:\s*416/);
  assert.match(workerSrc, /content-range.*bytes \*\/\$\{/);

  assert.match(appSrc, /function buildShowcasePreset\(/);
  assert.match(appSrc, /const deepPreset = buildShowcasePreset\(deepTarget, deepDuration\)/);
  assert.match(appSrc, /const preset = buildShowcasePreset\(opts\?\.target, opts\?\.durationMin\)/);
  assert.ok(NEURAL_MICRO_STATES.some((s) => s.suggestedTarget === 'deep_flow'));
});
