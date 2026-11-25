import { parseNaturalCheckIn } from '../shared/parser';
import { getCuratedGoalBySlug, resolveOpenGoalIntent } from '../shared/openGoals';
import { STUDIO_STEM_V7_MANIFEST } from '../shared/studioStemManifest';
import {
  composeScientificMusicPrompt,
  getGenreDisplayMeta,
  matchCoreGenreAlias,
  sanitizeCustomVibe,
} from '../shared/promptComposer';
import {
  PROTOCOL_ARMS,
  buildCohortKey,
  buildFactorizedMarginalScopes,
  computeImplicitReward,
  computeSessionReward,
  formatCohortLabel,
  resolveEnergyTier,
  selectProtocolRecommendation,
  type BanditStatRow,
} from '../shared/protocols';
import {
  ageToBand,
  GENRE_META,
  getTimeOfDayBucket,
  ROLE_LABELS,
  STATE_LABELS,
  TARGET_LABELS,
  type ABValidationStats,
  type AcousticParams,
  type AppRuntimeConfig,
  type ArchetypeComboPerformance,
  type ArmPerformance,
  type AudioSourceType,
  type CohortIntelligenceCard,
  type CohortPerformance,
  type CurrentState,
  type CustomTrackInfo,
  type DatasetInquiryPayload,
  type DebriefPayload,
  type EnergyTier,
  type GenrePerformance,
  type GlobalRetentionFunnel,
  type LiveAdjustment,
  type MusicGenreChoice,
  type OutputDevice,
  type ParsedCheckIn,
  type ResearchInsights,
  type ResolvedGenre,
  type RetentionMetrics,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserProfile,
  type WorkedRating,
} from '../shared/types';
import type { D1Database, Env, ExecutionContext } from './env';
import { fetchVerifiedLiveLiterature } from './literature';
import { resolveMusicProvider } from './musicProviders';
import { compileMedicalStudy, searchLiveMedicalStudies } from './studyCompiler';
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  retrieveStripeCheckoutSession,
  verifyStripeWebhookSignature,
  type BillingPlanCycle,
} from './stripeBilling';
import { buildRecommendationFromStudySpec } from '../shared/studyCompilerCore';
import { VERIFIED_STUDY_PRESETS } from '../shared/studyPresets';

const EEA_UK_CH_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'GB', 'UK', 'CH',
]);

const ALLOWED_ORIGINS = new Set([
  'https://nootropic.fm',
  'https://www.nootropic.fm',
  'https://app.nootropic.fm',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function isTrustedOrigin(origin: string): boolean {
  if (!origin) return false;
  return (
    ALLOWED_ORIGINS.has(origin) ||
    origin.endsWith('.workers.dev') ||
    origin.endsWith('.web.app') ||
    origin.endsWith('.firebaseapp.com') ||
    origin.endsWith('.vercel.app')
  );
}

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') ?? '';
  const trusted = isTrustedOrigin(origin);
  return {
    'access-control-allow-origin': trusted ? origin : '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-admin-key, x-profile-token, authorization',
    ...(trusted ? { 'access-control-allow-credentials': 'true', vary: 'Origin' } : {}),
  };
}

const API_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

const AUTH_COOKIE_NAME = 'nfm_auth';

function extractProfileTokenFromRequest(request: Request): string {
  const headerTok = request.headers.get('x-profile-token')?.trim() ?? '';
  if (headerTok) return headerTok;
  const cookieHeader = request.headers.get('cookie') ?? '';
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = part.slice(0, eqIdx).trim();
    if (k === AUTH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eqIdx + 1).trim());
      } catch {
        return part.slice(eqIdx + 1).trim();
      }
    }
  }
  return '';
}

function buildAuthSetCookieHeader(request: Request, token: string | null): string {
  const isHttps = (() => {
    try {
      return new URL(request.url).protocol === 'https:';
    } catch {
      return true;
    }
  })();
  const secureFlag = isHttps ? '; Secure' : '';
  if (!token) {
    return `${AUTH_COOKIE_NAME}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag}`;
  }
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api; Max-Age=7776000; HttpOnly; SameSite=Lax${secureFlag}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeRealtimeActorKey(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  return (await sha256Hex(`nootropic-fm:ws-actor:${ip}`)).slice(0, 24);
}

async function signRealtimeTicket(
  secret: string,
  actorKey: string,
  isPro: boolean,
  ttlMs = 120_000
): Promise<{ ticket: string; expiresAt: string }> {
  const expMs = Date.now() + ttlMs;
  const nonceBytes = new Uint8Array(12);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const proFlag = isPro ? '1' : '0';
  const payload = `${expMs}.${nonce}.${proFlag}`;
  const sig = await hmacSha256Hex(secret, `lyria-rt:v2:${payload}.${actorKey}`);
  return {
    ticket: `${payload}.${sig}`,
    expiresAt: new Date(expMs).toISOString(),
  };
}

async function verifyRealtimeTicket(
  secret: string,
  ticket: string,
  actorKey: string
): Promise<{ valid: boolean; nonce: string; expMs: number; isPro: boolean }> {
  const parts = ticket.split('.');
  if (parts.length !== 4) {
    return { valid: false, nonce: '', expMs: 0, isPro: false };
  }
  const [expStr, nonce, proFlag, sig] = parts;
  const expMs = Number(expStr);
  if (
    !Number.isFinite(expMs) ||
    expMs < Date.now() ||
    !nonce ||
    nonce.length < 16 ||
    (proFlag !== '0' && proFlag !== '1') ||
    !sig
  ) {
    return { valid: false, nonce: '', expMs: 0, isPro: false };
  }
  const expected = await hmacSha256Hex(secret, `lyria-rt:v2:${expStr}.${nonce}.${proFlag}.${actorKey}`);
  if (!constantTimeEqual(sig, expected)) {
    return { valid: false, nonce: '', expMs: 0, isPro: false };
  }
  return { valid: true, nonce, expMs, isPro: proFlag === '1' };
}

interface CfWebSocket {
  accept(): void;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (evt: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: 'close', listener: (evt: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}

function generateProfileToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `nfm_tok_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

const SYNC_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateSyncCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let chars = '';
  for (let i = 0; i < 8; i++) {
    chars += SYNC_ALPHABET[bytes[i] % SYNC_ALPHABET.length];
  }
  return `NFM-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

function normalizeSyncCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = cleaned.startsWith('NFM') ? cleaned.slice(3) : cleaned;
  if (body.length !== 8) return '';
  return `NFM-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function sanitizeDisplayName(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/[^a-zA-Z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
}

function sanitizeOccupation(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/[^a-zA-Z0-9\s/&-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function parseGenderValue(raw?: string): UserProfile['gender'] {
  if (raw === 'male' || raw === 'female' || raw === 'non_binary' || raw === 'prefer_not_to_say') {
    return raw;
  }
  return 'prefer_not_to_say';
}

function tokenHashMatches(providedHash: string, storedField: string): boolean {
  const hashes = storedField
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const h of hashes) {
    if (constantTimeEqual(providedHash, h)) return true;
  }
  return false;
}

function appendTokenHash(existingField: string, newHash: string): string {
  const hashes = existingField
    .split(',')
    .map((s) => s.trim())
    .filter((h) => h.length > 0 && h !== newHash);
  hashes.push(newHash);
  return hashes.slice(-8).join(',');
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
  if (maxPerDay <= 0) return false;
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const day = new Date().toISOString().slice(0, 10);
  const hashHex = (await sha256Hex(`nootropic-fm:${day}:${action}:${ip}`)).slice(0, 24);
  const bucketKey = `${day}:${action}:${hashHex}`;

  // Single atomic SQLite upsert + conditional increment: eliminates TOCTOU race & halves D1 round-trips
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket_key, hits, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         hits = rate_limits.hits + 1,
         updated_at = excluded.updated_at
       WHERE rate_limits.hits < ?
       RETURNING hits`
    )
    .bind(bucketKey, new Date().toISOString(), maxPerDay)
    .first<{ hits: number }>();

  return Boolean(row && row.hits <= maxPerDay);
}

function json(
  data: unknown,
  status = 200,
  request?: Request,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...corsHeaders(request),
      ...(extraHeaders ?? {}),
    },
  });
}

function mapProfileRow(row: Record<string, unknown>, sessionCount?: number): UserProfile {
  const rawPlan = String(row.plan_tier ?? 'free').toLowerCase();
  const proUntil = row.pro_until ? String(row.pro_until) : null;
  const isProActive =
    rawPlan === 'pro' && (!proUntil || Number.isNaN(Date.parse(proUntil)) || Date.parse(proUntil) > Date.now());
  return {
    id: String(row.id),
    displayName: row.display_name ? String(row.display_name) : undefined,
    age: Math.max(18, Number(row.age)),
    ageBand: ageToBand(Math.max(18, Number(row.age))),
    gender: parseGenderValue(row.gender ? String(row.gender) : undefined),
    role: String(row.role) as UserProfile['role'],
    occupationLabel: row.occupation_label ? String(row.occupation_label) : undefined,
    texturePref: String(row.texture_pref) as UserProfile['texturePref'],
    noiseSensitivity: String(row.noise_sensitivity) as UserProfile['noiseSensitivity'],
    defaultDevice: String(row.default_device) as OutputDevice,
    primaryChallenge: String(row.primary_challenge) as UserProfile['primaryChallenge'],
    researchConsent: Number(row.research_consent) === 1,
    preferredModMult:
      row.preferred_mod_mult === null || row.preferred_mod_mult === undefined
        ? 1.0
        : Number(row.preferred_mod_mult),
    planTier: isProActive ? 'pro' : 'free',
    proUntil,
    ...(typeof sessionCount === 'number' ? { sessionCount } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSessionRow(row: Record<string, unknown>, includeProfileId = true): SessionRecord {
  const acousticParams = JSON.parse(String(row.acoustic_params_json)) as AcousticParams;
  const rec: SessionRecord = {
    id: String(row.id),
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
    energyTier: String(row.energy_tier || acousticParams.energyTier || 'focus') as EnergyTier,
    musicGenre: String(row.music_genre || acousticParams.genre || 'deep_electronic'),
    initialMusicGenre: row.initial_music_genre ? String(row.initial_music_genre) : undefined,
    customGenreSlug: row.custom_genre_slug ? String(row.custom_genre_slug) : null,
    audioSource: (row.audio_source as AudioSourceType | undefined) ?? 'studio_library',
    retentionOutcome: row.retention_outcome ? String(row.retention_outcome) : null,
    acousticParams,
    citedStudyIds: JSON.parse(String(row.cited_study_ids_json)) as string[],
    liveAdjustments: JSON.parse(String(row.live_adjustments_json ?? '[]')) as LiveAdjustment[],
    timeOfDayBucket: String(row.time_of_day_bucket) as SessionRecord['timeOfDayBucket'],
    status: String(row.status) as SessionRecord['status'],
    postScore:
      row.post_score === null || row.post_score === undefined ? null : Number(row.post_score),
    deltaScore:
      row.delta_score === null || row.delta_score === undefined ? null : Number(row.delta_score),
    workedRating: (row.worked_rating as WorkedRating | null) ?? null,
    feedbackTags: JSON.parse(String(row.feedback_tags_json ?? '[]')) as string[],
    rewardScore:
      row.reward_score === null || row.reward_score === undefined ? null : Number(row.reward_score),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
  if (includeProfileId) {
    rec.profileId = String(row.profile_id);
  }
  return rec;
}

/**
 * Optional Gemini Flash check-in enhancement ONLY when explicitly opted in via ENABLE_LLM_PARSE="true".
 * Strictly isolated from GEMINI_MUSIC_API_KEY so Lyria billing never leaks into /api/parse!
 */
async function enhanceWithGeminiIfConfigured(
  env: Env,
  rawText: string,
  fallback: ParsedCheckIn
): Promise<ParsedCheckIn> {
  if (env.ENABLE_LLM_PARSE !== 'true' || !env.GEMINI_API_KEY || rawText.trim().length < 6) {
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
    const prompt = `Extract structured audio session context from the user's message. Respond STRICTLY with valid JSON (no markdown) with keys:
{
  "extractedAge": number | null,
  "currentState": "distracted" | "fatigued" | "stressed" | "anxious" | "calm_neutral" | "restless",
  "targetState": "alert_focus" | "deep_flow" | "calm_reset" | "energy_lift" | "sleep_winddown",
  "environment": "driving" | "office" | "study" | "home_relax" | "transit",
  "device": "headphones" | "speakers" | "car_audio",
  "durationMin": number
}
Safety rule: if driving (driver, car, bus, minibus, truck, road), set environment="driving", device="car_audio", and targetState MUST NOT be "sleep_winddown" or "calm_reset" (use "alert_focus").
Message: """${rawText}"""`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(4000),
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
      extractedAge:
        typeof parsed.extractedAge === 'number' && parsed.extractedAge >= 18
          ? parsed.extractedAge
          : fallback.extractedAge,
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

type BanditScopeType =
  | 'cohort'
  | 'profile'
  | 'profile_state'
  | 'cohort_genre'
  | 'profile_genre'
  | 'cohort_arm_genre'
  | 'marginal_goal_state'
  | 'marginal_goal_env'
  | 'marginal_goal_role';

function extractMarginalScopesFromSession(session: {
  cohortKey: string;
  targetState: TargetState;
  currentState: CurrentState;
  environment: SessionEnvironment;
}): Array<{ scopeType: BanditScopeType; scopeId: string }> {
  const parts = session.cohortKey.split('|');
  const role = parts.length >= 5 ? (parts[1] as UserProfile['role']) : undefined;
  const goalSlug = parts.length >= 5 ? parts[3] : parts[2] || session.targetState;
  return buildFactorizedMarginalScopes({
    targetState: session.targetState,
    customGoalSlug: goalSlug !== session.targetState ? goalSlug : undefined,
    currentState: session.currentState,
    environment: session.environment,
    role,
  });
}

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

async function fetchTopPersonalGenres(db: D1Database, profileId: string): Promise<ResolvedGenre[]> {
  const rows = await fetchBanditRows(db, 'profile_genre', profileId);
  return rows
    .filter((r) => r.armId in GENRE_META && r.trials >= 1 && r.alpha / (r.alpha + r.beta) >= 0.56)
    .sort((a, b) => b.alpha / (b.alpha + b.beta) - a.alpha / (a.alpha + a.beta))
    .slice(0, 2)
    .map((r) => r.armId as ResolvedGenre);
}

/**
 * Atomic, separated Explicit vs Implicit Bandit update with delta-replacement support
 * so an explicit debrief cleanly supersedes any earlier implicit retention update
 * (zero double counting & zero avg_delta dilution!).
 */
async function updateBanditScope(
  db: D1Database,
  opts: {
    scopeType: BanditScopeType;
    scopeId: string;
    armId: string;
    mode: 'explicit' | 'implicit' | 'return_bonus';
    reward: number;
    weight: number;
    delta?: number;
    completionRatio: number;
    supersedePrevReward?: number;
    supersedePrevWeight?: number;
  }
): Promise<{ alpha: number; beta: number; trials: number; successRatePct: number }> {
  const arm = PROTOCOL_ARMS.find((a) => a.id === opts.armId);
  const priorAlpha = arm?.priorAlpha ?? 2.5;
  const priorBeta = arm?.priorBeta ?? 1.5;

  const prevW = opts.supersedePrevWeight ?? 0;
  const prevR = opts.supersedePrevReward ?? 0;
  const addAlpha = Number((opts.reward * opts.weight - prevR * prevW).toFixed(3));
  const addBeta = Number(((1 - opts.reward) * opts.weight - (1 - prevR) * prevW).toFixed(3));

  const existing = await db
    .prepare(
      `SELECT alpha, beta, trials, explicit_trials, implicit_trials, explicit_delta_sum, retention_sum, avg_delta, avg_completion, avg_reward
       FROM bandit_stats WHERE scope_type = ? AND scope_id = ? AND arm_id = ?`
    )
    .bind(opts.scopeType, opts.scopeId, opts.armId)
    .first<Record<string, unknown>>();

  const prevAlpha = existing ? Number(existing.alpha) : priorAlpha;
  const prevBeta = existing ? Number(existing.beta) : priorBeta;
  const prevTrials = existing ? Number(existing.trials) : 0;
  const prevExpTrials = existing ? Number(existing.explicit_trials ?? 0) : 0;
  const prevImpTrials = existing ? Number(existing.implicit_trials ?? 0) : 0;
  const prevExpDeltaSum = existing ? Number(existing.explicit_delta_sum ?? 0) : 0;
  const prevRetSum = existing ? Number(existing.retention_sum ?? 0) : 0;
  const prevAvgReward = existing ? Number(existing.avg_reward ?? 0) : 0;

  const isReplacement = prevW > 0;
  const newExpTrials = opts.mode === 'explicit' ? prevExpTrials + 1 : prevExpTrials;
  const newImpTrials =
    opts.mode === 'implicit' && !isReplacement
      ? prevImpTrials + 1
      : opts.mode === 'explicit' && isReplacement
        ? Math.max(0, prevImpTrials - 1)
        : prevImpTrials;
  const newTrials =
    opts.mode === 'return_bonus'
      ? prevTrials
      : isReplacement
        ? Math.max(1, prevTrials)
        : prevTrials + 1;

  const newAlpha = Number(Math.max(0.2, prevAlpha + addAlpha).toFixed(3));
  const newBeta = Number(Math.max(0.2, prevBeta + addBeta).toFixed(3));
  const newExpDeltaSum =
    opts.mode === 'explicit' ? prevExpDeltaSum + (opts.delta ?? 0) : prevExpDeltaSum;
  const newRetSum =
    opts.mode === 'return_bonus' || isReplacement
      ? prevRetSum
      : prevRetSum + opts.completionRatio;

  const newAvgDelta =
    newExpTrials > 0 ? Number((newExpDeltaSum / newExpTrials).toFixed(3)) : 0;
  const newAvgComp =
    newTrials > 0 ? Number((newRetSum / newTrials).toFixed(3)) : opts.completionRatio;
  const newAvgReward =
    newTrials > 0
      ? Number(((prevAvgReward * prevTrials + opts.reward) / Math.max(1, prevTrials + 1)).toFixed(3))
      : opts.reward;

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO bandit_stats (
         scope_type, scope_id, arm_id, alpha, beta, trials,
         explicit_trials, implicit_trials, explicit_delta_sum, retention_sum,
         avg_delta, avg_completion, avg_reward, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_type, scope_id, arm_id) DO UPDATE SET
         alpha = excluded.alpha,
         beta = excluded.beta,
         trials = excluded.trials,
         explicit_trials = excluded.explicit_trials,
         implicit_trials = excluded.implicit_trials,
         explicit_delta_sum = excluded.explicit_delta_sum,
         retention_sum = excluded.retention_sum,
         avg_delta = excluded.avg_delta,
         avg_completion = excluded.avg_completion,
         avg_reward = excluded.avg_reward,
         updated_at = excluded.updated_at`
    )
    .bind(
      opts.scopeType,
      opts.scopeId,
      opts.armId,
      newAlpha,
      newBeta,
      newTrials,
      newExpTrials,
      newImpTrials,
      newExpDeltaSum,
      newRetSum,
      newAvgDelta,
      newAvgComp,
      newAvgReward,
      now
    )
    .run();

  return {
    alpha: newAlpha,
    beta: newBeta,
    trials: newTrials,
    successRatePct: Math.round((newAlpha / (newAlpha + newBeta)) * 100),
  };
}

interface StudioCatalogTrackItem {
  key: string;
  name: string;
  url: string;
  size: number;
  energy: EnergyTier;
  bpm: number;
  lufs: number;
  rootMidi: number;
  keyLabel: string;
  opusUrl?: string;
  aacUrl?: string;
  subHarmonicBpm?: number;
  alignedBandsHz?: number[];
  downbeatOffsetMs?: number;
  sampleRate?: number;
  v7Remastered?: boolean;
  durationSec?: number;
}

const STUDIO_TRACK_ACOUSTIC_MAP: Record<
  string,
  { bpm: number; lufs: number; rootMidi: number; keyLabel: string }
> = {
  'lofi_keys/focus/dusty-rhodes-88-1.mp3': { bpm: 88, lufs: -14.7, rootMidi: 48, keyLabel: 'C maj' },
  'lofi_keys/focus/dusty-rhodes-88-2.mp3': { bpm: 88, lufs: -14.7, rootMidi: 48, keyLabel: 'C maj' },
  'deep_electronic/drive/warm-analog-pulse-1.mp3': { bpm: 112, lufs: -12.9, rootMidi: 43, keyLabel: 'G min' },
  'deep_electronic/drive/warm-analog-pulse-2.mp3': { bpm: 112, lufs: -13.6, rootMidi: 43, keyLabel: 'G maj' },
  'cinematic_strings/focus/chamber-flow-92-1.mp3': { bpm: 92, lufs: -14.8, rootMidi: 46, keyLabel: 'Bb maj' },
  'cinematic_strings/focus/chamber-flow-92-2.mp3': { bpm: 92, lufs: -14.7, rootMidi: 46, keyLabel: 'Bb maj' },
  'jazz_rhodes/focus/late-night-rhodes-92-1.mp3': { bpm: 92, lufs: -13.4, rootMidi: 48, keyLabel: 'C maj' },
  'jazz_rhodes/focus/late-night-rhodes-92-2.mp3': { bpm: 92, lufs: -14.3, rootMidi: 48, keyLabel: 'C maj' },
  'acoustic_pluck/focus/nylon-arpeggios-90-1.mp3': { bpm: 90, lufs: -14.5, rootMidi: 43, keyLabel: 'G maj' },
  'acoustic_pluck/focus/nylon-arpeggios-90-2.mp3': { bpm: 90, lufs: -14.3, rootMidi: 43, keyLabel: 'G maj' },
  'nature_rain/calm/warm-rain-pads-1.mp3': { bpm: 0, lufs: -14.5, rootMidi: 51, keyLabel: 'Eb maj' },
  'nature_rain/calm/warm-rain-pads-2.mp3': { bpm: 0, lufs: -14.1, rootMidi: 44, keyLabel: 'Ab maj' },
  'dub_reggae/focus/warm-island-dub-88-1.mp3': { bpm: 88, lufs: -13.1, rootMidi: 44, keyLabel: 'Ab maj' },
  'dub_reggae/focus/warm-island-dub-88-2.mp3': { bpm: 88, lufs: -12.5, rootMidi: 43, keyLabel: 'G min' },
  'ambient_space/calm/celestial-drift-64-1.mp3': { bpm: 64, lufs: -12.0, rootMidi: 50, keyLabel: 'D maj' },
  'ambient_space/calm/celestial-drift-64-2.mp3': { bpm: 64, lufs: -11.8, rootMidi: 46, keyLabel: 'Bb min' },
  'solo_piano/calm/felt-piano-flow-72-1.mp3': { bpm: 72, lufs: -11.2, rootMidi: 49, keyLabel: 'Db maj' },
  'solo_piano/focus/felt-piano-flow-86-2.mp3': { bpm: 86, lufs: -11.6, rootMidi: 50, keyLabel: 'D maj' },
  'bossa_nova/focus/rio-bossa-groove-92-1.mp3': { bpm: 92, lufs: -12.7, rootMidi: 51, keyLabel: 'Eb maj' },
  'bossa_nova/focus/rio-bossa-groove-92-2.mp3': { bpm: 92, lufs: -12.6, rootMidi: 43, keyLabel: 'G maj' },
  'deep_electronic/calm/velvet-sub-horizon-68-1.mp3': { bpm: 68, lufs: -13.2, rootMidi: 43, keyLabel: 'G min' },
  'deep_electronic/calm/analog-drift-pulse-68-2.mp3': { bpm: 68, lufs: -13.4, rootMidi: 46, keyLabel: 'Bb min' },
  'deep_electronic/focus/neural-analog-flow-92-1.mp3': { bpm: 92, lufs: -12.9, rootMidi: 42, keyLabel: 'F# maj' },
  'deep_electronic/focus/modular-focus-grid-96-2.mp3': { bpm: 96, lufs: -12.8, rootMidi: 42, keyLabel: 'F# maj' },
  'lofi_keys/calm/evening-felt-rhodes-68-1.mp3': { bpm: 68, lufs: -12.5, rootMidi: 49, keyLabel: 'Db maj' },
  'ambient_space/focus/stellar-focus-pulse-84-1.mp3': { bpm: 84, lufs: -12.3, rootMidi: 50, keyLabel: 'D maj' },
};

// 5-minute isolate cache for core studio stems so we don't spam R2 Class A `list()` on every player mount
let coreCatalogCache: {
  expiresAt: number;
  tracksByGenre: Record<ResolvedGenre, StudioCatalogTrackItem[]>;
} | null = null;

async function getCoreStudioCatalog(env: Env) {
  if (coreCatalogCache && coreCatalogCache.expiresAt > Date.now()) {
    return coreCatalogCache.tracksByGenre;
  }

  const tracksByGenre: Record<ResolvedGenre, StudioCatalogTrackItem[]> = {
    lofi_keys: [],
    deep_electronic: [],
    cinematic_strings: [],
    jazz_rhodes: [],
    acoustic_pluck: [],
    nature_rain: [],
    dub_reggae: [],
    ambient_space: [],
    solo_piano: [],
    bossa_nova: [],
  };

  const defaultEnergyForGenre = (g: ResolvedGenre): EnergyTier => {
    if (g === 'nature_rain' || g === 'ambient_space' || g === 'solo_piano') return 'calm';
    if (g === 'deep_electronic') return 'drive';
    return 'focus';
  };

  const inferStudioTrackBpm = (g: ResolvedGenre, energy: EnergyTier, cleanName: string): number => {
    const explicitMatch =
      cleanName.match(/\b(4[89]|[5-9]\d|1[0-6]\d|17[0-5])\s*bpm\b/i) ??
      cleanName.match(/\b(4[89]|[5-9]\d|1[0-6]\d|17[0-5])(?:\s+\d+)?$/i);
    if (explicitMatch) return Number(explicitMatch[1]);
    switch (g) {
      case 'nature_rain':
        return 0;
      case 'ambient_space':
        return 64;
      case 'solo_piano':
        return energy === 'calm' ? 72 : 86;
      case 'lofi_keys':
      case 'dub_reggae':
        return 88;
      case 'acoustic_pluck':
        return 90;
      case 'cinematic_strings':
      case 'jazz_rhodes':
      case 'bossa_nova':
        return 92;
      case 'deep_electronic':
        return energy === 'calm' ? 68 : energy === 'focus' ? 94 : 112;
    }
  };

  if (env.AUDIO_BUCKET) {
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const listed = await env.AUDIO_BUCKET.list({
        limit: 500,
        cursor,
        include: ['customMetadata'],
      });
      for (const obj of listed.objects) {
        if (obj.key.startsWith('custom/') || obj.key.startsWith('v7/')) continue;
        if (!/\.(mp3|ogg|opus|m4a|wav)$/i.test(obj.key)) continue;
        const segments = obj.key.split('/');
        const folder = segments[0];
        if (!(folder in tracksByGenre) || segments.length < 2) continue;

        const genreKey = folder as ResolvedGenre;
        let energy: EnergyTier = defaultEnergyForGenre(genreKey);
        let fileName = segments[segments.length - 1];

        if (
          segments.length >= 3 &&
          (segments[1] === 'calm' || segments[1] === 'focus' || segments[1] === 'drive')
        ) {
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

        const resolvedName = cleanName || 'Studio Track';
        const encodedPath = segments.map((s) => encodeURIComponent(s)).join('/');
        const known = STUDIO_TRACK_ACOUSTIC_MAP[obj.key];
        const v7 = STUDIO_STEM_V7_MANIFEST[obj.key];
        const meta = obj.customMetadata ?? {};
        const metaBpm = Number(meta.bpm);
        const metaLufs = Number(meta.lufs);
        const metaRoot = Number(meta.rootMidi);

        tracksByGenre[genreKey].push({
          key: obj.key,
          name: resolvedName,
          url: `/api/audio/stream/${encodedPath}`,
          size: obj.size,
          energy,
          bpm:
            known?.bpm ??
            (Number.isFinite(metaBpm) && metaBpm >= 0
              ? Math.round(metaBpm)
              : inferStudioTrackBpm(genreKey, energy, resolvedName)),
          lufs:
            v7?.lufs ??
            known?.lufs ??
            (Number.isFinite(metaLufs) && metaLufs >= -32 && metaLufs <= -4
              ? Number(metaLufs.toFixed(1))
              : -14.0),
          rootMidi:
            known?.rootMidi ??
            (Number.isFinite(metaRoot) && metaRoot >= 36 && metaRoot <= 72
              ? Math.round(metaRoot)
              : 48),
          keyLabel: known?.keyLabel ?? (meta.keyLabel?.trim() || 'C min'),
          ...(v7
            ? {
                opusUrl: v7.opusUrl,
                aacUrl: v7.aacUrl,
                subHarmonicBpm: v7.subHarmonicBpm,
                alignedBandsHz: v7.alignedBandsHz,
                downbeatOffsetMs: v7.downbeatOffsetMs,
                sampleRate: v7.sampleRate,
                durationSec: v7.durationSec,
                v7Remastered: true,
              }
            : {}),
        });
      }
      if (!listed.truncated || !listed.cursor) break;
      cursor = listed.cursor;
    }
  }

  coreCatalogCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    tracksByGenre,
  };
  return tracksByGenre;
}

async function lookupCachedCustomTrack(
  db: D1Database,
  genreSlug: string,
  energyTier: EnergyTier
): Promise<CustomTrackInfo | null> {
  const exact = await db
    .prepare(
      `SELECT * FROM custom_tracks WHERE genre_slug = ? AND energy_tier = ? AND status = 'ready'
       ORDER BY RANDOM() LIMIT 1`
    )
    .bind(genreSlug, energyTier)
    .first<Record<string, unknown>>();

  const row =
    exact ??
    (await db
      .prepare(
        `SELECT * FROM custom_tracks WHERE genre_slug = ? AND status = 'ready'
         ORDER BY play_count DESC LIMIT 1`
      )
      .bind(genreSlug)
      .first<Record<string, unknown>>());

  if (!row) return null;
  const r2Key = String(row.r2_key);
  const encoded = r2Key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  return {
    id: String(row.id),
    genreSlug: String(row.genre_slug),
    displayLabel: String(row.display_label),
    energyTier: String(row.energy_tier) as EnergyTier,
    url: `/api/audio/stream/${encoded}`,
    provider: String(row.provider),
    bpm: Number(row.bpm ?? 92),
    durationSec: Number(row.duration_sec ?? 120),
    sizeBytes: Number(row.size_bytes ?? 0),
    playCount: Number(row.play_count ?? 0),
  };
}

async function verifyProfileAccess(
  db: D1Database,
  profileId: string,
  request: Request
): Promise<{
  ok: boolean;
  row: Record<string, unknown> | null;
  issuedLegacyToken?: string;
}> {
  const row = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(profileId).first();
  if (!row) return { ok: false, row: null };

  const storedHash = row.token_hash ? String(row.token_hash) : '';
  const providedToken = extractProfileTokenFromRequest(request);

  if (!storedHash) {
    // Seamless 1-time token issuance for existing v1 profiles created before migration 0004
    const freshToken = generateProfileToken();
    const freshHash = await sha256Hex(freshToken);
    await db
      .prepare('UPDATE profiles SET token_hash = ? WHERE id = ?')
      .bind(freshHash, profileId)
      .run();
    return { ok: true, row, issuedLegacyToken: freshToken };
  }

  if (!providedToken) {
    return { ok: false, row };
  }
  const providedHash = await sha256Hex(providedToken);
  if (!tokenHashMatches(providedHash, storedHash)) {
    return { ok: false, row };
  }
  return { ok: true, row };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      // GET /api/health
      if (url.pathname === '/api/health' && request.method === 'GET') {
        const provider = resolveMusicProvider(env);
        return json(
          {
            ok: true,
            version: '4.1',
            mode: env.APP_ENV ?? 'open-research-beta',
            hasGemini: env.ENABLE_LLM_PARSE === 'true' && Boolean(env.GEMINI_API_KEY),
            hasLiveMusicGen: Boolean(provider),
            hasLyriaRealtime: Boolean(env.GEMINI_MUSIC_API_KEY?.trim()),
            hasWorkersAi: Boolean(env.AI),
            hasStripe: Boolean(env.STRIPE_SECRET_KEY?.trim()),
            musicProvider: provider?.id ?? 'none',
            exportProtected: Boolean(env.ADMIN_EXPORT_KEY),
            hasAudioBucket: Boolean(env.AUDIO_BUCKET),
          },
          200,
          request
        );
      }

      // GET /api/config — Runtime privacy/region config + daily cap + popular Community R2 Cache vibes
      if (url.pathname === '/api/config' && request.method === 'GET') {
        const cfCountry = String(
          ((request as unknown as { cf?: { country?: string } }).cf?.country ?? 'US').toUpperCase()
        );
        const regionRequiresOptIn = EEA_UK_CH_COUNTRIES.has(cfCountry);
        const provider = resolveMusicProvider(env);
        const dailyCapMax = Math.max(0, Number(env.MUSIC_GEN_DAILY_CAP ?? '3'));
        const today = new Date().toISOString().slice(0, 10);

        const [usageRow, popularRes] = await Promise.all([
          env.DB.prepare('SELECT music_gen_calls FROM api_usage_daily WHERE day = ?')
            .bind(today)
            .first<{ music_gen_calls?: number }>(),
          env.DB.prepare(
            `SELECT genre_slug, display_label, energy_tier, SUM(play_count) AS total_plays
             FROM custom_tracks WHERE status = 'ready'
             GROUP BY genre_slug, energy_tier
             ORDER BY total_plays DESC, MAX(created_at) DESC
             LIMIT 10`
          ).all<Record<string, unknown>>(),
        ]);

        const usedToday = Number(usageRow?.music_gen_calls ?? 0);
        const config: AppRuntimeConfig = {
          regionRequiresOptIn,
          countryCode: cfCountry,
          customLiveGenAvailable: Boolean(provider) && usedToday < dailyCapMax,
          lyriaRealtimeAvailable: Boolean(env.GEMINI_MUSIC_API_KEY?.trim()),
          workersAiCompilerAvailable: Boolean(env.AI),
          stripeBillingAvailable: Boolean(env.STRIPE_SECRET_KEY?.trim()),
          musicProvider: provider?.id ?? 'cache_only',
          dailyCapMax,
          dailyCapRemaining: Math.max(0, dailyCapMax - usedToday),
          popularCustomVibes: popularRes.results.map((r) => ({
            genreSlug: String(r.genre_slug),
            displayLabel: String(r.display_label),
            energyTier: String(r.energy_tier) as EnergyTier,
            playCount: Number(r.total_plays ?? 0),
          })),
        };
        return json({ config }, 200, request);
      }

      // GET /api/studies/presets — Verified Ground-Truth Clinical Executable Study Presets ($0)
      if (url.pathname === '/api/studies/presets' && request.method === 'GET') {
        return json({ presets: VERIFIED_STUDY_PRESETS }, 200, request);
      }

      // GET /api/studies/leaderboard — Real Anonymized Community Empirical Results per Medical Study
      if (url.pathname === '/api/studies/leaderboard' && request.method === 'GET') {
        const res = await env.DB.prepare(
          `SELECT
             study_spec_id,
             MAX(study_title) AS study_title,
             MAX(entrainment_type) AS entrainment_type,
             AVG(frequency_hz) AS avg_hz,
             COUNT(*) AS sessions_n,
             SUM(CASE WHEN worked_rating = 'yes' OR (worked_rating = 'partial' AND COALESCE(delta_score, 0) > 0) THEN 1 ELSE 0 END) AS pos_n,
             AVG(delta_score) AS avg_delta,
             SUM(CASE WHEN pvt_delta_ms IS NOT NULL THEN 1 ELSE 0 END) AS pvt_trials,
             AVG(pvt_delta_ms) AS avg_pvt_delta_ms
           FROM study_outcomes
           WHERE is_control_trial = 0
           GROUP BY study_spec_id
           ORDER BY sessions_n DESC, avg_delta DESC
           LIMIT 30`
        ).all<Record<string, unknown>>();

        const entries = res.results.map((r) => {
          const n = Number(r.sessions_n ?? 0);
          const pvtTrials = Number(r.pvt_trials ?? 0);
          return {
            studySpecId: String(r.study_spec_id),
            studyTitle: String(r.study_title),
            entrainmentType: String(r.entrainment_type ?? 'amplitude_modulation'),
            frequencyHz: Number(Number(r.avg_hz ?? 0).toFixed(1)),
            sessions: n,
            successRatePct: n > 0 ? Math.round((Number(r.pos_n ?? 0) / n) * 100) : 0,
            avgDelta: Number(Number(r.avg_delta ?? 0).toFixed(2)),
            pvtTrials,
            avgPvtDeltaMs:
              pvtTrials > 0 && r.avg_pvt_delta_ms !== null && r.avg_pvt_delta_ms !== undefined
                ? Math.round(Number(r.avg_pvt_delta_ms))
                : null,
          };
        });

        return json({ leaderboard: entries }, 200, request);
      }

      // POST /api/studies/search — Live search across Europe PMC (PubMed/OA abstracts) & ClinicalTrials.gov v2 ($0)
      if (url.pathname === '/api/studies/search' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'study_search', 60);
        if (!allowed) {
          return json({ error: 'Daily study search limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json().catch(() => ({}))) as { query?: string };
        const q = String(body.query ?? '').trim();
        if (q.length < 2) {
          return json({ results: [] }, 200, request);
        }
        const results = await searchLiveMedicalStudies(env, q);
        return json({ results }, 200, request);
      }

      // POST /api/studies/compile — Compiles ANY PubMed/DOI/NCT/Topic/Abstract into an ExecutableStudySpec + Recommendation
      if (url.pathname === '/api/studies/compile' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'study_compile', 40);
        if (!allowed) {
          return json({ error: 'Daily study compilation limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json().catch(() => ({}))) as {
          queryOrText?: string;
          presetId?: string;
          pmid?: string;
          doi?: string;
          nctId?: string;
          abstractOverride?: string;
          titleOverride?: string;
          device?: OutputDevice;
          environment?: SessionEnvironment;
          preferredGenre?: ResolvedGenre;
          profileId?: string;
          ephemeralMode?: boolean;
        };

        const device: OutputDevice =
          body.device === 'speakers' || body.device === 'car_audio' ? body.device : 'headphones';
        const environment: SessionEnvironment =
          body.environment === 'driving' ||
          body.environment === 'office' ||
          body.environment === 'study' ||
          body.environment === 'home_relax' ||
          body.environment === 'transit'
            ? body.environment
            : device === 'car_audio'
              ? 'driving'
              : 'study';

        const { spec, fromCache } = await compileMedicalStudy(env, {
          queryOrText: String(body.queryOrText ?? ''),
          presetId: body.presetId,
          pmid: body.pmid,
          doi: body.doi,
          nctId: body.nctId,
          abstractOverride: body.abstractOverride,
          titleOverride: body.titleOverride,
          device,
          environment,
          preferredGenre: body.preferredGenre,
        });

        let sessionId = `eph_study_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
        let isPersisted = false;
        let studyProfile: UserProfile | null = null;
        let effectivePreferredGenre = body.preferredGenre;

        if (body.profileId && !body.ephemeralMode) {
          const auth = await verifyProfileAccess(env.DB, body.profileId, request);
          if (auth.row && auth.ok && Number(auth.row.research_consent) === 1) {
            studyProfile = mapProfileRow(auth.row);
            const pGenreRows = await fetchBanditRows(env.DB, 'profile_genre', studyProfile.id);
            if (!effectivePreferredGenre) {
              const bestRow = pGenreRows
                .filter((r) => r.armId in GENRE_META && r.trials >= 1 && r.alpha / (r.alpha + r.beta) >= 0.56)
                .sort((a, b) => b.alpha / (b.alpha + b.beta) - a.alpha / (a.alpha + a.beta))[0];
              if (bestRow) {
                effectivePreferredGenre = bestRow.armId as ResolvedGenre;
              }
            }
            if (spec.entrainment.modulationDepth > 0) {
              const modMult = Math.max(0.65, Math.min(1.35, studyProfile.preferredModMult ?? 1.0));
              spec.entrainment.modulationDepth = Number(
                Math.min(0.75, Math.max(0.1, spec.entrainment.modulationDepth * modMult)).toFixed(2)
              );
            }
            sessionId = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
            isPersisted = true;
          }
        }

        const recommendation = buildRecommendationFromStudySpec({
          spec,
          sessionId,
          device,
          environment,
          preferredGenre: effectivePreferredGenre,
          ephemeralMode: !isPersisted,
          cohortKey: studyProfile
            ? buildCohortKey(studyProfile.ageBand, environment, spec.protocol.targetState)
            : undefined,
        });

        if (isPersisted && studyProfile) {
          const now = new Date().toISOString();
          const finalGenreKey = recommendation.customGenreSlug ?? recommendation.params.genre;
          await env.DB.prepare(
            `INSERT INTO sessions (
              id, profile_id, cohort_key, raw_input_text, current_state, baseline_score,
              target_state, environment, device, safety_mode, planned_duration_min,
              actual_duration_sec, completion_ratio, arm_id, arm_name, is_exploration,
              is_control_trial, energy_tier, music_genre, initial_music_genre,
              custom_genre_slug, audio_source, study_spec_id,
              acoustic_params_json, cited_study_ids_json, live_adjustments_json,
              time_of_day_bucket, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, ?, ?, ?, NULL, ?, ?, ?, ?, '[]', ?, 'active', ?)`
          )
            .bind(
              sessionId,
              studyProfile.id,
              recommendation.cohortKey,
              `Study Lab: ${spec.shortLabel}`.slice(0, 500),
              recommendation.currentState,
              recommendation.baselineScore,
              recommendation.targetState,
              recommendation.environment,
              recommendation.device,
              recommendation.safetyMode ? 1 : 0,
              recommendation.plannedDurationMin,
              recommendation.arm.id,
              recommendation.arm.name,
              recommendation.params.energyTier,
              finalGenreKey,
              finalGenreKey,
              recommendation.audioSource,
              recommendation.executableSpec?.id ?? spec.id,
              JSON.stringify(recommendation.params),
              JSON.stringify(recommendation.arm.studyIds),
              getTimeOfDayBucket(),
              now
            )
            .run()
            .catch(() => {});
        }

        return json({ spec: recommendation.executableSpec ?? spec, recommendation, fromCache }, 200, request);
      }

      // POST /api/music/realtime-token — Mints a short-lived HMAC ticket for our secure Lyria RealTime WS proxy
      if (url.pathname === '/api/music/realtime-token' && request.method === 'POST') {
        const apiKey = env.GEMINI_MUSIC_API_KEY?.trim();
        if (!apiKey) {
          return json(
            {
              available: false,
              reason: 'Endless Stream is offline right now; continuing smoothly on Studio Mix.',
            },
            200,
            request
          );
        }

        // Pro members get 240 daily live-AI token refreshes (full multi-session infinite streaming)
        let isProCaller = false;
        const providedToken = extractProfileTokenFromRequest(request);
        if (providedToken) {
          const tokenHash = await sha256Hex(providedToken);
          const proRow = await env.DB.prepare(
            `SELECT plan_tier, pro_until, token_hash FROM profiles
             WHERE plan_tier = 'pro' AND token_hash LIKE ? LIMIT 5`
          )
            .bind(`%${tokenHash}%`)
            .all<Record<string, unknown>>();
          for (const row of proRow.results) {
            const stored = String(row.token_hash ?? '');
            const until = row.pro_until ? String(row.pro_until) : null;
            const validUntil = !until || Number.isNaN(Date.parse(until)) || Date.parse(until) > Date.now();
            if (validUntil && tokenHashMatches(tokenHash, stored)) {
              isProCaller = true;
              break;
            }
          }
        }

        const allowed = await checkDailyRateLimit(
          env.DB,
          request,
          isProCaller ? 'lyria_realtime_pro' : 'lyria_realtime_token',
          isProCaller ? 240 : 30
        );
        if (!allowed) {
          return json(
            {
              available: false,
              reason: 'Daily Endless Stream quota reached; continuing seamlessly on Studio Mix.',
            },
            200,
            request
          );
        }

        const actorKey = await computeRealtimeActorKey(request);
        const { ticket, expiresAt } = await signRealtimeTicket(apiKey, actorKey, isProCaller, 120_000);
        return json(
          {
            available: true,
            token: ticket,
            expiresAt,
            model: 'models/lyria-realtime-exp',
          },
          200,
          request
        );
      }

      // POST /api/admin/seed-studio-track — Admin-only curated Studio R2 catalog builder (copy or Lyria 3.5)
      if (url.pathname === '/api/admin/seed-studio-track' && request.method === 'POST') {
        if (!isAuthorizedAdmin(request, env)) {
          return json({ error: 'Unauthorized admin request' }, 401, request);
        }
        if (!env.AUDIO_BUCKET) {
          return json({ error: 'AUDIO_BUCKET not configured' }, 500, request);
        }

        const body = (await request.json().catch(() => ({}))) as {
          targetKey?: string;
          copyFromKey?: string;
          prompt?: string;
        };
        const targetKey = (body.targetKey ?? '').trim().replace(/^\/+/, '');
        if (!targetKey || !/^[a-z0-9_]+\/(calm|focus|drive)\/[a-z0-9_-]+\.mp3$/i.test(targetKey)) {
          return json(
            { error: 'targetKey must match <genre>/(calm|focus|drive)/<filename>.mp3' },
            400,
            request
          );
        }

        if (body.copyFromKey?.trim()) {
          const srcObj = await env.AUDIO_BUCKET.get(body.copyFromKey.trim());
          if (!srcObj) {
            return json({ error: `Source key not found: ${body.copyFromKey}` }, 404, request);
          }
          const bytes = new Uint8Array(await srcObj.arrayBuffer());
          await env.AUDIO_BUCKET.put(targetKey, bytes, {
            httpMetadata: {
              contentType: 'audio/mpeg',
              cacheControl: 'public, max-age=31536000, immutable',
            },
          });
          coreCatalogCache = null;
          return json({ ok: true, mode: 'copied', targetKey, sizeBytes: bytes.byteLength }, 200, request);
        }

        const prompt = (body.prompt ?? '').trim();
        if (prompt.length < 20) {
          return json({ error: 'Provide either copyFromKey or a detailed instrumental prompt' }, 400, request);
        }
        const provider = resolveMusicProvider(env);
        if (!provider) {
          return json({ error: 'Music provider not configured' }, 503, request);
        }

        const generated = await provider.generate({ prompt });
        await env.AUDIO_BUCKET.put(targetKey, generated.audioBytes, {
          httpMetadata: {
            contentType: generated.contentType || 'audio/mpeg',
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });
        coreCatalogCache = null;
        return json(
          {
            ok: true,
            mode: 'generated',
            targetKey,
            provider: generated.provider,
            modelId: generated.modelId,
            sizeBytes: generated.audioBytes.byteLength,
            estimatedDurationSec: generated.estimatedDurationSec,
          },
          200,
          request
        );
      }

      // GET /api/music/realtime-ws — Secure Cloudflare Workers WebSocket Proxy to Google Lyria RealTime (BidiGenerateMusic)
      // Enforces: Origin check + IP-bound HMAC + Atomic Single-Use Nonce (`jti`) + Active Socket Cap (<=2) + Hard Duration Ceiling!
      if (url.pathname === '/api/music/realtime-ws' && request.method === 'GET') {
        const apiKey = env.GEMINI_MUSIC_API_KEY?.trim();
        if (!apiKey) {
          return new Response('Lyria RealTime not configured', { status: 503 });
        }
        if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
          return new Response('Expected WebSocket Upgrade', { status: 426 });
        }
        const wsOrigin = request.headers.get('origin') ?? '';
        if (wsOrigin && !isTrustedOrigin(wsOrigin)) {
          return new Response('Untrusted WebSocket origin', { status: 403 });
        }

        const actorKey = await computeRealtimeActorKey(request);
        const ticket = url.searchParams.get('ticket') ?? '';
        const verified = await verifyRealtimeTicket(apiKey, ticket, actorKey);
        if (!verified.valid) {
          return new Response('Invalid or expired realtime ticket', { status: 401 });
        }

        const nowMs = Date.now();
        // 1. Atomic Single-Use Nonce (`jti`) Consumption in D1 — blocks 100% of replay attacks!
        const claimedNonce = await env.DB.prepare(
          `INSERT INTO used_ws_nonces (nonce, actor_key, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(nonce) DO NOTHING
           RETURNING nonce`
        )
          .bind(verified.nonce, actorKey, verified.expMs + 60_000)
          .first<{ nonce: string }>();

        if (!claimedNonce) {
          return new Response('Realtime ticket already consumed', { status: 401 });
        }

        // Opportunistic expired nonce & lease garbage collection
        ctx.waitUntil(
          env.DB.batch([
            env.DB.prepare('DELETE FROM used_ws_nonces WHERE expires_at < ?').bind(nowMs),
            env.DB.prepare('DELETE FROM active_ws_leases WHERE expires_at < ?').bind(nowMs),
          ]).catch(() => {})
        );

        // 2. Atomic Concurrent Active Socket Cap per actor (<= 2 allows smooth reconnect overlap while blocking parallel socket floods)
        const MAX_CONCURRENT_SOCKETS = 2;
        const maxSessionMs = verified.isPro ? 11 * 60 * 1000 : 110 * 1000;
        const leaseId = crypto.randomUUID();
        const claimedLease = await env.DB.prepare(
          `INSERT INTO active_ws_leases (lease_id, actor_key, expires_at)
           SELECT ?, ?, ?
           WHERE (SELECT COUNT(*) FROM active_ws_leases WHERE actor_key = ? AND expires_at > ?) < ?
           RETURNING lease_id`
        )
          .bind(leaseId, actorKey, nowMs + maxSessionMs, actorKey, nowMs, MAX_CONCURRENT_SOCKETS)
          .first<{ lease_id: string }>();
        if (!claimedLease) {
          return new Response('Concurrent realtime stream limit reached', { status: 429 });
        }

        const releaseLeaseOnce = (() => {
          let released = false;
          return () => {
            if (released) return;
            released = true;
            ctx.waitUntil(
              env.DB.prepare('DELETE FROM active_ws_leases WHERE lease_id = ?')
                .bind(leaseId)
                .run()
                .catch(() => {})
            );
          };
        })();

        const upstreamUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateMusic?key=${encodeURIComponent(apiKey)}`;
        const upstreamResp = (await fetch(upstreamUrl, {
          headers: { Upgrade: 'websocket' },
        })) as Response & { webSocket?: CfWebSocket };

        const upstream = upstreamResp.webSocket;
        if (!upstream) {
          releaseLeaseOnce();
          return new Response('Unable to connect to Google Lyria RealTime upstream', { status: 502 });
        }
        upstream.accept();

        const WsPairCtor = (globalThis as unknown as {
          WebSocketPair: new () => { 0: CfWebSocket; 1: CfWebSocket };
        }).WebSocketPair;
        const pair = new WsPairCtor();
        const client = pair[0];
        const server = pair[1];
        server.accept();

        const maxDurationTimer = setTimeout(() => {
          releaseLeaseOnce();
          try {
            upstream.close(1000, 'Session stream window complete');
          } catch {}
          try {
            server.close(1000, 'Session stream window complete');
          } catch {}
        }, maxSessionMs);

        const cleanupSocketSession = () => {
          clearTimeout(maxDurationTimer);
          releaseLeaseOnce();
        };

        const MAX_CLIENT_FRAME_BYTES = 16_384;
        const forwardWsFrame = async (target: CfWebSocket, data: unknown, asText = false, enforceCap = false) => {
          if (typeof data === 'string') {
            if (enforceCap && data.length > MAX_CLIENT_FRAME_BYTES) {
              throw new Error('Frame too large');
            }
            target.send(data);
            return;
          }
          if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            if (enforceCap && data.byteLength > MAX_CLIENT_FRAME_BYTES) {
              throw new Error('Frame too large');
            }
            if (asText) {
              target.send(new TextDecoder().decode(data as BufferSource));
            } else {
              target.send(data as ArrayBuffer | ArrayBufferView);
            }
            return;
          }
          if (data && typeof (data as { text?: () => Promise<string> }).text === 'function') {
            const blob = data as Blob;
            if (enforceCap && blob.size > MAX_CLIENT_FRAME_BYTES) {
              throw new Error('Frame too large');
            }
            if (asText) {
              target.send(await blob.text());
            } else {
              target.send(await blob.arrayBuffer());
            }
          }
        };

        server.addEventListener('message', (evt) => {
          void forwardWsFrame(upstream, evt.data, false, true).catch(() => {
            cleanupSocketSession();
            try { upstream.close(1009, 'Invalid client frame'); } catch {}
            try { server.close(1009, 'Invalid client frame'); } catch {}
          });
        });
        upstream.addEventListener('message', (evt) => {
          void forwardWsFrame(server, evt.data, true, false).catch(() => {
            cleanupSocketSession();
            try { upstream.close(1011, 'Client send failed'); } catch {}
          });
        });
        server.addEventListener('close', (evt) => {
          cleanupSocketSession();
          try { upstream.close(evt.code || 1000, evt.reason || ''); } catch {}
        });
        upstream.addEventListener('close', (evt) => {
          cleanupSocketSession();
          try { server.close(evt.code || 1000, evt.reason || ''); } catch {}
        });
        server.addEventListener('error', () => {
          cleanupSocketSession();
          try { upstream.close(1011, 'Client socket error'); } catch {}
        });
        upstream.addEventListener('error', () => {
          cleanupSocketSession();
          try { server.close(1011, 'Upstream socket error'); } catch {}
        });

        return new Response(null, {
          status: 101,
          webSocket: client,
        } as ResponseInit & { webSocket: CfWebSocket });
      }

      // GET /api/audio/catalog — Core Studio Stems + Community R2 Custom Tracks
      if (url.pathname === '/api/audio/catalog' && request.method === 'GET') {
        const [tracksByGenre, customRows] = await Promise.all([
          getCoreStudioCatalog(env),
          env.DB.prepare(
            `SELECT * FROM custom_tracks WHERE status = 'ready' ORDER BY play_count DESC, created_at DESC LIMIT 120`
          ).all<Record<string, unknown>>(),
        ]);

        const customTracks: CustomTrackInfo[] = customRows.results.map((row) => {
          const r2Key = String(row.r2_key);
          const encoded = r2Key
            .split('/')
            .map((s) => encodeURIComponent(s))
            .join('/');
          return {
            id: String(row.id),
            genreSlug: String(row.genre_slug),
            displayLabel: String(row.display_label),
            energyTier: String(row.energy_tier) as EnergyTier,
            url: `/api/audio/stream/${encoded}`,
            provider: String(row.provider),
            bpm: Number(row.bpm ?? 92),
            durationSec: Number(row.duration_sec ?? 120),
            sizeBytes: Number(row.size_bytes ?? 0),
            playCount: Number(row.play_count ?? 0),
          };
        });

        return json({ tracksByGenre, customTracks }, 200, request);
      }

      // GET / HEAD /api/audio/stream/* — Streams studio & custom R2 stems with HTTP Range (206) support ($0 egress!)
      if (
        url.pathname.startsWith('/api/audio/stream/') &&
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        if (!env.AUDIO_BUCKET) {
          return json({ error: 'Audio bucket not configured' }, 404, request);
        }
        const rawPath = url.pathname.replace('/api/audio/stream/', '');
        const key = rawPath
          .split('/')
          .map((seg) => decodeURIComponent(seg))
          .join('/');

        if (request.method === 'HEAD') {
          const headObj = await env.AUDIO_BUCKET.head(key);
          if (!headObj) {
            return json({ error: 'Audio track not found' }, 404, request);
          }
          const headers = new Headers(corsHeaders(request));
          headObj.writeHttpMetadata?.(headers);
          if (!headers.get('content-type')) {
            if (key.endsWith('.mp3')) headers.set('content-type', 'audio/mpeg');
            else if (key.endsWith('.opus')) headers.set('content-type', 'audio/ogg; codecs=opus');
            else if (key.endsWith('.ogg')) headers.set('content-type', 'audio/ogg');
            else if (key.endsWith('.m4a')) headers.set('content-type', 'audio/mp4');
            else if (key.endsWith('.wav')) headers.set('content-type', 'audio/wav');
            else headers.set('content-type', 'application/octet-stream');
          }
          headers.set('etag', headObj.etag);
          headers.set('accept-ranges', 'bytes');
          headers.set('content-length', String(headObj.size));
          headers.set('cache-control', 'public, max-age=31536000, immutable');
          return new Response(null, { status: 200, headers });
        }

        const rangeHeader = request.headers.get('range');
        let r2Range: { offset: number; length?: number } | undefined;
        if (rangeHeader) {
          const m = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
          if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Number(m[2]) : undefined;
            r2Range = {
              offset: start,
              ...(end !== undefined && end >= start ? { length: end - start + 1 } : {}),
            };
          }
        }

        const object = await env.AUDIO_BUCKET.get(key, r2Range ? { range: r2Range } : undefined);
        if (!object) {
          return json({ error: 'Audio track not found' }, 404, request);
        }

        const headers = new Headers(corsHeaders(request));
        object.writeHttpMetadata(headers);
        if (!headers.get('content-type')) {
          if (key.endsWith('.mp3')) headers.set('content-type', 'audio/mpeg');
          else if (key.endsWith('.opus')) headers.set('content-type', 'audio/ogg; codecs=opus');
          else if (key.endsWith('.ogg')) headers.set('content-type', 'audio/ogg');
          else if (key.endsWith('.m4a')) headers.set('content-type', 'audio/mp4');
          else if (key.endsWith('.wav')) headers.set('content-type', 'audio/wav');
          else headers.set('content-type', 'application/octet-stream');
        }
        headers.set('etag', object.etag);
        headers.set('accept-ranges', 'bytes');
        headers.set('cache-control', 'public, max-age=31536000, immutable');

        if (r2Range) {
          const end =
            r2Range.length !== undefined
              ? Math.min(object.size - 1, r2Range.offset + r2Range.length - 1)
              : object.size - 1;
          headers.set('content-range', `bytes ${r2Range.offset}-${end}/${object.size}`);
          headers.set('content-length', String(Math.max(0, end - r2Range.offset + 1)));
          return new Response(object.body, { status: 206, headers });
        }

        headers.set('content-length', String(object.size));
        return new Response(object.body, { status: 200, headers });
      }

      // POST /api/profile — Creates/updates 18+ listener profile with SHA-256 auth token
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'profile', 60);
        if (!allowed) {
          return json({ error: 'Daily profile rate limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json()) as Partial<UserProfile>;
        const rawAge = Number(body.age ?? 32);
        if (!Number.isFinite(rawAge) || rawAge < 18 || rawAge > 95) {
          return json({ error: 'nootropic.fm is restricted to listeners aged 18+.' }, 400, request);
        }

        const isUpdating = Boolean(body.id && body.id.length >= 8);
        let id = isUpdating
          ? String(body.id)
          : `anon_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        let profileToken: string | undefined;
        let tokenHash = '';
        let syncCode: string | undefined;
        let syncCodeHash: string | null = null;

        if (isUpdating) {
          const existing = await env.DB.prepare(
            'SELECT token_hash, sync_code_hash FROM profiles WHERE id = ?'
          )
            .bind(id)
            .first<{ token_hash?: string; sync_code_hash?: string }>();
          if (existing?.token_hash) {
            const provided = extractProfileTokenFromRequest(request);
            const providedHash = provided ? await sha256Hex(provided) : '';
            if (!provided || !tokenHashMatches(providedHash, existing.token_hash)) {
              // Do not overwrite another user's profile; allocate a clean profile instead
              id = `anon_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
              profileToken = generateProfileToken();
              tokenHash = await sha256Hex(profileToken);
              syncCode = generateSyncCode();
              syncCodeHash = await sha256Hex(syncCode);
            } else {
              tokenHash = existing.token_hash;
              if (existing.sync_code_hash) {
                syncCodeHash = existing.sync_code_hash;
              } else {
                syncCode = generateSyncCode();
                syncCodeHash = await sha256Hex(syncCode);
              }
            }
          } else {
            profileToken = generateProfileToken();
            tokenHash = await sha256Hex(profileToken);
            syncCode = generateSyncCode();
            syncCodeHash = await sha256Hex(syncCode);
          }
        } else {
          profileToken = generateProfileToken();
          tokenHash = await sha256Hex(profileToken);
          syncCode = generateSyncCode();
          syncCodeHash = await sha256Hex(syncCode);
        }

        const age = Math.round(rawAge);
        const ageBand = ageToBand(age);
        const now = new Date().toISOString();
        const displayName = sanitizeDisplayName(body.displayName);
        const gender = parseGenderValue(body.gender);
        const occupationLabel = sanitizeOccupation(body.occupationLabel);

        const profile: UserProfile = {
          id,
          displayName: displayName || undefined,
          age,
          ageBand,
          gender,
          role: body.role ?? 'other',
          occupationLabel: occupationLabel || undefined,
          texturePref: body.texturePref ?? 'warm_organic',
          noiseSensitivity: body.noiseSensitivity ?? 'medium',
          defaultDevice: body.defaultDevice ?? 'headphones',
          primaryChallenge: body.primaryChallenge ?? 'distraction',
          researchConsent: body.researchConsent === true,
          preferredModMult: body.preferredModMult ?? 1.0,
          createdAt: body.createdAt ?? now,
          updatedAt: now,
        };

        await env.DB.prepare(
          `INSERT INTO profiles (id, display_name, age, age_band, gender, role, occupation_label, texture_pref, noise_sensitivity, default_device, primary_challenge, research_consent, token_hash, sync_code_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             age = excluded.age,
             age_band = excluded.age_band,
             gender = excluded.gender,
             role = excluded.role,
             occupation_label = excluded.occupation_label,
             texture_pref = excluded.texture_pref,
             noise_sensitivity = excluded.noise_sensitivity,
             default_device = excluded.default_device,
             primary_challenge = excluded.primary_challenge,
             research_consent = excluded.research_consent,
             token_hash = COALESCE(profiles.token_hash, excluded.token_hash),
             sync_code_hash = COALESCE(profiles.sync_code_hash, excluded.sync_code_hash),
             updated_at = excluded.updated_at`
        )
          .bind(
            profile.id,
            displayName,
            profile.age,
            profile.ageBand,
            gender,
            profile.role,
            occupationLabel,
            profile.texturePref,
            profile.noiseSensitivity,
            profile.defaultDevice,
            profile.primaryChallenge,
            profile.researchConsent ? 1 : 0,
            tokenHash,
            syncCodeHash,
            profile.createdAt,
            profile.updatedAt
          )
          .run();

        const savedRow = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?')
          .bind(profile.id)
          .first<Record<string, unknown>>();

        return json(
          {
            profile: savedRow ? mapProfileRow(savedRow) : { ...profile, planTier: 'free', proUntil: null },
            ...(profileToken ? { profileToken } : {}),
            ...(syncCode ? { syncCode } : {}),
          },
          200,
          request,
          profileToken ? { 'set-cookie': buildAuthSetCookieHeader(request, profileToken) } : undefined
        );
      }

      // POST /api/identity/restore — Restore Passwordless Neural Identity on any device via NFM-XXXX-XXXX Sync Key
      if (url.pathname === '/api/identity/restore' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'identity_restore', 30);
        if (!allowed) {
          return json(
            { error: 'Too many restore attempts today. Please try again tomorrow.' },
            429,
            request
          );
        }
        const body = (await request.json().catch(() => ({}))) as { syncCode?: string };
        const normalized = normalizeSyncCode(String(body.syncCode ?? ''));
        if (!normalized) {
          return json(
            { error: 'Please enter a valid Sync Key (format: NFM-XXXX-XXXX).' },
            400,
            request
          );
        }

        const codeHash = await sha256Hex(normalized);
        const row = await env.DB.prepare('SELECT * FROM profiles WHERE sync_code_hash = ?')
          .bind(codeHash)
          .first<Record<string, unknown>>();
        if (!row) {
          return json(
            { error: 'Identity Sync Key not found. Double-check the code and try again.' },
            404,
            request
          );
        }

        const id = String(row.id);
        const freshToken = generateProfileToken();
        const freshTokenHash = await sha256Hex(freshToken);
        const mergedHashes = appendTokenHash(
          row.token_hash ? String(row.token_hash) : '',
          freshTokenHash
        );

        await env.DB.prepare('UPDATE profiles SET token_hash = ?, updated_at = ? WHERE id = ?')
          .bind(mergedHashes, new Date().toISOString(), id)
          .run();

        const [pendingRow, countRow, favoriteGenres] = await Promise.all([
          env.DB.prepare(
            `SELECT * FROM sessions
             WHERE profile_id = ? AND status = 'pending_debrief' AND actual_duration_sec >= 60
             ORDER BY created_at DESC LIMIT 1`
          )
            .bind(id)
            .first(),
          env.DB.prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE profile_id = ?')
            .bind(id)
            .first<{ cnt: number }>(),
          fetchTopPersonalGenres(env.DB, id),
        ]);

        return json(
          {
            profile: { ...mapProfileRow(row, Number(countRow?.cnt ?? 0)), favoriteGenres },
            profileToken: freshToken,
            syncCode: normalized,
            pendingDebrief: pendingRow ? mapSessionRow(pendingRow) : null,
          },
          200,
          request,
          { 'set-cookie': buildAuthSetCookieHeader(request, freshToken) }
        );
      }

      // GET /api/profile/:id — Authenticated via X-Profile-Token; returns pendingDebrief ONLY if listened >= 60s
      if (url.pathname.startsWith('/api/profile/') && request.method === 'GET') {
        const id = decodeURIComponent(url.pathname.replace('/api/profile/', ''));
        const auth = await verifyProfileAccess(env.DB, id, request);
        if (!auth.row) return json({ error: 'Profile not found' }, 404, request);
        if (!auth.ok) return json({ error: 'Unauthorized profile access' }, 401, request);

        // Seamless 1-time Sync Code issuance for legacy profiles created before migration 0005
        let issuedSyncCode: string | undefined;
        if (!auth.row.sync_code_hash) {
          issuedSyncCode = generateSyncCode();
          const hash = await sha256Hex(issuedSyncCode);
          await env.DB.prepare('UPDATE profiles SET sync_code_hash = ? WHERE id = ?')
            .bind(hash, id)
            .run();
        }

        const [pendingRow, countRow, favoriteGenres] = await Promise.all([
          env.DB.prepare(
            `SELECT * FROM sessions
             WHERE profile_id = ? AND status = 'pending_debrief' AND actual_duration_sec >= 60
             ORDER BY created_at DESC LIMIT 1`
          )
            .bind(id)
            .first(),
          env.DB.prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE profile_id = ?')
            .bind(id)
            .first<{ cnt: number }>(),
          fetchTopPersonalGenres(env.DB, id),
        ]);

        return json(
          {
            profile: { ...mapProfileRow(auth.row, Number(countRow?.cnt ?? 0)), favoriteGenres },
            pendingDebrief: pendingRow ? mapSessionRow(pendingRow) : null,
            ...(auth.issuedLegacyToken ? { profileToken: auth.issuedLegacyToken } : {}),
            ...(issuedSyncCode ? { syncCode: issuedSyncCode } : {}),
          },
          200,
          request,
          auth.issuedLegacyToken
            ? { 'set-cookie': buildAuthSetCookieHeader(request, auth.issuedLegacyToken) }
            : undefined
        );
      }

      // DELETE /api/profile/:id — GDPR "Delete My Data" (authenticated via X-Profile-Token)
      if (url.pathname.startsWith('/api/profile/') && request.method === 'DELETE') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'profile_delete', 20);
        if (!allowed) return json({ error: 'Rate limit reached.' }, 429, request);

        const id = decodeURIComponent(url.pathname.replace('/api/profile/', ''));
        const auth = await verifyProfileAccess(env.DB, id, request);
        if (!auth.row) return json({ error: 'Profile not found' }, 404, request);
        if (!auth.ok) return json({ error: 'Unauthorized deletion request' }, 401, request);

        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE profile_id = ?').bind(id),
          env.DB.prepare(
            `DELETE FROM bandit_stats WHERE (scope_type IN ('profile', 'profile_genre') AND scope_id = ?) OR (scope_type = 'profile_state' AND scope_id LIKE ?)`
          ).bind(id, `${id}|%`),
          env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(id),
        ]);

        return json(
          { ok: true, deletedProfileId: id },
          200,
          request,
          { 'set-cookie': buildAuthSetCookieHeader(request, null) }
        );
      }

      // POST /api/parse
      if (url.pathname === '/api/parse' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'parse', 120);
        if (!allowed) return json({ error: 'Daily parse rate limit reached.' }, 429, request);
        const body = (await request.json()) as { text?: string; profile?: Partial<UserProfile> };
        const rawText = String(body.text ?? '').trim();
        const localParsed = parseNaturalCheckIn(rawText, body.profile);
        const finalParsed = await enhanceWithGeminiIfConfigured(env, rawText, localParsed);
        return json({ parsed: finalParsed }, 200, request);
      }

      // POST /api/protocol/start — Synthesizes 2-Layer Formula, checks R2 Custom Cache, credits D1/D7 return bonus
      if (url.pathname === '/api/protocol/start' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'session_start', 40);
        if (!allowed) {
          return json({ error: 'Daily session rate limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json()) as {
          profileId?: string;
          ephemeralMode?: boolean;
          ephemeralProfile?: Partial<UserProfile>;
          rawInputText?: string;
          currentState: CurrentState;
          microStateId?: string;
          microStateLabel?: string;
          arousalPct?: number;
          clarityPct?: number;
          baselineScore: number;
          targetState: TargetState;
          customGoalText?: string;
          customGoalSlug?: string;
          customGoalLabel?: string;
          environment: SessionEnvironment;
          device: OutputDevice;
          durationMin: number;
          ageOverride?: number;
          requestedGenre?: MusicGenreChoice;
          customGenreInput?: string;
          blindControlOptIn?: boolean;
        };

        let profile: UserProfile;
        let isEphemeral = Boolean(body.ephemeralMode);

        if (isEphemeral || !body.profileId) {
          const safeAge = Math.max(18, Math.min(95, Number(body.ephemeralProfile?.age ?? body.ageOverride ?? 32)));
          profile = {
            id: 'ephemeral_local',
            displayName: sanitizeDisplayName(body.ephemeralProfile?.displayName) || undefined,
            age: safeAge,
            ageBand: ageToBand(safeAge),
            gender: parseGenderValue(body.ephemeralProfile?.gender),
            role: body.ephemeralProfile?.role ?? 'other',
            occupationLabel: sanitizeOccupation(body.ephemeralProfile?.occupationLabel) || undefined,
            texturePref: body.ephemeralProfile?.texturePref ?? 'warm_organic',
            noiseSensitivity: body.ephemeralProfile?.noiseSensitivity ?? 'medium',
            defaultDevice: body.device ?? 'headphones',
            primaryChallenge: 'distraction',
            researchConsent: false,
            preferredModMult: 1.0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          isEphemeral = true;
        } else {
          const profileRow = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?')
            .bind(body.profileId)
            .first();
          if (!profileRow) {
            return json({ error: 'Profile not found. Complete calibration first.' }, 404, request);
          }
          profile = mapProfileRow(profileRow);
          if (!profile.researchConsent) {
            isEphemeral = true;
          }
          if (
            !isEphemeral &&
            typeof body.ageOverride === 'number' &&
            body.ageOverride >= 18 &&
            body.ageOverride <= 95 &&
            body.ageOverride !== profile.age
          ) {
            profile = { ...profile, age: body.ageOverride, ageBand: ageToBand(body.ageOverride) };
            await env.DB.prepare('UPDATE profiles SET age = ?, age_band = ?, updated_at = ? WHERE id = ?')
              .bind(profile.age, profile.ageBand, new Date().toISOString(), profile.id)
              .run();
          }
        }

        const isDrivingEnv = body.environment === 'driving';
        const openGoal = body.customGoalText?.trim()
          ? resolveOpenGoalIntent(body.customGoalText, isDrivingEnv)
          : (() => {
              const preset = getCuratedGoalBySlug(body.customGoalSlug);
              if (!preset) return null;
              return {
                slug: preset.slug,
                label: preset.label,
                subtitle: preset.subtitle,
                coreTarget: preset.coreTarget,
                coords: preset.coords,
                defaultMin: preset.defaultMin,
                dspOverride: isDrivingEnv ? undefined : preset.dspOverride,
                pubmedQuery: preset.pubmedQuery,
                openAlexTerm: preset.openAlexTerm,
                isOpenCustomTopic: false,
                rawTopicQuery: undefined,
              };
            })();

        const rawTarget = openGoal?.coreTarget ?? body.targetState;
        const effectiveTarget: TargetState =
          isDrivingEnv && (rawTarget === 'sleep_winddown' || rawTarget === 'calm_reset')
            ? 'alert_focus'
            : rawTarget;
        const effectiveGoalSlug =
          openGoal &&
          !(isDrivingEnv && (openGoal.coreTarget === 'sleep_winddown' || openGoal.coreTarget === 'calm_reset'))
            ? openGoal.slug
            : undefined;
        const effectiveGoalLabel =
          openGoal && effectiveGoalSlug ? (body.customGoalLabel || openGoal.label) : undefined;

        const energyTier = resolveEnergyTier(effectiveTarget, body.environment, body.currentState);
        const cohortKey = buildCohortKey(
          profile.ageBand,
          body.environment,
          effectiveTarget,
          profile.role,
          body.currentState,
          effectiveGoalSlug
        );
        const legacyBroadCohortKey = buildCohortKey(
          profile.ageBand,
          body.environment,
          effectiveTarget
        );
        const profileStateKey = `${profile.id}|${body.currentState}|${effectiveGoalSlug || effectiveTarget}`;

        // Map core genre aliases typed as custom text (e.g. "rain", "ploaie", "lo-fi") straight to instant Studio R2!
        const coreAliasFromCustom = matchCoreGenreAlias(body.customGenreInput);
        const effectiveRequestedGenre: MusicGenreChoice | undefined =
          coreAliasFromCustom ?? body.requestedGenre;

        const sanitizedCustom = coreAliasFromCustom
          ? null
          : sanitizeCustomVibe(body.customGenreInput);
        if (sanitizedCustom?.rejectedReason) {
          return json({ error: sanitizedCustom.rejectedReason }, 400, request);
        }
        const validCustom = sanitizedCustom && !sanitizedCustom.rejectedReason ? sanitizedCustom : null;

        // Sweep stale (>2h) silent-abandoned sessions (<25% completion without debrief/pagehide)
        // so survivorship bias cannot inflate protocols that users silently closed on mobile.
        if (!isEphemeral && profile.researchConsent) {
          const twoHoursAgoIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const staleRows = await env.DB.prepare(
            `SELECT id, cohort_key, current_state, target_state, environment, arm_id, music_genre,
                    is_control_trial, planned_duration_min, actual_duration_sec, completion_ratio
             FROM sessions
             WHERE profile_id = ?
               AND status IN ('active', 'pending_debrief')
               AND COALESCE(implicit_applied_weight, 0) = 0
               AND actual_duration_sec >= 10
               AND created_at < ?
             ORDER BY created_at DESC
             LIMIT 2`
          )
            .bind(profile.id, twoHoursAgoIso)
            .all<Record<string, unknown>>()
            .catch(() => ({ results: [] as Record<string, unknown>[] }));

          for (const st of staleRows.results ?? []) {
            const stActualSec = Number(st.actual_duration_sec ?? 0);
            const stPlannedSec = Math.max(300, Number(st.planned_duration_min ?? 25) * 60);
            const stComp = Number(
              Math.min(1, Number(st.completion_ratio ?? stActualSec / stPlannedSec)).toFixed(3)
            );
            const stEarlyAbort = stActualSec < 90 || (stComp < 0.25 && stActualSec < 600);
            const stComputed = computeImplicitReward({
              actualDurationSec: stActualSec,
              completionRatio: stComp,
              isEarlyBounce: stEarlyAbort,
              instantGenreSwapped: false,
            });
            const stWeight = 0.45;
            const stGenre = String(st.music_genre || 'deep_electronic');
            const stCohort = String(st.cohort_key);
            const stArm = String(st.arm_id);
            const stControl = Number(st.is_control_trial ?? 0) === 1;
            const stMarginals = extractMarginalScopesFromSession({
              cohortKey: stCohort,
              targetState: String(st.target_state) as TargetState,
              currentState: String(st.current_state) as CurrentState,
              environment: String(st.environment) as SessionEnvironment,
            });

            const sweepUpdates: Array<Promise<unknown>> = [
              updateBanditScope(env.DB, {
                scopeType: 'cohort_genre',
                scopeId: stCohort,
                armId: stGenre,
                mode: 'implicit',
                reward: stComputed.reward,
                weight: stWeight,
                completionRatio: stComp,
              }),
              updateBanditScope(env.DB, {
                scopeType: 'profile_genre',
                scopeId: profile.id,
                armId: stGenre,
                mode: 'implicit',
                reward: stComputed.reward,
                weight: stWeight,
                completionRatio: stComp,
              }),
            ];
            if (!stControl) {
              sweepUpdates.push(
                updateBanditScope(env.DB, {
                  scopeType: 'cohort',
                  scopeId: stCohort,
                  armId: stArm,
                  mode: 'implicit',
                  reward: stComputed.reward,
                  weight: stWeight,
                  completionRatio: stComp,
                }),
                updateBanditScope(env.DB, {
                  scopeType: 'profile',
                  scopeId: profile.id,
                  armId: stArm,
                  mode: 'implicit',
                  reward: stComputed.reward,
                  weight: stWeight,
                  completionRatio: stComp,
                }),
                updateBanditScope(env.DB, {
                  scopeType: 'cohort_arm_genre',
                  scopeId: `${stCohort}|${stGenre}`,
                  armId: stArm,
                  mode: 'implicit',
                  reward: stComputed.reward,
                  weight: stWeight,
                  completionRatio: stComp,
                }),
                ...stMarginals.map((m) =>
                  updateBanditScope(env.DB, {
                    scopeType: m.scopeType,
                    scopeId: m.scopeId,
                    armId: stArm,
                    mode: 'implicit',
                    reward: stComputed.reward,
                    weight: stWeight,
                    completionRatio: stComp,
                  })
                )
              );
            }
            await Promise.all([
              ...sweepUpdates,
              env.DB.prepare(
                `UPDATE sessions
                 SET implicit_reward_score = ?,
                     implicit_applied_weight = ?,
                     retention_outcome = ?,
                     status = CASE WHEN status = 'active' THEN 'abandoned' ELSE status END
                 WHERE id = ?`
              )
                .bind(stComputed.reward, stWeight, stComputed.outcome, String(st.id))
                .run(),
            ]).catch(() => {});
          }
        }

        const marginalScopes = buildFactorizedMarginalScopes({
          targetState: effectiveTarget,
          customGoalSlug: effectiveGoalSlug,
          currentState: body.currentState,
          environment: body.environment,
          role: profile.role,
        });

        // Check daily cap & R2 custom track cache
        const today = new Date().toISOString().slice(0, 10);
        const provider = resolveMusicProvider(env);
        const dailyCapMax = Math.max(0, Number(env.MUSIC_GEN_DAILY_CAP ?? '3'));

        const [
          exactCohortStats,
          broadCohortStats,
          marginalStats,
          profileStats,
          profileStateStats,
          cohortGenreStats,
          profileGenreStats,
          cohortArmGenreStats,
          livePubMedPapers,
          compiledCustomSpec,
          cachedCustom,
          usageRow,
          recentShamRows,
        ] = await Promise.all([
          fetchBanditRows(env.DB, 'cohort', cohortKey),
          fetchBanditRows(env.DB, 'cohort', legacyBroadCohortKey),
          Promise.all(
            marginalScopes.map((m) => fetchBanditRows(env.DB, m.scopeType, m.scopeId))
          ),
          isEphemeral ? Promise.resolve([]) : fetchBanditRows(env.DB, 'profile', profile.id),
          isEphemeral ? Promise.resolve([]) : fetchBanditRows(env.DB, 'profile_state', profileStateKey),
          fetchBanditRows(env.DB, 'cohort_genre', cohortKey),
          isEphemeral ? Promise.resolve([]) : fetchBanditRows(env.DB, 'profile_genre', profile.id),
          validCustom
            ? fetchBanditRows(env.DB, 'cohort_arm_genre', `${cohortKey}|${validCustom.slug}`)
            : body.requestedGenre && body.requestedGenre !== 'auto'
              ? fetchBanditRows(env.DB, 'cohort_arm_genre', `${cohortKey}|${body.requestedGenre}`)
              : Promise.resolve([]),
          fetchVerifiedLiveLiterature(
            env,
            effectiveTarget,
            body.environment,
            body.microStateId,
            openGoal
              ? {
                  slug: openGoal.slug,
                  pubmedQuery: openGoal.pubmedQuery,
                  openAlexTerm: openGoal.openAlexTerm,
                }
              : null
          ),
          openGoal?.isOpenCustomTopic && openGoal.rawTopicQuery
            ? compileMedicalStudy(env, {
                queryOrText: openGoal.rawTopicQuery,
                device: body.device,
                environment: body.environment,
              })
                .then((r) => r.spec)
                .catch(() => null)
            : Promise.resolve(null),
          validCustom ? lookupCachedCustomTrack(env.DB, validCustom.slug, energyTier) : Promise.resolve(null),
          env.DB.prepare('SELECT music_gen_calls FROM api_usage_daily WHERE day = ?')
            .bind(today)
            .first<{ music_gen_calls?: number }>(),
          isEphemeral
            ? Promise.resolve({ results: [] as Array<{ is_control_trial?: number }> })
            : env.DB.prepare(
                'SELECT is_control_trial FROM sessions WHERE profile_id = ? ORDER BY created_at DESC LIMIT 12'
              )
                .bind(profile.id)
                .all<{ is_control_trial?: number }>(),
        ]);

        // Hierarchical fallback: prefer exact (ageBand + role + currentState + targetState) cohort,
        // falling back per-arm to broad (ageBand + environment + targetState) if exact has 0 trials yet
        const exactMap = new Map(exactCohortStats.map((r) => [r.armId, r]));
        const cohortStats = [
          ...exactCohortStats,
          ...broadCohortStats.filter((b) => !exactMap.has(b.armId)),
        ];
        const stateProfMap = new Map(profileStateStats.map((r) => [r.armId, r]));
        const mergedProfileStats = [
          ...profileStateStats,
          ...profileStats.filter((p) => !stateProfMap.has(p.armId)),
        ];

        const recentControlFlags = (recentShamRows.results ?? []).map(
          (r) => Number(r.is_control_trial ?? 0) === 1
        );

        const liveGenAvailable =
          Boolean(provider) && Number(usageRow?.music_gen_calls ?? 0) < dailyCapMax;

        // Credit one-time D1/D7 Return Retention bonus to the prior session that brought this user back!
        let returnBonusAwarded = false;
        if (!isEphemeral && profile.researchConsent) {
          const prior = await env.DB.prepare(
            `SELECT id, cohort_key, arm_id, music_genre, is_control_trial, completion_ratio, created_at
             FROM sessions
             WHERE profile_id = ? AND return_bonus_credited = 0 AND actual_duration_sec >= 60
             ORDER BY created_at DESC LIMIT 1`
          )
            .bind(profile.id)
            .first<Record<string, unknown>>();

          if (prior?.created_at) {
            const elapsedMs = Date.now() - Date.parse(String(prior.created_at));
            const twelveHours = 12 * 60 * 60 * 1000;
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            if (elapsedMs >= twelveHours && elapsedMs <= sevenDays) {
              const priorArm = String(prior.arm_id);
              const priorGenre = String(prior.music_genre || 'deep_electronic');
              const priorCohort = String(prior.cohort_key);
              const priorControl = Number(prior.is_control_trial ?? 0) === 1;
              const priorComp = Number(prior.completion_ratio ?? 0.5);

              await env.DB.prepare('UPDATE sessions SET return_bonus_credited = 1 WHERE id = ?')
                .bind(String(prior.id))
                .run();

              const bonusTasks: Array<Promise<unknown>> = [
                updateBanditScope(env.DB, {
                  scopeType: 'cohort_genre',
                  scopeId: priorCohort,
                  armId: priorGenre,
                  mode: 'return_bonus',
                  reward: 0.88,
                  weight: 0.35,
                  completionRatio: priorComp,
                }),
                updateBanditScope(env.DB, {
                  scopeType: 'profile_genre',
                  scopeId: profile.id,
                  armId: priorGenre,
                  mode: 'return_bonus',
                  reward: 0.88,
                  weight: 0.35,
                  completionRatio: priorComp,
                }),
              ];
              if (!priorControl) {
                bonusTasks.push(
                  updateBanditScope(env.DB, {
                    scopeType: 'cohort',
                    scopeId: priorCohort,
                    armId: priorArm,
                    mode: 'return_bonus',
                    reward: 0.88,
                    weight: 0.35,
                    completionRatio: priorComp,
                  }),
                  updateBanditScope(env.DB, {
                    scopeType: 'profile',
                    scopeId: profile.id,
                    armId: priorArm,
                    mode: 'return_bonus',
                    reward: 0.88,
                    weight: 0.35,
                    completionRatio: priorComp,
                  })
                );
              }
              await Promise.all(bonusTasks);
              returnBonusAwarded = true;
            }
          }
        }

        if (cachedCustom) {
          ctx.waitUntil(
            env.DB.prepare('UPDATE custom_tracks SET play_count = play_count + 1 WHERE id = ?')
              .bind(cachedCustom.id)
              .run()
              .catch(() => {})
          );
        }

        const sessionId = isEphemeral
          ? `eph_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
          : `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

        const recommendation = {
          ...selectProtocolRecommendation({
            sessionId,
            profile,
            currentState: body.currentState,
            microStateId: body.microStateId,
            microStateLabel: body.microStateLabel,
            arousalPct:
              typeof body.arousalPct === 'number'
                ? Math.max(0, Math.min(100, Math.round(body.arousalPct)))
                : undefined,
            clarityPct:
              typeof body.clarityPct === 'number'
                ? Math.max(0, Math.min(100, Math.round(body.clarityPct)))
                : undefined,
            baselineScore: Math.max(1, Math.min(5, Number(body.baselineScore ?? 2))),
            targetState: effectiveTarget,
            customGoalSlug: effectiveGoalSlug,
            customGoalLabel: effectiveGoalLabel,
            compiledCustomSpec,
            environment: body.environment,
            device: body.device,
            durationMin: Math.max(5, Math.min(120, Number(body.durationMin ?? 30))),
            requestedGenre: effectiveRequestedGenre,
            customGenreInput: validCustom?.displayLabel,
            cachedCustomTrackUrl: cachedCustom?.url,
            liveGenAvailable,
            ephemeralMode: isEphemeral,
            cohortStats,
            marginalStats,
            profileStats: mergedProfileStats,
            cohortGenreStats,
            profileGenreStats,
            cohortArmGenreStats,
            recentControlFlags,
            allowControlTrial: Boolean(body.blindControlOptIn) && profile.planTier !== 'pro',
            returnBonusAwarded,
          }),
          livePubMedPapers,
        };

        if (!isEphemeral) {
          const now = new Date().toISOString();
          const finalGenreKey = recommendation.customGenreSlug ?? recommendation.params.genre;
          await env.DB.prepare(
            `INSERT INTO sessions (
              id, profile_id, cohort_key, raw_input_text, current_state, baseline_score,
              target_state, environment, device, safety_mode, planned_duration_min,
              actual_duration_sec, completion_ratio, arm_id, arm_name, is_exploration,
              is_control_trial, energy_tier, music_genre, initial_music_genre,
              custom_genre_slug, audio_source, study_spec_id,
              acoustic_params_json, cited_study_ids_json, live_adjustments_json,
              time_of_day_bucket, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'active', ?)`
          )
            .bind(
              sessionId,
              profile.id,
              recommendation.cohortKey,
              (body.rawInputText ?? '').slice(0, 500),
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
              finalGenreKey,
              finalGenreKey,
              recommendation.customGenreSlug ?? null,
              recommendation.audioSource,
              recommendation.executableSpec?.id ?? null,
              JSON.stringify(recommendation.params),
              JSON.stringify(recommendation.arm.studyIds),
              getTimeOfDayBucket(),
              now
            )
            .run();
        }

        return json({ recommendation }, 200, request);
      }

      // POST /api/music/generate — 2-Speed Custom Vibe Generator + R2 Community Cache + Atomic Cap & Lock
      if (url.pathname === '/api/music/generate' && request.method === 'POST') {
        const body = (await request.json()) as {
          customGenre: string;
          energyTier: EnergyTier;
          targetState: TargetState;
          bpm?: number;
          harmonicMode?: AcousticParams['harmonicMode'];
          speakerSafeEQ?: boolean;
          noiseSensitivity?: 'low' | 'medium' | 'high';
          sessionId?: string;
        };

        const sanitized = sanitizeCustomVibe(body.customGenre);
        if (!sanitized || sanitized.rejectedReason) {
          return json(
            { error: sanitized?.rejectedReason ?? 'Invalid custom genre name.' },
            400,
            request
          );
        }

        const energyTier: EnergyTier =
          body.energyTier === 'calm' || body.energyTier === 'drive' ? body.energyTier : 'focus';

        // 1. Check R2 Community Cache FIRST ($0.00!) — exact energy tier first, then any ready track for this genre!
        const existingTracksRes = await env.DB.prepare(
          `SELECT * FROM custom_tracks WHERE genre_slug = ? AND status = 'ready'
           ORDER BY CASE WHEN energy_tier = ? THEN 0 ELSE 1 END, play_count DESC`
        )
          .bind(sanitized.slug, energyTier)
          .all<Record<string, unknown>>();

        const existingTracks = existingTracksRes.results;
        const exactTierTracks = existingTracks.filter((r) => String(r.energy_tier) === energyTier);
        const totalPlays = exactTierTracks.reduce((acc, r) => acc + Number(r.play_count ?? 0), 0);

        // Serve immediately from R2 cache if any ready track already exists for this genre!
        if (exactTierTracks.length >= 2 || (exactTierTracks.length === 1 && totalPlays < 5) || existingTracks.length > 0) {
          const pool = exactTierTracks.length > 0 ? exactTierTracks : existingTracks;
          const picked = pool[Math.floor(Math.random() * pool.length)];
          const r2Key = String(picked.r2_key);
          const encoded = r2Key
            .split('/')
            .map((s) => encodeURIComponent(s))
            .join('/');
          return json(
            {
              status: 'ready',
              fromCache: true,
              track: {
                id: String(picked.id),
                genreSlug: sanitized.slug,
                displayLabel: String(picked.display_label),
                energyTier: String(picked.energy_tier) as EnergyTier,
                url: `/api/audio/stream/${encoded}`,
                provider: String(picked.provider),
                bpm: Number(picked.bpm ?? 92),
              },
            },
            200,
            request
          );
        }

        const provider = resolveMusicProvider(env);
        if (!provider || !env.AUDIO_BUCKET) {
          return json(
            {
              status: 'unavailable',
              message: 'Live custom generation is currently offline; playing closest studio library match.',
            },
            200,
            request
          );
        }

        const perIpOk = await checkDailyRateLimit(env.DB, request, 'music_gen', 6);
        if (!perIpOk) {
          return json(
            {
              status: 'rate_limited',
              message: 'Daily per-listener custom generation limit (6/day) reached. Studio & cached vibes remain unlimited.',
            },
            429,
            request
          );
        }

        // 2. Acquire atomic job lock (prevents duplicate $0.08 spend on concurrent requests)
        const jobKey = `${sanitized.slug}:${energyTier}`;
        const nowIso = new Date().toISOString();
        const existingJob = await env.DB.prepare('SELECT * FROM music_generation_jobs WHERE job_key = ?')
          .bind(jobKey)
          .first<Record<string, unknown>>();

        if (existingJob && String(existingJob.status) === 'generating') {
          const ageMs = Date.now() - Date.parse(String(existingJob.updated_at));
          if (ageMs < 90_000) {
            return json({ status: 'generating', jobKey, pollAfterMs: 3500 }, 202, request);
          }
        }

        // 3. Atomic Daily Cap Reservation (guaranteed hard spend ceiling!)
        const dailyCapMax = Math.max(0, Number(env.MUSIC_GEN_DAILY_CAP ?? '3'));
        const today = nowIso.slice(0, 10);
        await env.DB.prepare(
          `INSERT OR IGNORE INTO api_usage_daily (day, gemini_calls, music_gen_calls, music_gen_cost_cents)
           VALUES (?, 0, 0, 0)`
        )
          .bind(today)
          .run();

        const reserveRes = await env.DB.prepare(
          `UPDATE api_usage_daily
           SET music_gen_calls = music_gen_calls + 1,
               music_gen_cost_cents = music_gen_cost_cents + ?
           WHERE day = ? AND music_gen_calls < ?`
        )
          .bind(provider.costCentsPerTrack, today, dailyCapMax)
          .run();

        if ((reserveRes.meta?.changes ?? 0) === 0) {
          return json(
            {
              status: 'cap_reached',
              message: 'Daily community generation budget reached; enjoy instant playback from our studio library & cached vibes!',
            },
            200,
            request
          );
        }

        // Lock job row
        await env.DB.prepare(
          `INSERT INTO music_generation_jobs (job_key, genre_slug, energy_tier, status, provider, created_at, updated_at)
           VALUES (?, ?, ?, 'generating', ?, ?, ?)
           ON CONFLICT(job_key) DO UPDATE SET status = 'generating', provider = excluded.provider, error_msg = NULL, updated_at = excluded.updated_at`
        )
          .bind(jobKey, sanitized.slug, energyTier, provider.id, nowIso, nowIso)
          .run();

        const bpm = Number(body.bpm ?? (energyTier === 'calm' ? 68 : energyTier === 'drive' ? 108 : 92));
        const prompt = composeScientificMusicPrompt({
          customGenreLabel: sanitized.displayLabel,
          energyTier,
          targetState: body.targetState ?? 'alert_focus',
          params: {
            bpm,
            harmonicMode: body.harmonicMode ?? 'warm_min9',
            speakerSafeEQ: Boolean(body.speakerSafeEQ),
          },
          noiseSensitivity: body.noiseSensitivity ?? 'medium',
        });

        // Wrap generate -> R2.put -> D1.insert in ctx.waitUntil(p) AND await p so mobile disconnects
        // never abort mid-flight and waste $0.08!
        const generationPromise = (async () => {
          try {
            const generated = await provider.generate({ prompt, durationSec: 135 });
            const trackId = `trk_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
            const r2Key = `custom/${sanitized.slug}/${energyTier}/${trackId}.mp3`;

            await env.AUDIO_BUCKET!.put(r2Key, generated.audioBytes, {
              httpMetadata: {
                contentType: generated.contentType,
                cacheControl: 'public, max-age=31536000, immutable',
              },
              customMetadata: {
                genreSlug: sanitized.slug,
                energyTier,
                provider: generated.provider,
                modelId: generated.modelId,
              },
            });

            const doneIso = new Date().toISOString();
            await env.DB.batch([
              env.DB.prepare(
                `INSERT INTO custom_tracks (
                  id, genre_slug, display_label, energy_tier, r2_key, provider, model_id,
                  prompt_text, bpm, duration_sec, size_bytes, play_count, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ready', ?)`
              ).bind(
                trackId,
                sanitized.slug,
                sanitized.displayLabel,
                energyTier,
                r2Key,
                generated.provider,
                generated.modelId,
                prompt,
                bpm,
                generated.estimatedDurationSec,
                generated.audioBytes.byteLength,
                doneIso
              ),
              env.DB.prepare(
                `UPDATE music_generation_jobs SET status = 'ready', r2_key = ?, track_id = ?, updated_at = ? WHERE job_key = ?`
              ).bind(r2Key, trackId, doneIso, jobKey),
            ]);

            if (body.sessionId && !body.sessionId.startsWith('eph_')) {
              await env.DB.prepare(
                `UPDATE sessions SET audio_source = 'community_cache' WHERE id = ?`
              )
                .bind(body.sessionId)
                .run()
                .catch(() => {});
            }

            const encoded = r2Key
              .split('/')
              .map((s) => encodeURIComponent(s))
              .join('/');
            return {
              ok: true as const,
              track: {
                id: trackId,
                genreSlug: sanitized.slug,
                displayLabel: sanitized.displayLabel,
                energyTier,
                url: `/api/audio/stream/${encoded}`,
                provider: generated.provider,
                bpm,
              },
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Generation failed';
            const failIso = new Date().toISOString();
            await env.DB.batch([
              env.DB.prepare(
                `UPDATE music_generation_jobs SET status = 'failed', error_msg = ?, updated_at = ? WHERE job_key = ?`
              ).bind(errMsg.slice(0, 240), failIso, jobKey),
              // Refund daily cap slot if provider errored before producing valid audio
              env.DB.prepare(
                `UPDATE api_usage_daily
                 SET music_gen_calls = MAX(0, music_gen_calls - 1),
                     music_gen_cost_cents = MAX(0, music_gen_cost_cents - ?)
                 WHERE day = ?`
              ).bind(provider.costCentsPerTrack, today),
            ]).catch(() => {});
            return { ok: false as const, error: errMsg };
          }
        })();

        ctx.waitUntil(generationPromise);
        const result = await generationPromise;

        if (!result.ok) {
          return json(
            {
              status: 'failed',
              message:
                result.error === 'VOCAL_LEAKAGE_DETECTED'
                  ? 'Rejected generated audio containing vocal artifacts to protect instrumental quality.'
                  : 'Custom track generation temporarily unavailable; continuing smoothly on studio library.',
            },
            200,
            request
          );
        }

        return json({ status: 'ready', fromCache: false, track: result.track }, 200, request);
      }

      // GET /api/music/status?slug=...&energy=...
      if (url.pathname === '/api/music/status' && request.method === 'GET') {
        const slug = url.searchParams.get('slug') ?? '';
        const energy = (url.searchParams.get('energy') ?? 'focus') as EnergyTier;
        if (!slug) return json({ error: 'Missing slug' }, 400, request);

        const track = await lookupCachedCustomTrack(env.DB, slug, energy);
        if (track) {
          return json({ status: 'ready', track }, 200, request);
        }
        const job = await env.DB.prepare('SELECT status, error_msg FROM music_generation_jobs WHERE job_key = ?')
          .bind(`${slug}:${energy}`)
          .first<{ status: string; error_msg?: string }>();

        return json({ status: job?.status ?? 'not_found', error: job?.error_msg ?? null }, 200, request);
      }

      // POST /api/session/genre — Persists Layer 2 swaps & flags Instant Swap (<60s)
      if (url.pathname === '/api/session/genre' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'session_genre', 150);
        if (!allowed) return json({ error: 'Rate limit reached.' }, 429, request);

        const body = (await request.json()) as {
          sessionId: string;
          genre: string;
          customGenreSlug?: string | null;
          audioSource?: AudioSourceType;
          atSec?: number;
          params?: AcousticParams;
        };
        if (!body.sessionId || body.sessionId.startsWith('eph_')) {
          return json({ ok: true, ephemeral: true }, 200, request);
        }

        const row = await env.DB.prepare(
          'SELECT profile_id, cohort_key, arm_id, initial_music_genre, is_control_trial, acoustic_params_json, genre_swapped_at_sec FROM sessions WHERE id = ?'
        )
          .bind(body.sessionId)
          .first<Record<string, unknown>>();
        if (!row) return json({ error: 'Session not found' }, 404, request);

        const prevParams = JSON.parse(String(row.acoustic_params_json)) as AcousticParams;
        const nextGenreKey = body.customGenreSlug || body.genre;
        const nextParams: AcousticParams = body.params
          ? { ...prevParams, ...body.params }
          : {
              ...prevParams,
              ...(body.genre in GENRE_META ? { genre: body.genre as ResolvedGenre } : {}),
              genreSelectionMode: body.customGenreSlug ? 'custom_vibe' : 'user_chosen',
              customGenreSlug: body.customGenreSlug ?? undefined,
            };

        const atSec = typeof body.atSec === 'number' ? Math.round(body.atSec) : null;
        const isInstantSwap =
          atSec !== null &&
          atSec > 0 &&
          atSec < 60 &&
          row.genre_swapped_at_sec === null &&
          nextGenreKey !== String(row.initial_music_genre);

        await env.DB.prepare(
          `UPDATE sessions
           SET music_genre = ?,
               custom_genre_slug = ?,
               audio_source = COALESCE(?, audio_source),
               genre_swapped_at_sec = COALESCE(genre_swapped_at_sec, ?),
               acoustic_params_json = ?
           WHERE id = ?`
        )
          .bind(
            nextGenreKey,
            body.customGenreSlug ?? null,
            body.audioSource ?? null,
            isInstantSwap ? atSec : null,
            JSON.stringify(nextParams),
            body.sessionId
          )
          .run();

        // Instant Genre Swap (<60s) gives mild negative implicit feedback strictly to the INITIAL genre
        if (isInstantSwap) {
          const initialGenre = String(row.initial_music_genre);
          const cohortKey = String(row.cohort_key);
          const profileId = String(row.profile_id);
          await Promise.all([
            updateBanditScope(env.DB, {
              scopeType: 'cohort_genre',
              scopeId: cohortKey,
              armId: initialGenre,
              mode: 'implicit',
              reward: 0.2,
              weight: 0.35,
              completionRatio: 0.05,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'profile_genre',
              scopeId: profileId,
              armId: initialGenre,
              mode: 'implicit',
              reward: 0.2,
              weight: 0.35,
              completionRatio: 0.05,
            }),
          ]);
        }

        return json({ ok: true, genre: nextGenreKey, instantSwapRecorded: isInstantSwap }, 200, request);
      }

      // POST /api/session/progress — 90s heartbeat; promotes 'active' -> 'pending_debrief' at >= 60s
      if (url.pathname === '/api/session/progress' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'progress', 200);
        if (!allowed) return json({ error: 'Rate limit reached.' }, 429, request);

        const body = (await request.json()) as {
          sessionId: string;
          actualDurationSec: number;
          liveAdjustments: LiveAdjustment[];
        };
        if (!body.sessionId || body.sessionId.startsWith('eph_')) {
          return json({ ok: true, completionRatio: 0 }, 200, request);
        }

        const row = await env.DB.prepare('SELECT planned_duration_min, status FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first<{ planned_duration_min: number; status: string }>();
        if (!row) return json({ error: 'Session not found' }, 404, request);

        const actualSec = Math.max(0, Math.round(body.actualDurationSec));
        const plannedSec = Math.max(60, Number(row.planned_duration_min) * 60);
        const completionRatio = Number(Math.min(1, Math.max(0, actualSec / plannedSec)).toFixed(3));
        const nextStatus =
          row.status === 'active' && actualSec >= 60 ? 'pending_debrief' : row.status;

        await env.DB.prepare(
          `UPDATE sessions
           SET actual_duration_sec = MAX(actual_duration_sec, ?),
               completion_ratio = MAX(completion_ratio, ?),
               live_adjustments_json = ?,
               status = ?,
               last_beacon_at = ?
           WHERE id = ?`
        )
          .bind(
            actualSec,
            completionRatio,
            JSON.stringify(body.liveAdjustments ?? []),
            nextStatus,
            new Date().toISOString(),
            body.sessionId
          )
          .run();

        return json({ ok: true, completionRatio }, 200, request);
      }

      // POST /api/session/beacon — Cross-browser navigator.sendBeacon (text/plain JSON, zero CORS preflight!)
      // visibilitychange = checkpoint ONLY (protects lock-screen listening!); pagehide/completion evaluates implicit retention.
      if (url.pathname === '/api/session/beacon' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'beacon', 250);
        if (!allowed) return json({ ok: false }, 429, request);

        const raw = await request.text();
        let body: {
          sessionId?: string;
          event?: 'visibility' | 'pagehide' | 'milestone' | 'milestone_25' | 'milestone_50' | 'milestone_75' | 'milestone_90';
          actualDurationSec?: number;
          audioStarted?: boolean;
          liveAdjustments?: LiveAdjustment[];
        };
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          return json({ error: 'Invalid beacon payload' }, 400, request);
        }

        if (!body.sessionId || body.sessionId.startsWith('eph_')) {
          return json({ ok: true, ephemeral: true }, 200, request);
        }

        const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first<Record<string, unknown>>();
        if (!row) return json({ ok: false }, 404, request);

        const session = mapSessionRow(row);
        if (session.status === 'completed') {
          return json({ ok: true, alreadyCompleted: true }, 200, request);
        }

        const actualSec = Math.max(session.actualDurationSec, Math.round(body.actualDurationSec ?? 0));
        const plannedSec = Math.max(60, session.plannedDurationMin * 60);
        const completionRatio = Number(Math.min(1, Math.max(0, actualSec / plannedSec)).toFixed(3));
        const now = new Date().toISOString();
        const nextStatus =
          session.status === 'active' && actualSec >= 60 ? 'pending_debrief' : session.status;

        const event = body.event ?? 'visibility';
        const computedMilestone =
          event === 'milestone_90' || completionRatio >= 0.9
            ? 90
            : event === 'milestone_75' || event === 'milestone' || completionRatio >= 0.75
              ? 75
              : event === 'milestone_50' || completionRatio >= 0.5
                ? 50
                : event === 'milestone_25' || completionRatio >= 0.25
                  ? 25
                  : 0;
        const maxMilestonePct = Math.max(Number(row.max_milestone_pct ?? 0), computedMilestone);

        const shouldEvaluateImplicit =
          (event === 'pagehide' && body.audioStarted !== false && actualSec >= 5) ||
          ((event === 'milestone' || event === 'milestone_75' || event === 'milestone_90') &&
            completionRatio >= 0.75);

        let implicitReward = row.implicit_reward_score !== null && row.implicit_reward_score !== undefined
          ? Number(row.implicit_reward_score)
          : null;
        let implicitWeight = Number(row.implicit_applied_weight ?? 0);
        let retentionOutcome = session.retentionOutcome ?? null;

        if (shouldEvaluateImplicit) {
          const isEarlyBounce =
            event === 'pagehide' &&
            (actualSec < 90 || (completionRatio < 0.25 && actualSec < 600));
          const computed = computeImplicitReward({
            actualDurationSec: actualSec,
            completionRatio,
            isEarlyBounce,
            instantGenreSwapped: false,
          });
          const targetWeight = 0.45;
          const finalGenre = session.musicGenre || 'deep_electronic';

          // Delta-replace any previous implicit milestone update cleanly
          const updates: Array<Promise<unknown>> = [
            updateBanditScope(env.DB, {
              scopeType: 'cohort_genre',
              scopeId: session.cohortKey,
              armId: finalGenre,
              mode: 'implicit',
              reward: computed.reward,
              weight: targetWeight,
              completionRatio,
              supersedePrevReward: implicitReward ?? 0,
              supersedePrevWeight: implicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'profile_genre',
              scopeId: String(row.profile_id),
              armId: finalGenre,
              mode: 'implicit',
              reward: computed.reward,
              weight: targetWeight,
              completionRatio,
              supersedePrevReward: implicitReward ?? 0,
              supersedePrevWeight: implicitWeight,
            }),
          ];

          if (!session.isControlTrial) {
            const marginalScopes = extractMarginalScopesFromSession(session);
            updates.push(
              updateBanditScope(env.DB, {
                scopeType: 'cohort',
                scopeId: session.cohortKey,
                armId: session.armId,
                mode: 'implicit',
                reward: computed.reward,
                weight: targetWeight,
                completionRatio,
                supersedePrevReward: implicitReward ?? 0,
                supersedePrevWeight: implicitWeight,
              }),
              updateBanditScope(env.DB, {
                scopeType: 'profile',
                scopeId: String(row.profile_id),
                armId: session.armId,
                mode: 'implicit',
                reward: computed.reward,
                weight: targetWeight,
                completionRatio,
                supersedePrevReward: implicitReward ?? 0,
                supersedePrevWeight: implicitWeight,
              }),
              updateBanditScope(env.DB, {
                scopeType: 'cohort_arm_genre',
                scopeId: `${session.cohortKey}|${finalGenre}`,
                armId: session.armId,
                mode: 'implicit',
                reward: computed.reward,
                weight: targetWeight,
                completionRatio,
                supersedePrevReward: implicitReward ?? 0,
                supersedePrevWeight: implicitWeight,
              }),
              ...marginalScopes.map((m) =>
                updateBanditScope(env.DB, {
                  scopeType: m.scopeType,
                  scopeId: m.scopeId,
                  armId: session.armId,
                  mode: 'implicit',
                  reward: computed.reward,
                  weight: targetWeight,
                  completionRatio,
                  supersedePrevReward: implicitReward ?? 0,
                  supersedePrevWeight: implicitWeight,
                })
              )
            );
          }

          await Promise.all(updates);
          implicitReward = computed.reward;
          implicitWeight = targetWeight;
          retentionOutcome = computed.outcome;
        }

        await env.DB.prepare(
          `UPDATE sessions
           SET actual_duration_sec = ?,
               completion_ratio = ?,
               max_milestone_pct = MAX(COALESCE(max_milestone_pct, 0), ?),
               live_adjustments_json = ?,
               status = ?,
               implicit_reward_score = ?,
               implicit_applied_weight = ?,
               retention_outcome = ?,
               last_beacon_at = ?
           WHERE id = ?`
        )
          .bind(
            actualSec,
            completionRatio,
            maxMilestonePct,
            JSON.stringify(body.liveAdjustments ?? session.liveAdjustments),
            nextStatus,
            implicitReward,
            implicitWeight,
            retentionOutcome,
            now,
            body.sessionId
          )
          .run();

        return json({ ok: true, retentionOutcome, completionRatio, maxMilestonePct }, 200, request);
      }

      // POST /api/session/claim-profile — Promotes an active 1-Click Quick-Try session into an anonymous persisted profile + session
      if (url.pathname === '/api/session/claim-profile' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'claim_profile', 40);
        if (!allowed) return json({ error: 'Rate limit reached.' }, 429, request);

        const body = (await request.json().catch(() => ({}))) as {
          occupationLabel?: string;
          age?: number;
          gender?: UserProfile['gender'];
          currentState?: CurrentState;
          targetState?: TargetState;
          environment?: SessionEnvironment;
          device?: OutputDevice;
          plannedDurationMin?: number;
          actualDurationSec?: number;
          armId?: string;
          armName?: string;
          studySpecId?: string;
          musicGenre?: string;
          energyTier?: EnergyTier;
          acousticParams?: AcousticParams;
          citedStudyIds?: string[];
        };

        const rawAge = Number(body.age ?? 0);
        if (!Number.isFinite(rawAge) || rawAge < 18 || rawAge > 95) {
          return json({ error: 'Listeners must be aged 18–95 to save a research profile.' }, 400, request);
        }
        const occupationLabel = sanitizeOccupation(body.occupationLabel);
        if (!occupationLabel || occupationLabel.length < 2) {
          return json({ error: 'Please enter your profession or craft (e.g. Doctor, Programmer, Student).' }, 400, request);
        }

        const lowerOcc = occupationLabel.toLowerCase();
        const inferredRole: UserProfile['role'] =
          /(driver|truck|uber|courier|pilot|delivery|sofer)/.test(lowerOcc)
            ? 'driver'
            : /(student|phd|med\s*school|resident|pupil)/.test(lowerOcc)
              ? 'student'
              : /(designer|artist|writer|musician|architect|video|creative)/.test(lowerOcc)
                ? 'creative'
                : /(founder|ceo|owner|entrepreneur|director|manager)/.test(lowerOcc)
                  ? 'entrepreneur'
                  : /(dev|program|engineer|analyst|data|tech|software|it\b)/.test(lowerOcc)
                    ? 'knowledge_worker'
                    : 'other';

        const now = new Date().toISOString();
        const age = Math.round(rawAge);
        const ageBand = ageToBand(age);
        const gender = parseGenderValue(body.gender);
        const profileId = `anon_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const profileToken = generateProfileToken();
        const tokenHash = await sha256Hex(profileToken);
        const syncCode = generateSyncCode();
        const syncCodeHash = await sha256Hex(syncCode);

        const profile: UserProfile = {
          id: profileId,
          age,
          ageBand,
          gender,
          role: inferredRole,
          occupationLabel,
          texturePref: 'warm_organic',
          noiseSensitivity: 'medium',
          defaultDevice: body.device ?? 'headphones',
          primaryChallenge: 'distraction',
          researchConsent: true,
          preferredModMult: 1.0,
          createdAt: now,
          updatedAt: now,
        };

        await env.DB.prepare(
          `INSERT INTO profiles (id, display_name, age, age_band, gender, role, occupation_label, texture_pref, noise_sensitivity, default_device, primary_challenge, research_consent, token_hash, sync_code_hash, created_at, updated_at)
           VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
          .bind(
            profile.id,
            profile.age,
            profile.ageBand,
            gender,
            profile.role,
            occupationLabel,
            profile.texturePref,
            profile.noiseSensitivity,
            profile.defaultDevice,
            profile.primaryChallenge,
            tokenHash,
            syncCodeHash,
            now,
            now
          )
          .run();

        const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const envMode: SessionEnvironment = body.environment ?? 'office';
        const targetState: TargetState = body.targetState ?? 'deep_flow';
        const currentState: CurrentState = body.currentState ?? 'distracted';
        const plannedMin = Math.max(5, Math.min(120, Math.round(Number(body.plannedDurationMin ?? 25))));
        const actualSec = Math.max(0, Math.round(Number(body.actualDurationSec ?? 0)));
        const compRatio = Number(Math.min(1, actualSec / (plannedMin * 60)).toFixed(3));
        const initMilestone =
          compRatio >= 0.9 ? 90 : compRatio >= 0.75 ? 75 : compRatio >= 0.5 ? 50 : compRatio >= 0.25 ? 25 : 0;
        const cohortKey = buildCohortKey(
          ageBand,
          envMode,
          targetState,
          inferredRole,
          currentState
        );
        const musicGenre = (body.musicGenre || 'lofi_keys').slice(0, 48);

        await env.DB.prepare(
          `INSERT INTO sessions (
            id, profile_id, cohort_key, raw_input_text, current_state, baseline_score,
            target_state, environment, device, safety_mode, planned_duration_min,
            actual_duration_sec, completion_ratio, max_milestone_pct, arm_id, arm_name, is_exploration,
            is_control_trial, energy_tier, music_genre, initial_music_genre,
            custom_genre_slug, audio_source, study_spec_id,
            acoustic_params_json, cited_study_ids_json, live_adjustments_json,
            time_of_day_bucket, status, created_at
          ) VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, 'studio_library', ?, ?, ?, '[]', ?, 'active', ?)`
        )
          .bind(
            sessionId,
            profile.id,
            cohortKey,
            `Quick-Try claimed: ${occupationLabel}`,
            currentState,
            targetState,
            envMode,
            body.device ?? 'headphones',
            plannedMin,
            actualSec,
            compRatio,
            initMilestone,
            (body.armId || 'beta-focus-16hz').slice(0, 64),
            (body.armName || 'Beta Focus 16 Hz').slice(0, 120),
            body.energyTier ?? 'focus',
            musicGenre,
            musicGenre,
            body.studySpecId ?? null,
            JSON.stringify(body.acousticParams ?? {}),
            JSON.stringify(body.citedStudyIds ?? []),
            getTimeOfDayBucket(),
            now
          )
          .run();

        return json(
          { profile, profileToken, syncCode, sessionId },
          200,
          request,
          { 'set-cookie': buildAuthSetCookieHeader(request, profileToken) }
        );
      }

      // POST /api/session/pvt — Saves objective visual 1/RT Psychomotor Vigilance Task metrics
      if (url.pathname === '/api/session/pvt' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'session_pvt', 120);
        if (!allowed) return json({ error: 'Rate limit reached.' }, 429, request);

        const body = (await request.json().catch(() => ({}))) as {
          sessionId?: string;
          phase?: 'pre' | 'post';
          medianMs?: number;
          lapses?: number;
          meanInvRt?: number;
          trialCount?: number;
          refreshHz?: number;
          decileSpreadMs?: number;
        };
        const medianMs = Number(body.medianMs);
        if (!Number.isFinite(medianMs) || medianMs < 100 || medianMs > 3000) {
          return json({ error: 'Invalid reaction time value.' }, 400, request);
        }
        const lapses = Math.max(0, Math.min(60, Math.round(Number(body.lapses ?? 0))));
        const meanInvRt =
          typeof body.meanInvRt === 'number' &&
          Number.isFinite(body.meanInvRt) &&
          body.meanInvRt >= 0.3 &&
          body.meanInvRt <= 10.0
            ? Number(body.meanInvRt.toFixed(3))
            : Number((1000 / medianMs).toFixed(3));
        const trialCount =
          typeof body.trialCount === 'number' && Number.isFinite(body.trialCount)
            ? Math.max(1, Math.min(120, Math.round(body.trialCount)))
            : null;
        const refreshHz =
          typeof body.refreshHz === 'number' &&
          Number.isFinite(body.refreshHz) &&
          body.refreshHz >= 30 &&
          body.refreshHz <= 500
            ? Math.round(body.refreshHz)
            : null;
        const decileSpreadMs =
          typeof body.decileSpreadMs === 'number' && Number.isFinite(body.decileSpreadMs)
            ? Math.max(0, Math.min(3000, Math.round(body.decileSpreadMs)))
            : null;

        if (!body.sessionId || body.sessionId.startsWith('eph_')) {
          return json(
            { ok: true, ephemeral: true, medianMs: Math.round(medianMs), lapses, meanInvRt },
            200,
            request
          );
        }

        if (body.phase === 'pre') {
          await env.DB.prepare(
            `UPDATE sessions SET
              pvt_pre_ms = ?,
              pvt_lapses_pre = ?,
              pvt_pre_inv_rt = ?,
              pvt_trial_count = COALESCE(?, pvt_trial_count),
              pvt_refresh_hz = COALESCE(?, pvt_refresh_hz),
              pvt_decile_spread_ms = COALESCE(?, pvt_decile_spread_ms)
             WHERE id = ?`
          )
            .bind(
              Math.round(medianMs),
              lapses,
              meanInvRt,
              trialCount,
              refreshHz,
              decileSpreadMs,
              body.sessionId
            )
            .run();
        } else {
          const prev = await env.DB.prepare(
            'SELECT pvt_pre_ms, pvt_pre_inv_rt FROM sessions WHERE id = ?'
          )
            .bind(body.sessionId)
            .first<{ pvt_pre_ms?: number | null; pvt_pre_inv_rt?: number | null }>();
          const pvtDelta =
            prev?.pvt_pre_ms !== null && prev?.pvt_pre_ms !== undefined
              ? Math.round(medianMs - Number(prev.pvt_pre_ms))
              : null;
          const pvtDeltaInvRt =
            prev?.pvt_pre_inv_rt !== null && prev?.pvt_pre_inv_rt !== undefined
              ? Number((meanInvRt - Number(prev.pvt_pre_inv_rt)).toFixed(3))
              : null;
          await env.DB.prepare(
            `UPDATE sessions SET
              pvt_post_ms = ?,
              pvt_lapses_post = ?,
              pvt_delta_ms = ?,
              pvt_post_inv_rt = ?,
              pvt_delta_inv_rt = ?,
              pvt_trial_count = COALESCE(?, pvt_trial_count),
              pvt_refresh_hz = COALESCE(?, pvt_refresh_hz),
              pvt_decile_spread_ms = COALESCE(?, pvt_decile_spread_ms)
             WHERE id = ?`
          )
            .bind(
              Math.round(medianMs),
              lapses,
              pvtDelta,
              meanInvRt,
              pvtDeltaInvRt,
              trialCount,
              refreshHz,
              decileSpreadMs,
              body.sessionId
            )
            .run();
        }
        return json({ ok: true, medianMs: Math.round(medianMs), lapses, meanInvRt }, 200, request);
      }

      // POST /api/session/biomarkers — Stores optional 15s Continuation Tapping CV & BLE HRV RMSSD/LF
      if (url.pathname === '/api/session/biomarkers' && request.method === 'POST') {
        const body = (await request.json()) as {
          sessionId: string;
          tappingCvPct?: number;
          tappingMeanItiMs?: number;
          hrvRmssdMs?: number;
          hrvLfRatio?: number;
        };
        if (!body.sessionId || body.sessionId.startsWith('eph_')) {
          return json({ ok: true, ephemeral: true }, 200, request);
        }
        const tapCv =
          typeof body.tappingCvPct === 'number' && Number.isFinite(body.tappingCvPct) && body.tappingCvPct >= 0 && body.tappingCvPct <= 100
            ? Number(body.tappingCvPct.toFixed(2))
            : null;
        const tapIti =
          typeof body.tappingMeanItiMs === 'number' && Number.isFinite(body.tappingMeanItiMs) && body.tappingMeanItiMs >= 140 && body.tappingMeanItiMs <= 2500
            ? Number(body.tappingMeanItiMs.toFixed(1))
            : null;
        const hrvRmssd =
          typeof body.hrvRmssdMs === 'number' && Number.isFinite(body.hrvRmssdMs) && body.hrvRmssdMs >= 2 && body.hrvRmssdMs <= 400
            ? Number(body.hrvRmssdMs.toFixed(1))
            : null;
        const hrvLf =
          typeof body.hrvLfRatio === 'number' && Number.isFinite(body.hrvLfRatio) && body.hrvLfRatio >= 0 && body.hrvLfRatio <= 1
            ? Number(body.hrvLfRatio.toFixed(3))
            : null;

        await env.DB.prepare(
          `UPDATE sessions SET
            tapping_cv_pct = COALESCE(?, tapping_cv_pct),
            tapping_mean_iti_ms = COALESCE(?, tapping_mean_iti_ms),
            hrv_rmssd_ms = COALESCE(?, hrv_rmssd_ms),
            hrv_lf_ratio = COALESCE(?, hrv_lf_ratio)
           WHERE id = ?`
        )
          .bind(tapCv, tapIti, hrvRmssd, hrvLf, body.sessionId)
          .run();

        return json({ ok: true }, 200, request);
      }

      // POST /api/session/debrief — Explicit 10s Debrief (supersedes any prior implicit update via delta-replacement!)
      if (url.pathname === '/api/session/debrief' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'debrief', 45);
        if (!allowed) {
          return json({ error: 'Daily debrief limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json()) as DebriefPayload;
        const cleanPvtPre =
          typeof body.pvtPreMs === 'number' && Number.isFinite(body.pvtPreMs) && body.pvtPreMs >= 100 && body.pvtPreMs <= 3000
            ? Math.round(body.pvtPreMs)
            : null;
        const cleanPvtPost =
          typeof body.pvtPostMs === 'number' && Number.isFinite(body.pvtPostMs) && body.pvtPostMs >= 100 && body.pvtPostMs <= 3000
            ? Math.round(body.pvtPostMs)
            : null;
        const cleanPvtDelta =
          cleanPvtPre !== null && cleanPvtPost !== null ? cleanPvtPost - cleanPvtPre : null;
        const cleanPreInv =
          typeof body.pvtPreInvRt === 'number' && Number.isFinite(body.pvtPreInvRt) && body.pvtPreInvRt >= 0.3 && body.pvtPreInvRt <= 10
            ? Number(body.pvtPreInvRt.toFixed(3))
            : null;
        const cleanPostInv =
          typeof body.pvtPostInvRt === 'number' && Number.isFinite(body.pvtPostInvRt) && body.pvtPostInvRt >= 0.3 && body.pvtPostInvRt <= 10
            ? Number(body.pvtPostInvRt.toFixed(3))
            : null;
        const cleanTrialCount =
          typeof body.pvtTrialCount === 'number' && Number.isFinite(body.pvtTrialCount)
            ? Math.max(1, Math.min(120, Math.round(body.pvtTrialCount)))
            : null;
        const cleanRefreshHz =
          typeof body.pvtRefreshHz === 'number' && Number.isFinite(body.pvtRefreshHz) && body.pvtRefreshHz >= 30 && body.pvtRefreshHz <= 500
            ? Math.round(body.pvtRefreshHz)
            : null;
        const cleanDecileSpread =
          typeof body.pvtDecileSpreadMs === 'number' && Number.isFinite(body.pvtDecileSpreadMs)
            ? Math.max(0, Math.min(3000, Math.round(body.pvtDecileSpreadMs)))
            : null;
        const cleanBlindingGuess =
          body.blindingGuess === 'active' ||
          body.blindingGuess === 'control' ||
          body.blindingGuess === 'unsure'
            ? body.blindingGuess
            : null;

        if (!body.sessionId || body.sessionId.startsWith('eph_')) {
          // Record completely anonymous aggregated Study Lab empirical rating (zero user PII!)
          if (body.sessionId?.startsWith('eph_study_') && body.studySpecId && body.studyTitle) {
            await env.DB.prepare(
              `INSERT INTO study_outcomes (
                id, study_spec_id, study_title, entrainment_type, frequency_hz,
                worked_rating, delta_score, pvt_pre_ms, pvt_post_ms, pvt_delta_ms,
                is_control_trial, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
            )
              .bind(
                `so_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
                body.studySpecId.slice(0, 100),
                body.studyTitle.slice(0, 180),
                (body.entrainmentType ?? 'amplitude_modulation').slice(0, 40),
                Number(body.frequencyHz ?? 0),
                body.workedRating,
                Math.max(-4, Math.min(4, Number(body.postScore) - 3)),
                cleanPvtPre,
                cleanPvtPost,
                cleanPvtDelta,
                new Date().toISOString()
              )
              .run()
              .catch(() => {});
          }
          return json(
            {
              ok: true,
              learningUpdate: {
                sessionId: body.sessionId,
                armId: 'ephemeral',
                armName: body.studyTitle || 'Local-Only Session',
                cohortKey: 'local',
                cohortLabel: 'Local-Only Privacy Mode',
                delta: body.postScore - 2,
                reward: 0.75,
                cohortSuccessRatePct: 0,
                cohortTrials: 0,
                profileSuccessRatePct: 0,
                profileTrials: 0,
                wasControlTrial: false,
                preferredModMult: 1.0,
              },
            },
            200,
            request
          );
        }

        const row = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
          .bind(body.sessionId)
          .first<Record<string, unknown>>();
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

        const finalPvtPreInv =
          cleanPreInv ?? (row.pvt_pre_inv_rt !== null && row.pvt_pre_inv_rt !== undefined ? Number(row.pvt_pre_inv_rt) : null);
        const finalPvtPostInv =
          cleanPostInv ?? (row.pvt_post_inv_rt !== null && row.pvt_post_inv_rt !== undefined ? Number(row.pvt_post_inv_rt) : null);
        const finalPvtDeltaInv =
          finalPvtPreInv !== null && finalPvtPostInv !== null
            ? Number((finalPvtPostInv - finalPvtPreInv).toFixed(3))
            : null;
        const finalPvtTrials =
          cleanTrialCount ?? (row.pvt_trial_count !== null && row.pvt_trial_count !== undefined ? Number(row.pvt_trial_count) : null);

        const { reward, delta } = computeSessionReward({
          baselineScore: session.baselineScore,
          postScore,
          workedRating: body.workedRating,
          completionRatio,
          liveAdjustments,
          pvtDeltaInvRt: finalPvtDeltaInv,
          pvtTrialCount: finalPvtTrials,
        });

        const learningWeight = actualSec >= 60 ? 1.0 : 0.35;
        const prevImplicitReward = Number(row.implicit_reward_score ?? 0);
        const prevImplicitWeight = Number(row.implicit_applied_weight ?? 0);

        const now = new Date().toISOString();
        const finalPvtPre =
          cleanPvtPre ?? (row.pvt_pre_ms !== null && row.pvt_pre_ms !== undefined ? Number(row.pvt_pre_ms) : null);
        const finalPvtPost =
          cleanPvtPost ?? (row.pvt_post_ms !== null && row.pvt_post_ms !== undefined ? Number(row.pvt_post_ms) : null);
        const finalPvtDelta =
          finalPvtPre !== null && finalPvtPost !== null ? Math.round(finalPvtPost - finalPvtPre) : null;

        const finalMilestonePct =
          completionRatio >= 0.9 ? 90 : completionRatio >= 0.75 ? 75 : completionRatio >= 0.5 ? 50 : completionRatio >= 0.25 ? 25 : 0;

        const genreTweaks = liveAdjustments.filter(
          (a) => a.control === 'genre' && a.note && a.note in GENRE_META
        );
        const swappedGenre =
          genreTweaks.length > 0 ? String(genreTweaks[genreTweaks.length - 1].note) : null;
        const finalGenre =
          swappedGenre || session.musicGenre || session.acousticParams?.genre || 'deep_electronic';

        await env.DB.prepare(
          `UPDATE sessions SET
            actual_duration_sec = ?,
            completion_ratio = ?,
            max_milestone_pct = MAX(COALESCE(max_milestone_pct, 0), ?),
            music_genre = ?,
            live_adjustments_json = ?,
            status = 'completed',
            post_score = ?,
            delta_score = ?,
            worked_rating = ?,
            feedback_tags_json = ?,
            reward_score = ?,
            implicit_applied_weight = 0,
            pvt_pre_ms = COALESCE(?, pvt_pre_ms),
            pvt_post_ms = COALESCE(?, pvt_post_ms),
            pvt_delta_ms = COALESCE(?, pvt_delta_ms),
            pvt_lapses_pre = COALESCE(?, pvt_lapses_pre),
            pvt_lapses_post = COALESCE(?, pvt_lapses_post),
            pvt_pre_inv_rt = COALESCE(?, pvt_pre_inv_rt),
            pvt_post_inv_rt = COALESCE(?, pvt_post_inv_rt),
            pvt_delta_inv_rt = COALESCE(?, pvt_delta_inv_rt),
            pvt_trial_count = COALESCE(?, pvt_trial_count),
            pvt_refresh_hz = COALESCE(?, pvt_refresh_hz),
            pvt_decile_spread_ms = COALESCE(?, pvt_decile_spread_ms),
            blinding_guess = COALESCE(?, blinding_guess),
            notes = ?,
            completed_at = ?
           WHERE id = ?`
        )
          .bind(
            actualSec,
            completionRatio,
            finalMilestonePct,
            finalGenre,
            JSON.stringify(liveAdjustments),
            postScore,
            delta,
            body.workedRating,
            JSON.stringify(body.feedbackTags ?? []),
            reward,
            finalPvtPre,
            finalPvtPost,
            finalPvtDelta,
            body.pvtLapsesPre ?? null,
            body.pvtLapsesPost ?? null,
            finalPvtPreInv,
            finalPvtPostInv,
            finalPvtDeltaInv,
            finalPvtTrials,
            cleanRefreshHz,
            cleanDecileSpread,
            cleanBlindingGuess,
            (body.notes ?? '').slice(0, 500),
            now,
            body.sessionId
          )
          .run();

        // Feed anonymized study outcome into the open Study Lab Leaderboard!
        const specId = (row.study_spec_id ? String(row.study_spec_id) : body.studySpecId) || null;
        if (specId) {
          await env.DB.prepare(
            `INSERT INTO study_outcomes (
              id, study_spec_id, study_title, entrainment_type, frequency_hz,
              worked_rating, delta_score, pvt_pre_ms, pvt_post_ms, pvt_delta_ms,
              is_control_trial, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              `so_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
              specId.slice(0, 100),
              (body.studyTitle || session.armName).slice(0, 180),
              (body.entrainmentType ?? 'amplitude_modulation').slice(0, 40),
              Number(body.frequencyHz ?? session.acousticParams?.modulationHz ?? 0),
              body.workedRating,
              delta,
              finalPvtPre,
              finalPvtPost,
              finalPvtDelta,
              session.isControlTrial ? 1 : 0,
              now
            )
            .run()
            .catch(() => {});
        }

        let cohortUpdated = { successRatePct: 0, trials: 0 };
        let profileUpdated = { successRatePct: 0, trials: 0 };
        let profileGenreUpdated = { successRatePct: 0, trials: 0 };
        const profileId = String(row.profile_id);
        const tags = body.feedbackTags ?? [];

        // Decouple Layer 1 (Protocol Sound) vs Layer 2 (Music Taste) rewards so disliking one never sabotages the other
        let protocolReward = reward;
        let genreReward = reward;
        if (tags.includes('Loved the music style')) {
          genreReward = Number(Math.min(0.98, genreReward + 0.14).toFixed(3));
        }
        if (session.initialMusicGenre && finalGenre !== session.initialMusicGenre && body.workedRating === 'yes') {
          genreReward = Number(Math.min(0.96, genreReward + 0.1).toFixed(3));
        }
        if (tags.includes('Try a different music style')) {
          genreReward = Number(Math.max(0.12, Math.min(0.32, genreReward - 0.38)).toFixed(3));
          if (body.workedRating !== 'no') {
            protocolReward = Number(Math.max(protocolReward, 0.62).toFixed(3));
          }
        }
        if (
          tags.includes('Modulation felt distracting') &&
          !tags.includes('Try a different music style') &&
          body.workedRating !== 'no'
        ) {
          genreReward = Number(Math.min(0.88, Math.max(genreReward, 0.64)).toFixed(3));
        }

        if (!session.isControlTrial) {
          const marginalScopes = extractMarginalScopesFromSession(session);
          const [cUp, pUp, , , pGenreUp] = await Promise.all([
            updateBanditScope(env.DB, {
              scopeType: 'cohort',
              scopeId: session.cohortKey,
              armId: session.armId,
              mode: 'explicit',
              reward: protocolReward,
              weight: learningWeight,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'profile',
              scopeId: profileId,
              armId: session.armId,
              mode: 'explicit',
              reward: protocolReward,
              weight: learningWeight,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'profile_state',
              scopeId: `${profileId}|${session.currentState}|${session.targetState}`,
              armId: session.armId,
              mode: 'explicit',
              reward: protocolReward,
              weight: learningWeight,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'cohort_genre',
              scopeId: session.cohortKey,
              armId: finalGenre,
              mode: 'explicit',
              reward: genreReward,
              weight: learningWeight,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'profile_genre',
              scopeId: profileId,
              armId: finalGenre,
              mode: 'explicit',
              reward: genreReward,
              weight: learningWeight,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'cohort_arm_genre',
              scopeId: `${session.cohortKey}|${finalGenre}`,
              armId: session.armId,
              mode: 'explicit',
              reward: protocolReward,
              weight: learningWeight,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            ...marginalScopes.map((m) =>
              updateBanditScope(env.DB, {
                scopeType: m.scopeType,
                scopeId: m.scopeId,
                armId: session.armId,
                mode: 'explicit',
                reward: protocolReward,
                weight: learningWeight,
                delta,
                completionRatio,
                supersedePrevReward: prevImplicitReward,
                supersedePrevWeight: prevImplicitWeight,
              })
            ),
          ]);
          cohortUpdated = cUp;
          profileUpdated = pUp;
          profileGenreUpdated = pGenreUp;
        } else {
          // Control trial still updates Layer 2 genre preference cleanly
          const [, pGenreUp] = await Promise.all([
            updateBanditScope(env.DB, {
              scopeType: 'cohort_genre',
              scopeId: session.cohortKey,
              armId: finalGenre,
              mode: 'explicit',
              reward: genreReward,
              weight: learningWeight * 0.75,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
            updateBanditScope(env.DB, {
              scopeType: 'profile_genre',
              scopeId: profileId,
              armId: finalGenre,
              mode: 'explicit',
              reward: genreReward,
              weight: learningWeight * 0.75,
              delta,
              completionRatio,
              supersedePrevReward: prevImplicitReward,
              supersedePrevWeight: prevImplicitWeight,
            }),
          ]);
          profileGenreUpdated = pGenreUp;
          const [cStats, pStats] = await Promise.all([
            fetchBanditRows(env.DB, 'cohort', session.cohortKey),
            fetchBanditRows(env.DB, 'profile', profileId),
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

        // Adapt personal AM sensitivity multiplier
        const profRow = await env.DB.prepare('SELECT preferred_mod_mult FROM profiles WHERE id = ?')
          .bind(profileId)
          .first<{ preferred_mod_mult?: number }>();
        const prevMult = Number(profRow?.preferred_mod_mult ?? 1.0);
        let multDelta = 0;
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
        const updatedModMult = Number(Math.max(0.65, Math.min(1.35, prevMult + multDelta)).toFixed(2));
        if (multDelta !== 0 && !session.isControlTrial) {
          await env.DB.prepare('UPDATE profiles SET preferred_mod_mult = ?, updated_at = ? WHERE id = ?')
            .bind(updatedModMult, now, profileId)
            .run();
        }

        return json(
          {
            ok: true,
            learningUpdate: {
              sessionId: session.id,
              armId: session.armId,
              armName: session.armName,
              cohortKey: session.cohortKey,
              cohortLabel: formatCohortLabel(session.cohortKey),
              delta,
              reward: protocolReward,
              cohortSuccessRatePct: cohortUpdated.successRatePct,
              cohortTrials: cohortUpdated.trials,
              profileSuccessRatePct: profileUpdated.successRatePct,
              profileTrials: profileUpdated.trials,
              wasControlTrial: session.isControlTrial,
              preferredModMult: updatedModMult,
              ...(finalGenre in GENRE_META ? { learnedGenre: finalGenre as ResolvedGenre } : {}),
              learnedGenreLabel: getGenreDisplayMeta(finalGenre).label,
              learnedGenreFitPct: profileGenreUpdated.successRatePct,
            },
          },
          200,
          request
        );
      }

      // POST /api/session/dismiss
      if (url.pathname === '/api/session/dismiss' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'dismiss', 60);
        if (!allowed) return json({ error: 'Rate limit reached.' }, 429, request);
        const body = (await request.json()) as { sessionId: string };
        await env.DB.prepare(
          `UPDATE sessions SET status = 'abandoned' WHERE id = ? AND status IN ('active', 'pending_debrief')`
        )
          .bind(body.sessionId)
          .run();
        return json({ ok: true }, 200, request);
      }

      // GET /api/insights — SQL-Aggregated Research Brain (ZERO profileId exposed publicly!)
      if (url.pathname === '/api/insights' && request.method === 'GET') {
        const profileId = url.searchParams.get('profileId') ?? '';
        let canReadPersonal = false;
        if (profileId) {
          const auth = await verifyProfileAccess(env.DB, profileId, request);
          canReadPersonal = auth.ok;
        }

        const [
          profilesCountRow,
          totalsRow,
          abRows,
          retentionRow,
          returnStatsRow,
          cohortAggRes,
          cohortBanditRes,
          personalBanditRes,
          genreAggRes,
          comboAggRes,
          recentRes,
        ] = await Promise.all([
          env.DB.prepare('SELECT COUNT(*) AS c FROM profiles').first<{ c: number }>(),
          env.DB.prepare(
            `SELECT
               COUNT(*) AS total_sessions,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_debriefs,
               SUM(CASE WHEN status = 'pending_debrief' AND actual_duration_sec >= 60 THEN 1 ELSE 0 END) AS pending_debriefs,
               SUM(CASE WHEN is_exploration = 1 THEN 1 ELSE 0 END) AS exploration_count,
               SUM(CASE WHEN status = 'completed' AND (worked_rating = 'yes' OR (worked_rating = 'partial' AND COALESCE(delta_score, 0) > 0)) THEN 1 ELSE 0 END) AS positive_completed,
               AVG(CASE WHEN status = 'completed' THEN delta_score END) AS avg_delta
             FROM sessions`
          ).first<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT
               is_control_trial,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS comp_n,
               AVG(CASE WHEN status = 'completed' THEN delta_score END) AS avg_delta,
               SUM(CASE WHEN status = 'completed' AND (worked_rating = 'yes' OR (worked_rating = 'partial' AND COALESCE(delta_score, 0) > 0)) THEN 1 ELSE 0 END) AS pos_n,
               AVG(CASE WHEN actual_duration_sec >= 10 THEN completion_ratio END) AS avg_ret
             FROM sessions
             GROUP BY is_control_trial`
          ).all<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT
               COUNT(*) AS tracked_n,
               AVG(completion_ratio) AS avg_comp,
               SUM(CASE WHEN completion_ratio >= 0.75 THEN 1 ELSE 0 END) AS completed_75_n,
               SUM(CASE WHEN retention_outcome = 'early_bounce' OR (status != 'completed' AND actual_duration_sec > 0 AND actual_duration_sec < 90) THEN 1 ELSE 0 END) AS bounce_n,
               SUM(CASE WHEN genre_swapped_at_sec IS NOT NULL AND genre_swapped_at_sec < 60 THEN 1 ELSE 0 END) AS swap_n
             FROM sessions
             WHERE actual_duration_sec >= 10 OR status = 'completed'`
          ).first<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT
               COUNT(DISTINCT profile_id) AS total_active_profiles,
               SUM(CASE WHEN session_count >= 2 THEN 1 ELSE 0 END) AS returning_profiles,
               SUM(CASE WHEN span_hours >= 12 AND span_hours <= 48 THEN 1 ELSE 0 END) AS d1_profiles,
               SUM(CASE WHEN span_hours >= 12 AND span_hours <= 168 THEN 1 ELSE 0 END) AS d7_profiles
             FROM (
               SELECT
                 profile_id,
                 COUNT(*) AS session_count,
                 (julianday(MAX(created_at)) - julianday(MIN(created_at))) * 24.0 AS span_hours
               FROM sessions
               GROUP BY profile_id
             )`
          ).first<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT
               cohort_key,
               COUNT(*) AS total_sessions,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_sessions,
               AVG(CASE WHEN status = 'completed' THEN delta_score END) AS avg_delta,
               SUM(CASE WHEN status = 'completed' AND (worked_rating = 'yes' OR (worked_rating = 'partial' AND COALESCE(delta_score, 0) > 0)) THEN 1 ELSE 0 END) AS pos_n
             FROM sessions
             GROUP BY cohort_key
             ORDER BY total_sessions DESC
             LIMIT 30`
          ).all<Record<string, unknown>>(),
          env.DB.prepare(`SELECT * FROM bandit_stats WHERE scope_type = 'cohort'`).all<Record<string, unknown>>(),
          canReadPersonal
            ? env.DB.prepare(`SELECT * FROM bandit_stats WHERE scope_type = 'profile' AND scope_id = ?`)
                .bind(profileId)
                .all<Record<string, unknown>>()
            : Promise.resolve({ results: [] as Record<string, unknown>[] }),
          env.DB.prepare(
            `SELECT
               music_genre,
               COUNT(*) AS total_n,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS comp_n,
               SUM(CASE WHEN status = 'completed' AND (worked_rating = 'yes' OR (worked_rating = 'partial' AND COALESCE(delta_score, 0) > 0)) THEN 1 ELSE 0 END) AS pos_n,
               AVG(CASE WHEN status = 'completed' THEN delta_score END) AS avg_delta,
               AVG(CASE WHEN actual_duration_sec >= 10 THEN completion_ratio END) AS avg_ret
             FROM sessions
             GROUP BY music_genre
             ORDER BY comp_n DESC, total_n DESC
             LIMIT 24`
          ).all<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT
               cohort_key,
               arm_name,
               music_genre,
               COUNT(*) AS sessions_n,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS comp_n,
               SUM(CASE WHEN status = 'completed' AND (worked_rating = 'yes' OR (worked_rating = 'partial' AND COALESCE(delta_score, 0) > 0)) THEN 1 ELSE 0 END) AS pos_n,
               AVG(CASE WHEN status = 'completed' THEN delta_score END) AS avg_delta,
               AVG(CASE WHEN actual_duration_sec >= 10 THEN completion_ratio END) AS avg_ret
             FROM sessions
             GROUP BY cohort_key, arm_name, music_genre
             ORDER BY sessions_n DESC
             LIMIT 12`
          ).all<Record<string, unknown>>(),
          env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 20').all<Record<string, unknown>>(),
        ]);

        const totalSessions = Number(totalsRow?.total_sessions ?? 0);
        const completedDebriefs = Number(totalsRow?.completed_debriefs ?? 0);
        const pendingDebriefs = Number(totalsRow?.pending_debriefs ?? 0);
        const positiveCompleted = Number(totalsRow?.positive_completed ?? 0);
        const globalSuccessRatePct =
          completedDebriefs > 0 ? Math.round((positiveCompleted / completedDebriefs) * 100) : 0;
        const globalAvgDelta =
          totalsRow?.avg_delta !== null && totalsRow?.avg_delta !== undefined
            ? Number(Number(totalsRow.avg_delta).toFixed(2))
            : 0;
        const explorationSharePct =
          totalSessions > 0
            ? Math.round((Number(totalsRow?.exploration_count ?? 0) / totalSessions) * 100)
            : 0;

        // Blind A/B Validation (Explicit Δ + Listen Retention %)
        const activeAb = abRows.results.find((r) => Number(r.is_control_trial ?? 0) === 0);
        const controlAb = abRows.results.find((r) => Number(r.is_control_trial ?? 0) === 1);
        const activeN = Number(activeAb?.comp_n ?? 0);
        const controlN = Number(controlAb?.comp_n ?? 0);
        const activeAvgDelta = activeN > 0 ? Number(Number(activeAb?.avg_delta ?? 0).toFixed(2)) : 0;
        const controlAvgDelta = controlN > 0 ? Number(Number(controlAb?.avg_delta ?? 0).toFixed(2)) : 0;
        const activeListenRet = Math.round(Number(activeAb?.avg_ret ?? 0) * 100);
        const controlListenRet = Math.round(Number(controlAb?.avg_ret ?? 0) * 100);

        const abValidation: ABValidationStats = {
          activeSessions: activeN,
          controlSessions: controlN,
          activeAvgDelta,
          controlAvgDelta,
          activeSuccessRatePct:
            activeN > 0 ? Math.round((Number(activeAb?.pos_n ?? 0) / activeN) * 100) : 0,
          controlSuccessRatePct:
            controlN > 0 ? Math.round((Number(controlAb?.pos_n ?? 0) / controlN) * 100) : 0,
          activeListenRetentionPct: activeListenRet,
          controlListenRetentionPct: controlListenRet,
          deltaLift:
            activeN > 0 && controlN > 0 ? Number((activeAvgDelta - controlAvgDelta).toFixed(2)) : 0,
          retentionLiftPct:
            activeListenRet > 0 && controlListenRet > 0 ? activeListenRet - controlListenRet : 0,
          readyForStats: activeN >= 10 && controlN >= 5,
        };

        // Behavioral Retention Metrics (separate from Explicit Δ!)
        const trackedN = Number(retentionRow?.tracked_n ?? 0);
        const totalActiveProfiles = Number(returnStatsRow?.total_active_profiles ?? 0);
        const retentionMetrics: RetentionMetrics = {
          trackedSessions: trackedN,
          avgListenRetentionPct: Math.round(Number(retentionRow?.avg_comp ?? 0) * 100),
          completionRatePct:
            trackedN > 0 ? Math.round((Number(retentionRow?.completed_75_n ?? 0) / trackedN) * 100) : 0,
          earlyBounceRatePct:
            trackedN > 0 ? Math.round((Number(retentionRow?.bounce_n ?? 0) / trackedN) * 100) : 0,
          instantSwapRatePct:
            trackedN > 0 ? Math.round((Number(retentionRow?.swap_n ?? 0) / trackedN) * 100) : 0,
          d1ReturnRatePct:
            totalActiveProfiles > 0
              ? Math.round((Number(returnStatsRow?.d1_profiles ?? 0) / totalActiveProfiles) * 100)
              : 0,
          d7ReturnRatePct:
            totalActiveProfiles > 0
              ? Math.round((Number(returnStatsRow?.d7_profiles ?? 0) / totalActiveProfiles) * 100)
              : 0,
          returningProfiles: Number(returnStatsRow?.returning_profiles ?? 0),
        };

        const armNameMap = new Map(PROTOCOL_ARMS.map((a) => [a.id, a.name]));
        const cohortBanditMap = new Map<string, ArmPerformance[]>();
        for (const r of cohortBanditRes.results) {
          const cohortKey = String(r.scope_id);
          const alpha = Number(r.alpha);
          const beta = Number(r.beta);
          const entry: ArmPerformance = {
            armId: String(r.arm_id),
            armName: armNameMap.get(String(r.arm_id)) ?? String(r.arm_id),
            trials: Number(r.trials),
            explicitTrials: Number(r.explicit_trials ?? 0),
            implicitTrials: Number(r.implicit_trials ?? 0),
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

        const cohorts: CohortPerformance[] = cohortAggRes.results.map((c) => {
          const cohortKey = String(c.cohort_key);
          const comp = Number(c.completed_sessions ?? 0);
          const arms = (cohortBanditMap.get(cohortKey) ?? []).sort(
            (a, b) => b.successRatePct - a.successRatePct
          );
          return {
            cohortKey,
            cohortLabel: formatCohortLabel(cohortKey),
            totalSessions: Number(c.total_sessions ?? 0),
            completedSessions: comp,
            avgDelta: comp > 0 ? Number(Number(c.avg_delta ?? 0).toFixed(2)) : 0,
            successRatePct: comp > 0 ? Math.round((Number(c.pos_n ?? 0) / comp) * 100) : 0,
            topArmName: arms[0]?.armName ?? '—',
            arms,
          };
        });

        const personalArms: ArmPerformance[] = personalBanditRes.results
          .map((r) => {
            const alpha = Number(r.alpha);
            const beta = Number(r.beta);
            return {
              armId: String(r.arm_id),
              armName: armNameMap.get(String(r.arm_id)) ?? String(r.arm_id),
              trials: Number(r.trials),
              explicitTrials: Number(r.explicit_trials ?? 0),
              implicitTrials: Number(r.implicit_trials ?? 0),
              successRatePct: Math.round((alpha / (alpha + beta)) * 100),
              avgDelta: Number(Number(r.avg_delta).toFixed(2)),
              avgCompletionPct: Math.round(Number(r.avg_completion) * 100),
              alpha,
              beta,
            };
          })
          .sort((a, b) => b.successRatePct - a.successRatePct);

        const genreLeaderboard: GenrePerformance[] = genreAggRes.results.map((r) => {
          const slug = String(r.music_genre || 'deep_electronic');
          const display = getGenreDisplayMeta(slug);
          const compN = Number(r.comp_n ?? 0);
          const totalN = Number(r.total_n ?? 0);
          return {
            genre: slug,
            label: display.label,
            isCustom: display.isCustom,
            sessions: compN > 0 ? compN : totalN,
            successRatePct: compN > 0 ? Math.round((Number(r.pos_n ?? 0) / compN) * 100) : 0,
            avgDelta: compN > 0 ? Number(Number(r.avg_delta ?? 0).toFixed(2)) : 0,
            avgRetentionPct: Math.round(Number(r.avg_ret ?? 0) * 100),
          };
        });

        const topArchetypeCombos: ArchetypeComboPerformance[] = comboAggRes.results.map((r) => {
          const cohortKey = String(r.cohort_key);
          const slug = String(r.music_genre || 'deep_electronic');
          const compN = Number(r.comp_n ?? 0);
          return {
            cohortKey,
            cohortLabel: formatCohortLabel(cohortKey),
            armName: String(r.arm_name),
            genreSlug: slug,
            genreLabel: getGenreDisplayMeta(slug).label,
            sessions: Number(r.sessions_n ?? 0),
            avgDelta: compN > 0 ? Number(Number(r.avg_delta ?? 0).toFixed(2)) : 0,
            avgRetentionPct: Math.round(Number(r.avg_ret ?? 0) * 100),
            successRatePct: compN > 0 ? Math.round((Number(r.pos_n ?? 0) / compN) * 100) : 0,
          };
        });

        // Public privacy scrub: NEVER include profileId, rawInputText, or notes in public recentSessions!
        const recentSessions = recentRes.results.map((r) => {
          const mapped = mapSessionRow(r, false);
          return { ...mapped, rawInputText: '', notes: '' };
        });

        const insights: ResearchInsights = {
          totalProfiles: Number(profilesCountRow?.c ?? 0),
          totalSessions,
          completedDebriefs,
          pendingDebriefs,
          globalSuccessRatePct,
          globalAvgDelta,
          explorationSharePct,
          abValidation,
          retentionMetrics,
          cohorts,
          personalArms,
          genreLeaderboard,
          topArchetypeCombos,
          recentSessions,
        };

        return json({ insights }, 200, request);
      }

      // GET /api/intelligence/cohorts — Aggregated Anonymized Cohort Intelligence + Retention Curve (B2B Preview / Zero PII)
      if (url.pathname === '/api/intelligence/cohorts' && request.method === 'GET') {
        const [funnelRow, cohortRes] = await Promise.all([
          env.DB.prepare(
            `SELECT
               COUNT(*) AS measured_n,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 25 THEN 1 ELSE 0 END) AS m25,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 50 THEN 1 ELSE 0 END) AS m50,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 75 THEN 1 ELSE 0 END) AS m75,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 90 THEN 1 ELSE 0 END) AS m90,
               AVG(COALESCE(s.completion_ratio, 0)) AS avg_comp
             FROM sessions s
             JOIN profiles p ON p.id = s.profile_id
             WHERE p.research_consent = 1 AND s.actual_duration_sec >= 15`
          ).first<Record<string, unknown>>(),
          env.DB.prepare(
            `SELECT
               CASE
                 WHEN TRIM(COALESCE(p.occupation_label, '')) != '' THEN TRIM(p.occupation_label)
                 ELSE p.role
               END AS prof_key,
               s.current_state,
               s.target_state,
               s.arm_name,
               COUNT(*) AS n_sessions,
               SUM(CASE WHEN s.worked_rating = 'yes' OR (s.worked_rating = 'partial' AND COALESCE(s.delta_score, 0) > 0) THEN 1 ELSE 0 END) AS pos_explicit,
               SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS n_explicit,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 25 THEN 1 ELSE 0 END) AS m25,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 50 THEN 1 ELSE 0 END) AS m50,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 75 THEN 1 ELSE 0 END) AS m75,
               SUM(CASE WHEN MAX(COALESCE(s.max_milestone_pct, 0), CAST(ROUND(COALESCE(s.completion_ratio, 0) * 100) AS INTEGER)) >= 90 THEN 1 ELSE 0 END) AS m90,
               AVG(s.pvt_delta_ms) AS avg_pvt_ms,
               MAX(s.music_genre) AS sample_genre
             FROM sessions s
             JOIN profiles p ON p.id = s.profile_id
             WHERE p.research_consent = 1 AND s.is_control_trial = 0 AND s.actual_duration_sec >= 15
             GROUP BY prof_key, s.current_state, s.target_state, s.arm_name
             HAVING COUNT(*) >= 5
             ORDER BY n_sessions DESC
             LIMIT 12`
          ).all<Record<string, unknown>>(),
        ]);

        const mN = Number(funnelRow?.measured_n ?? 0);
        const globalRetention: GlobalRetentionFunnel = {
          measuredSessions: mN,
          pct25: mN > 0 ? Math.round((Number(funnelRow?.m25 ?? 0) / mN) * 100) : 0,
          pct50: mN > 0 ? Math.round((Number(funnelRow?.m50 ?? 0) / mN) * 100) : 0,
          pct75: mN > 0 ? Math.round((Number(funnelRow?.m75 ?? 0) / mN) * 100) : 0,
          pct90: mN > 0 ? Math.round((Number(funnelRow?.m90 ?? 0) / mN) * 100) : 0,
          avgCompletionPct: mN > 0 ? Math.round(Number(funnelRow?.avg_comp ?? 0) * 100) : 0,
        };

        const cohorts: CohortIntelligenceCard[] = cohortRes.results.map((r, idx) => {
          const n = Number(r.n_sessions ?? 0);
          const nExp = Number(r.n_explicit ?? 0);
          const rawProf = String(r.prof_key ?? 'Listeners');
          const profLabel =
            rawProf in ROLE_LABELS ? ROLE_LABELS[rawProf as keyof typeof ROLE_LABELS] : rawProf;
          const stKey = String(r.current_state ?? 'distracted') as CurrentState;
          const tgKey = String(r.target_state ?? 'deep_flow') as TargetState;
          const pct75 = n > 0 ? Math.round((Number(r.m75 ?? 0) / n) * 100) : 0;
          const pct90 = n > 0 ? Math.round((Number(r.m90 ?? 0) / n) * 100) : 0;
          const successPct =
            nExp > 0
              ? Math.round((Number(r.pos_explicit ?? 0) / nExp) * 100)
              : pct75;

          return {
            id: `live_${idx}_${rawProf.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            isLiveData: true,
            professionLabel: profLabel,
            fromStateLabel: (STATE_LABELS[stKey] ?? stKey).split('/')[0].trim(),
            toStateLabel: TARGET_LABELS[tgKey] ?? tgKey,
            studyLabel: String(r.arm_name ?? 'Study-Backed Protocol'),
            sessions: n,
            successRatePct: successPct,
            fullFinishPct: pct90,
            retentionCurve: {
              pct25: n > 0 ? Math.round((Number(r.m25 ?? 0) / n) * 100) : 0,
              pct50: n > 0 ? Math.round((Number(r.m50 ?? 0) / n) * 100) : 0,
              pct75,
              pct90,
            },
            blurredPreview: {
              topGenreHint: String(r.sample_genre ?? 'Studio Match'),
              modulationHint: '3-Band LR4 · Exact Hz/Depth/SNR',
              avgPvtShiftMs:
                r.avg_pvt_ms !== null && r.avg_pvt_ms !== undefined
                  ? Math.round(Number(r.avg_pvt_ms))
                  : null,
              abLiftPct: null,
            },
          };
        });

        return json(
          {
            cohorts,
            globalRetention,
            totalLiveCohorts: cohorts.length,
          },
          200,
          request
        );
      }

      // POST /api/intelligence/inquire — B2B / Academic Research Dataset Licensing Inquiry
      if (url.pathname === '/api/intelligence/inquire' && request.method === 'POST') {
        const allowed = await checkDailyRateLimit(env.DB, request, 'b2b_inquiry', 5);
        if (!allowed) {
          return json({ error: 'Daily inquiry limit reached. Please try again tomorrow.' }, 429, request);
        }
        const body = (await request.json().catch(() => ({}))) as Partial<DatasetInquiryPayload>;
        const email = String(body.email ?? '').trim().slice(0, 120);
        const organization = String(body.organization ?? '').trim().slice(0, 120);
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: 'Please enter a valid work or research email address.' }, 400, request);
        }
        if (organization.length < 2) {
          return json({ error: 'Please enter your company, lab, or organization name.' }, 400, request);
        }
        const inquiryId = `inq_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO dataset_inquiries (id, email, organization, role_title, cohort_interest, use_case, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            inquiryId,
            email,
            organization,
            String(body.roleTitle ?? '').trim().slice(0, 80),
            String(body.cohortInterest ?? '').trim().slice(0, 140),
            String(body.useCase ?? 'research').trim().slice(0, 40),
            String(body.notes ?? '').trim().slice(0, 500),
            now
          )
          .run();

        return json({ ok: true, inquiryId }, 200, request);
      }

      // GET /api/admin/inquiries — Admin-Protected B2B Dataset Licensing Leads Export
      if (url.pathname === '/api/admin/inquiries' && request.method === 'GET') {
        if (!isAuthorizedAdmin(request, env)) {
          return json({ error: 'Unauthorized (provide X-Admin-Key header).' }, 401, request);
        }
        const rows = await env.DB.prepare(
          `SELECT * FROM dataset_inquiries ORDER BY created_at DESC LIMIT 200`
        ).all<Record<string, unknown>>();
        return json({ count: rows.results.length, inquiries: rows.results }, 200, request);
      }

      // POST /api/admin/seed-studio-stem — Admin-Protected Lyria 3.5 Core Stem Generator (Preserves SynthID Watermark!)
      if (url.pathname === '/api/admin/seed-studio-stem' && request.method === 'POST') {
        if (!isAuthorizedAdmin(request, env)) {
          return json({ error: 'Unauthorized (provide X-Admin-Key header).' }, 401, request);
        }
        const body = (await request.json().catch(() => ({}))) as {
          genre?: string;
          energy?: string;
          fileSlug?: string;
          bpm?: number;
          rootMidi?: number;
          keyLabel?: string;
          prompt?: string;
        };

        const genre = String(body.genre ?? '') as ResolvedGenre;
        const energy = String(body.energy ?? 'focus') as EnergyTier;
        const fileSlug = String(body.fileSlug ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64);
        const prompt = String(body.prompt ?? '').trim();

        if (!(genre in GENRE_META)) {
          return json({ error: 'Invalid genre.' }, 400, request);
        }
        if (energy !== 'calm' && energy !== 'focus' && energy !== 'drive') {
          return json({ error: 'Invalid energy tier.' }, 400, request);
        }
        if (!fileSlug || prompt.length < 16) {
          return json({ error: 'Valid fileSlug and prompt are required.' }, 400, request);
        }

        const provider = resolveMusicProvider(env);
        if (!provider || !env.AUDIO_BUCKET) {
          return json({ error: 'Music provider or AUDIO_BUCKET unavailable.' }, 503, request);
        }

        const generated = await provider.generate({ prompt, durationSec: 150 });
        const bpm = Number.isFinite(Number(body.bpm)) ? Math.round(Number(body.bpm)) : 92;
        const rootMidi = Number.isFinite(Number(body.rootMidi)) ? Math.round(Number(body.rootMidi)) : 48;
        const keyLabel = String(body.keyLabel ?? 'C min').trim() || 'C min';
        const r2Key = `${genre}/${energy}/${fileSlug}.mp3`;

        // Write raw Lyria 3.5 bytes straight to R2 without transcoding so SynthID watermark remains 100% intact
        await env.AUDIO_BUCKET.put(r2Key, generated.audioBytes, {
          httpMetadata: {
            contentType: generated.contentType || 'audio/mpeg',
            cacheControl: 'public, max-age=31536000, immutable',
          },
          customMetadata: {
            genre,
            energy,
            bpm: String(bpm),
            rootMidi: String(rootMidi),
            keyLabel,
            lufs: '-13.5',
            provider: generated.provider,
            modelId: generated.modelId,
          },
        });

        coreCatalogCache = null;
        const encoded = r2Key
          .split('/')
          .map((s) => encodeURIComponent(s))
          .join('/');

        return json(
          {
            ok: true,
            key: r2Key,
            url: `/api/audio/stream/${encoded}`,
            sizeBytes: generated.audioBytes.byteLength,
            bpm,
            rootMidi,
            keyLabel,
          },
          200,
          request
        );
      }

      // POST /api/billing/checkout — Creates a Stripe Subscription Checkout Session ($9.99/mo or $59/yr)
      if (url.pathname === '/api/billing/checkout' && request.method === 'POST') {
        const stripeKey = env.STRIPE_SECRET_KEY?.trim();
        if (!stripeKey) {
          return json(
            { error: 'Stripe billing is not activated yet on this deployment.' },
            503,
            request
          );
        }
        const allowed = await checkDailyRateLimit(env.DB, request, 'billing_checkout', 20);
        if (!allowed) return json({ error: 'Rate limit reached. Please try again shortly.' }, 429, request);

        const body = (await request.json().catch(() => ({}))) as {
          plan?: BillingPlanCycle;
          profileId?: string;
          email?: string;
        };
        const plan: BillingPlanCycle = body.plan === 'monthly' ? 'monthly' : 'annual';

        let targetProfileId = body.profileId?.trim() || '';
        let hadPriorSub = false;
        let createdAuth:
          | { profile: UserProfile; profileToken: string; syncCode: string }
          | undefined;

        if (targetProfileId) {
          const check = await verifyProfileAccess(env.DB, targetProfileId, request);
          if (!check.ok || !check.row) {
            targetProfileId = '';
          } else {
            hadPriorSub = Boolean(check.row.stripe_subscription_id);
          }
        }

        if (!targetProfileId) {
          // Automatically mint an anonymous profile + Sync Key so subscription attaches cleanly with zero passwords
          const now = new Date().toISOString();
          targetProfileId = `anon_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
          const profileToken = generateProfileToken();
          const tokenHash = await sha256Hex(profileToken);
          const syncCode = generateSyncCode();
          const syncCodeHash = await sha256Hex(syncCode);
          const newProfile: UserProfile = {
            id: targetProfileId,
            age: 30,
            ageBand: '25-34',
            gender: 'prefer_not_to_say',
            role: 'other',
            texturePref: 'warm_organic',
            noiseSensitivity: 'medium',
            defaultDevice: 'headphones',
            primaryChallenge: 'distraction',
            researchConsent: true,
            preferredModMult: 1.0,
            planTier: 'free',
            proUntil: null,
            createdAt: now,
            updatedAt: now,
          };

          await env.DB.prepare(
            `INSERT INTO profiles (id, display_name, age, age_band, gender, role, occupation_label, texture_pref, noise_sensitivity, default_device, primary_challenge, research_consent, token_hash, sync_code_hash, created_at, updated_at)
             VALUES (?, '', 30, '25-34', 'prefer_not_to_say', 'other', '', 'warm_organic', 'medium', 'headphones', 'distraction', 1, ?, ?, ?, ?)`
          )
            .bind(targetProfileId, tokenHash, syncCodeHash, now, now)
            .run();

          createdAuth = { profile: newProfile, profileToken, syncCode };
        }

        const originHeader = request.headers.get('origin') || url.origin;
        const safeOrigin = ALLOWED_ORIGINS.has(originHeader)
          ? originHeader
          : url.origin;

        const session = await createStripeCheckoutSession({
          secretKey: stripeKey,
          plan,
          profileId: targetProfileId,
          successUrl: `${safeOrigin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${safeOrigin}/?billing=canceled`,
          email: body.email,
          priceMonthly: env.STRIPE_PRICE_MONTHLY,
          priceAnnual: env.STRIPE_PRICE_ANNUAL,
          eligibleForTrial: !hadPriorSub,
        });

        return json(
          {
            url: session.url,
            checkoutSessionId: session.id,
            ...(createdAuth ?? {}),
          },
          200,
          request,
          createdAuth?.profileToken
            ? { 'set-cookie': buildAuthSetCookieHeader(request, createdAuth.profileToken) }
            : undefined
        );
      }

      // POST /api/billing/verify — Verifies a completed Stripe Checkout Session on redirect return & activates Pro immediately
      if (url.pathname === '/api/billing/verify' && request.method === 'POST') {
        const stripeKey = env.STRIPE_SECRET_KEY?.trim();
        if (!stripeKey) {
          return json({ error: 'Stripe billing not configured.' }, 503, request);
        }
        const body = (await request.json().catch(() => ({}))) as { checkoutSessionId?: string };
        const checkoutSessionId = String(body.checkoutSessionId ?? '').trim();
        if (!checkoutSessionId || !checkoutSessionId.startsWith('cs_')) {
          return json({ error: 'Invalid checkout session ID.' }, 400, request);
        }

        const verified = await retrieveStripeCheckoutSession(stripeKey, checkoutSessionId);
        if (!verified.paid || !verified.profileId) {
          return json(
            { ok: true, paid: false, planTier: 'free', proUntil: null, profile: null },
            200,
            request
          );
        }

        const now = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE profiles
           SET plan_tier = 'pro',
               pro_until = ?,
               stripe_customer_id = COALESCE(?, stripe_customer_id),
               stripe_subscription_id = COALESCE(?, stripe_subscription_id),
               billing_email = COALESCE(?, billing_email),
               updated_at = ?
           WHERE id = ?`
        )
          .bind(
            verified.proUntilIso,
            verified.customerId,
            verified.subscriptionId,
            verified.customerEmail,
            now,
            verified.profileId
          )
          .run();

        const updatedRow = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?')
          .bind(verified.profileId)
          .first<Record<string, unknown>>();

        return json(
          {
            ok: true,
            paid: true,
            planTier: 'pro',
            proUntil: verified.proUntilIso,
            profile: updatedRow ? mapProfileRow(updatedRow) : null,
          },
          200,
          request
        );
      }

      // POST /api/billing/portal — Opens Stripe Customer Billing Portal for active Pro subscribers
      if (url.pathname === '/api/billing/portal' && request.method === 'POST') {
        const stripeKey = env.STRIPE_SECRET_KEY?.trim();
        if (!stripeKey) {
          return json({ error: 'Stripe billing not configured.' }, 503, request);
        }
        const body = (await request.json().catch(() => ({}))) as { profileId?: string };
        const profileId = String(body.profileId ?? '').trim();
        if (!profileId) return json({ error: 'Missing profileId' }, 400, request);

        const access = await verifyProfileAccess(env.DB, profileId, request);
        if (!access.ok || !access.row) {
          return json({ error: 'Unauthorized profile access.' }, 403, request);
        }
        const customerId = access.row.stripe_customer_id ? String(access.row.stripe_customer_id) : '';
        if (!customerId) {
          return json({ error: 'No active Stripe billing account linked to this profile.' }, 404, request);
        }

        const originHeader = request.headers.get('origin') || url.origin;
        const safeOrigin = ALLOWED_ORIGINS.has(originHeader) ? originHeader : url.origin;
        const portalUrl = await createStripePortalSession(stripeKey, customerId, safeOrigin);
        return json({ url: portalUrl }, 200, request);
      }

      // POST /api/billing/webhook — Official Stripe Webhook receiver (HMAC-SHA256 verified & idempotent)
      if (url.pathname === '/api/billing/webhook' && request.method === 'POST') {
        const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!webhookSecret) {
          return json({ error: 'Stripe webhook secret not configured.' }, 503, request);
        }
        const rawBody = await request.text();
        const sigHeader = request.headers.get('stripe-signature');
        const valid = await verifyStripeWebhookSignature(rawBody, sigHeader, webhookSecret);
        if (!valid) {
          return json({ error: 'Invalid Stripe webhook signature.' }, 400, request);
        }

        const evt = JSON.parse(rawBody) as {
          id?: string;
          type?: string;
          data?: {
            object?: Record<string, unknown>;
          };
        };
        const eventId = String(evt.id ?? '');
        const eventType = String(evt.type ?? '');
        const obj = evt.data?.object ?? {};

        const now = new Date().toISOString();
        if (eventId) {
          // Atomic single-statement webhook idempotency claim BEFORE mutating profile entitlements (P2 #11)
          const claimed = await env.DB.prepare(
            `INSERT INTO processed_webhooks (event_id, event_type, received_at)
             VALUES (?, ?, ?)
             ON CONFLICT(event_id) DO NOTHING
             RETURNING event_id`
          )
            .bind(eventId, eventType || 'unknown', now)
            .first<{ event_id: string }>();
          if (!claimed) {
            return json({ received: true, duplicate: true }, 200, request);
          }

          // Probabilistic GC of >90-day old processed webhook keys
          if (Math.random() < 0.02) {
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            ctx.waitUntil(
              env.DB.prepare('DELETE FROM processed_webhooks WHERE received_at < ?')
                .bind(ninetyDaysAgo)
                .run()
                .catch(() => {})
            );
          }
        }

        try {
          const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
          let profileId = meta.profile_id || (obj.client_reference_id ? String(obj.client_reference_id) : '');
          const customerId = obj.customer ? String(obj.customer) : null;
          const subId =
            eventType.startsWith('customer.subscription.')
              ? (obj.id ? String(obj.id) : null)
              : (obj.subscription ? String(obj.subscription) : null);

          if (!profileId && (customerId || subId)) {
            const found = await env.DB.prepare(
              `SELECT id FROM profiles WHERE stripe_customer_id = ? OR stripe_subscription_id = ? LIMIT 1`
            )
              .bind(customerId ?? '__none__', subId ?? '__none__')
              .first<{ id?: string }>();
            if (found?.id) profileId = found.id;
          }

          if (profileId) {
            if (eventType === 'checkout.session.completed') {
              const email =
                (obj.customer_details as { email?: string } | undefined)?.email ||
                (obj.customer_email ? String(obj.customer_email) : null);
              const isZeroUpfrontTrial = Number(obj.amount_total ?? 1) === 0;
              const fallbackDays = isZeroUpfrontTrial
                ? 8
                : meta.plan === 'annual'
                  ? 370
                  : 35;
              const fallbackUntil = new Date(
                Date.now() + fallbackDays * 24 * 60 * 60 * 1000
              ).toISOString();
              await env.DB.prepare(
                `UPDATE profiles
                 SET plan_tier = 'pro',
                     pro_until = COALESCE(pro_until, ?),
                     stripe_customer_id = COALESCE(?, stripe_customer_id),
                     stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                     billing_email = COALESCE(?, billing_email),
                     updated_at = ?
                 WHERE id = ?`
              )
                .bind(fallbackUntil, customerId, subId, email, now, profileId)
                .run();
            } else if (
              eventType === 'customer.subscription.created' ||
              eventType === 'customer.subscription.updated'
            ) {
              const status = String(obj.status ?? '');
              const active = status === 'active' || status === 'trialing';
              const subItems = (
                obj.items as { data?: Array<{ current_period_end?: number }> } | undefined
              )?.data;
              const periodEnd = Number(
                obj.current_period_end ?? subItems?.[0]?.current_period_end ?? 0
              );
              const proUntil =
                periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null;
              await env.DB.prepare(
                `UPDATE profiles
                 SET plan_tier = ?,
                     pro_until = COALESCE(?, pro_until),
                     stripe_customer_id = COALESCE(?, stripe_customer_id),
                     stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                     updated_at = ?
                 WHERE id = ?`
              )
                .bind(active ? 'pro' : 'free', proUntil, customerId, subId, now, profileId)
                .run();
            } else if (eventType === 'customer.subscription.deleted') {
              await env.DB.prepare(
                `UPDATE profiles SET plan_tier = 'free', updated_at = ? WHERE id = ?`
              )
                .bind(now, profileId)
                .run();
            } else if (eventType === 'invoice.paid') {
              const lines = (obj.lines as { data?: Array<{ period?: { end?: number } }> } | undefined)?.data;
              const periodEnd = Number(lines?.[0]?.period?.end ?? 0);
              const proUntil =
                periodEnd > 0
                  ? new Date(periodEnd * 1000).toISOString()
                  : new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString();
              await env.DB.prepare(
                `UPDATE profiles
                 SET plan_tier = 'pro', pro_until = ?, updated_at = ?
                 WHERE id = ?`
              )
                .bind(proUntil, now, profileId)
                .run();
            }
          }

          if (eventId) {
            const amountCents = Number(obj.amount_paid ?? obj.amount_total ?? 0);
            const currency = String(obj.currency ?? 'usd');
            await env.DB.prepare(
              `INSERT OR IGNORE INTO billing_events (id, event_type, profile_id, stripe_customer_id, stripe_subscription_id, amount_cents, currency, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'processed', ?)`
            )
              .bind(eventId, eventType, profileId || null, customerId, subId, amountCents, currency, now)
              .run()
              .catch(() => {});
          }
        } catch (webhookErr) {
          if (eventId) {
            await env.DB.prepare('DELETE FROM processed_webhooks WHERE event_id = ?')
              .bind(eventId)
              .run()
              .catch(() => {});
          }
          throw webhookErr;
        }

        return json({ received: true }, 200, request);
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
            p.gender,
            p.role,
            p.occupation_label,
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
            s.max_milestone_pct,
            s.arm_id,
            s.study_spec_id,
            s.is_exploration,
            s.is_control_trial,
            s.energy_tier,
            s.music_genre,
            s.initial_music_genre,
            s.custom_genre_slug,
            s.audio_source,
            s.genre_swapped_at_sec,
            s.implicit_reward_score,
            s.retention_outcome,
            s.return_bonus_credited,
            s.pvt_pre_ms,
            s.pvt_post_ms,
            s.pvt_delta_ms,
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
            'session_id', 'age_band', 'gender', 'role', 'occupation_label', 'cohort_key', 'time_of_day_bucket',
            'current_state', 'baseline_score', 'target_state', 'environment', 'device',
            'safety_mode', 'planned_duration_min', 'actual_duration_sec', 'completion_ratio', 'max_milestone_pct',
            'arm_id', 'study_spec_id', 'is_exploration', 'is_control_trial', 'energy_tier',
            'music_genre', 'initial_music_genre', 'custom_genre_slug', 'audio_source',
            'genre_swapped_at_sec', 'implicit_reward_score', 'retention_outcome', 'return_bonus_credited',
            'pvt_pre_ms', 'pvt_post_ms', 'pvt_delta_ms',
            'modulation_hz', 'modulation_depth', 'crossover_hz', 'upper_crossover_hz',
            'stereo_am_spread', 'preferred_mod_mult', 'bpm', 'noise_color', 'noise_level',
            'status', 'post_score', 'delta_score', 'worked_rating', 'reward_score', 'created_at',
          ];
          const csvLines = [headers.join(',')];
          for (const r of rows.results) {
            const ap = JSON.parse(String(r.acoustic_params_json)) as AcousticParams;
            const vals = [
              r.session_id, r.age_band, r.gender ?? 'prefer_not_to_say', r.role, r.occupation_label ?? '', r.cohort_key, r.time_of_day_bucket,
              r.current_state, r.baseline_score, r.target_state, r.environment, r.device,
              r.safety_mode, r.planned_duration_min, r.actual_duration_sec, r.completion_ratio, r.max_milestone_pct ?? 0,
              r.arm_id, r.study_spec_id ?? '', r.is_exploration, r.is_control_trial ?? 0, r.energy_tier ?? ap.energyTier ?? 'focus',
              r.music_genre ?? ap.genre ?? 'auto', r.initial_music_genre ?? '', r.custom_genre_slug ?? '', r.audio_source ?? '',
              r.genre_swapped_at_sec ?? '', r.implicit_reward_score ?? '', r.retention_outcome ?? '', r.return_bonus_credited ?? 0,
              r.pvt_pre_ms ?? '', r.pvt_post_ms ?? '', r.pvt_delta_ms ?? '',
              ap.modulationHz, ap.modulationDepth, ap.crossoverHz ?? 190, ap.upperCrossoverHz ?? 4500,
              ap.stereoAmSpread ? 1 : 0, r.preferred_mod_mult ?? 1.0, ap.bpm, ap.noiseColor, ap.noiseLevel,
              r.status, r.post_score ?? '', r.delta_score ?? '', r.worked_rating ?? '', r.reward_score ?? '', r.created_at,
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
              version: '2.0',
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

      return json({ error: 'API route not found' }, 404, request);
    } catch (err) {
      console.error('Worker API error:', err);
      return json(
        { error: err instanceof Error ? err.message : 'Internal server error' },
        500,
        request
      );
    }
  },
};
