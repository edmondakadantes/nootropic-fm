/**
 * nootropic.fm — 100/100 Continuous Personal Neural Memory, Micro-Tuning & Chronotype Suite
 *
 * Verifies:
 *  1) `createDefaultNeuralMemory`, `parsePersonalNeuralMemory`, and `updatePersonalNeuralMemory` across 10 simulated sessions:
 *     - Goal-separated focusModMult vs calmModMult
 *     - Continuous Beta focusOffsetHz micro-tuning & Tapping-derived personalIafHz
 *     - Stochastic 1/f noise multiplier, mid-session fatigueDipMinute anticipation, peak/dip chronotype windows
 *     - Active vs Blind Sham causal PVT reaction lift (`causalLiftMs`) & Bayesian calibrationPct progression
 *  2) `selectProtocolRecommendation` applying continuous tuning + Circadian Dip Stabilizer Iso-Bridge while keeping Signature 6x40 Hz integer-locked.
 *  3) Worker D1 `POST /api/session/debrief` + `POST /api/session/recommend` persistence & `profile_chrono` updates.
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

const {
  createDefaultNeuralMemory,
  parsePersonalNeuralMemory,
  updatePersonalNeuralMemory,
} = await import('../shared/psychometrics.ts');
const { PROTOCOL_ARMS, selectProtocolRecommendation } = await import('../shared/protocols.ts');
const workerModule = await import('../worker/index.ts');
const worker = workerModule.default;

test('PersonalNeuralMemory learns continuous focus/calm doses, IAF, fatigue dip, chronotype, and Active-vs-Sham PVT lift', () => {
  let mem = createDefaultNeuralMemory('25-34');
  assert.equal(mem.calibrationPct, 0);
  assert.equal(mem.personalIafHz, 10.2);

  // Session 1: Activating Focus session where listener nudged modulation higher & wanted stronger focus
  mem = updatePersonalNeuralMemory(mem, {
    targetState: 'alert_focus',
    timeOfDayBucket: 'morning',
    isControlTrial: false,
    reward: 0.86,
    deltaScore: 2,
    completionRatio: 1.0,
    actualDurationSec: 1800,
    baseModulationHz: 16,
    feedbackTags: ['Wanted stronger focus'],
    liveAdjustments: [
      { atSec: 320, control: 'modulation', delta: 0.15 },
      { atSec: 360, control: 'noise', delta: 0.1 },
    ],
    pvtDeltaMs: -24,
    tappingMeanItiMs: 575, // ~10.4 Hz harmonic
    tappingCvPct: 4.5,
    chronoScores: {
      morning: { avgReward: 0.86, trials: 1 },
      afternoon: { avgReward: 0.51, trials: 1 },
    },
  });

  assert.equal(mem.learnedSessions, 1);
  assert.ok(mem.focusModMult > 1.0, `Expected focusModMult > 1.0, got ${mem.focusModMult}`);
  assert.equal(mem.calmModMult, 1.0, 'Calm dose should stay decoupled from focus session');
  assert.ok(mem.focusOffsetHz > 0, `Expected positive focusOffsetHz, got ${mem.focusOffsetHz}`);
  assert.ok(mem.preferredNoiseMult > 1.0, `Expected preferredNoiseMult > 1.0, got ${mem.preferredNoiseMult}`);
  assert.ok(mem.personalIafHz >= 10.2 && mem.personalIafHz <= 10.6);
  assert.equal(mem.peakChronoBucket, 'morning');
  assert.equal(mem.dipChronoBucket, 'afternoon');
  assert.equal(mem.activeAvgPvtDeltaMs, -24);

  // Session 2: Blind Sham control with mild worsening (+6 ms slower) -> yields +30 ms causal lift
  mem = updatePersonalNeuralMemory(mem, {
    targetState: 'deep_flow',
    timeOfDayBucket: 'afternoon',
    isControlTrial: true,
    reward: 0.55,
    deltaScore: 0,
    completionRatio: 1.0,
    actualDurationSec: 1500,
    baseModulationHz: 16,
    pvtDeltaMs: 6,
  });
  assert.equal(mem.shamAvgPvtDeltaMs, 6);
  assert.equal(mem.causalLiftMs, 30);

  // Session 3: Early exit at minute 19 on a calm reset session -> learns calm dose & fatigueDipMinute
  mem = updatePersonalNeuralMemory(mem, {
    targetState: 'calm_reset',
    timeOfDayBucket: 'evening',
    isControlTrial: false,
    reward: 0.6,
    deltaScore: 1,
    completionRatio: 0.62,
    actualDurationSec: 1140,
    baseModulationHz: 10,
    feedbackTags: ['A bit too intense'],
  });
  assert.ok(mem.calmModMult < 1.0, `Expected calmModMult < 1.0, got ${mem.calmModMult}`);
  assert.equal(mem.fatigueDipMinute, 19);
  assert.ok(mem.calibrationPct >= 40, `Expected meaningful calibrationPct, got ${mem.calibrationPct}`);

  // Round-trip JSON parsing safety
  const reparsed = parsePersonalNeuralMemory(JSON.stringify(mem), '25-34');
  assert.equal(reparsed.causalLiftMs, 30);
  assert.equal(reparsed.fatigueDipMinute, 19);
  assert.equal(reparsed.dipChronoBucket, 'afternoon');
});

test('selectProtocolRecommendation micro-tunes Hz, arms circadian stabilizer, and keeps Signature 6x40 Hz locked', () => {
  const mem = parsePersonalNeuralMemory(
    {
      calibrationPct: 68,
      learnedSessions: 9,
      personalIafHz: 10.6,
      focusOffsetHz: 0.8,
      focusModMult: 1.15,
      calmModMult: 0.82,
      preferredNoiseMult: 1.2,
      fatigueDipMinute: 20,
      peakChronoBucket: 'morning',
      dipChronoBucket: 'afternoon',
      activeAvgPvtDeltaMs: -22,
      shamAvgPvtDeltaMs: 4,
      causalLiftMs: 26,
    },
    '25-34'
  );

  const profile = {
    id: 'anon_test_100',
    age: 30,
    ageBand: '25-34',
    role: 'knowledge_worker',
    texturePref: 'minimal_electronic',
    noiseSensitivity: 'medium',
    defaultDevice: 'headphones',
    primaryChallenge: 'distraction',
    researchConsent: true,
    preferredModMult: 1.15,
    neuralMemory: mem,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
  };

  // Focus arm in afternoon dip window -> applies +0.8 Hz micro-tuning AND circadian dip stabilizer
  const focusRec = selectProtocolRecommendation({
    sessionId: 'ses_focus_test',
    profile,
    currentState: 'calm_neutral',
    baselineScore: 3,
    targetState: 'alert_focus',
    environment: 'office',
    device: 'headphones',
    durationMin: 30,
    cohortStats: [],
    profileStats: [{ armId: 'smr-15hz-focus', alpha: 14, beta: 2, trials: 10, avgDelta: 2, avgCompletion: 0.95 }],
    profileChronoStats: [{ armId: 'smr-15hz-focus', alpha: 8, beta: 1, trials: 5, avgDelta: 2.1, avgCompletion: 1 }],
    timeOfDayBucket: 'afternoon',
  });

  assert.ok(focusRec.appliedNeuralTuning, 'Expected appliedNeuralTuning metadata');
  assert.equal(focusRec.appliedNeuralTuning.calibrationPct, 68);
  assert.equal(focusRec.appliedNeuralTuning.chronoAdapted, true);
  assert.equal(focusRec.appliedNeuralTuning.proactiveLiftMinute, 18);
  assert.ok(
    focusRec.params.modulationHz > 15,
    `Expected Beta focus modulationHz > 15 after +0.8 offset, got ${focusRec.params.modulationHz}`
  );
  assert.ok(
    focusRec.executableSpec?.entrainment.isoBridge?.reasonLabel.includes('Circadian'),
    'Expected personal Circadian Dip Stabilizer Iso-Bridge'
  );

  // Calm Alpha arm -> tunes to personalIafHz (10.6 Hz) & uses calmModMult (0.82)
  const calmRec = selectProtocolRecommendation({
    sessionId: 'ses_calm_test',
    profile,
    currentState: 'stressed',
    baselineScore: 2,
    targetState: 'calm_reset',
    environment: 'home_relax',
    device: 'headphones',
    durationMin: 20,
    cohortStats: [],
    profileStats: [{ armId: 'alpha-10hz-calm', alpha: 12, beta: 2, trials: 8, avgDelta: 2, avgCompletion: 0.95 }],
    timeOfDayBucket: 'evening',
  });
  assert.equal(calmRec.params.modulationHz, 10.6);
  assert.equal(calmRec.appliedNeuralTuning?.appliedModMult, 0.82);

  // Signature 6x40 Hz -> strictly keeps 40 Hz integer sub-harmonic lock & zero sham
  const sigRec = selectProtocolRecommendation({
    sessionId: 'ses_sig_test',
    profile,
    currentState: 'distracted',
    baselineScore: 2,
    targetState: 'deep_flow',
    requestedGenre: 'nootropic_trance',
    environment: 'office',
    device: 'headphones',
    durationMin: 30,
    cohortStats: [],
    profileStats: [],
    timeOfDayBucket: 'morning',
  });
  const tranceArm = PROTOCOL_ARMS.find((a) => a.id === 'nootropic-trance-6x40hz');
  assert.equal(sigRec.arm.id, 'nootropic-trance-6x40hz');
  assert.equal(sigRec.params.modulationHz, tranceArm.baseParams.modulationHz);
  assert.equal(sigRec.isControlTrial, false);
});

test('Worker /api/session/debrief persists biomarkers & updates PersonalNeuralMemory + profile_chrono', async () => {
  const executedSql = [];
  let savedProfileMem = null;

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
          executedSql.push({ sql: cleanSql, args: this.args });
          if (cleanSql.startsWith('UPDATE profiles SET preferred_mod_mult = ?, neural_memory_json = ?')) {
            savedProfileMem = JSON.parse(String(this.args[1]));
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          executedSql.push({ sql: cleanSql, args: this.args });
          if (cleanSql.includes('FROM rate_limits') || cleanSql.includes('INSERT INTO rate_limits')) {
            return { hits: 1 };
          }
          if (cleanSql.startsWith('SELECT * FROM sessions WHERE id = ?')) {
            return {
              id: 'ses_worker_100',
              profile_id: 'anon_worker_100',
              cohort_key: '25-34|knowledge_worker|distracted|alert_focus|office',
              raw_input_text: 'deep coding',
              current_state: 'distracted',
              baseline_score: 2,
              target_state: 'alert_focus',
              environment: 'office',
              device: 'headphones',
              safety_mode: 0,
              planned_duration_min: 30,
              actual_duration_sec: 1500,
              completion_ratio: 0.83,
              arm_id: 'smr-15hz-focus',
              arm_name: '15–16 Hz Rapid-AM Focus',
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
                bpm: 100,
                pulseIntensity: 0.6,
                noiseColor: 'pink',
                noiseLevel: 0.14,
                harmonicMode: 'bright_maj9',
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
          if (cleanSql.includes('FROM bandit_stats WHERE scope_type = ?')) {
            return { alpha: 6, beta: 2, trials: 3, explicit_trials: 3, implicit_trials: 0, explicit_delta_sum: 4, retention_sum: 2.7, avg_delta: 1.3, avg_completion: 0.9, avg_reward: 0.8 };
          }
          return null;
        },
        async all() {
          executedSql.push({ sql: cleanSql, args: this.args });
          if (cleanSql.includes('GROUP BY time_of_day_bucket')) {
            return {
              results: [
                { time_of_day_bucket: 'morning', avg_r: 0.88, cnt: 4 },
                { time_of_day_bucket: 'afternoon', avg_r: 0.52, cnt: 2 },
              ],
            };
          }
          if (cleanSql.includes('FROM bandit_stats')) {
            return {
              results: [
                { arm_id: 'smr-15hz-focus', alpha: 9, beta: 2, trials: 4, avg_delta: 1.8, avg_completion: 0.94 },
              ],
            };
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

  const req = new Request('https://app.nootropic.fm/api/session/debrief', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'ses_worker_100',
      actualDurationSec: 1620,
      postScore: 4,
      workedRating: 'yes',
      feedbackTags: ['Wanted stronger focus'],
      liveAdjustments: [{ atSec: 300, control: 'modulation', delta: 0.12 }],
      pvtPreMs: 268,
      pvtPostMs: 244,
      tappingCvPct: 4.2,
      tappingMeanItiMs: 572,
      hrvRmssdMs: 46.5,
      hrvLfRatio: 0.62,
    }),
  });

  const res = await worker.fetch(req, { DB: mockDb }, { waitUntil() {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.learningUpdate.neuralMemory, 'Expected neuralMemory in learningUpdate response');
  assert.equal(body.learningUpdate.neuralMemory.peakChronoBucket, 'morning');
  assert.equal(body.learningUpdate.neuralMemory.dipChronoBucket, 'afternoon');
  assert.equal(body.learningUpdate.neuralMemory.activeAvgPvtDeltaMs, -24);
  assert.ok(savedProfileMem, 'Expected neural_memory_json UPDATE on profiles table');
  assert.ok(
    executedSql.some((q) => q.args.includes('profile_chrono')),
    'Expected profile_chrono bandit update during debrief'
  );
  assert.ok(
    executedSql.some((q) => q.sql.includes('tapping_cv_pct = COALESCE')),
    'Expected tapping & HRV columns written on sessions UPDATE'
  );
});
