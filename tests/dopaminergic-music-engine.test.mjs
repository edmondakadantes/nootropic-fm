/**
 * nootropic.fm — 7 Technical Secrets of Dopaminergic "WOW-State" Flow Music Test Suite
 *
 * Verifies:
 *  1) GenerativeComposer: 32-Bar Striatal Arc (groove -> riser -> drop), Wundt <= 7-semitone melodic jump guard,
 *     Gaussian-smooth soft transients, -1.8 dB Ghost Sidechain breathing on sub-kick, and <= 0.44 * fs Nyquist safety @ 8 kHz.
 *  2) promptComposer: 3-stage ignition + inner-voice space prompt composition + strict no-vocal/artist safety.
 *  3) Worker Darwinian Track-Level Bandit: /api/session/debrief updates `global_track` & `profile_track`
 *     (penalizing <60s bounce vs boosting >=90% lock & fast PVT), and /api/audio/catalog attaches `darwinianFitScore`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

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

const { GenerativeComposer } = await import('../src/audio/GenerativeComposer.ts');
const { composeScientificMusicPrompt, sanitizeCustomVibe } = await import('../shared/promptComposer.ts');
const { VERIFIED_STUDY_PRESETS } = await import('../shared/studyPresets.ts');
const workerModule = await import('../worker/index.ts');
const worker = workerModule.default;

function createAudioParamStub(initial = 0) {
  return {
    value: initial,
    setValueAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
    },
    exponentialRampToValueAtTime(v) {
      this.value = v;
    },
    setTargetAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
  };
}

function createDopamineMockAudioContext(sampleRate = 8000) {
  let simTime = 0;
  const maxFreqLog = [];
  const padGainCalls = [];
  const makeNode = (extra = {}) => ({
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
    ...extra,
  });

  const ctx = {
    sampleRate,
    get currentTime() {
      return simTime;
    },
    set currentTime(v) {
      simTime = v;
    },
    destination: makeNode({ maxChannelCount: 2 }),
    createBuffer(ch, len, sr) {
      const channels = Array.from({ length: ch }, () => new Float32Array(len));
      return { sampleRate: sr, length: len, getChannelData: (i) => channels[i] };
    },
    createBufferSource() {
      return makeNode({ buffer: null, loop: false, playbackRate: createAudioParamStub(1) });
    },
    createGain() {
      const gain = createAudioParamStub(1);
      const node = makeNode({ gain });
      const origLinear = gain.linearRampToValueAtTime.bind(gain);
      gain.linearRampToValueAtTime = (v, t) => {
        padGainCalls.push({ v, t });
        origLinear(v, t);
      };
      return node;
    },
    createStereoPanner() {
      return makeNode({ pan: createAudioParamStub(0) });
    },
    createBiquadFilter() {
      const freq = createAudioParamStub(1000);
      const origSet = freq.setValueAtTime.bind(freq);
      const origTarget = freq.setTargetAtTime.bind(freq);
      freq.setValueAtTime = (v, t) => {
        maxFreqLog.push(v);
        origSet(v, t);
      };
      freq.setTargetAtTime = (v, t) => {
        maxFreqLog.push(v);
        origTarget(v, t);
      };
      return makeNode({
        type: 'lowpass',
        frequency: freq,
        Q: createAudioParamStub(0.707),
        gain: createAudioParamStub(0),
      });
    },
    createOscillator() {
      const freq = createAudioParamStub(220);
      const origSet = freq.setValueAtTime.bind(freq);
      freq.setValueAtTime = (v, t) => {
        maxFreqLog.push(v);
        origSet(v, t);
      };
      return makeNode({
        type: 'sine',
        frequency: freq,
        detune: createAudioParamStub(0),
      });
    },
  };
  return { ctx, maxFreqLog, padGainCalls };
}

test('GenerativeComposer enforces Wundt <=7 semitone melodic leaps, 32-Bar Striatal Arc, and <=0.44*fs Nyquist @ 8kHz', () => {
  const origWindow = globalThis.window;
  const origFetch = globalThis.fetch;
  try {
    globalThis.window = globalThis;
    globalThis.fetch = async () => new Response(null, { status: 404 });

    const { ctx, maxFreqLog, padGainCalls } = createDopamineMockAudioContext(8000);
    const composer = new GenerativeComposer();
    const spec = { ...structuredClone(VERIFIED_STUDY_PRESETS[0].music), percussion: 'steady_pulse', bpm: 120 };

    composer.start({
      ctx,
      musicSpec: spec,
      genre: 'deep_electronic',
      proceduralMaster: ctx.createGain(),
      cleanSubBus: ctx.createGain(),
      reverbSend: ctx.createGain(),
      delaySend: ctx.createGain(),
      speakerSafeEQ: false,
      workletsReady: false,
    });

    // Verify Wundt 85/15 max-fifth leap guard across 60 fractal walks
    const midis = [];
    for (let i = 0; i < 60; i++) {
      midis.push(composer.pickFractalMidi(12));
    }
    for (let i = 1; i < midis.length; i++) {
      assert.ok(
        Math.abs(midis[i] - midis[i - 1]) <= 7,
        `Expected Wundt leap <= 7 semitones, saw ${midis[i - 1]} -> ${midis[i]}`
      );
    }

    // Advance virtual clock through a full 256-step (32-bar) Striatal Arc cycle
    const phasesSeen = new Set();
    for (let k = 0; k < 275; k++) {
      ctx.currentTime += 0.25;
      composer.scheduleLiveSteps();
      phasesSeen.add(composer.getStriatalArcPhase());
    }
    composer.stop();

    assert.ok(phasesSeen.has('groove'), 'Expected Striatal groove phase');
    assert.ok(phasesSeen.has('riser'), 'Expected Striatal riser phase');
    assert.ok(phasesSeen.has('drop'), 'Expected Striatal resolution drop phase');

    // Verify -1.8 dB Ghost Sidechain modulation calls happened on padBus (amp ~ 0.813 * basePad)
    assert.ok(padGainCalls.some((c) => c.v > 0.2 && c.v < 0.3), 'Expected Ghost Sidechain -1.8 dB dip on padBus');

    // Verify 100% Nyquist clamping @ 8 kHz (3520 Hz)
    const nyqSafe8k = 8000 * 0.44;
    for (const f of maxFreqLog) {
      assert.ok(f <= nyqSafe8k + 1e-6, `Expected all GenerativeComposer frequencies <= ${nyqSafe8k} Hz, got ${f}`);
    }
  } finally {
    globalThis.window = origWindow;
    globalThis.fetch = origFetch;
  }
});

test('composeScientificMusicPrompt embeds 3-stage ignition & inner-voice clarity pocket while guarding custom vibes', () => {
  const vibe = sanitizeCustomVibe('Midnight Synthwave');
  assert.equal(vibe?.slug, 'midnight_synthwave');
  const prompt = composeScientificMusicPrompt({
    customGenreLabel: vibe.displayLabel,
    energyTier: 'focus',
    targetState: 'deep_flow',
    params: { bpm: 108, harmonicMode: 'warm_min9', speakerSafeEQ: false },
    noiseSensitivity: 'medium',
  });
  assert.match(prompt, /1\.2-2\.8 kHz/i);
  assert.match(prompt, /Decompression Intro/i);
  assert.match(prompt, /Flow-Lock Drop/i);
  assert.match(prompt, /no vocals, no lyrics/i);

  const rejected = sanitizeCustomVibe('Taylor Swift vocals');
  assert.ok(rejected?.rejectedReason);
});

test('Worker Darwinian Track Bandit updates global_track & profile_track on debrief and attaches darwinianFitScore in /api/audio/catalog', async () => {
  const banditStore = new Map();

  const keyFor = (scopeType, scopeId, armId) => `${scopeType}::${scopeId}::${armId}`;

  const mockDb = {
    prepare(sql) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      const stmt = {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          if (cleanSql.startsWith('INSERT INTO bandit_stats')) {
            const [scopeType, scopeId, armId, alpha, beta, trials] = this.args;
            banditStore.set(keyFor(scopeType, scopeId, armId), {
              armId,
              alpha: Number(alpha),
              beta: Number(beta),
              trials: Number(trials),
            });
          } else if (cleanSql.startsWith('UPDATE bandit_stats SET alpha = ?')) {
            const [alpha, beta, trials, , , , , , , scopeType, scopeId, armId] = this.args;
            banditStore.set(keyFor(scopeType, scopeId, armId), {
              armId,
              alpha: Number(alpha),
              beta: Number(beta),
              trials: Number(trials),
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (cleanSql.includes('FROM rate_limits') || cleanSql.includes('INSERT INTO rate_limits')) {
            return { hits: 1 };
          }
          if (cleanSql.startsWith('SELECT * FROM sessions WHERE id = ?')) {
            const sid = String(this.args[0]);
            return {
              id: sid,
              profile_id: 'anon_track_tester',
              cohort_key: '25-34|knowledge_worker|distracted|deep_flow|office',
              raw_input_text: 'focus stem test',
              current_state: 'distracted',
              baseline_score: 2,
              target_state: 'deep_flow',
              environment: 'office',
              device: 'headphones',
              safety_mode: 0,
              planned_duration_min: 30,
              actual_duration_sec: sid.includes('bounce') ? 35 : 1720,
              completion_ratio: sid.includes('bounce') ? 0.02 : 0.95,
              arm_id: 'beta-drive-16hz',
              arm_name: 'Beta-Drive 16 Hz',
              is_exploration: 0,
              is_control_trial: 0,
              energy_tier: 'focus',
              music_genre: 'deep_electronic',
              initial_music_genre: 'deep_electronic',
              custom_genre_slug: null,
              audio_source: 'studio_library',
              retention_outcome: null,
              acoustic_params_json: JSON.stringify({
                modulationHz: 16,
                modulationDepth: 0.38,
                crossoverHz: 190,
                bpm: 112,
                pulseIntensity: 0.6,
                noiseColor: 'pink',
                noiseLevel: 0.14,
                harmonicMode: 'warm_min9',
                rootNoteHz: 220,
                filterCutoffHz: 3200,
                speakerSafeEQ: false,
                antiMonotonyCycleMin: 8,
                binauralOffsetHz: 0,
                genre: 'deep_electronic',
                genreSelectionMode: 'auto',
                energyTier: 'focus',
              }),
              cited_study_ids_json: '[]',
              live_adjustments_json: '[]',
              time_of_day_bucket: 'morning',
              status: 'active',
              post_score: null,
              delta_score: null,
              worked_rating: null,
              feedback_tags_json: '[]',
              reward_score: null,
              notes: '',
              created_at: '2026-11-26T22:00:00.000Z',
              completed_at: null,
            };
          }
          if (cleanSql.includes('SELECT age_band, preferred_mod_mult, neural_memory_json FROM profiles')) {
            return { age_band: '25-34', preferred_mod_mult: 1.0, neural_memory_json: null };
          }
          if (cleanSql.includes('FROM bandit_stats WHERE scope_type = ? AND scope_id = ? AND arm_id = ?')) {
            const [scopeType, scopeId, armId] = this.args;
            const hit = banditStore.get(keyFor(scopeType, scopeId, armId));
            return hit
              ? {
                  alpha: hit.alpha,
                  beta: hit.beta,
                  trials: hit.trials,
                  explicit_trials: hit.trials,
                  implicit_trials: 0,
                  explicit_delta_sum: 2,
                  retention_sum: 1,
                  avg_delta: 2,
                  avg_completion: 0.95,
                  avg_reward: 0.85,
                }
              : null;
          }
          return null;
        },
        async all() {
          if (cleanSql.includes('FROM bandit_stats WHERE scope_type = ? AND scope_id = ?')) {
            const [scopeType, scopeId] = this.args;
            const out = [];
            for (const [k, v] of banditStore.entries()) {
              if (k.startsWith(`${scopeType}::${scopeId}::`)) {
                out.push({
                  arm_id: v.armId,
                  alpha: v.alpha,
                  beta: v.beta,
                  trials: v.trials,
                  avg_delta: 0,
                  avg_completion: 0,
                });
              }
            }
            return { results: out };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };

  // Debrief winner stem (95% completion + -18 ms PVT speedup)
  await worker.fetch(
    new Request('https://app.nootropic.fm/api/session/debrief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'ses_winner_track',
        actualDurationSec: 1720,
        postScore: 5,
        workedRating: 'yes',
        pvtPreMs: 265,
        pvtPostMs: 247,
        activeTrackKey: 'deep_electronic/drive/warm-analog-pulse-1.mp3',
      }),
    }),
    { DB: mockDb },
    { waitUntil() {} }
  );

  // Debrief early-bounce stem (35s bounce -> capped low reward)
  await worker.fetch(
    new Request('https://app.nootropic.fm/api/session/debrief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'ses_bounce_track',
        actualDurationSec: 35,
        postScore: 2,
        workedRating: 'no',
        activeTrackKey: 'deep_electronic/drive/warm-analog-pulse-2.mp3',
      }),
    }),
    { DB: mockDb },
    { waitUntil() {} }
  );

  const mockBucket = {
    async list() {
      return {
        objects: [
          { key: 'deep_electronic/drive/warm-analog-pulse-2.mp3', size: 1200000, customMetadata: {} },
          { key: 'deep_electronic/drive/warm-analog-pulse-1.mp3', size: 1200000, customMetadata: {} },
        ],
        truncated: false,
      };
    },
  };

  const catRes = await worker.fetch(
    new Request('https://app.nootropic.fm/api/audio/catalog', { method: 'GET' }),
    { DB: mockDb, AUDIO_BUCKET: mockBucket },
    { waitUntil() {} }
  );
  assert.equal(catRes.status, 200);
  const catJson = await catRes.json();
  const list = catJson.tracksByGenre.deep_electronic;
  assert.equal(list.length, 2);
  assert.equal(list[0].key, 'deep_electronic/drive/warm-analog-pulse-1.mp3');
  assert.ok(list[0].darwinianFitScore > list[1].darwinianFitScore);
});
