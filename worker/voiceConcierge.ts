import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  buildVoiceConciergePlan,
  type ConciergeVoiceOption,
  type VoiceConciergePlan,
  type VoiceConciergeRequest,
  type VoiceCueType,
} from '../shared/voiceConcierge';
import type {
  CurrentState,
  OutputDevice,
  ResolvedGenre,
  TargetState,
  TimeOfDayBucket,
} from '../shared/types';
import { GENRE_META } from '../shared/types';
import type { Env } from './env';

export interface VoiceConciergeResponse {
  available: boolean;
  cueType: VoiceCueType;
  greetingUrl?: string;
  bodyUrl?: string;
  breathPauseMs: number;
  transcript: string;
  fromCache?: boolean;
  provider?: string;
  voiceId?: string;
}

export interface ConciergeVoiceCatalogResponse {
  available: boolean;
  provider: string;
  defaultVoiceId: string;
  voices: ConciergeVoiceOption[];
}

const VALID_CUES = new Set<VoiceCueType>(['intro_full', 'intro_short', 'outro_landing']);
const VALID_STATES = new Set<CurrentState>([
  'distracted',
  'fatigued',
  'stressed',
  'anxious',
  'calm_neutral',
  'restless',
]);
const VALID_TARGETS = new Set<TargetState>([
  'alert_focus',
  'deep_flow',
  'calm_reset',
  'energy_lift',
  'sleep_winddown',
]);
const VALID_TIME_BUCKETS = new Set<TimeOfDayBucket>([
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
]);
const VALID_GENRES = new Set<string>(Object.keys(GENRE_META));

const VOICE_CATALOG_TTL_MS = 10 * 60 * 1000;
const ELEVENLABS_QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
export const ELEVENLABS_CONCIERGE_SPEED = 0.96;
let elevenLabsQuotaCooldownUntil = 0;
let cachedCatalog: {
  keyHash: string;
  expiresAt: number;
  data: ConciergeVoiceCatalogResponse;
} | null = null;

export function clearVoiceCatalogCacheForTests(): void {
  cachedCatalog = null;
  elevenLabsQuotaCooldownUntil = 0;
}

async function sha256Short(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function decodeBase64Bytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function detectAudioFormat(bytes: Uint8Array): { ext: 'mp3' | 'wav' | 'ogg'; contentType: string } {
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return { ext: 'wav', contentType: 'audio/wav' };
  }
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return { ext: 'ogg', contentType: 'audio/ogg' };
  }
  return { ext: 'mp3', contentType: 'audio/mpeg' };
}

export function formatCleanVoiceShortLabel(rawName: string, descriptive?: string): string {
  const collapsed = rawName.replace(/\s+/g, ' ').trim();
  const baseRaw = collapsed.split(/\s+[-–—]\s+/)[0]?.trim() || collapsed;
  const cleanedBase = baseRaw.replace(/\bGentle Meditation\b/i, 'Meditation').trim();
  const shortBase =
    cleanedBase.length > 22 ? `${cleanedBase.slice(0, 21).trim()}…` : cleanedBase;

  const tagRaw = (descriptive || '').trim();
  if (tagRaw) {
    const cleanTag = tagRaw.charAt(0).toUpperCase() + tagRaw.slice(1).toLowerCase();
    if (!shortBase.toLowerCase().includes(cleanTag.toLowerCase())) {
      return `${shortBase} · ${cleanTag}`;
    }
  }
  return shortBase;
}

interface RawElevenLabsVoice {
  voice_id?: string;
  name?: string;
  category?: string;
  labels?: Record<string, string | undefined>;
}

const FALLBACK_CATALOG: ConciergeVoiceCatalogResponse = {
  available: true,
  provider: 'workers_ai',
  defaultVoiceId: 'aura_luna',
  voices: [
    {
      voiceId: 'aura_luna',
      name: 'Luna (Studio)',
      shortLabel: 'Luna · Calm',
      category: 'fallback',
      gender: 'female',
      accent: 'american',
      descriptive: 'calm',
    },
  ],
};

export async function listAvailableConciergeVoices(
  env: Env
): Promise<ConciergeVoiceCatalogResponse> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return FALLBACK_CATALOG;
  }

  const keyHash = await sha256Short(apiKey);
  const cacheKey = `${keyHash}|alanya_only_v4`;
  const now = Date.now();
  if (cachedCatalog && cachedCatalog.keyHash === cacheKey && cachedCatalog.expiresAt > now) {
    return cachedCatalog.data;
  }

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      return FALLBACK_CATALOG;
    }

    const payload = (await res.json()) as { voices?: RawElevenLabsVoice[] };
    const rawVoices = Array.isArray(payload.voices) ? payload.voices : [];

    const matched = rawVoices.find((v) => {
      const id = typeof v.voice_id === 'string' ? v.voice_id.trim() : '';
      const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim() : '';
      return id === DEFAULT_ELEVENLABS_VOICE_ID || /\balanya\b/i.test(name);
    });

    if (!matched && rawVoices.length === 0) {
      return FALLBACK_CATALOG;
    }

    const resolvedId =
      (typeof matched?.voice_id === 'string' && matched.voice_id.trim()) ||
      DEFAULT_ELEVENLABS_VOICE_ID;
    const resolvedName =
      (typeof matched?.name === 'string' && matched.name.replace(/\s+/g, ' ').trim()) ||
      'Alanya - Smooth';
    const isPremade = (matched?.category ?? '').toLowerCase() === 'premade';
    const alanyaOption: ConciergeVoiceOption = {
      voiceId: resolvedId,
      name: resolvedName,
      shortLabel: 'Alanya · Smooth',
      category: isPremade ? 'premade' : 'custom',
      gender: matched?.labels?.gender || 'female',
      accent: matched?.labels?.accent || 'american',
      descriptive: matched?.labels?.descriptive || 'smooth',
    };

    const catalog: ConciergeVoiceCatalogResponse = {
      available: true,
      provider: 'elevenlabs',
      defaultVoiceId: alanyaOption.voiceId,
      voices: [alanyaOption],
    };

    cachedCatalog = {
      keyHash: cacheKey,
      expiresAt: now + VOICE_CATALOG_TTL_MS,
      data: catalog,
    };
    return catalog;
  } catch {
    return FALLBACK_CATALOG;
  }
}

async function resolveDefaultElevenLabsVoiceId(env: Env): Promise<string> {
  const catalog = await listAvailableConciergeVoices(env);
  if (catalog.provider === 'elevenlabs' && catalog.defaultVoiceId) {
    return catalog.defaultVoiceId;
  }
  return DEFAULT_ELEVENLABS_VOICE_ID;
}

async function synthesizeViaElevenLabs(
  env: Env,
  text: string,
  voiceId: string
): Promise<{
  bytes: Uint8Array;
  ext: 'mp3' | 'wav' | 'ogg';
  contentType: string;
  provider: string;
  voiceId: string;
} | null> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey || !voiceId || Date.now() < elevenLabsQuotaCooldownUntil) return null;

  const primaryModel = env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2';
  const models = Array.from(new Set([primaryModel, 'eleven_flash_v2_5']));

  for (const modelId of models) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: {
              stability: 0.68,
              similarity_boost: 0.82,
              style: 0.06,
              speed: ELEVENLABS_CONCIERGE_SPEED,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!res.ok) {
        if (res.status === 401 || res.status === 402 || res.status === 429) {
          elevenLabsQuotaCooldownUntil = Date.now() + ELEVENLABS_QUOTA_COOLDOWN_MS;
          return null;
        }
        if (res.status === 400 || res.status === 403 || res.status === 422) {
          const errText = await res.text().catch(() => '');
          if (/quota|credit|insufficient|limit/i.test(errText)) {
            elevenLabsQuotaCooldownUntil = Date.now() + ELEVENLABS_QUOTA_COOLDOWN_MS;
            return null;
          }
          continue;
        }
        return null;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 512) {
        const fmt = detectAudioFormat(bytes);
        return { bytes, ...fmt, provider: 'elevenlabs', voiceId };
      }
    } catch {
      // try next model or fall through
    }
  }
  return null;
}

async function extractWorkersAiAudioBytes(aiOut: unknown): Promise<Uint8Array | null> {
  if (!aiOut) return null;
  if (aiOut instanceof Uint8Array) {
    return aiOut.byteLength > 512 ? aiOut : null;
  }
  if (aiOut instanceof ArrayBuffer) {
    return aiOut.byteLength > 512 ? new Uint8Array(aiOut) : null;
  }
  if (ArrayBuffer.isView(aiOut)) {
    return aiOut.byteLength > 512
      ? new Uint8Array(aiOut.buffer, aiOut.byteOffset, aiOut.byteLength)
      : null;
  }
  if (typeof ReadableStream !== 'undefined' && aiOut instanceof ReadableStream) {
    const ab = await new Response(aiOut).arrayBuffer();
    return ab.byteLength > 512 ? new Uint8Array(ab) : null;
  }
  if (typeof Response !== 'undefined' && aiOut instanceof Response) {
    const ab = await aiOut.arrayBuffer();
    return ab.byteLength > 512 ? new Uint8Array(ab) : null;
  }
  if (typeof aiOut === 'object') {
    const rec = aiOut as Record<string, unknown>;
    if (typeof rec.audio === 'string' && rec.audio.length > 256) {
      const bytes = decodeBase64Bytes(rec.audio);
      return bytes.byteLength > 512 ? bytes : null;
    }
  }
  return null;
}

async function synthesizeViaWorkersAi(env: Env, text: string): Promise<{
  bytes: Uint8Array;
  ext: 'mp3' | 'wav' | 'ogg';
  contentType: string;
  provider: string;
} | null> {
  if (!env.AI) return null;

  // Try Aura-2 English (`luna` — ultra-soft calm studio female voice), then Aura-1 (`luna`)
  const candidates: Array<{ model: string; input: Record<string, unknown> }> = [
    { model: '@cf/deepgram/aura-2-en', input: { text, speaker: 'luna', encoding: 'mp3' } },
    { model: '@cf/deepgram/aura-1', input: { text, speaker: 'luna' } },
  ];

  for (const cand of candidates) {
    try {
      const raw = await env.AI.run(cand.model, cand.input);
      const bytes = await extractWorkersAiAudioBytes(raw);
      if (bytes && bytes.byteLength > 512) {
        const fmt = detectAudioFormat(bytes);
        return { bytes, ...fmt, provider: cand.model };
      }
    } catch {
      // try next Aura model
    }
  }
  return null;
}

async function synthesizeViaGeminiTts(env: Env, text: string): Promise<{
  bytes: Uint8Array;
  ext: 'mp3' | 'wav' | 'ogg';
  contentType: string;
  provider: string;
} | null> {
  const apiKey = (env.GEMINI_API_KEY || env.GEMINI_MUSIC_API_KEY || '').trim();
  if (!apiKey) return null;

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash-lite-tts',
        store: false,
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text,
                annotations: [
                  {
                    type: 'speech_metadata',
                    style:
                      'soft, calm, warm, soothing intimate human studio voice, gentle relaxed breathy tone, unhurried pace',
                  },
                ],
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: 'Achernar' }],
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      steps?: Array<{
        type?: string;
        content?: Array<{ type?: string; data?: string }>;
      }>;
    };
    let b64Audio: string | null = null;
    for (const step of data.steps ?? []) {
      for (const part of step.content ?? []) {
        if (part.type === 'audio' && typeof part.data === 'string' && part.data.length > 256) {
          b64Audio = part.data;
        }
      }
    }
    if (!b64Audio) return null;
    const bytes = decodeBase64Bytes(b64Audio);
    if (bytes.byteLength <= 512) return null;
    const fmt = detectAudioFormat(bytes);
    return { bytes, ...fmt, provider: 'gemini-3.8-flash-lite-tts' };
  } catch {
    return null;
  }
}

async function findCachedVoiceKey(env: Env, basePrefix: string): Promise<string | null> {
  if (!env.AUDIO_BUCKET) return null;
  const [mp3Head, wavHead] = await Promise.all([
    env.AUDIO_BUCKET.head(`${basePrefix}.mp3`),
    env.AUDIO_BUCKET.head(`${basePrefix}.wav`),
  ]);
  if (mp3Head && mp3Head.size > 512) return `${basePrefix}.mp3`;
  if (wavHead && wavHead.size > 512) return `${basePrefix}.wav`;
  return null;
}

async function putImmutableVoiceSegment(
  env: Env,
  finalKey: string,
  synth: { bytes: Uint8Array; contentType: string; provider: string; voiceId?: string }
): Promise<{ url: string; fromCache: boolean; provider: string; voiceId?: string } | null> {
  if (!env.AUDIO_BUCKET) return null;
  await env.AUDIO_BUCKET.put(finalKey, synth.bytes, {
    httpMetadata: {
      contentType: synth.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      voiceProvider: synth.provider,
      ...(synth.voiceId ? { voiceId: synth.voiceId } : {}),
    },
  });
  const encoded = finalKey.split('/').map((s) => encodeURIComponent(s)).join('/');
  return {
    url: `/api/audio/stream/${encoded}`,
    fromCache: false,
    provider: synth.provider,
    voiceId: synth.voiceId,
  };
}

async function getOrCreateSegmentUrl(
  env: Env,
  kind: 'greet' | 'body',
  slug: string,
  text: string,
  elevenLabsVoiceId: string | null,
  allowSynth: () => Promise<boolean>
): Promise<{ url: string; fromCache: boolean; provider: string; voiceId?: string } | null> {
  if (!env.AUDIO_BUCKET) return null;

  // 1. Primary path: ElevenLabs Alanya-only immutable R2 cache (`voice/v4/...` @ natural 0.96x cadence)
  if (elevenLabsVoiceId && env.ELEVENLABS_API_KEY?.trim()) {
    const elDigest = await sha256Short(`v4|11labs:${elevenLabsVoiceId}:s096|${text}`);
    const elPrefix = `voice/v4/${kind}_${slug.slice(0, 36)}_${elDigest}`;
    const elCached = await findCachedVoiceKey(env, elPrefix);
    if (elCached) {
      const encoded = elCached.split('/').map((s) => encodeURIComponent(s)).join('/');
      return {
        url: `/api/audio/stream/${encoded}`,
        fromCache: true,
        provider: 'r2_cache',
        voiceId: elevenLabsVoiceId,
      };
    }

    const permitted = await allowSynth();
    if (!permitted) return null;

    const elSynth = await synthesizeViaElevenLabs(env, text, elevenLabsVoiceId);
    if (elSynth) {
      return putImmutableVoiceSegment(env, `${elPrefix}.${elSynth.ext}`, elSynth);
    }
    // If ElevenLabs fails (e.g. 429 quota exhausted), fall through transparently to Workers AI / Gemini!
  }

  // 2. Fallback / Free-Tier path: Cloudflare Workers AI (`luna`) -> Gemini 3.8 Flash-Lite TTS (`Achernar`)
  const digest = await sha256Short(`v1|luna|${text}`);
  const basePrefix = `voice/v1/${kind}_${slug.slice(0, 36)}_${digest}`;

  const existingKey = await findCachedVoiceKey(env, basePrefix);
  if (existingKey) {
    const encoded = existingKey.split('/').map((s) => encodeURIComponent(s)).join('/');
    return {
      url: `/api/audio/stream/${encoded}`,
      fromCache: true,
      provider: 'r2_cache',
      voiceId: 'aura_luna',
    };
  }

  const permitted = await allowSynth();
  if (!permitted) return null;

  const synth = (await synthesizeViaWorkersAi(env, text)) ?? (await synthesizeViaGeminiTts(env, text));
  if (!synth) return null;

  return putImmutableVoiceSegment(env, `${basePrefix}.${synth.ext}`, {
    ...synth,
    voiceId: 'aura_luna',
  });
}

export function sanitizeVoiceRequestPayload(raw: Record<string, unknown>): VoiceConciergeRequest {
  const cueRaw = String(raw.cueType ?? 'intro_full') as VoiceCueType;
  const cueType: VoiceCueType = VALID_CUES.has(cueRaw) ? cueRaw : 'intro_full';

  const stateRaw = String(raw.currentState ?? 'calm_neutral') as CurrentState;
  const currentState: CurrentState = VALID_STATES.has(stateRaw) ? stateRaw : 'calm_neutral';

  const targetRaw = String(raw.targetState ?? 'alert_focus') as TargetState;
  const targetState: TargetState = VALID_TARGETS.has(targetRaw) ? targetRaw : 'alert_focus';

  const genreRaw = String(raw.genre ?? 'deep_electronic');
  const genre: ResolvedGenre = VALID_GENRES.has(genreRaw)
    ? (genreRaw as ResolvedGenre)
    : 'deep_electronic';

  const tbRaw = String(raw.timeBucket ?? 'afternoon') as TimeOfDayBucket;
  const timeBucket: TimeOfDayBucket = VALID_TIME_BUCKETS.has(tbRaw) ? tbRaw : 'afternoon';

  const armId = String(raw.armId ?? 'beta-drive-16hz')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 48);
  const modulationHz = Math.max(1, Math.min(45, Number(raw.modulationHz) || 16));
  const durationMin = Math.max(5, Math.min(120, Number(raw.durationMin) || 25));

  const devRaw = String(raw.device ?? 'headphones');
  const device: OutputDevice =
    devRaw === 'speakers' || devRaw === 'car_audio' ? devRaw : 'headphones';

  const rawVoiceId = typeof raw.voiceId === 'string' ? raw.voiceId.trim() : '';
  const voiceId = /^[A-Za-z0-9_-]{2,48}$/.test(rawVoiceId) ? rawVoiceId : null;

  return {
    cueType,
    firstName: typeof raw.firstName === 'string' ? raw.firstName.slice(0, 36) : null,
    voiceId,
    currentState,
    targetState,
    armId,
    modulationHz,
    genre,
    isDriving: Boolean(raw.isDriving),
    device,
    timeBucket,
    durationMin,
  };
}

export async function resolveVoiceConciergeAudio(
  env: Env,
  rawBody: Record<string, unknown>,
  checkSynthQuota: () => Promise<boolean>
): Promise<VoiceConciergeResponse> {
  const cleanReq = sanitizeVoiceRequestPayload(rawBody);
  const plan: VoiceConciergePlan = buildVoiceConciergePlan(cleanReq);

  if (
    !env.AUDIO_BUCKET ||
    (!env.ELEVENLABS_API_KEY?.trim() &&
      !env.AI &&
      !env.GEMINI_API_KEY &&
      !env.GEMINI_MUSIC_API_KEY)
  ) {
    return {
      available: false,
      cueType: plan.cueType,
      breathPauseMs: plan.breathPauseMs,
      transcript: plan.fullTranscript,
    };
  }

  let elevenLabsVoiceId: string | null = null;
  if (env.ELEVENLABS_API_KEY?.trim() && cleanReq.voiceId !== 'aura_luna') {
    elevenLabsVoiceId = await resolveDefaultElevenLabsVoiceId(env);
  }

  let quotaChecked = false;
  let quotaAllowed = true;
  const allowOnce = async (): Promise<boolean> => {
    if (!quotaChecked) {
      quotaChecked = true;
      quotaAllowed = await checkSynthQuota();
    }
    return quotaAllowed;
  };

  let [greetSeg, bodySeg] = await Promise.all([
    getOrCreateSegmentUrl(
      env,
      'greet',
      plan.greetingCacheSlug,
      plan.greetingText,
      elevenLabsVoiceId,
      allowOnce
    ),
    getOrCreateSegmentUrl(
      env,
      'body',
      plan.bodyCacheSlug,
      plan.bodyText,
      elevenLabsVoiceId,
      allowOnce
    ),
  ]);

  // Voice-Pair Cohesion Guard: if one segment hit R2 on Alanya while the other fell back to Workers AI
  // (e.g. partial R2 hit during ElevenLabs quota exhaustion), unify both onto the same free voice!
  if (greetSeg && bodySeg && greetSeg.voiceId !== bodySeg.voiceId) {
    if (greetSeg.voiceId !== 'aura_luna') {
      greetSeg = await getOrCreateSegmentUrl(
        env,
        'greet',
        plan.greetingCacheSlug,
        plan.greetingText,
        null,
        allowOnce
      );
    }
    if (bodySeg && bodySeg.voiceId !== 'aura_luna') {
      bodySeg = await getOrCreateSegmentUrl(
        env,
        'body',
        plan.bodyCacheSlug,
        plan.bodyText,
        null,
        allowOnce
      );
    }
  }

  if (!greetSeg || !bodySeg) {
    return {
      available: false,
      cueType: plan.cueType,
      breathPauseMs: plan.breathPauseMs,
      transcript: plan.fullTranscript,
    };
  }

  return {
    available: true,
    cueType: plan.cueType,
    greetingUrl: greetSeg.url,
    bodyUrl: bodySeg.url,
    breathPauseMs: plan.breathPauseMs,
    transcript: plan.fullTranscript,
    fromCache: greetSeg.fromCache && bodySeg.fromCache,
    provider: greetSeg.fromCache ? bodySeg.provider : greetSeg.provider,
    voiceId: bodySeg.voiceId ?? greetSeg.voiceId,
  };
}
