import { parseNaturalCheckIn } from '../shared/parser';
import {
  PROTOCOL_ARMS,
  buildCohortKey,
  computeSessionReward,
  formatCohortLabel,
  selectProtocolRecommendation,
  type BanditStatRow,
} from '../shared/protocols';
import {
  ageToBand,
  GENRE_META,
  getTimeOfDayBucket,
  type ABValidationStats,
  type AcousticParams,
  type ArmPerformance,
  type CohortPerformance,
  type CurrentState,
  type DebriefPayload,
  type EnergyTier,
  type GenrePerformance,
  type LiveAdjustment,
  type LivePubMedPaper,
  type MusicGenreChoice,
  type OutputDevice,
  type ParsedCheckIn,
  type ResearchInsights,
  type ResolvedGenre,
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
  `CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
];

const MIGRATION_ALTERS = [
  `ALTER TABLE profiles ADD COLUMN preferred_mod_mult REAL NOT NULL DEFAULT 1.0`,
  `ALTER TABLE sessions ADD COLUMN is_control_trial INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE sessions ADD COLUMN energy_tier TEXT NOT NULL DEFAULT 'focus'`,
  `ALTER TABLE sessions ADD COLUMN music_genre TEXT NOT NULL DEFAULT 'deep_electronic'`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_control ON sessions(is_control_trial, status)`,
];

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  for (const sql of MIGRATION_ALTERS) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Column or index already exists
    }
  }
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
    ALLOWED_ORIGINS.has(origin) ||
    origin.endsWith('.workers.dev') ||
    origin.endsWith('.web.app') ||
    origin.endsWith('.firebaseapp.com') ||
    origin.endsWith('.vercel.app')
      ? origin
      : '*';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-admin-key, authorization',
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const expected = env.ADMIN_EXPORT_KEY?.trim();
  if (!expected) return false;
  const headerKey = request.headers.get('x-admin-key')?.trim() ?? '';
  const authHeader = request.headers.get('authorization')?.trim() ?? '';
  const bearerKey = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  return constantTimeEqual(headerKey, expected) || constantTimeEqual(bearerKey, expected);
}

async function checkDailyRateLimit(
  db: D1Database,
  request: Request,
  action: string,
  maxPerDay: number
): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`nootropic-fm:${day}:${action}:${ip}`)
  );
  const hashHex = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const bucketKey = `${day}:${action}:${hashHex}`;

  const existing = await db
    .prepare('SELECT hits FROM rate_limits WHERE bucket_key = ?')
    .bind(bucketKey)
    .first<{ hits: number }>();

  if ((existing?.hits ?? 0) >= maxPerDay) {
    return false;
  }

  await db
    .prepare(
      `INSERT INTO rate_limits (bucket_key, hits, updated_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET hits = hits + 1, updated_at = excluded.updated_at`
    )
    .bind(bucketKey, new Date().toISOString())
    .run();

  return true;
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
    preferredModMult:
      row.preferred_mod_mult === null || row.preferred_mod_mult === undefined
        ? 1.0
        : Number(row.preferred_mod_mult),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSessionRow(row: Record<string, unknown>): SessionRecord {
  const acousticParams = JSON.parse(String(row.acoustic_params_json)) as AcousticParams;
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
    isControlTrial: Number(row.is_control_trial ?? 0) === 1,
    energyTier: (String(row.energy_tier || acousticParams.energyTier || 'focus') as EnergyTier),
    musicGenre: (String(row.music_genre || acousticParams.genre || 'deep_electronic') as ResolvedGenre),
    acousticParams,
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
    const prompt = `Extract structured audio session context from the user's message. Respond STRICTLY with a valid JSON object (no markdown) with these keys:
{
  "extractedAge": number | null,
  "currentState": "distracted" | "fatigued" | "stressed" | "anxious" | "calm_neutral" | "restless",
  "targetState": "alert_focus" | "deep_flow" | "calm_reset" | "energy_lift" | "sleep_winddown",
  "environment": "driving" | "office" | "study" | "home_relax" | "transit",
  "device": "headphones" | "speakers" | "car_audio",
  "durationMin": number
}
Safety rule: if the user is driving (driver, car, bus, minibus, truck, road), set environment="driving", device="car_audio", and targetState MUST NOT be "sleep_winddown" or "calm_reset" (use "alert_focus").
Message: """${rawText}"""`;

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

const pubmedCache = new Map<string, { expiresAt: number; papers: LivePubMedPaper[] }>();

/**
 * Live peer-reviewed study lookup against official US National Library of Medicine (NIH) PubMed API.
 * Free ($0), cached 12h per context, strict 2.6s timeout so protocol synthesis is always snappy.
 */
async function fetchLivePubMedPapers(
  targetState: TargetState,
  environment: SessionEnvironment
): Promise<LivePubMedPaper[]> {
  const cacheKey = `${environment}:${targetState}`;
  const cached = pubmedCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.papers;
  }

  const queryByContext = (): string => {
    if (environment === 'driving') {
      return '(music[Title/Abstract] OR auditory[Title/Abstract]) AND (driving[Title/Abstract] OR vigilance[Title/Abstract]) AND (attention[Title/Abstract] OR arousal[Title/Abstract])';
    }
    if (targetState === 'sleep_winddown') {
      return 'music[Title/Abstract] AND ("sleep quality"[Title/Abstract] OR "slow oscillation"[Title/Abstract] OR insomnia[Title/Abstract])';
    }
    if (targetState === 'calm_reset') {
      return 'music[Title/Abstract] AND (cortisol[Title/Abstract] OR "autonomic"[Title/Abstract] OR "stress recovery"[Title/Abstract])';
    }
    if (targetState === 'energy_lift') {
      return 'music[Title/Abstract] AND (tempo[Title/Abstract] OR arousal[Title/Abstract]) AND (fatigue[Title/Abstract] OR alertness[Title/Abstract])';
    }
    return '("amplitude modulation"[Title/Abstract] OR "background music"[Title/Abstract] OR "white noise"[Title/Abstract]) AND ("sustained attention"[Title/Abstract] OR "cognitive performance"[Title/Abstract])';
  };

  try {
    const term = encodeURIComponent(queryByContext());
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&sort=relevance&term=${term}`;
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(2600),
      headers: { 'user-agent': 'nootropic.fm/1.0 (open-research-psychoacoustics)' },
    });
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = (searchData.esearchresult?.idlist ?? []).slice(0, 2);
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`;
    const sumRes = await fetch(summaryUrl, {
      signal: AbortSignal.timeout(2600),
      headers: { 'user-agent': 'nootropic.fm/1.0 (open-research-psychoacoustics)' },
    });
    if (!sumRes.ok) return [];
    const sumData = (await sumRes.json()) as {
      result?: Record<
        string,
        {
          uid?: string;
          title?: string;
          authors?: Array<{ name?: string }>;
          fulljournalname?: string;
          source?: string;
          pubdate?: string;
        }
      >;
    };

    const papers: LivePubMedPaper[] = [];
    for (const id of ids) {
      const item = sumData.result?.[id];
      if (!item?.title) continue;
      const firstAuthor = item.authors?.[0]?.name ?? 'Research Team';
      const authorLabel =
        (item.authors?.length ?? 0) > 1 ? `${firstAuthor} et al.` : firstAuthor;
      const yearMatch = (item.pubdate ?? '').match(/\d{4}/);
      papers.push({
        pmid: id,
        title: item.title.replace(/\.$/, ''),
        authors: authorLabel,
        journal: item.fulljournalname || item.source || 'PubMed Indexed Journal',
        year: yearMatch ? yearMatch[0] : 'Peer-Reviewed',
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      });
    }

    if (papers.length > 0) {
      pubmedCache.set(cacheKey, {
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        papers,
      });
    }
    return papers;
  } catch {
    return [];
  }
}

type BanditScopeType = 'cohort' | 'profile' | 'cohort_genre' | 'profile_genre';

async function fetchBanditRows(
  db: D1Database,
  scopeType: BanditScopeType,
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
  scopeType: BanditScopeType,
  scopeId: string,
  armId: string,
  reward: number,
  delta: number,
  completionRatio: number,
  weight = 1.0
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
  const newAlpha = Number((prevAlpha + reward * weight).toFixed(3));
  const newBeta = Number((prevBeta + (1 - reward) * weight).toFixed(3));
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
        return json(
          {
            ok: true,
            mode: env.APP_ENV ?? 'open-research-beta',
            hasGemini: Boolean(env.GEMINI_API_KEY),
            exportProtected: Boolean(env.ADMIN_EXPORT_KEY),
            hasAudioBucket: Boolean(env.AUDIO_BUCKET),
          },
          200,
          request
        );
      }

      // GET /api/audio/catalog — Lists studio audio stems uploaded to Cloudflare R2 per genre x energy tier
      if (url.pathname === '/api/audio/catalog' && request.method === 'GET') {
        const tracksByGenre: Record<
          ResolvedGenre,
          Array<{ key: string; name: string; url: string; size: number; energy: EnergyTier }>
        > = {
          lofi_keys: [],
          deep_electronic: [],
          cinematic_strings: [],
          jazz_rhodes: [],
          acoustic_pluck: [],
          nature_rain: [],
        };

        const defaultEnergyForGenre = (g: ResolvedGenre): EnergyTier => {
          if (g === 'nature_rain') return 'calm';
          if (g === 'deep_electronic') return 'drive';
          return 'focus';
        };

        if (env.AUDIO_BUCKET) {
          const listed = await env.AUDIO_BUCKET.list({ limit: 500 });
          for (const obj of listed.objects) {
            if (!/\.(mp3|ogg|opus|m4a|wav)$/i.test(obj.key)) continue;
            const segments = obj.key.split('/');
            const folder = segments[0];
            if (!(folder in tracksByGenre) || segments.length < 2) continue;

            const genreKey = folder as ResolvedGenre;
            let energy: EnergyTier = defaultEnergyForGenre(genreKey);
            let fileName = segments[segments.length - 1];

            // Supports both <genre>/<energy>/<file>.mp3 and flat <genre>/<file>.mp3
            if (segments.length >= 3 && (segments[1] === 'calm' || segments[1] === 'focus' || segments[1] === 'drive')) {
              energy = segments[1] as EnergyTier;
              fileName = segments.slice(2).join('/');
            } else {
              const lower = fileName.toLowerCase();
              if (lower.startsWith('calm_') || lower.startsWith('calm-')) energy = 'calm';
              else if (lower.startsWith('drive_') || lower.startsWith('drive-')) energy = 'drive';
              else if (lower.startsWith('focus_') || lower.startsWith('focus-')) energy = 'focus';
            }

            const cleanName = fileName
              .replace(/\.[^.]+$/, '')
              .replace(/^(calm|focus|drive)[-_]+/i, '')
              .replace(/[-_]+/g, ' ')
              .trim();

            const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
            tracksByGenre[genreKey].push({
              key: obj.key,
              name: cleanName || 'Studio Track',
              url: `/api/audio/stream/${encodedPath}`,
              size: obj.size,
              energy,
            });
          }
        }

        return json({ tracksByGenre }, 200, request);
      }

      // GET /api/audio/stream/:genre/:file — Streams studio stems directly from Cloudflare R2 ($0 egress!)
      if (url.pathname.startsWith('/api/audio/stream/') && request.method === 'GET') {
        if (!env.AUDIO_BUCKET) {
          return json({ error: 'Audio bucket not configured' }, 404, request);
        }
        const rawPath = url.pathname.replace('/api/audio/stream/', '');
        const key = rawPath
          .split('/')
          .map((seg) => decodeURIComponent(seg))
          .join('/');

        const object = await env.AUDIO_BUCKET.get(key);
        if (!object) {
          return json({ error: 'Audio track not found' }, 404, request);
        }

        const headers = new Headers(corsHeaders(request));
        object.writeHttpMetadata(headers);
        if (!headers.get('content-type')) {
          if (key.endsWith('.mp3')) headers.set('content-type', 'audio/mpeg');
          else if (key.endsWith('.ogg') || key.endsWith('.opus')) headers.set('content-type', 'audio/ogg');
          else if (key.endsWith('.m4a')) headers.set('content-type', 'audio/mp4');
          else if (key.endsWith('.wav')) headers.set('content-type', 'audio/wav');
          else headers.set('content-type', 'application/octet-stream');
        }
        headers.set('etag', object.etag);
        headers.set('cache-control', 'public, max-age=31536000, immutable');

        return new Response(object.body, { headers });
      }

      // POST /api/profile
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'profile', 60);
        if (!allowed) {
          return json({ error: 'Daily profile rate limit reached. Please try again tomorrow.' }, 429, request);
        }
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
        const allowed = await checkDailyRateLimit(env.DB, request, 'session_start', 35);
        if (!allowed) {
          return json({ error: 'Daily session rate limit reached. Please try again tomorrow.' }, 429, request);
        }
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
          requestedGenre?: MusicGenreChoice;
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

        const [cohortStats, profileStats, cohortGenreStats, profileGenreStats, livePubMedPapers] =
          await Promise.all([
            fetchBanditRows(env.DB, 'cohort', cohortKey),
            fetchBanditRows(env.DB, 'profile', profile.id),
            fetchBanditRows(env.DB, 'cohort_genre', cohortKey),
            fetchBanditRows(env.DB, 'profile_genre', profile.id),
            fetchLivePubMedPapers(effectiveTarget, body.environment),
          ]);

        const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const recommendation = {
          ...selectProtocolRecommendation({
            sessionId,
            profile,
            currentState: body.currentState,
            baselineScore: Math.max(1, Math.min(5, Number(body.baselineScore ?? 2))),
            targetState: body.targetState,
            environment: body.environment,
            device: body.device,
            durationMin: Math.max(5, Math.min(120, Number(body.durationMin ?? 30))),
            requestedGenre: body.requestedGenre,
            cohortStats,
            profileStats,
            cohortGenreStats,
            profileGenreStats,
          }),
          livePubMedPapers,
        };

        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (
            id, profile_id, cohort_key, raw_input_text, current_state, baseline_score,
            target_state, environment, device, safety_mode, planned_duration_min,
            actual_duration_sec, completion_ratio, arm_id, arm_name, is_exploration,
            is_control_trial, energy_tier, music_genre,
            acoustic_params_json, cited_study_ids_json, live_adjustments_json,
            time_of_day_bucket, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'pending_debrief', ?)`
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
            recommendation.isControlTrial ? 1 : 0,
            recommendation.params.energyTier,
            recommendation.params.genre,
            JSON.stringify(recommendation.params),
            JSON.stringify(recommendation.arm.studyIds),
            getTimeOfDayBucket(),
            now
          )
          .run();

        return json({ recommendation });
      }

      // POST /api/session/genre — Persists 1-tap Reveal or Player Layer 2 Music swaps for accurate Bandit attribution
      if (url.pathname === '/api/session/genre' && request.method === 'POST') {
        const body = (await request.json()) as {
          sessionId: string;
          genre: ResolvedGenre;
          params?: AcousticParams;
        };
        if (!body.sessionId || !(body.genre in GENRE_META)) {
          return json({ error: 'Invalid session or genre' }, 400, request);
        }
        const row = await env.DB.prepare('SELECT acoustic_params_json FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first<{ acoustic_params_json: string }>();
        if (!row) return json({ error: 'Session not found' }, 404, request);

        const prevParams = JSON.parse(String(row.acoustic_params_json)) as AcousticParams;
        const nextParams: AcousticParams = body.params
          ? { ...prevParams, ...body.params, genre: body.genre }
          : { ...prevParams, genre: body.genre, genreSelectionMode: 'user_chosen' };

        await env.DB.prepare(
          `UPDATE sessions SET music_genre = ?, acoustic_params_json = ? WHERE id = ?`
        )
          .bind(body.genre, JSON.stringify(nextParams), body.sessionId)
          .run();

        return json({ ok: true, genre: body.genre }, 200, request);
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
        const allowed = await checkDailyRateLimit(env.DB, request, 'debrief', 45);
        if (!allowed) {
          return json({ error: 'Daily debrief limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json()) as DebriefPayload;
        const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first();
        if (!row) return json({ error: 'Session not found' }, 404, request);

        const session = mapSessionRow(row);
        if (session.status === 'completed') {
          return json({ error: 'This session has already been rated.' }, 409, request);
        }

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

        // Scientific data hygiene: full Bandit weight for >=60s listening; softer weight for brief previews
        const learningWeight = actualSec >= 60 ? 1.0 : 0.35;

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

        // Update BOTH Layer 1 (protocol arm) AND Layer 2 (music genre) Bandit models —
        // strictly skipping active-AM Bandit arm updates on Blind Pure-Music Control trials so control
        // sessions never pollute active protocol scoring (they feed A/B Validation instead!).
        let cohortUpdated = { successRatePct: 0, trials: 0 };
        let profileUpdated = { successRatePct: 0, trials: 0 };
        const finalGenre = session.musicGenre || session.acousticParams?.genre || 'deep_electronic';

        if (!session.isControlTrial) {
          const [cUp, pUp] = await Promise.all([
            updateBanditScope(env.DB, 'cohort', session.cohortKey, session.armId, reward, delta, completionRatio, learningWeight),
            updateBanditScope(env.DB, 'profile', session.profileId, session.armId, reward, delta, completionRatio, learningWeight),
            updateBanditScope(env.DB, 'cohort_genre', session.cohortKey, finalGenre, reward, delta, completionRatio, learningWeight),
            updateBanditScope(env.DB, 'profile_genre', session.profileId, finalGenre, reward, delta, completionRatio, learningWeight),
          ]);
          cohortUpdated = cUp;
          profileUpdated = pUp;
        } else {
          // Control trial still teaches Layer 2 music preference cleanly
          await Promise.all([
            updateBanditScope(env.DB, 'cohort_genre', session.cohortKey, finalGenre, reward, delta, completionRatio, learningWeight * 0.75),
            updateBanditScope(env.DB, 'profile_genre', session.profileId, finalGenre, reward, delta, completionRatio, learningWeight * 0.75),
          ]);
          const [cStats, pStats] = await Promise.all([
            fetchBanditRows(env.DB, 'cohort', session.cohortKey),
            fetchBanditRows(env.DB, 'profile', session.profileId),
          ]);
          const cRow = cStats.find((r) => r.armId === session.armId);
          const pRow = pStats.find((r) => r.armId === session.armId);
          cohortUpdated = {
            trials: cRow?.trials ?? 0,
            successRatePct: cRow ? Math.round((cRow.alpha / (cRow.alpha + cRow.beta)) * 100) : 70,
          };
          profileUpdated = {
            trials: pRow?.trials ?? 0,
            successRatePct: pRow ? Math.round((pRow.alpha / (pRow.alpha + pRow.beta)) * 100) : 70,
          };
        }

        // Adapt user's personal AM sensitivity multiplier from debrief tags + live modulation tweaks
        let updatedModMult = 1.0;
        const profRow = await env.DB.prepare('SELECT preferred_mod_mult FROM profiles WHERE id = ?')
          .bind(session.profileId)
          .first<{ preferred_mod_mult?: number }>();
        const prevMult = Number(profRow?.preferred_mod_mult ?? 1.0);
        let multDelta = 0;
        const tags = body.feedbackTags ?? [];
        if (tags.includes('A bit too intense') || tags.includes('Modulation felt distracting')) {
          multDelta -= 0.08;
        }
        if (tags.includes('Wanted stronger focus')) {
          multDelta += 0.06;
        }
        const netModTweak = liveAdjustments
          .filter((a) => a.control === 'modulation')
          .reduce((acc, a) => acc + a.delta, 0);
        if (netModTweak !== 0) {
          multDelta += Math.max(-0.1, Math.min(0.1, netModTweak * 0.35));
        }
        updatedModMult = Number(Math.max(0.65, Math.min(1.35, prevMult + multDelta)).toFixed(2));
        if (multDelta !== 0 && !session.isControlTrial) {
          await env.DB.prepare('UPDATE profiles SET preferred_mod_mult = ?, updated_at = ? WHERE id = ?')
            .bind(updatedModMult, now, session.profileId)
            .run();
        }

        return json({
          ok: true,
          learningUpdate: {
            sessionId: session.id,
            armId: session.armId,
            armName: session.armName,
            cohortKey: session.cohortKey,
            cohortLabel: formatCohortLabel(session.cohortKey),
            delta,
            reward,
            cohortSuccessRatePct: cohortUpdated.successRatePct,
            cohortTrials: cohortUpdated.trials,
            profileSuccessRatePct: profileUpdated.successRatePct,
            profileTrials: profileUpdated.trials,
            wasControlTrial: session.isControlTrial,
            preferredModMult: updatedModMult,
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

        // Blind A/B Scientific Validation: Active 3-Band AM vs Pure-Music Control (AM = 0%)
        const activeCompleted = completed.filter((s) => !s.isControlTrial);
        const controlCompleted = completed.filter((s) => s.isControlTrial);
        const avgDeltaOf = (list: SessionRecord[]) =>
          list.length > 0
            ? Number((list.reduce((acc, s) => acc + (s.deltaScore ?? 0), 0) / list.length).toFixed(2))
            : 0;
        const successPctOf = (list: SessionRecord[]) =>
          list.length > 0
            ? Math.round(
                (list.filter(
                  (s) => s.workedRating === 'yes' || (s.workedRating === 'partial' && (s.deltaScore ?? 0) > 0)
                ).length /
                  list.length) *
                  100
              )
            : 0;
        const activeAvgDelta = avgDeltaOf(activeCompleted);
        const controlAvgDelta = avgDeltaOf(controlCompleted);
        const abValidation: ABValidationStats = {
          activeSessions: activeCompleted.length,
          controlSessions: controlCompleted.length,
          activeAvgDelta,
          controlAvgDelta,
          activeSuccessRatePct: successPctOf(activeCompleted),
          controlSuccessRatePct: successPctOf(controlCompleted),
          deltaLift:
            activeCompleted.length > 0 && controlCompleted.length > 0
              ? Number((activeAvgDelta - controlAvgDelta).toFixed(2))
              : 0,
          readyForStats: activeCompleted.length >= 10 && controlCompleted.length >= 5,
        };

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
              cohortLabel: formatCohortLabel(cohortKey),
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

        // Aggregate Music Genre Layer performance across real completed sessions
        const genreBuckets = new Map<ResolvedGenre, { total: number; positive: number; deltaSum: number }>();
        for (const s of completed) {
          const g = (s.acousticParams?.genre as ResolvedGenre | undefined) ?? 'deep_electronic';
          if (!GENRE_META[g]) continue;
          const b = genreBuckets.get(g) ?? { total: 0, positive: 0, deltaSum: 0 };
          b.total += 1;
          if (s.workedRating === 'yes' || (s.workedRating === 'partial' && (s.deltaScore ?? 0) > 0)) {
            b.positive += 1;
          }
          b.deltaSum += s.deltaScore ?? 0;
          genreBuckets.set(g, b);
        }
        const genreLeaderboard: GenrePerformance[] = Array.from(genreBuckets.entries())
          .map(([genre, b]) => ({
            genre,
            label: GENRE_META[genre].label,
            sessions: b.total,
            successRatePct: Math.round((b.positive / b.total) * 100),
            avgDelta: Number((b.deltaSum / b.total).toFixed(2)),
          }))
          .sort((a, b) => b.successRatePct - a.successRatePct || b.sessions - a.sessions);

        const insights: ResearchInsights = {
          totalProfiles: Number(profilesCountRow?.c ?? 0),
          totalSessions: sessions.length,
          completedDebriefs: completed.length,
          pendingDebriefs: pending.length,
          globalSuccessRatePct,
          globalAvgDelta,
          explorationSharePct,
          abValidation,
          cohorts,
          personalArms,
          genreLeaderboard,
          recentSessions: sessions.slice(0, 20).map((s) => ({
            ...s,
            rawInputText: '',
            notes: '',
          })),
        };

        return json({ insights }, 200, request);
      }

      // GET /api/dataset/export — Admin-Protected Anonymized Research Dataset (JSON or CSV)
      if (url.pathname === '/api/dataset/export' && request.method === 'GET') {
        if (!isAuthorizedAdmin(request, env)) {
          return json(
            {
              error:
                'Unauthorized. Dataset export is restricted to nootropic.fm researchers (provide X-Admin-Key header).',
            },
            401,
            request
          );
        }
        const format = url.searchParams.get('format') ?? 'json';
        const rows = await env.DB.prepare(
          `SELECT
            s.id AS session_id,
            p.age_band,
            p.role,
            p.texture_pref,
            p.noise_sensitivity,
            p.preferred_mod_mult,
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
            s.is_control_trial,
            s.energy_tier,
            s.music_genre,
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
            'is_control_trial',
            'energy_tier',
            'music_genre',
            'genre_mode',
            'modulation_hz',
            'modulation_depth',
            'crossover_hz',
            'upper_crossover_hz',
            'stereo_am_spread',
            'preferred_mod_mult',
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
              r.is_control_trial ?? 0,
              r.energy_tier ?? ap.energyTier ?? 'focus',
              r.music_genre ?? ap.genre ?? 'auto',
              ap.genreSelectionMode ?? 'auto',
              ap.modulationHz,
              ap.modulationDepth,
              ap.crossoverHz ?? 190,
              ap.upperCrossoverHz ?? 4500,
              ap.stereoAmSpread ? 1 : 0,
              r.preferred_mod_mult ?? 1.0,
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
