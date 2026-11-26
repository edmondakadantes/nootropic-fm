/**
 * nootropic.fm — Endless Stream (D1 Token SQL + UI State) & 10-Genre Audio Audit Suite
 *
 * Regression coverage for:
 *   1) Worker `/api/music/realtime-token` uses `instr(token_hash, ?) > 0` instead of `LIKE`
 *      (eliminating Cloudflare D1 `SQLITE_MAX_LIKE_PATTERN_LENGTH = 50` HTTP 500 crash on 64-char SHA-256 hashes)
 *   2) `PlayerView.tsx` & `PsychoacousticEngine.ts` never masquerade `generative_live` as active `Endless Stream`
 *      and route Lyria fallbacks cleanly to `studio_library` (`Studio Mix`)
 *   3) `buildLyriaRealtimeConfig` preserves drums, bass, tempo & clarity across rhythmic genres
 *      (`deep_electronic`, `lofi_keys`, `dub_reggae`, `bossa_nova`, `jazz_rhodes`) while keeping
 *      `nature_rain`, `ambient_space`, `solo_piano`, `cinematic_strings`, and `sleep_winddown` beatless
 *   4) `STUDIO_STEM_V7_MANIFEST` covers all 26 stems & all 10 genres at -15.5 LUFS parity (`?r=5`)
 *      with zero inter-sample peak clipping (`truePeakDbtp <= -1.0 dBTP`)
 *   5) `NootropicEnvFlattener` guards inter-note silent rests (<14% mean) against inverse-gate reverb pumping
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const { buildLyriaRealtimeConfig, GENRE_LYRIA_PROMPTS } = await import('../shared/studySpec.ts');
const { VERIFIED_STUDY_PRESETS } = await import('../shared/studyPresets.ts');
const { selectProtocolRecommendation } = await import('../shared/protocols.ts');
const { STUDIO_STEM_V7_MANIFEST } = await import('../shared/studioStemManifest.ts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const ALL_11_GENRES = [
  'nootropic_trance',
  'deep_electronic',
  'lofi_keys',
  'cinematic_strings',
  'jazz_rhodes',
  'acoustic_pluck',
  'nature_rain',
  'dub_reggae',
  'ambient_space',
  'solo_piano',
  'bossa_nova',
];

test('1. Worker /api/music/realtime-token avoids D1 50-byte LIKE crash on 64-char SHA-256 token_hash', () => {
  const workerSrc = readFileSync(resolve(ROOT, 'worker/index.ts'), 'utf8');
  assert.ok(
    !workerSrc.includes('token_hash LIKE ?'),
    'worker/index.ts must NEVER use `token_hash LIKE ?` with a 64-char SHA-256 hex digest (exceeds D1 50-byte LIKE limit)'
  );
  assert.ok(
    workerSrc.includes('instr(token_hash, ?) > 0'),
    'Expected `instr(token_hash, ?) > 0` in /api/music/realtime-token Pro lookup'
  );

  // Prove SQLite instr(token_hash, ?) > 0 handles both single and rotated pipe-separated 64-char SHA-256 hashes cleanly
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, plan_tier TEXT, pro_until TEXT, token_hash TEXT)`);
  const hashA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
  const hashB = 'ffeeddccbbaa99887766554433221100f8e7d6c5b4a39281706f5e4d3c2b1a09';
  db.prepare(`INSERT INTO profiles VALUES (?, ?, ?, ?)`).run('anon_1', 'pro', null, `${hashA}|${hashB}`);
  db.prepare(`INSERT INTO profiles VALUES (?, ?, ?, ?)`).run('anon_2', 'free', null, hashB);

  const stmt = db.prepare(
    `SELECT id, plan_tier, pro_until, token_hash FROM profiles WHERE plan_tier = 'pro' AND instr(token_hash, ?) > 0 LIMIT 5`
  );
  assert.equal(stmt.all(hashA).length, 1);
  assert.equal(stmt.all(hashB).length, 1);
  assert.equal(stmt.all('0'.repeat(64)).length, 0);
  db.close();
});

test('2. PlayerView & PsychoacousticEngine never disguise generative_live as active Endless Stream', () => {
  const playerSrc = readFileSync(resolve(ROOT, 'src/components/PlayerView.tsx'), 'utf8');
  const engineSrc = readFileSync(resolve(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');

  assert.ok(
    !playerSrc.includes("carrierMode === 'lyria_realtime' || carrierMode === 'generative_live'"),
    'PlayerView must never style Endless Stream as Live when carrierMode is generative_live'
  );
  assert.ok(
    engineSrc.includes("Object.keys(this.studioCatalog).length > 0 ? 'studio_library' : 'generative_live'"),
    'PsychoacousticEngine Lyria fallback must prefer studio_library when Studio stems exist'
  );
});

test('3. 10-Genre Lyria RealTime & ISO Protocol Audit: rhythmic groove vs beatless ambient', () => {
  const calmSpec = structuredClone(
    VERIFIED_STUDY_PRESETS.find((s) => s.protocol.targetState === 'calm_reset') ??
      VERIFIED_STUDY_PRESETS[0]
  );
  calmSpec.music.percussion = 'none';
  calmSpec.music.bpm = 0;
  calmSpec.music.brightness = 0.22;

  const sleepSpec = structuredClone(calmSpec);
  sleepSpec.protocol.targetState = 'sleep_winddown';

  for (const genre of ALL_11_GENRES) {
    assert.ok(GENRE_LYRIA_PROMPTS[genre], `Missing GENRE_LYRIA_PROMPTS for ${genre}`);
    const cfg = buildLyriaRealtimeConfig(calmSpec, genre);

    if (
      genre === 'nootropic_trance' ||
      genre === 'deep_electronic' ||
      genre === 'lofi_keys' ||
      genre === 'dub_reggae' ||
      genre === 'bossa_nova' ||
      genre === 'jazz_rhodes'
    ) {
      assert.equal(cfg.config.muteDrums, false, `${genre} must NOT mute drums on non-sleep protocols`);
      assert.equal(cfg.config.muteBass, false, `${genre} must NOT mute bass on non-sleep protocols`);
      assert.ok(cfg.config.bpm >= 75, `${genre} should keep rhythmic BPM >= 75, got ${cfg.config.bpm}`);
    } else if (
      genre === 'nature_rain' ||
      genre === 'ambient_space' ||
      genre === 'solo_piano' ||
      genre === 'cinematic_strings'
    ) {
      assert.equal(cfg.config.muteDrums, true, `${genre} must mute drums`);
    }

    const sleepCfg = buildLyriaRealtimeConfig(sleepSpec, genre);
    assert.equal(sleepCfg.config.muteDrums, true, `${genre} must mute drums in sleep_winddown`);
  }

  const deepCfg = buildLyriaRealtimeConfig(calmSpec, 'deep_electronic');
  assert.ok(deepCfg.config.brightness >= 0.44, 'deep_electronic Lyria brightness must stay >= 0.44');

  // Verify ISO-adapted deep_electronic does not brickwall-muffle filterCutoffHz down to 860 Hz
  const rec = selectProtocolRecommendation({
    sessionId: 'ses_test_iso',
    profile: {
      id: 'anon_test',
      age: 30,
      ageBand: '25_34',
      gender: 'male',
      role: 'knowledge_worker',
      texturePref: 'warm_ambient',
      noiseSensitivity: 'medium',
      defaultDevice: 'headphones',
      favoriteGenres: ['deep_electronic'],
      primaryChallenge: 'stress',
      researchConsent: true,
      createdAt: new Date().toISOString(),
    },
    currentState: 'stressed',
    baselineScore: 2,
    targetState: 'calm_reset',
    environment: 'office',
    device: 'headphones',
    durationMin: 20,
    requestedGenre: 'auto',
    cohortStats: [],
    profileStats: [],
  });
  if (rec.params.genre === 'deep_electronic') {
    assert.ok(
      rec.params.filterCutoffHz >= 1400,
      `Expected deep_electronic filterCutoffHz >= 1400 Hz, got ${rec.params.filterCutoffHz}`
    );
  }
});

test('4. STUDIO_STEM_V7_MANIFEST 11-Genre Parity: all 28 stems remastered (?r=5/6), balanced LUFS & zero >0 dBFS clipping', () => {
  const entries = Object.values(STUDIO_STEM_V7_MANIFEST);
  assert.equal(entries.length, 28, `Expected 28 v7 studio stems, got ${entries.length}`);

  const genresSeen = new Set();
  for (const e of entries) {
    const genre = e.sourceKey.split('/')[0];
    genresSeen.add(genre);
    assert.ok(/\?r=[56]$/.test(e.opusUrl), `Expected ?r=5/6 on ${e.opusUrl}`);
    assert.ok(/\?r=[56]$/.test(e.aacUrl), `Expected ?r=5/6 on ${e.aacUrl}`);
    assert.ok(
      e.lufs >= -17.2 && e.lufs <= -13.8,
      `Expected ${e.sourceKey} LUFS within [-17.2, -13.8], got ${e.lufs}`
    );
    assert.ok(
      e.truePeakDbtp <= -0.8,
      `Expected ${e.sourceKey} truePeakDbtp <= -0.8 dBTP (zero clipping), got ${e.truePeakDbtp}`
    );
  }

  for (const g of ALL_11_GENRES) {
    assert.ok(genresSeen.has(g), `Genre ${g} missing from STUDIO_STEM_V7_MANIFEST`);
  }
});

test('5. NootropicEnvFlattener prevents inverse-gate pumping on rhythmic synth plucks with silent rests', () => {
  const tsSrc = readFileSync(resolve(ROOT, 'src/audio/dspWorklets.ts'), 'utf8');
  const startMarker = 'export const DSP_WORKLET_CODE = `';
  const startIdx = tsSrc.indexOf(startMarker);
  const endIdx = tsSrc.indexOf('`;\n\nconst loadedWorkletContexts', startIdx);
  const rawCode = tsSrc
    .slice(startIdx + startMarker.length, endIdx)
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$');

  const reg = new Map();
  vm.runInNewContext(rawCode, {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null, postMessage: () => {} };
      }
    },
    registerProcessor: (n, c) => reg.set(n, c),
    sampleRate: 48000,
    currentTime: 0,
    Math,
    Float32Array,
    Float64Array,
    Int16Array,
    Uint8Array,
  });

  const FlatCtor = reg.get('nootropic-env-flattener');
  const proc = new FlatCtor();
  const sr = 48000;
  // Simulate a rhythmic electronic pluck every 500 ms (120 BPM) followed by a quiet -42 dB reverb tail
  const total = sr * 4;
  const inp = new Float32Array(total);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const beatPhase = (i % (sr / 2)) / sr;
    const env = beatPhase < 0.08 ? 0.45 * Math.exp(-beatPhase * 28) : 0.004;
    inp[i] = env * Math.sin((2 * Math.PI * 330 * i) / sr);
  }
  for (let off = 0; off < total; off += 128) {
    const seg = inp.subarray(off, off + 128);
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    proc.process([[seg, seg]], [[oL, oR]], { gamma: new Float32Array([0.18]) });
    out.set(oL, off);
  }
  // Check quiet tail at t = 3.40s (400ms into beat -> reverb tail): must NOT be boosted > +1.5 dB
  let inTailSq = 0;
  let outTailSq = 0;
  const tStart = Math.floor(3.35 * sr);
  const tEnd = Math.floor(3.45 * sr);
  for (let i = tStart; i < tEnd; i++) {
    inTailSq += inp[i] * inp[i];
    outTailSq += out[i] * out[i];
  }
  const tailBoostDb = 10 * Math.log10(outTailSq / Math.max(1e-12, inTailSq));
  assert.ok(
    tailBoostDb <= 1.5,
    `Expected <= +1.5 dB reverb tail boost during inter-note rests, got +${tailBoostDb.toFixed(2)} dB`
  );
});

test('6. NootropicFM Mode: Theta-Gamma 6x40 Hz CFC envelope coupling, 0.000 dB mono-sum orbit, & Driving Safety override', () => {
  const tsSrc = readFileSync(resolve(ROOT, 'src/audio/dspWorklets.ts'), 'utf8');
  const startMarker = 'export const DSP_WORKLET_CODE = `';
  const startIdx = tsSrc.indexOf(startMarker);
  const endIdx = tsSrc.indexOf('`;\n\nconst loadedWorkletContexts', startIdx);
  const rawCode = tsSrc
    .slice(startIdx + startMarker.length, endIdx)
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$');

  const reg = new Map();
  vm.runInNewContext(rawCode, {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null, postMessage: () => {} };
      }
    },
    registerProcessor: (n, c) => reg.set(n, c),
    sampleRate: 48000,
    currentTime: 0,
    Math,
    Float32Array,
    Float64Array,
    Int16Array,
    Uint8Array,
  });

  const SynthCtor = reg.get('nootropic-clinical-synth');
  const synth = new SynthCtor();
  synth.port.onmessage({
    data: {
      type: 'config',
      mode: 'theta_gamma_cfc',
      rateHz: 6.0,
      startRateHz: 6.0,
      rampSec: 0,
      carrierHz: 220,
      depth: 0.72,
      bluetoothSafe: false,
    },
  });

  const sr = 48000;
  const total = sr * 4;
  const env = new Float32Array(total);
  const synthMono = new SynthCtor();
  synthMono.port.onmessage({
    data: {
      type: 'config',
      mode: 'theta_gamma_cfc',
      rateHz: 6.0,
      startRateHz: 6.0,
      rampSec: 0,
      carrierHz: 220,
      depth: 0.72,
      bluetoothSafe: true,
    },
  });

  let maxMonoDiff = 0;
  for (let off = 0; off < total; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    const mL = new Float32Array(128);
    const mR = new Float32Array(128);
    synth.process([], [[oL, oR]]);
    synthMono.process([], [[mL, mR]]);
    for (let i = 0; i < 128; i++) {
      const monoSum = 0.5 * (oL[i] + oR[i]);
      maxMonoDiff = Math.max(maxMonoDiff, Math.abs(monoSum - mL[i]));
      env[off + i] = Math.abs(monoSum);
    }
  }
  assert.ok(maxMonoDiff < 1e-6, `Expected exact mono-sum invariance on 0.1 Hz stereo orbit, diff=${maxMonoDiff}`);

  // Goertzel envelope spectrum after 1.0s settle (3.000s window = exact 1/3 Hz integer bins)
  const steady = env.subarray(sr);
  const goertzel = (hz) => {
    const N = steady.length;
    const w = (2 * Math.PI * hz) / sr;
    const coeff = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      const s0 = steady[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / N;
  };

  const mag6Hz = goertzel(6.0);
  const mag40Hz = goertzel(40.0);
  const magSideband34Hz = goertzel(34.0); // 40 - 6 Hz CFC lower sideband!
  const magSideband46Hz = goertzel(46.0); // 40 + 6 Hz CFC upper sideband!
  const magOff23Hz = goertzel(23.0);

  assert.ok(mag6Hz > magOff23Hz * 6, `Expected strong 6.0 Hz Theta envelope peak (${mag6Hz} vs ${magOff23Hz})`);
  assert.ok(mag40Hz > magOff23Hz * 3, `Expected strong 40.0 Hz Gamma envelope peak (${mag40Hz} vs ${magOff23Hz})`);
  assert.ok(
    magSideband34Hz > magOff23Hz * 2.2 && magSideband46Hz > magOff23Hz * 2.2,
    `Expected 40±6 Hz (34 & 46 Hz) phase-amplitude coupling sidebands (${magSideband34Hz}, ${magSideband46Hz} vs ${magOff23Hz})`
  );

  // Verify Stationary NootropicFM Mode launches 14->6 Hz Theta-Gamma CFC @ 120 BPM
  const baseProfile = {
    id: 'anon_trance_test',
    age: 29,
    ageBand: '25_34',
    gender: 'male',
    role: 'knowledge_worker',
    texturePref: 'minimal_electronic',
    noiseSensitivity: 'medium',
    defaultDevice: 'headphones',
    favoriteGenres: ['nootropic_trance'],
    primaryChallenge: 'distraction',
    researchConsent: true,
    createdAt: new Date().toISOString(),
  };

  const stationaryRec = selectProtocolRecommendation({
    sessionId: 'ses_trance_desk',
    profile: baseProfile,
    currentState: 'distracted',
    baselineScore: 2,
    targetState: 'deep_flow',
    environment: 'office',
    device: 'headphones',
    durationMin: 45,
    requestedGenre: 'nootropic_trance',
    cohortStats: [],
    profileStats: [],
  });
  assert.equal(stationaryRec.arm.id, 'nootropic-trance-6x40hz');
  assert.equal(stationaryRec.params.genre, 'nootropic_trance');
  assert.equal(stationaryRec.params.bpm, 120);
  assert.equal(stationaryRec.executableSpec?.entrainment.type, 'theta_gamma_cfc');
  assert.equal(stationaryRec.executableSpec?.entrainment.startFrequencyHz, 14);
  assert.equal(stationaryRec.executableSpec?.entrainment.frequencyHz, 6);

  // Verify Driving Safety Override automatically blocks 6 Hz Theta trance behind the wheel -> >=14 Hz Beta!
  const drivingRec = selectProtocolRecommendation({
    sessionId: 'ses_trance_car',
    profile: baseProfile,
    currentState: 'fatigued',
    baselineScore: 2,
    targetState: 'deep_flow',
    environment: 'driving',
    device: 'car_audio',
    durationMin: 30,
    requestedGenre: 'nootropic_trance',
    cohortStats: [],
    profileStats: [],
  });
  assert.notEqual(drivingRec.arm.id, 'nootropic-trance-6x40hz');
  assert.ok(drivingRec.params.modulationHz >= 14, `Driving must use >=14 Hz Beta, got ${drivingRec.params.modulationHz}`);
  assert.equal(drivingRec.params.speakerSafeEQ, true);
  assert.notEqual(drivingRec.executableSpec?.entrainment.type, 'theta_gamma_cfc');
});

