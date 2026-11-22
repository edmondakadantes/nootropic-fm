import { parseNaturalCheckIn } from '../shared/parser';
import {
  PROTOCOL_ARMS,
  buildCohortKey,
  computeSessionReward,
  formatCohortLabelRo,
  selectProtocolRecommendation,
  type BanditStatRow,
} from '../shared/protocols';
import {
  ageToBand,
  getTimeOfDayBucket,
  type AcousticParams,
  type ArmPerformance,
  type CohortPerformance,
  type CurrentState,
  type DebriefPayload,
  type LiveAdjustment,
  type OutputDevice,
  type ParsedCheckIn,
  type ResearchInsights,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserProfile,
  type WorkedRating,
} from '../shared/types';
import type { D1Database, Env } from './env';

let schemaReady = false;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    age INTEGER NOT NULL,
    age_band TEXT NOT NULL,
    role TEXT NOT NULL,
    texture_pref TEXT NOT NULL,
    noise_sensitivity TEXT NOT NULL,
    default_device TEXT NOT NULL,
    primary_challenge TEXT NOT NULL,
    research_consent INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    cohort_key TEXT NOT NULL,
    raw_input_text TEXT NOT NULL DEFAULT '',
    current_state TEXT NOT NULL,
    baseline_score INTEGER NOT NULL,
    target_state TEXT NOT NULL,
    environment TEXT NOT NULL,
    device TEXT NOT NULL,
    safety_mode INTEGER NOT NULL DEFAULT 0,
    planned_duration_min INTEGER NOT NULL,
    actual_duration_sec INTEGER NOT NULL DEFAULT 0,
    completion_ratio REAL NOT NULL DEFAULT 0,
    arm_id TEXT NOT NULL,
    arm_name TEXT NOT NULL,
    is_exploration INTEGER NOT NULL DEFAULT 0,
    acoustic_params_json TEXT NOT NULL,
    cited_study_ids_json TEXT NOT NULL,
    live_adjustments_json TEXT NOT NULL DEFAULT '[]',
    time_of_day_bucket TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_debrief',
    post_score INTEGER,
    delta_score INTEGER,
    worked_rating TEXT,
    feedback_tags_json TEXT NOT NULL DEFAULT '[]',
    reward_score REAL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_cohort ON sessions(cohort_key, status)`,
  `CREATE TABLE IF NOT EXISTS bandit_stats (
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    arm_id TEXT NOT NULL,
    alpha REAL NOT NULL,
    beta REAL NOT NULL,
    trials INTEGER NOT NULL DEFAULT 0,
    avg_delta REAL NOT NULL DEFAULT 0,
    avg_completion REAL NOT NULL DEFAULT 0,
    avg_reward REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope_type, scope_id, arm_id)
  )`,
  `CREATE TABLE IF NOT EXISTS api_usage_daily (
    day TEXT PRIMARY KEY,
    gemini_calls INTEGER NOT NULL DEFAULT 0
  )`,
];

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

const ALLOWED_ORIGINS = new Set([
  'https://nootropic.fm',
  'https://www.nootropic.fm',
  'https://app.nootropic.fm',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') ?? '';
  const allowOrigin =
    ALLOWED_ORIGINS.has(origin) || origin.endsWith('.workers.dev') || origin.endsWith('.web.app') || origin.endsWith('.firebaseapp.com') || origin.endsWith('.vercel.app')
      ? origin
      : '*';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function json(data: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    age: Number(row.age),
    ageBand: String(row.age_band) as UserProfile['ageBand'],
    role: String(row.role) as UserProfile['role'],
    texturePref: String(row.texture_pref) as UserProfile['texturePref'],
    noiseSensitivity: String(row.noise_sensitivity) as UserProfile['noiseSensitivity'],
    defaultDevice: String(row.default_device) as OutputDevice,
    primaryChallenge: String(row.primary_challenge) as UserProfile['primaryChallenge'],
    researchConsent: Number(row.research_consent) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSessionRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    cohortKey: String(row.cohort_key),
    rawInputText: String(row.raw_input_text ?? ''),
    currentState: String(row.current_state) as CurrentState,
    baselineScore: Number(row.baseline_score),
    targetState: String(row.target_state) as TargetState,
    environment: String(row.environment) as SessionEnvironment,
    device: String(row.device) as OutputDevice,
    safetyMode: Number(row.safety_mode) === 1,
    plannedDurationMin: Number(row.planned_duration_min),
    actualDurationSec: Number(row.actual_duration_sec ?? 0),
    completionRatio: Number(row.completion_ratio ?? 0),
    armId: String(row.arm_id),
    armName: String(row.arm_name),
    isExploration: Number(row.is_exploration) === 1,
    acousticParams: JSON.parse(String(row.acoustic_params_json)) as AcousticParams,
    citedStudyIds: JSON.parse(String(row.cited_study_ids_json)) as string[],
    liveAdjustments: JSON.parse(String(row.live_adjustments_json ?? '[]')) as LiveAdjustment[],
    timeOfDayBucket: String(row.time_of_day_bucket) as SessionRecord['timeOfDayBucket'],
    status: String(row.status) as SessionRecord['status'],
    postScore: row.post_score === null || row.post_score === undefined ? null : Number(row.post_score),
    deltaScore: row.delta_score === null || row.delta_score === undefined ? null : Number(row.delta_score),
    workedRating: (row.worked_rating as WorkedRating | null) ?? null,
    feedbackTags: JSON.parse(String(row.feedback_tags_json ?? '[]')) as string[],
    rewardScore: row.reward_score === null || row.reward_score === undefined ? null : Number(row.reward_score),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

/**
 * Optional Gemini Flash check-in enhancement with strict daily cap so cost stays $0.
 */
async function enhanceWithGeminiIfConfigured(
  env: Env,
  rawText: string,
  fallback: ParsedCheckIn
): Promise<ParsedCheckIn> {
  if (!env.GEMINI_API_KEY || rawText.trim().length < 6) {
    return fallback;
  }

  const dailyCap = Number(env.GEMINI_DAILY_CAP ?? '100');
  const today = new Date().toISOString().slice(0, 10);

  const usage = await env.DB.prepare('SELECT gemini_calls FROM api_usage_daily WHERE day = ?')
    .bind(today)
    .first<{ gemini_calls: number }>();

  if ((usage?.gemini_calls ?? 0) >= dailyCap) {
    return fallback;
  }

  try {
    const prompt = `Extrage structurat contextul sesiunii audio din mesajul utilizatorului. Răspunde STRICT cu un obiect JSON valid, fără markdown, cu cheile:
{
  "extractedAge": number | null,
  "currentState": "distracted" | "fatigued" | "stressed" | "anxious" | "calm_neutral" | "restless",
  "targetState": "alert_focus" | "deep_flow" | "calm_reset" | "energy_lift" | "sleep_winddown",
  "environment": "driving" | "office" | "study" | "home_relax" | "transit",
  "device": "headphones" | "speakers" | "car_audio",
  "durationMin": number
}
Regulă de siguranță: dacă utilizatorul conduce (șofer, volan, mașină, microbuz, camion), environment="driving", device="car_audio", iar targetState NU poate fi "sleep_winddown" sau "calm_reset" (folosește "alert_focus").
Mesaj: """${rawText}"""`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      }
    );

    if (!res.ok) return fallback;

    await env.DB.prepare(
      `INSERT INTO api_usage_daily (day, gemini_calls) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET gemini_calls = gemini_calls + 1`
    )
      .bind(today)
      .run();

    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return fallback;

    const parsed = JSON.parse(text) as Partial<ParsedCheckIn>;
    const environment = parsed.environment ?? fallback.environment;
    const isDriving = environment === 'driving';
    const targetState =
      isDriving && (parsed.targetState === 'sleep_winddown' || parsed.targetState === 'calm_reset')
        ? 'alert_focus'
        : (parsed.targetState ?? fallback.targetState);

    return {
      ...fallback,
      extractedAge: typeof parsed.extractedAge === 'number' ? parsed.extractedAge : fallback.extractedAge,
      currentState: parsed.currentState ?? fallback.currentState,
      targetState,
      environment,
      device: isDriving ? 'car_audio' : (parsed.device ?? fallback.device),
      durationMin:
        typeof parsed.durationMin === 'number' && parsed.durationMin >= 5 && parsed.durationMin <= 120
          ? Math.round(parsed.durationMin)
          : fallback.durationMin,
      usedGemini: true,
    };
  } catch {
    return fallback;
  }
}

async function fetchBanditRows(
  db: D1Database,
  scopeType: 'cohort' | 'profile',
  scopeId: string
): Promise<BanditStatRow[]> {
  const result = await db
    .prepare(
      `SELECT arm_id, alpha, beta, trials, avg_delta, avg_completion
       FROM bandit_stats WHERE scope_type = ? AND scope_id = ?`
    )
    .bind(scopeType, scopeId)
    .all<Record<string, unknown>>();

  return result.results.map((r) => ({
    armId: String(r.arm_id),
    alpha: Number(r.alpha),
    beta: Number(r.beta),
    trials: Number(r.trials),
    avgDelta: Number(r.avg_delta),
    avgCompletion: Number(r.avg_completion),
  }));
}

async function updateBanditScope(
  db: D1Database,
  scopeType: 'cohort' | 'profile',
  scopeId: string,
  armId: string,
  reward: number,
  delta: number,
  completionRatio: number
): Promise<{ alpha: number; beta: number; trials: number; successRatePct: number }> {
  const arm = PROTOCOL_ARMS.find((a) => a.id === armId);
  const priorAlpha = arm?.priorAlpha ?? 2.5;
  const priorBeta = arm?.priorBeta ?? 1.5;

  const existing = await db
    .prepare(
      `SELECT alpha, beta, trials, avg_delta, avg_completion, avg_reward
       FROM bandit_stats WHERE scope_type = ? AND scope_id = ? AND arm_id = ?`
    )
    .bind(scopeType, scopeId, armId)
    .first<Record<string, unknown>>();

  const prevAlpha = existing ? Number(existing.alpha) : priorAlpha;
  const prevBeta = existing ? Number(existing.beta) : priorBeta;
  const prevTrials = existing ? Number(existing.trials) : 0;
  const prevAvgDelta = existing ? Number(existing.avg_delta) : 0;
  const prevAvgComp = existing ? Number(existing.avg_completion) : 0;
  const prevAvgReward = existing ? Number(existing.avg_reward) : 0;

  const newTrials = prevTrials + 1;
  const newAlpha = Number((prevAlpha + reward).toFixed(3));
  const newBeta = Number((prevBeta + (1 - reward)).toFixed(3));
  const newAvgDelta = Number(((prevAvgDelta * prevTrials + delta) / newTrials).toFixed(3));
  const newAvgComp = Number(((prevAvgComp * prevTrials + completionRatio) / newTrials).toFixed(3));
  const newAvgReward = Number(((prevAvgReward * prevTrials + reward) / newTrials).toFixed(3));
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO bandit_stats (scope_type, scope_id, arm_id, alpha, beta, trials, avg_delta, avg_completion, avg_reward, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_type, scope_id, arm_id) DO UPDATE SET
         alpha = excluded.alpha,
         beta = excluded.beta,
         trials = excluded.trials,
         avg_delta = excluded.avg_delta,
         avg_completion = excluded.avg_completion,
         avg_reward = excluded.avg_reward,
         updated_at = excluded.updated_at`
    )
    .bind(scopeType, scopeId, armId, newAlpha, newBeta, newTrials, newAvgDelta, newAvgComp, newAvgReward, now)
    .run();

  return {
    alpha: newAlpha,
    beta: newBeta,
    trials: newTrials,
    successRatePct: Math.round((newAlpha / (newAlpha + newBeta)) * 100),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      await ensureSchema(env.DB);

      // GET /api/health
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({
          ok: true,
          mode: env.APP_ENV ?? 'open-research-beta',
          hasGemini: Boolean(env.GEMINI_API_KEY),
        });
      }

      // POST /api/profile
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const body = (await request.json()) as Partial<UserProfile>;
        const id = body.id && body.id.length >= 8 ? body.id : `anon_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const age = Math.max(16, Math.min(95, Number(body.age ?? 32)));
        const ageBand = ageToBand(age);
        const now = new Date().toISOString();

        const profile: UserProfile = {
          id,
          age,
          ageBand,
          role: body.role ?? 'other',
          texturePref: body.texturePref ?? 'warm_organic',
          noiseSensitivity: body.noiseSensitivity ?? 'medium',
          defaultDevice: body.defaultDevice ?? 'headphones',
          primaryChallenge: body.primaryChallenge ?? 'distraction',
          researchConsent: body.researchConsent !== false,
          createdAt: body.createdAt ?? now,
          updatedAt: now,
        };

        await env.DB.prepare(
          `INSERT INTO profiles (id, age, age_band, role, texture_pref, noise_sensitivity, default_device, primary_challenge, research_consent, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             age = excluded.age,
             age_band = excluded.age_band,
             role = excluded.role,
             texture_pref = excluded.texture_pref,
             noise_sensitivity = excluded.noise_sensitivity,
             default_device = excluded.default_device,
             primary_challenge = excluded.primary_challenge,
             research_consent = excluded.research_consent,
             updated_at = excluded.updated_at`
        )
          .bind(
            profile.id,
            profile.age,
            profile.ageBand,
            profile.role,
            profile.texturePref,
            profile.noiseSensitivity,
            profile.defaultDevice,
            profile.primaryChallenge,
            profile.researchConsent ? 1 : 0,
            profile.createdAt,
            profile.updatedAt
          )
          .run();

        return json({ profile });
      }

      // GET /api/profile/:id
      if (url.pathname.startsWith('/api/profile/') && request.method === 'GET') {
        const id = decodeURIComponent(url.pathname.replace('/api/profile/', ''));
        const row = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'Profile not found' }, 404);

        const pendingRow = await env.DB.prepare(
          `SELECT * FROM sessions WHERE profile_id = ? AND status = 'pending_debrief' ORDER BY created_at DESC LIMIT 1`
        )
          .bind(id)
          .first();

        return json({
          profile: mapProfileRow(row),
          pendingDebrief: pendingRow ? mapSessionRow(pendingRow) : null,
        });
      }

      // POST /api/parse
      if (url.pathname === '/api/parse' && request.method === 'POST') {
        const body = (await request.json()) as { text?: string; profile?: Partial<UserProfile> };
        const rawText = String(body.text ?? '').trim();
        const localParsed = parseNaturalCheckIn(rawText, body.profile);
        const finalParsed = await enhanceWithGeminiIfConfigured(env, rawText, localParsed);
        return json({ parsed: finalParsed });
      }

      // POST /api/protocol/start
      if (url.pathname === '/api/protocol/start' && request.method === 'POST') {
        const body = (await request.json()) as {
          profileId: string;
          rawInputText?: string;
          currentState: CurrentState;
          baselineScore: number;
          targetState: TargetState;
          environment: SessionEnvironment;
          device: OutputDevice;
          durationMin: number;
          ageOverride?: number;
        };

        const profileRow = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?')
          .bind(body.profileId)
          .first();
        if (!profileRow) return json({ error: 'Profile not found. Complete onboarding first.' }, 404);

        let profile = mapProfileRow(profileRow);
        if (typeof body.ageOverride === 'number' && body.ageOverride >= 16 && body.ageOverride <= 95 && body.ageOverride !== profile.age) {
          profile = { ...profile, age: body.ageOverride, ageBand: ageToBand(body.ageOverride) };
          await env.DB.prepare('UPDATE profiles SET age = ?, age_band = ?, updated_at = ? WHERE id = ?')
            .bind(profile.age, profile.ageBand, new Date().toISOString(), profile.id)
            .run();
        }

        const effectiveTarget: TargetState =
          body.environment === 'driving' &&
          (body.targetState === 'sleep_winddown' || body.targetState === 'calm_reset')
            ? 'alert_focus'
            : body.targetState;
        const cohortKey = buildCohortKey(profile.ageBand, body.environment, effectiveTarget);

        const [cohortStats, profileStats] = await Promise.all([
          fetchBanditRows(env.DB, 'cohort', cohortKey),
          fetchBanditRows(env.DB, 'profile', profile.id),
        ]);

        const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const recommendation = selectProtocolRecommendation({
          sessionId,
          profile,
          currentState: body.currentState,
          baselineScore: Math.max(1, Math.min(5, Number(body.baselineScore ?? 2))),
          targetState: body.targetState,
          environment: body.environment,
          device: body.device,
          durationMin: Math.max(5, Math.min(120, Number(body.durationMin ?? 30))),
          cohortStats,
          profileStats,
        });

        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (
            id, profile_id, cohort_key, raw_input_text, current_state, baseline_score,
            target_state, environment, device, safety_mode, planned_duration_min,
            actual_duration_sec, completion_ratio, arm_id, arm_name, is_exploration,
            acoustic_params_json, cited_study_ids_json, live_adjustments_json,
            time_of_day_bucket, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, '[]', ?, 'pending_debrief', ?)`
        )
          .bind(
            sessionId,
            profile.id,
            recommendation.cohortKey,
            body.rawInputText ?? '',
            recommendation.currentState,
            recommendation.baselineScore,
            recommendation.targetState,
            recommendation.environment,
            recommendation.device,
            recommendation.safetyMode ? 1 : 0,
            recommendation.plannedDurationMin,
            recommendation.arm.id,
            recommendation.arm.name,
            recommendation.isExploration ? 1 : 0,
            JSON.stringify(recommendation.params),
            JSON.stringify(recommendation.arm.studyIds),
            getTimeOfDayBucket(),
            now
          )
          .run();

        return json({ recommendation });
      }

      // POST /api/session/progress
      if (url.pathname === '/api/session/progress' && request.method === 'POST') {
        const body = (await request.json()) as {
          sessionId: string;
          actualDurationSec: number;
          liveAdjustments: LiveAdjustment[];
        };
        const row = await env.DB.prepare('SELECT planned_duration_min FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first<{ planned_duration_min: number }>();
        if (!row) return json({ error: 'Session not found' }, 404);

        const plannedSec = Math.max(60, Number(row.planned_duration_min) * 60);
        const completionRatio = Number(Math.min(1, Math.max(0, body.actualDurationSec / plannedSec)).toFixed(3));

        await env.DB.prepare(
          `UPDATE sessions SET actual_duration_sec = ?, completion_ratio = ?, live_adjustments_json = ? WHERE id = ?`
        )
          .bind(
            Math.round(body.actualDurationSec),
            completionRatio,
            JSON.stringify(body.liveAdjustments ?? []),
            body.sessionId
          )
          .run();

        return json({ ok: true, completionRatio });
      }

      // POST /api/session/debrief
      if (url.pathname === '/api/session/debrief' && request.method === 'POST') {
        const body = (await request.json()) as DebriefPayload;
        const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first();
        if (!row) return json({ error: 'Session not found' }, 404);

        const session = mapSessionRow(row);
        const actualSec = Math.max(session.actualDurationSec, Math.round(body.actualDurationSec ?? 0));
        const plannedSec = Math.max(60, session.plannedDurationMin * 60);
        const completionRatio = Number(Math.min(1, Math.max(0.05, actualSec / plannedSec)).toFixed(3));
        const postScore = Math.max(1, Math.min(5, Number(body.postScore)));
        const liveAdjustments =
          body.liveAdjustments && body.liveAdjustments.length > 0
            ? body.liveAdjustments
            : session.liveAdjustments;

        const { reward, delta } = computeSessionReward({
          baselineScore: session.baselineScore,
          postScore,
          workedRating: body.workedRating,
          completionRatio,
          liveAdjustments,
        });

        const now = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE sessions SET
            actual_duration_sec = ?,
            completion_ratio = ?,
            live_adjustments_json = ?,
            status = 'completed',
            post_score = ?,
            delta_score = ?,
            worked_rating = ?,
            feedback_tags_json = ?,
            reward_score = ?,
            notes = ?,
            completed_at = ?
           WHERE id = ?`
        )
          .bind(
            actualSec,
            completionRatio,
            JSON.stringify(liveAdjustments),
            postScore,
            delta,
            body.workedRating,
            JSON.stringify(body.feedbackTags ?? []),
            reward,
            (body.notes ?? '').slice(0, 500),
            now,
            body.sessionId
          )
          .run();

        // Update BOTH cohort collective intelligence and individual profile model
        const [cohortUpdated, profileUpdated] = await Promise.all([
          updateBanditScope(env.DB, 'cohort', session.cohortKey, session.armId, reward, delta, completionRatio),
          updateBanditScope(env.DB, 'profile', session.profileId, session.armId, reward, delta, completionRatio),
        ]);

        return json({
          ok: true,
          learningUpdate: {
            sessionId: session.id,
            armId: session.armId,
            armName: session.armName,
            cohortKey: session.cohortKey,
            cohortLabelRo: formatCohortLabelRo(session.cohortKey),
            delta,
            reward,
            cohortSuccessRatePct: cohortUpdated.successRatePct,
            cohortTrials: cohortUpdated.trials,
            profileSuccessRatePct: profileUpdated.successRatePct,
            profileTrials: profileUpdated.trials,
          },
        });
      }

      // POST /api/session/dismiss
      if (url.pathname === '/api/session/dismiss' && request.method === 'POST') {
        const body = (await request.json()) as { sessionId: string };
        await env.DB.prepare(`UPDATE sessions SET status = 'abandoned' WHERE id = ? AND status = 'pending_debrief'`)
          .bind(body.sessionId)
          .run();
        return json({ ok: true });
      }

      // GET /api/insights
      if (url.pathname === '/api/insights' && request.method === 'GET') {
        const profileId = url.searchParams.get('profileId') ?? '';

        const [profilesCountRow, allSessionsRes, cohortBanditRes, personalBanditRes] = await Promise.all([
          env.DB.prepare('SELECT COUNT(*) as c FROM profiles').first<{ c: number }>(),
          env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200').all<Record<string, unknown>>(),
          env.DB.prepare(`SELECT * FROM bandit_stats WHERE scope_type = 'cohort'`).all<Record<string, unknown>>(),
          profileId
            ? env.DB.prepare(`SELECT * FROM bandit_stats WHERE scope_type = 'profile' AND scope_id = ?`)
                .bind(profileId)
                .all<Record<string, unknown>>()
            : Promise.resolve({ results: [] as Record<string, unknown>[] }),
        ]);

        const sessions = allSessionsRes.results.map(mapSessionRow);
        const completed = sessions.filter((s) => s.status === 'completed');
        const pending = sessions.filter((s) => s.status === 'pending_debrief');

        const positiveCount = completed.filter(
          (s) => s.workedRating === 'yes' || (s.workedRating === 'partial' && (s.deltaScore ?? 0) > 0)
        ).length;
        const globalSuccessRatePct =
          completed.length > 0 ? Math.round((positiveCount / completed.length) * 100) : 0;
        const globalAvgDelta =
          completed.length > 0
            ? Number(
                (completed.reduce((acc, s) => acc + (s.deltaScore ?? 0), 0) / completed.length).toFixed(2)
              )
            : 0;
        const explorationSharePct =
          sessions.length > 0
            ? Math.round((sessions.filter((s) => s.isExploration).length / sessions.length) * 100)
            : 0;

        const armNameMap = new Map(PROTOCOL_ARMS.map((a) => [a.id, a.name]));

        // Group cohort bandit stats
        const cohortBanditMap = new Map<string, ArmPerformance[]>();
        for (const r of cohortBanditRes.results) {
          const cohortKey = String(r.scope_id);
          const alpha = Number(r.alpha);
          const beta = Number(r.beta);
          const entry: ArmPerformance = {
            armId: String(r.arm_id),
            armName: armNameMap.get(String(r.arm_id)) ?? String(r.arm_id),
            trials: Number(r.trials),
            successRatePct: Math.round((alpha / (alpha + beta)) * 100),
            avgDelta: Number(Number(r.avg_delta).toFixed(2)),
            avgCompletionPct: Math.round(Number(r.avg_completion) * 100),
            alpha,
            beta,
          };
          const list = cohortBanditMap.get(cohortKey) ?? [];
          list.push(entry);
          cohortBanditMap.set(cohortKey, list);
        }

        // Build cohort summaries
        const cohortSessionGroups = new Map<string, SessionRecord[]>();
        for (const s of sessions) {
          const list = cohortSessionGroups.get(s.cohortKey) ?? [];
          list.push(s);
          cohortSessionGroups.set(s.cohortKey, list);
        }

        const cohorts: CohortPerformance[] = Array.from(cohortSessionGroups.entries())
          .map(([cohortKey, list]) => {
            const comp = list.filter((s) => s.status === 'completed');
            const pos = comp.filter((s) => s.workedRating === 'yes').length;
            const arms = (cohortBanditMap.get(cohortKey) ?? []).sort(
              (a, b) => b.successRatePct - a.successRatePct
            );
            return {
              cohortKey,
              cohortLabelRo: formatCohortLabelRo(cohortKey),
              totalSessions: list.length,
              completedSessions: comp.length,
              avgDelta:
                comp.length > 0
                  ? Number((comp.reduce((a, b) => a + (b.deltaScore ?? 0), 0) / comp.length).toFixed(2))
                  : 0,
              successRatePct: comp.length > 0 ? Math.round((pos / comp.length) * 100) : 0,
              topArmName: arms[0]?.armName ?? list[0]?.armName ?? '—',
              arms,
            };
          })
          .sort((a, b) => b.totalSessions - a.totalSessions);

        const personalArms: ArmPerformance[] = personalBanditRes.results
          .map((r) => {
            const alpha = Number(r.alpha);
            const beta = Number(r.beta);
            return {
              armId: String(r.arm_id),
              armName: armNameMap.get(String(r.arm_id)) ?? String(r.arm_id),
              trials: Number(r.trials),
              successRatePct: Math.round((alpha / (alpha + beta)) * 100),
              avgDelta: Number(Number(r.avg_delta).toFixed(2)),
              avgCompletionPct: Math.round(Number(r.avg_completion) * 100),
              alpha,
              beta,
            };
          })
          .sort((a, b) => b.successRatePct - a.successRatePct);

        const insights: ResearchInsights = {
          totalProfiles: Number(profilesCountRow?.c ?? 0),
          totalSessions: sessions.length,
          completedDebriefs: completed.length,
          pendingDebriefs: pending.length,
          globalSuccessRatePct,
          globalAvgDelta,
          explorationSharePct,
          cohorts,
          personalArms,
          recentSessions: sessions.slice(0, 20),
        };

        return json({ insights });
      }

      // GET /api/dataset/export — Anonymized Open Research Dataset (JSON or CSV)
      if (url.pathname === '/api/dataset/export' && request.method === 'GET') {
        const format = url.searchParams.get('format') ?? 'json';
        const rows = await env.DB.prepare(
          `SELECT
            s.id AS session_id,
            p.age_band,
            p.role,
            p.texture_pref,
            p.noise_sensitivity,
            s.cohort_key,
            s.time_of_day_bucket,
            s.current_state,
            s.baseline_score,
            s.target_state,
            s.environment,
            s.device,
            s.safety_mode,
            s.planned_duration_min,
            s.actual_duration_sec,
            s.completion_ratio,
            s.arm_id,
            s.is_exploration,
            s.acoustic_params_json,
            s.status,
            s.post_score,
            s.delta_score,
            s.worked_rating,
            s.reward_score,
            s.feedback_tags_json,
            s.created_at,
            s.completed_at
           FROM sessions s
           JOIN profiles p ON p.id = s.profile_id
           WHERE p.research_consent = 1
           ORDER BY s.created_at DESC`
        ).all<Record<string, unknown>>();

        if (format === 'csv') {
          const headers = [
            'session_id',
            'age_band',
            'role',
            'cohort_key',
            'time_of_day_bucket',
            'current_state',
            'baseline_score',
            'target_state',
            'environment',
            'device',
            'safety_mode',
            'planned_duration_min',
            'actual_duration_sec',
            'completion_ratio',
            'arm_id',
            'is_exploration',
            'modulation_hz',
            'modulation_depth',
            'bpm',
            'noise_color',
            'noise_level',
            'status',
            'post_score',
            'delta_score',
            'worked_rating',
            'reward_score',
            'created_at',
          ];
          const csvLines = [headers.join(',')];
          for (const r of rows.results) {
            const ap = JSON.parse(String(r.acoustic_params_json)) as AcousticParams;
            const vals = [
              r.session_id,
              r.age_band,
              r.role,
              r.cohort_key,
              r.time_of_day_bucket,
              r.current_state,
              r.baseline_score,
              r.target_state,
              r.environment,
              r.device,
              r.safety_mode,
              r.planned_duration_min,
              r.actual_duration_sec,
              r.completion_ratio,
              r.arm_id,
              r.is_exploration,
              ap.modulationHz,
              ap.modulationDepth,
              ap.bpm,
              ap.noiseColor,
              ap.noiseLevel,
              r.status,
              r.post_score ?? '',
              r.delta_score ?? '',
              r.worked_rating ?? '',
              r.reward_score ?? '',
              r.created_at,
            ];
            csvLines.push(vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
          }
          return new Response(csvLines.join('\n'), {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename="nootropic-fm-research-dataset.csv"',
              ...corsHeaders(request),
            },
          });
        }

        const sanitized = rows.results.map((r) => ({
          ...r,
          acoustic_params: JSON.parse(String(r.acoustic_params_json)),
          feedback_tags: JSON.parse(String(r.feedback_tags_json ?? '[]')),
          acoustic_params_json: undefined,
          feedback_tags_json: undefined,
        }));

        return new Response(
          JSON.stringify(
            {
              platform: 'nootropic.fm',
              license: 'Anonymized Open Research Dataset',
              exportedAt: new Date().toISOString(),
              count: sanitized.length,
              records: sanitized,
            },
            null,
            2
          ),
          {
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'content-disposition': 'attachment; filename="nootropic-fm-research-dataset.json"',
              ...corsHeaders(request),
            },
          }
        );
      }

      return json({ error: 'API route not found' }, 404);
    } catch (err) {
      console.error('Worker API error:', err);
      return json(
        { error: err instanceof Error ? err.message : 'Internal server error' },
        500
      );
    }
  },
};
