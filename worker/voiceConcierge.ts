import {
  buildVoiceConciergePlan,
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

async function getOrCreateSegmentUrl(
  env: Env,
  kind: 'greet' | 'body',
  slug: string,
  text: string,
  allowSynth: () => Promise<boolean>
): Promise<{ url: string; fromCache: boolean; provider: string } | null> {
  if (!env.AUDIO_BUCKET) return null;
  const digest = await sha256Short(`v1|luna|${text}`);
  const basePrefix = `voice/v1/${kind}_${slug.slice(0, 36)}_${digest}`;

  const existingKey = await findCachedVoiceKey(env, basePrefix);
  if (existingKey) {
    const encoded = existingKey.split('/').map((s) => encodeURIComponent(s)).join('/');
    return { url: `/api/audio/stream/${encoded}`, fromCache: true, provider: 'r2_cache' };
  }

  const permitted = await allowSynth();
  if (!permitted) return null;

  // Primary $0 Cloudflare Workers AI (Deepgram Aura `luna`), fallback Gemini Flash-Lite TTS (`Achernar`)
  const synth = (await synthesizeViaWorkersAi(env, text)) ?? (await synthesizeViaGeminiTts(env, text));
  if (!synth) return null;

  const finalKey = `${basePrefix}.${synth.ext}`;
  await env.AUDIO_BUCKET.put(finalKey, synth.bytes, {
    httpMetadata: {
      contentType: synth.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      voiceProvider: synth.provider,
    },
  });

  const encoded = finalKey.split('/').map((s) => encodeURIComponent(s)).join('/');
  return { url: `/api/audio/stream/${encoded}`, fromCache: false, provider: synth.provider };
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

  return {
    cueType,
    firstName: typeof raw.firstName === 'string' ? raw.firstName.slice(0, 36) : null,
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

  if (!env.AUDIO_BUCKET || (!env.AI && !env.GEMINI_API_KEY && !env.GEMINI_MUSIC_API_KEY)) {
    return {
      available: false,
      cueType: plan.cueType,
      breathPauseMs: plan.breathPauseMs,
      transcript: plan.fullTranscript,
    };
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

  const [greetSeg, bodySeg] = await Promise.all([
    getOrCreateSegmentUrl(env, 'greet', plan.greetingCacheSlug, plan.greetingText, allowOnce),
    getOrCreateSegmentUrl(env, 'body', plan.bodyCacheSlug, plan.bodyText, allowOnce),
  ]);

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
  };
}
