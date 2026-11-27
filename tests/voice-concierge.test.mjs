/**
 * nootropic.fm — Personalized Studio Voice Concierge & $0 R2 Cache Audit Suite
 *
 * Verifies:
 *  1) `sanitizeSpokenFirstName` extracts clean human first names (including normalized diacritics)
 *     while rejecting placeholders (`anon`, `guest`, `user`), numbers, URLs, and prompt injections.
 *  2) `buildVoiceConciergePlan` generates warm, empathetic, science-accurate 2-segment scripts
 *     across all 11 genres (including `NootropicFM Mode` 6x40 Hz), anonymous listeners,
 *     concise returning sessions (`intro_short`), Driving Safety Mode, and Soft-Landing whispers (`outro_landing`).
 *  3) `resolveVoiceConciergeAudio` synthesizes via Cloudflare Workers AI (`@cf/deepgram/aura-2-en` `luna`)
 *     on first encounter, writes immutable segments to R2 (`voice/v1/...`), serves subsequent requests
 *     from R2 with 0 AI calls (`$0` marginal cost), shares scenario bodies across distinct user names,
 *     and falls back cleanly to `gemini-3.8-flash-lite-tts` (`Achernar`) when Workers AI is unavailable.
 *  4) `VOCAL_PEAK_CEILING` + sidechain ducking math preserves 100% Layer-1 headroom below `LIMITER_CEILING_LINEAR`.
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

const { sanitizeSpokenFirstName, buildVoiceConciergePlan, DEFAULT_ELEVENLABS_VOICE_ID } = await import(
  '../shared/voiceConcierge.ts'
);
const {
  resolveVoiceConciergeAudio,
  sanitizeVoiceRequestPayload,
  listAvailableConciergeVoices,
  clearVoiceCatalogCacheForTests,
  ELEVENLABS_CONCIERGE_SPEED,
} = await import('../worker/voiceConcierge.ts');
const {
  VOCAL_PEAK_CEILING,
  VOCAL_TARGET_RMS,
  VOICE_DRY_GAIN,
  VOICE_EARLY_GAIN,
  MUSIC_VOICE_DUCK_GAIN,
  MUSIC_FADE_IN_AFTER_VOICE_SEC,
  SESSION_INTRO_VOICE_DELAY_MS,
  VOCAL_LEAD_PAD_SEC,
  VOCAL_FADE_IN_SEC,
  trimAndNormalizeVocalBuffer,
} = await import('../src/audio/VoiceConciergePlayer.ts');
const { LIMITER_CEILING_LINEAR } = await import('../src/audio/dspMath.ts');

function createMockR2Bucket() {
  const store = new Map();
  return {
    store,
    async head(key) {
      const item = store.get(key);
      if (!item) return null;
      return { key, size: item.bytes.byteLength, httpMetadata: item.httpMetadata };
    },
    async put(key, value, opts = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, { bytes, httpMetadata: opts.httpMetadata ?? {}, customMetadata: opts.customMetadata ?? {} });
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return { body: item.bytes, size: item.bytes.byteLength, httpMetadata: item.httpMetadata };
    },
  };
}

function makeFakeMp3Bytes(length = 2048) {
  const buf = new Uint8Array(length);
  // ID3 header signature
  buf[0] = 0x49;
  buf[1] = 0x44;
  buf[2] = 0x33;
  for (let i = 3; i < length; i++) {
    buf[i] = (i * 31) & 0xff;
  }
  return buf;
}

test('sanitizeSpokenFirstName normalizes real names and blocks placeholders or injections', () => {
  assert.equal(sanitizeSpokenFirstName('vasi cicarac'), 'Vasi');
  assert.equal(sanitizeSpokenFirstName('  Ștefan Popescu '), 'Stefan');
  assert.equal(sanitizeSpokenFirstName('Mădălina-Ioana'), 'Madalina-ioana');
  assert.equal(sanitizeSpokenFirstName('ALEX'), 'Alex');

  // Placeholders & invalid tokens return null (graceful anonymous greeting)
  assert.equal(sanitizeSpokenFirstName(null), null);
  assert.equal(sanitizeSpokenFirstName(''), null);
  assert.equal(sanitizeSpokenFirstName('anon'), null);
  assert.equal(sanitizeSpokenFirstName('Anonymous User'), null);
  assert.equal(sanitizeSpokenFirstName('Guest_4921'), null);
  assert.equal(sanitizeSpokenFirstName('test'), null);
  assert.equal(sanitizeSpokenFirstName('123456'), null);
  assert.equal(sanitizeSpokenFirstName('bcdfghjkl'), null); // no vowels
  assert.equal(sanitizeSpokenFirstName('https://evil.example/payload'), null);
});

test('buildVoiceConciergePlan crafts empathetic named & anonymous scripts across modes', () => {
  const trancePlan = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'Vasi',
    currentState: 'distracted',
    targetState: 'deep_flow',
    armId: 'nootropic-trance-6x40hz',
    modulationHz: 6,
    genre: 'nootropic_trance',
    isDriving: false,
    timeBucket: 'morning',
  });
  assert.equal(trancePlan.greetingText, 'Good morning, Vasi.');
  assert.match(trancePlan.bodyText, /mental scatter/i);
  assert.match(trancePlan.bodyText, /six-by-forty hertz trance rhythm/i);
  assert.match(trancePlan.bodyText, /Nootropic F M pulse/);
  assert.match(trancePlan.bodyText, /let us take care of the rest/i);
  assert.equal(trancePlan.breathPauseMs, 500);

  // Anonymous listener never hears "null" or awkward trailing commas
  const anonCalm = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'anonymous',
    currentState: 'stressed',
    targetState: 'calm_reset',
    armId: 'alpha-10hz-calm',
    modulationHz: 10,
    genre: 'solo_piano',
    isDriving: false,
    timeBucket: 'evening',
  });
  assert.equal(anonCalm.greetingText, 'Good evening.');
  assert.ok(!anonCalm.fullTranscript.includes('null'));
  assert.match(anonCalm.bodyText, /10-hertz calm wave/);
  assert.match(anonCalm.bodyText, /soft felt piano/);

  // Returning session on same day uses concise intro_short
  const shortPlan = buildVoiceConciergePlan({
    cueType: 'intro_short',
    firstName: 'Vasi',
    currentState: 'fatigued',
    targetState: 'alert_focus',
    armId: 'beta-16hz',
    modulationHz: 16,
    genre: 'deep_electronic',
    isDriving: false,
  });
  assert.equal(shortPlan.greetingText, 'Welcome back, Vasi.');
  assert.equal(shortPlan.breathPauseMs, 380);
  assert.match(shortPlan.bodyText, /Deep Electronic groove focus flow/);

  // Driving Safety Mode overrides calming language with road-safe alertness cue
  const drivePlan = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'Vasi',
    currentState: 'fatigued',
    targetState: 'alert_focus',
    armId: 'beta-16hz',
    modulationHz: 16,
    genre: 'lofi_keys',
    isDriving: true,
  });
  assert.equal(drivePlan.greetingText, 'Eyes on the road, Vasi.');
  assert.match(drivePlan.bodyText, /Traffic frequencies stay wide open/);
  assert.match(drivePlan.bodyText, /Drive safe/);

  // Soft-landing outro cue
  const outroPlan = buildVoiceConciergePlan({
    cueType: 'outro_landing',
    firstName: 'Vasi',
    currentState: 'distracted',
    targetState: 'deep_flow',
    armId: 'gamma-40hz',
    modulationHz: 40,
    genre: 'ambient_space',
    isDriving: false,
    durationMin: 25,
  });
  assert.equal(outroPlan.greetingText, '25 minutes complete, Vasi.');
  assert.match(outroPlan.bodyText, /gently bring your focus back/);
});

test('resolveVoiceConciergeAudio caches immutable segments in R2 and shares scenario bodies across users', async () => {
  const bucket = createMockR2Bucket();
  let aiCalls = 0;
  let quotaChecks = 0;

  const env = {
    AUDIO_BUCKET: bucket,
    AI: {
      async run(model, input) {
        aiCalls++;
        assert.equal(model, '@cf/deepgram/aura-2-en');
        assert.equal(input.speaker, 'luna');
        return makeFakeMp3Bytes(2400);
      },
    },
  };

  const checkQuota = async () => {
    quotaChecks++;
    return true;
  };

  const payloadVasi = {
    cueType: 'intro_full',
    firstName: 'Vasi',
    currentState: 'distracted',
    targetState: 'deep_flow',
    armId: 'nootropic-trance-6x40hz',
    modulationHz: 6,
    genre: 'nootropic_trance',
    isDriving: false,
    timeBucket: 'morning',
  };

  // 1st call: synthesizes greeting + body (2 AI calls) and stores in R2
  const first = await resolveVoiceConciergeAudio(env, payloadVasi, checkQuota);
  assert.equal(first.available, true);
  assert.equal(first.fromCache, false);
  assert.equal(aiCalls, 2);
  assert.equal(quotaChecks, 1);
  assert.equal(bucket.store.size, 2);
  assert.match(first.greetingUrl, /^\/api\/audio\/stream\/voice\/v1\/greet_/);
  assert.match(first.bodyUrl, /^\/api\/audio\/stream\/voice\/v1\/body_/);

  // 2nd identical call: 100% R2 cache hit (0 AI calls, 0 quota consumption!)
  const second = await resolveVoiceConciergeAudio(env, payloadVasi, checkQuota);
  assert.equal(second.available, true);
  assert.equal(second.fromCache, true);
  assert.equal(second.provider, 'r2_cache');
  assert.equal(aiCalls, 2);
  assert.equal(quotaChecks, 1);
  assert.equal(second.greetingUrl, first.greetingUrl);
  assert.equal(second.bodyUrl, first.bodyUrl);

  // 3rd call with a brand-new user ("Maria") on the exact same scenario:
  // Reuses the cached scenario body from R2 and only synthesizes Maria's 1.2s greeting (1 AI call)!
  const third = await resolveVoiceConciergeAudio(
    env,
    { ...payloadVasi, firstName: 'Maria' },
    checkQuota
  );
  assert.equal(third.available, true);
  assert.equal(third.bodyUrl, first.bodyUrl);
  assert.notEqual(third.greetingUrl, first.greetingUrl);
  assert.equal(aiCalls, 3);
  assert.equal(bucket.store.size, 3);
});

test('resolveVoiceConciergeAudio falls back cleanly to Gemini 3.8 Flash-Lite TTS (Achernar) when Workers AI fails', async () => {
  const bucket = createMockR2Bucket();
  const wavBytes = new Uint8Array(1600);
  // RIFF header
  wavBytes[0] = 0x52;
  wavBytes[1] = 0x49;
  wavBytes[2] = 0x46;
  wavBytes[3] = 0x46;
  const b64Wav = Buffer.from(wavBytes).toString('base64');

  const origFetch = globalThis.fetch;
  let geminiCalls = 0;
  globalThis.fetch = async (url, init) => {
    geminiCalls++;
    assert.match(String(url), /generativelanguage\.googleapis\.com\/v1beta\/interactions/);
    const parsed = JSON.parse(init.body);
    assert.equal(parsed.model, 'gemini-3.8-flash-lite-tts');
    assert.equal(parsed.store, false);
    assert.equal(parsed.generation_config.speech_config[0].voice, 'Achernar');
    return new Response(
      JSON.stringify({
        steps: [{ type: 'model_turn', content: [{ type: 'audio', data: b64Wav }] }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    const res = await resolveVoiceConciergeAudio(
      {
        AUDIO_BUCKET: bucket,
        AI: {
          async run() {
            throw new Error('Workers AI simulated outage');
          },
        },
        GEMINI_API_KEY: 'test-gemini-key',
      },
      {
        cueType: 'intro_short',
        firstName: 'Alex',
        currentState: 'calm_neutral',
        targetState: 'alert_focus',
        armId: 'beta-16hz',
        modulationHz: 16,
        genre: 'lofi_keys',
        isDriving: false,
      },
      async () => true
    );
    assert.equal(res.available, true);
    assert.equal(res.provider, 'gemini-3.8-flash-lite-tts');
    assert.equal(geminiCalls, 2);
    assert.match(res.greetingUrl, /\.wav$/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('sanitizeVoiceRequestPayload + vocal headroom math strictly preserve Layer-1 limiter invariance', () => {
  const sanitized = sanitizeVoiceRequestPayload({
    cueType: 'invalid_mode',
    firstName: 'Vasi',
    currentState: 'not_a_state',
    targetState: 'not_a_target',
    armId: 'bad/../arm!!',
    modulationHz: 9999,
    genre: 'unknown_genre',
    isDriving: 1,
    durationMin: -50,
  });
  assert.equal(sanitized.cueType, 'intro_full');
  assert.equal(sanitized.currentState, 'calm_neutral');
  assert.equal(sanitized.targetState, 'alert_focus');
  assert.equal(sanitized.genre, 'deep_electronic');
  assert.equal(sanitized.modulationHz, 45);
  assert.equal(sanitized.durationMin, 5);
  assert.equal(sanitized.isDriving, true);

  // Verify vocal peak + whisper-soft ducked music + Layer-1 clinical stimulus stays strictly below masterSafetyLimiter ceiling!
  const maxVoicePeakAtSumBus = VOCAL_PEAK_CEILING * (VOICE_DRY_GAIN + VOICE_EARLY_GAIN);
  const maxDuckedMusicAtSumBus = 0.68 * MUSIC_VOICE_DUCK_GAIN; // musicPreLimiter * whisper ducking (0.12)
  const maxLayer1Peak = 0.19;
  const worstCaseCombinedPeak = maxVoicePeakAtSumBus + maxDuckedMusicAtSumBus + maxLayer1Peak;

  const spokenRms = VOCAL_TARGET_RMS * VOICE_DRY_GAIN;
  const duckedMusicRms = 0.22 * MUSIC_VOICE_DUCK_GAIN;
  const speechToMusicSnrDb = 20 * Math.log10(spokenRms / duckedMusicRms);

  assert.ok(VOCAL_TARGET_RMS >= 0.16 && VOCAL_TARGET_RMS < 0.25);
  assert.ok(
    SESSION_INTRO_VOICE_DELAY_MS >= 3000,
    `Expected calm arrival delay >= 3000ms before speech starts, got ${SESSION_INTRO_VOICE_DELAY_MS}`
  );
  assert.ok(MUSIC_VOICE_DUCK_GAIN <= 0.15, `Expected deep whisper-bed duck <= 0.15, got ${MUSIC_VOICE_DUCK_GAIN}`);
  assert.ok(
    MUSIC_FADE_IN_AFTER_VOICE_SEC >= 4.5,
    `Expected gradual fade-in >= 4.5s, got ${MUSIC_FADE_IN_AFTER_VOICE_SEC}`
  );
  assert.ok(
    speechToMusicSnrDb >= 14.0,
    `Expected clear speech-to-music SNR >= +14.0 dB while speaking, got ${speechToMusicSnrDb.toFixed(2)} dB`
  );
  assert.ok(
    worstCaseCombinedPeak < LIMITER_CEILING_LINEAR,
    `Expected combined peak ${worstCaseCombinedPeak.toFixed(4)} < master limiter ceiling ${LIMITER_CEILING_LINEAR.toFixed(4)}`
  );
});


test('listAvailableConciergeVoices returns ONLY Alanya at 0.96x natural pace and excludes other voices', async () => {
  clearVoiceCatalogCacheForTests();
  assert.equal(DEFAULT_ELEVENLABS_VOICE_ID, 'iRb5bX2IzJDUAwy4jeki');
  assert.equal(ELEVENLABS_CONCIERGE_SPEED, 0.96);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /api\.elevenlabs\.io\/v1\/voices$/);
    assert.equal(init.headers['xi-api-key'], 'test-el-key');
    return new Response(
      JSON.stringify({
        voices: [
          {
            voice_id: 'ro_dj_01',
            name: 'Anyella - Vibrant Radio DJ',
            category: 'professional',
            labels: { language: 'ro', descriptive: 'excited', use_case: 'advertisement' },
          },
          {
            voice_id: 'horror_01',
            name: 'True - Crime & Horror Narrator',
            category: 'professional',
            labels: { language: 'en', descriptive: 'serious', use_case: 'narrative_story' },
          },
          {
            voice_id: DEFAULT_ELEVENLABS_VOICE_ID,
            name: 'Alanya - Smooth',
            category: 'custom',
            labels: { language: 'en', gender: 'female', accent: 'american', descriptive: 'smooth', use_case: 'narrative_story' },
          },
          {
            voice_id: 'pysCEvZRsl1S0ifPp4IM',
            name: 'Serene Presence - Calm & Grounded',
            category: 'custom',
            labels: { language: 'en', gender: 'female', descriptive: 'meditative', use_case: 'narrative_story' },
          },
          {
            voice_id: 'gYGXjks6FzTWwNQ6X7hC',
            name: 'Monique - Empathetic, Calm & Nurturing',
            category: 'custom',
            labels: { language: 'en', gender: 'female', descriptive: 'calm', use_case: 'conversational' },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    const catalog = await listAvailableConciergeVoices({
      ELEVENLABS_API_KEY: 'test-el-key',
      ELEVENLABS_VOICE_ID: 'gYGXjks6FzTWwNQ6X7hC',
    });
    assert.equal(catalog.available, true);
    assert.equal(catalog.provider, 'elevenlabs');
    assert.equal(catalog.defaultVoiceId, DEFAULT_ELEVENLABS_VOICE_ID);
    assert.equal(catalog.voices.length, 1);
    assert.equal(catalog.voices[0].voiceId, DEFAULT_ELEVENLABS_VOICE_ID);
    assert.equal(catalog.voices[0].shortLabel, 'Alanya · Smooth');
  } finally {
    clearVoiceCatalogCacheForTests();
    globalThis.fetch = origFetch;
  }
});

test('resolveVoiceConciergeAudio synthesizes via ElevenLabs Alanya at 0.96x into v4 R2 cache and falls back on 429', async () => {
  clearVoiceCatalogCacheForTests();
  const bucket = createMockR2Bucket();
  const mp3Bytes = makeFakeMp3Bytes(2600);
  const origFetch = globalThis.fetch;
  let elevenTtsCalls = 0;
  let aiFallbackCalls = 0;
  let simulateQuotaOut = false;
  const observedSpeeds = [];

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/v1/voices')) {
      return new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: DEFAULT_ELEVENLABS_VOICE_ID,
              name: 'Alanya - Smooth',
              category: 'custom',
              labels: { language: 'en', descriptive: 'smooth' },
            },
            {
              voice_id: 'gYGXjks6FzTWwNQ6X7hC',
              name: 'Monique - Empathetic, Calm & Nurturing',
              category: 'custom',
              labels: { language: 'en', descriptive: 'calm' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (u.includes('/v1/text-to-speech/')) {
      elevenTtsCalls++;
      if (init?.body) {
        const parsed = JSON.parse(String(init.body));
        observedSpeeds.push(parsed.voice_settings?.speed);
      }
      if (simulateQuotaOut) {
        return new Response('quota_exceeded', { status: 429 });
      }
      return new Response(mp3Bytes, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  const env = {
    AUDIO_BUCKET: bucket,
    ELEVENLABS_API_KEY: 'test-el-key',
    AI: {
      async run() {
        aiFallbackCalls++;
        return makeFakeMp3Bytes(2100);
      },
    },
  };

  try {
    const first = await resolveVoiceConciergeAudio(
      env,
      {
        cueType: 'intro_full',
        firstName: 'Vasi',
        currentState: 'distracted',
        targetState: 'deep_flow',
        armId: 'nootropic-trance-6x40hz',
        modulationHz: 6,
        genre: 'nootropic_trance',
        isDriving: false,
      },
      async () => true
    );
    assert.equal(first.available, true);
    assert.equal(first.provider, 'elevenlabs');
    assert.equal(first.voiceId, DEFAULT_ELEVENLABS_VOICE_ID);
    assert.equal(elevenTtsCalls, 2);
    assert.deepEqual(observedSpeeds, [0.96, 0.96]);
    assert.match(first.greetingUrl, /^\/api\/audio\/stream\/voice\/v4\/greet_/);

    // Repeat call (even with legacy Monique voiceId from older client cache) normalizes to Alanya and hits v4 R2 cache with 0 ElevenLabs calls
    const second = await resolveVoiceConciergeAudio(
      env,
      {
        cueType: 'intro_full',
        firstName: 'Vasi',
        voiceId: 'gYGXjks6FzTWwNQ6X7hC',
        currentState: 'distracted',
        targetState: 'deep_flow',
        armId: 'nootropic-trance-6x40hz',
        modulationHz: 6,
        genre: 'nootropic_trance',
        isDriving: false,
      },
      async () => true
    );
    assert.equal(second.fromCache, true);
    assert.equal(second.provider, 'r2_cache');
    assert.equal(second.voiceId, DEFAULT_ELEVENLABS_VOICE_ID);
    assert.equal(second.greetingUrl, first.greetingUrl);
    assert.equal(elevenTtsCalls, 2);

    // Partial-cache scenario under ElevenLabs quota exhaustion: 'Vasi' greeting IS cached as Alanya,
    // while target 'sleep_winddown' body misses cache and triggers 429 -> BOTH segments unify onto aura_luna!
    simulateQuotaOut = true;
    const partialFallback = await resolveVoiceConciergeAudio(
      env,
      {
        cueType: 'intro_full',
        firstName: 'Vasi',
        currentState: 'distracted',
        targetState: 'sleep_winddown',
        armId: 'delta-2hz-sleep',
        modulationHz: 2,
        genre: 'solo_piano',
        isDriving: false,
      },
      async () => true
    );
    assert.equal(partialFallback.available, true);
    assert.equal(partialFallback.provider, '@cf/deepgram/aura-2-en');
    assert.equal(partialFallback.voiceId, 'aura_luna');
    assert.match(partialFallback.greetingUrl, /^\/api\/audio\/stream\/voice\/v1\/greet_/);
    assert.match(partialFallback.bodyUrl, /^\/api\/audio\/stream\/voice\/v1\/body_/);

    // Next brand-new user uses 5-min cooldown circuit-breaker (0 wasted ElevenLabs HTTP calls) on Workers AI
    const prevElevenCalls = elevenTtsCalls;
    const fallback = await resolveVoiceConciergeAudio(
      env,
      {
        cueType: 'intro_short',
        firstName: 'Maria',
        voiceId: 'iRb5bX2IzJDUAwy4jeki',
        currentState: 'calm_neutral',
        targetState: 'alert_focus',
        armId: 'beta-16hz',
        modulationHz: 16,
        genre: 'lofi_keys',
        isDriving: false,
      },
      async () => true
    );
    assert.equal(fallback.available, true);
    assert.equal(fallback.provider, '@cf/deepgram/aura-2-en');
    assert.equal(elevenTtsCalls, prevElevenCalls);
    assert.equal(aiFallbackCalls, 4);
  } finally {
    clearVoiceCatalogCacheForTests();
    globalThis.fetch = origFetch;
  }
});

test('trimAndNormalizeVocalBuffer prepends 45 ms lead cushion so 12 ms fade-in never clips initial consonant', () => {
  assert.equal(VOCAL_LEAD_PAD_SEC, 0.045);
  assert.equal(VOCAL_FADE_IN_SEC, 0.012);
  assert.ok(VOCAL_FADE_IN_SEC < VOCAL_LEAD_PAD_SEC);

  const sr = 48000;
  const totalLen = Math.floor(sr * 0.25);
  const makeMockBuffer = (channels, length, sampleRate) => {
    const channelData = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData(ch) {
        return channelData[ch];
      },
    };
  };

  const rawBuf = makeMockBuffer(1, totalLen, sr);
  const src = rawBuf.getChannelData(0);
  // Active consonant begins right at sample 0!
  for (let i = 0; i < totalLen - Math.floor(sr * 0.05); i++) {
    src[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sr);
  }
  // Sample 0 had zero sine value above; force active sample right at index 0
  src[0] = 0.18;

  const mockCtx = {
    createBuffer(channels, length, sampleRate) {
      return makeMockBuffer(channels, length, sampleRate);
    },
  };

  const out = trimAndNormalizeVocalBuffer(mockCtx, rawBuf);
  const dst = out.getChannelData(0);
  const expectedLeadSamples = Math.floor(sr * VOCAL_LEAD_PAD_SEC); // 2160
  const fadeSamples = Math.floor(sr * VOCAL_FADE_IN_SEC); // 576

  assert.ok(expectedLeadSamples > fadeSamples);
  // Entire 45 ms pre-consonant lead cushion is silent (0) so the 12 ms anti-click ramp finishes cleanly before sample 2160
  for (let i = 0; i < expectedLeadSamples; i++) {
    assert.equal(dst[i], 0, `Expected 0 lead cushion at sample ${i}`);
  }
  assert.ok(Math.abs(dst[expectedLeadSamples]) > 0.05, 'First consonant sample must remain intact after lead pad');
});
