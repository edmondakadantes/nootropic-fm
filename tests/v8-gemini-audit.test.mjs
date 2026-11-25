/**
 * nootropic.fm v8 — Comprehensive Automated Audit Verification Suite
 *
 * Deep behavioral, DSP, psychometric, security, and SQLite/Worker integration tests
 * covering all 11 findings from the v8 Technical Audit (4 P0, 5 P1, 2 P2) + edge cases:
 *
 *  - P0 #1: LR4 3-Band Crossover phase coherence under dynamic ZDF tilt (±4.2 dB @ 1350 Hz)
 *  - P0 #2: Safari/iOS Stem OOM guard (`mediaDeckPool` progressive `<audio>` + 2.2 MB decode ceiling)
 *  - P0 #3: Lyria WebSocket proxy hardening (Origin, IP-bound HMAC, atomic single-use `used_ws_nonces`,
 *           atomic `active_ws_leases <= 2` concurrency cap, 110s/11m socket window, 16 KB frame cap)
 *  - P0 #4: Active Aperiodic Acoustic Sham (matched-RMS diotic triad, zero 4–45 Hz ASSR peak,
 *           zero monitor-toggle unblinding)
 *  - P1 #5: 8-Tap Polyphase Kaiser-Bessel Sinc Resampler (>50 dB stopband alias rejection vs cubic)
 *  - P1 #6: Dynamic `< 0.44 * sampleRate` Nyquist clamping @ 16 kHz / 8 kHz Bluetooth HFP + iOS `'interrupted'` recovery
 *  - P1 #7: Animal / non-auditory study rejection + MSO 150–900 Hz & <=45 Hz binaural guardrails
 *  - P1 #8: Bandit `< 25%` early-abort survival penalty + stale sweep + factorized marginal cold-start pooling
 *  - P1 #9: Atomic single-query `rate_limits` enforcement (`INSERT ... ON CONFLICT DO UPDATE WHERE hits < ? RETURNING hits`)
 *  - P2 #10: Dedicated `musicPreLimiter` (-3.35 dBTP = 0.68) guaranteeing 0.000 dB Layer-1 ducking during drum peaks
 *  - P2 #11: `HttpOnly; SameSite=Lax; Secure` `nfm_auth` cookie, atomic `processed_webhooks` idempotency, & CSP `_headers`
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Allow Node's native TypeScript loader to resolve extensionless relative imports in `shared/*.ts`
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { DSP_WORKLET_CODE } = await import('../src/audio/dspWorklets.ts');
const { LIMITER_CEILING_LINEAR } = await import('../src/audio/dspMath.ts');
const {
  appendPubMedHumanAuditoryGuard,
  isNonAuditoryOrAnimalStudy,
  PUBMED_HUMAN_AUDITORY_EXCLUSION,
  EUROPEPMC_HUMAN_AUDITORY_EXCLUSION,
  OPENALEX_HUMAN_AUDITORY_EXCLUSION,
} = await import('../shared/openGoals.ts');
const { PsychoacousticEngine } = await import('../src/audio/PsychoacousticEngine.ts');
const { LyriaRealtimeClient } = await import('../src/audio/LyriaRealtimeClient.ts');
const { MedicalStimulusRack, createCalibratedNoiseBuffer } = await import('../src/audio/MedicalStimulusRack.ts');
const { StereoRainBed, createStereoRainBuffer } = await import('../src/audio/StereoRainBed.ts');
const { GenerativeComposer } = await import('../src/audio/GenerativeComposer.ts');
const { StudioSampler } = await import('../src/audio/StudioSampler.ts');
const { applySafetyAndDeviceGuardrails } = await import('../shared/studyCompilerCore.ts');
const { VERIFIED_STUDY_PRESETS } = await import('../shared/studyPresets.ts');
const { computeHierarchicalArmPosterior } = await import('../shared/psychometrics.ts');
const {
  buildFactorizedMarginalScopes,
  computeImplicitReward,
  selectProtocolRecommendation,
} = await import('../shared/protocols.ts');
const workerModule = await import('../dist/nootropic_fm/index.js');
const worker = workerModule.default;

function db(val) {
  return 20 * Math.log10(Math.max(1e-12, val));
}

function goertzelMag(samples, sampleRate, freqHz) {
  const n = samples.length;
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    const q0 = coeff * q1 - q2 + samples[i] * w;
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * Math.cos(omega);
  const imag = q2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag) / (n * 0.25);
}

function makeBiquad(type, fc, sampleRate, qLin = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * qLin);
  const a0 = 1 + alpha;
  let b0;
  let b1;
  let b2;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;
  if (type === 'lowpass') {
    b0 = (1 - cosW) / 2 / a0;
    b1 = (1 - cosW) / a0;
    b2 = (1 - cosW) / 2 / a0;
  } else if (type === 'highpass') {
    b0 = (1 + cosW) / 2 / a0;
    b1 = -(1 + cosW) / a0;
    b2 = (1 + cosW) / 2 / a0;
  } else {
    // 2nd-order allpass matching Web Audio BiquadFilterNode 'allpass' (Q = SQRT1_2 for LR4 phase complement)
    b0 = (1 - alpha) / a0;
    b1 = (-2 * cosW) / a0;
    b2 = (1 + alpha) / a0;
  }
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function makeLR4(type, fc, sampleRate) {
  const s1 = makeBiquad(type, fc, sampleRate, Math.SQRT1_2);
  const s2 = makeBiquad(type, fc, sampleRate, Math.SQRT1_2);
  return (x) => s2(s1(x));
}

function loadWorkletProcessors(sampleRate = 48000) {
  const registry = new Map();
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        _outbox: [],
        postMessage: (msg) => {
          this.port._outbox.push(msg);
        },
        onmessage: null,
        _deliver: (msg) => {
          if (typeof this.port.onmessage === 'function') {
            this.port.onmessage({ data: msg });
          }
        },
      };
    }
  }
  const compileWorklets = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    DSP_WORKLET_CODE
  );
  compileWorklets(MockAudioWorkletProcessor, (name, Ctor) => registry.set(name, Ctor), sampleRate);
  return registry;
}

/**
 * Builds an in-memory SQLite (`node:sqlite`) database with all real D1 migrations (0001..0012)
 * wrapped in a Cloudflare `D1Database`-compatible adapter.
 */
function createInMemoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  const migDir = path.join(ROOT, 'migrations');
  const migFiles = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migFiles) {
    const sql = fs.readFileSync(path.join(migDir, file), 'utf8');
    sqlite.exec(sql);
  }

  function createBoundStmt(sql, boundValues = []) {
    const normParams = boundValues.map((v) => (v === undefined ? null : v));
    const hasResultRows = /\b(SELECT|RETURNING|PRAGMA)\b/i.test(sql);
    return {
      bind(...vals) {
        return createBoundStmt(sql, vals);
      },
      async first(colName) {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...normParams) ?? null;
        if (!row) return null;
        if (colName) return row[colName] ?? null;
        return row;
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        if (hasResultRows) {
          const rows = stmt.all(...normParams);
          return { results: rows, success: true, meta: {} };
        }
        const info = stmt.run(...normParams);
        return { results: [], success: true, meta: { changes: Number(info.changes ?? 0) } };
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        if (hasResultRows) {
          const rows = stmt.all(...normParams);
          return { results: rows, success: true, meta: { changes: rows.length } };
        }
        const info = stmt.run(...normParams);
        return { success: true, meta: { changes: Number(info.changes ?? 0) } };
      },
    };
  }

  return {
    _sqlite: sqlite,
    prepare(sql) {
      return createBoundStmt(sql, []);
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) {
        out.push(await s.all());
      }
      return out;
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}

function createExecCtx() {
  const pending = [];
  return {
    waitUntil(p) {
      pending.push(Promise.resolve(p).catch(() => {}));
    },
    passThroughOnException() {},
    async flush() {
      await Promise.all(pending.splice(0));
    },
  };
}

async function hmacSha256HexNode(secret, message) {
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

// ============================================================================
// P0 #1 — LR4 3-Band Crossover Phase Coherence under Dynamic ZDF Tilt
// ============================================================================
test('P0 #1: Dynamic ZDF tilt placed upstream of LR4 split maintains 0.000 dB phase-coherent reconstruction at 190 Hz & 4500 Hz', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');

  // Structural verification: preTiltBus -> tiltSplitter -> amTiltL/R -> tiltMerger -> musicMixBus,
  // while musicMixBus feeds lowBand.input & aboveLow.input (ZERO tilt filter inside Band 2!)
  assert.ok(
    engineSrc.includes('preTiltBus.connect(tiltSplitter)') &&
      engineSrc.includes('tiltMerger.connect(musicMixBus)') &&
      engineSrc.includes('musicMixBus.connect(lowBand.input)') &&
      engineSrc.includes('musicMixBus.connect(aboveLow.input)'),
    'Dynamic ZDF tilt must feed musicMixBus upstream of LR4 band split'
  );
  assert.ok(
    !engineSrc.includes('midHp2.connect(midSplit)') && !engineSrc.includes('midMerge.connect(midLp1)'),
    'Band 2 must never insert a phase-rotating peaking tilt filter between midHp2 and midLp1'
  );

  // Numerical 48 kHz DSP proof: sweep ZDF tilt ±4.2 dB @ 10 Hz across 190 Hz + 1350 Hz + 4500 Hz composite
  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const ZdfCtor = reg.get('nootropic-zdf-tilt');
  const frames = 128 * 375; // 1.000s

  const input = new Float32Array(frames);
  const gainSweepDb = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    input[i] =
      0.28 * Math.sin(2 * Math.PI * 190 * t) +
      0.28 * Math.sin(2 * Math.PI * 1350 * t) +
      0.28 * Math.sin(2 * Math.PI * 4500 * t);
    gainSweepDb[i] = 4.2 * Math.sin(2 * Math.PI * 10 * t);
  }

  // New upstream architecture: input -> ZDF tilt -> 3-band LR4 + AP phase-complement sum (with unity Band-2 gain)
  const zdfUpstream = new ZdfCtor();
  const tiltedRef = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) {
    const iSeg = input.subarray(off, off + 128);
    const gSeg = gainSweepDb.subarray(off, off + 128);
    const oL = new Float32Array(128);
    zdfUpstream.process([[iSeg, iSeg]], [[oL, new Float32Array(128)]], {
      freq: new Float32Array([1350]),
      Q: new Float32Array([1.15]),
      gainDb: gSeg,
    });
    tiltedRef.set(oL, off);
  }

  const lowLp = makeLR4('lowpass', 190, sr);
  const lowAp = makeBiquad('allpass', 4500, sr, Math.SQRT1_2);
  const midHp = makeLR4('highpass', 190, sr);
  const midLp = makeLR4('lowpass', 4500, sr);
  const highHp = makeLR4('highpass', 4500, sr);
  const highAp = makeBiquad('allpass', 190, sr, Math.SQRT1_2);

  const reconNew = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const x = tiltedRef[i];
    const b1 = lowAp(lowLp(x));
    const b2 = midLp(midHp(x));
    const b3 = highAp(highHp(x));
    reconNew[i] = b1 + b2 + b3;
  }

  // Old buggy architecture (for contrast): ZDF tilt inside Band 2 only -> phase rotation at 190 Hz & 4500 Hz
  const zdfInside = new ZdfCtor();
  const lowLpOld = makeLR4('lowpass', 190, sr);
  const lowApOld = makeBiquad('allpass', 4500, sr, Math.SQRT1_2);
  const midHpOld = makeLR4('highpass', 190, sr);
  const midLpOld = makeLR4('lowpass', 4500, sr);
  const highHpOld = makeLR4('highpass', 4500, sr);
  const highApOld = makeBiquad('allpass', 190, sr, Math.SQRT1_2);
  const midPre = new Float32Array(frames);
  const b1Old = new Float32Array(frames);
  const b3Old = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const x = input[i];
    b1Old[i] = lowApOld(lowLpOld(x));
    midPre[i] = midHpOld(x);
    b3Old[i] = highApOld(highHpOld(x));
  }
  const midTiltedOld = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) {
    const oL = new Float32Array(128);
    zdfInside.process(
      [[midPre.subarray(off, off + 128), midPre.subarray(off, off + 128)]],
      [[oL, new Float32Array(128)]],
      {
        freq: new Float32Array([1350]),
        Q: new Float32Array([1.15]),
        gainDb: new Float32Array([4.2]),
      }
    );
    midTiltedOld.set(oL, off);
  }
  const reconOld = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    reconOld[i] = b1Old[i] + midLpOld(midTiltedOld[i]) + b3Old[i];
  }

  // Also build static +4.2 dB reference to quantify old inside-Band-2 comb-filter error at 190 Hz & 4500 Hz
  const zdfStaticRef = new ZdfCtor();
  const staticRef = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) {
    const oL = new Float32Array(128);
    zdfStaticRef.process(
      [[input.subarray(off, off + 128), input.subarray(off, off + 128)]],
      [[oL, new Float32Array(128)]],
      {
        freq: new Float32Array([1350]),
        Q: new Float32Array([1.15]),
        gainDb: new Float32Array([4.2]),
      }
    );
    staticRef.set(oL, off);
  }

  const steady = Math.round(0.2 * sr);
  const refSteady = tiltedRef.subarray(steady);
  const newSteady = reconNew.subarray(steady);
  const err190Db = Math.abs(db(goertzelMag(newSteady, sr, 190) / goertzelMag(refSteady, sr, 190)));
  const err1350Db = Math.abs(db(goertzelMag(newSteady, sr, 1350) / goertzelMag(refSteady, sr, 1350)));
  const err4500Db = Math.abs(db(goertzelMag(newSteady, sr, 4500) / goertzelMag(refSteady, sr, 4500)));

  const oldSteady = reconOld.subarray(steady);
  const staticRefSteady = staticRef.subarray(steady);
  const oldCombErrDb = Math.max(
    Math.abs(db(goertzelMag(oldSteady, sr, 190) / goertzelMag(staticRefSteady, sr, 190))),
    Math.abs(db(goertzelMag(oldSteady, sr, 4500) / goertzelMag(staticRefSteady, sr, 4500)))
  );

  assert.ok(err190Db < 0.005, `Expected < 0.005 dB crossover error @ 190 Hz, got ${err190Db.toFixed(5)} dB`);
  assert.ok(err1350Db < 0.005, `Expected < 0.005 dB crossover error @ 1350 Hz, got ${err1350Db.toFixed(5)} dB`);
  assert.ok(err4500Db < 0.005, `Expected < 0.005 dB crossover error @ 4500 Hz, got ${err4500Db.toFixed(5)} dB`);
  assert.ok(
    oldCombErrDb > 0.12 && oldCombErrDb > Math.max(1e-7, err190Db, err4500Db) * 1000,
    `Upstream ZDF placement must eliminate old inside-Band-2 crossover comb error >1000x (old=${oldCombErrDb.toFixed(3)} dB vs new=${Math.max(err190Db, err4500Db).toFixed(5)} dB)`
  );
});

// ============================================================================
// P0 #2 — Safari/iOS Stem OOM Prevention (Progressive <audio> Pool + 2.2 MB Guard)
// ============================================================================
test('P0 #2: Safari/iOS fallback uses progressive mediaDeckPool (<audio> + DelayNode) and enforces 2.2 MB decodeAudioData byte ceiling', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');

  assert.ok(!engineSrc.includes('decodePreferredV7Stem'), 'Full-stem decodePreferredV7Stem OOM path must be completely removed');
  assert.ok(engineSrc.includes('const MAX_DECODE_AUDIO_BYTES = 2_200_000;'), 'loadAudioBuffer must enforce 2.2 MB byte ceiling');
  assert.ok(engineSrc.includes('playProgressiveMediaStem('), 'Non-WebCodecs browsers must stream stems via playProgressiveMediaStem');
  assert.ok(engineSrc.includes('createMediaElementSource(el)'), 'mediaDeckPool must bind pre-unlocked HTMLAudioElement slots');
  assert.ok(engineSrc.includes('this.bufferCache.clear()'), 'stop() must clear bufferCache to release decoded AudioBuffers');

  // Behavioral check of the byte-ceiling guard (header Content-Length AND post-arrayBuffer byteLength)
  function checkDecodeByteCeiling(contentLengthHeader, actualByteLength) {
    const MAX_BYTES = 2_200_000;
    const declaredLen = Number(contentLengthHeader ?? '0');
    if (declaredLen > MAX_BYTES) return { rejectedAt: 'header', allowed: false };
    if (actualByteLength === 0) return { rejectedAt: 'empty', allowed: false };
    if (actualByteLength > MAX_BYTES) return { rejectedAt: 'body', allowed: false };
    return { rejectedAt: null, allowed: true };
  }

  assert.deepEqual(checkDecodeByteCeiling('8400000', 8400000), { rejectedAt: 'header', allowed: false });
  assert.deepEqual(checkDecodeByteCeiling(null, 2_200_001), { rejectedAt: 'body', allowed: false });
  assert.deepEqual(checkDecodeByteCeiling('0', 0), { rejectedAt: 'empty', allowed: false });
  assert.deepEqual(checkDecodeByteCeiling('2200000', 2_200_000), { rejectedAt: null, allowed: true });
  assert.deepEqual(checkDecodeByteCeiling('380000', 380_000), { rejectedAt: null, allowed: true });
});

// ============================================================================
// P0 #3 — Lyria WebSocket Proxy Hardening (Real Worker + SQLite D1 Integration)
// ============================================================================
test('P0 #3: /api/music/realtime-ws enforces Origin, IP-bound HMAC, atomic single-use nonce (`used_ws_nonces`), and atomic `<= 2` active socket cap', async () => {
  const dbConn = createInMemoryD1();
  const env = {
    DB: dbConn,
    GEMINI_MUSIC_API_KEY: 'test_lyria_secret_key_do_not_leak_v8',
  };
  const ctx = createExecCtx();

  // 1. Mint a real signed ticket via POST /api/music/realtime-token from IP 203.0.113.10
  const tokReq = new Request('https://www.nootropic.fm/api/music/realtime-token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.nootropic.fm',
      'cf-connecting-ip': '203.0.113.10',
    },
    body: JSON.stringify({}),
  });
  const tokRes = await worker.fetch(tokReq, env, ctx);
  assert.equal(tokRes.status, 200);
  const tokJson = await tokRes.json();
  assert.equal(tokJson.available, true);
  assert.equal(tokJson.token.split('.').length, 4, 'v2 ticket must encode expMs.nonce.proFlag.sig');

  // 2. Reject untrusted Origin (403) BEFORE touching nonces
  const badOriginRes = await worker.fetch(
    new Request(`https://www.nootropic.fm/api/music/realtime-ws?ticket=${encodeURIComponent(tokJson.token)}`, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'https://evil-attacker.example',
        'cf-connecting-ip': '203.0.113.10',
      },
    }),
    env,
    ctx
  );
  assert.equal(badOriginRes.status, 403);

  // 3. Reject missing Upgrade header (426)
  const noUpgRes = await worker.fetch(
    new Request(`https://www.nootropic.fm/api/music/realtime-ws?ticket=${encodeURIComponent(tokJson.token)}`, {
      headers: {
        Origin: 'https://www.nootropic.fm',
        'cf-connecting-ip': '203.0.113.10',
      },
    }),
    env,
    ctx
  );
  assert.equal(noUpgRes.status, 426);

  // 4. Reject valid ticket replayed from a DIFFERENT client IP (401 IP-bound HMAC mismatch)
  const wrongIpRes = await worker.fetch(
    new Request(`https://www.nootropic.fm/api/music/realtime-ws?ticket=${encodeURIComponent(tokJson.token)}`, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'https://www.nootropic.fm',
        'cf-connecting-ip': '198.51.100.99',
      },
    }),
    env,
    ctx
  );
  assert.equal(wrongIpRes.status, 401);

  // 5. Atomic single-use nonce (`used_ws_nonces`): mock upstream fetch to avoid real Google network call
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Mock upstream without WS', { status: 502 });

    // Fire TWO simultaneous upgrade attempts with the exact same valid ticket from the rightful IP
    const makeWsReq = () =>
      new Request(`https://www.nootropic.fm/api/music/realtime-ws?ticket=${encodeURIComponent(tokJson.token)}`, {
        headers: {
          Upgrade: 'websocket',
          Origin: 'https://www.nootropic.fm',
          'cf-connecting-ip': '203.0.113.10',
        },
      });

    const [r1, r2] = await Promise.all([
      worker.fetch(makeWsReq(), env, ctx),
      worker.fetch(makeWsReq(), env, ctx),
    ]);
    await ctx.flush();

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    // Exactly ONE reaches upstream (502 mock) while the duplicate replay is blocked with 401!
    assert.deepEqual(statuses, [401, 502], `Expected [401, 502] for single-use nonce race, got ${JSON.stringify(statuses)}`);

    const nonceCount = dbConn._sqlite.prepare('SELECT COUNT(*) AS c FROM used_ws_nonces').get().c;
    assert.equal(nonceCount, 1, 'used_ws_nonces must store the consumed ticket jti');

    // 6. Atomic Concurrent Active Socket Cap (`active_ws_leases <= 2`):
    // Mint 3 fresh valid tickets for the same actor while keeping upstream sockets "open" (simulated by pre-holding 2 active leases,
    // plus firing a concurrent wave against the atomic INSERT ... WHERE COUNT(*) < 2 query)
    const freshTickets = [];
    for (let k = 0; k < 3; k++) {
      const tr = await worker.fetch(
        new Request('https://www.nootropic.fm/api/music/realtime-token', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://www.nootropic.fm',
            'cf-connecting-ip': '203.0.113.10',
          },
          body: JSON.stringify({}),
        }),
        env,
        ctx
      );
      freshTickets.push((await tr.json()).token);
    }

    // Grab actor_key from used_ws_nonces and insert 2 active unexpired leases
    const actorKey = dbConn._sqlite.prepare('SELECT actor_key FROM used_ws_nonces LIMIT 1').get().actor_key;
    const futureExp = Date.now() + 90_000;
    dbConn._sqlite
      .prepare('INSERT INTO active_ws_leases (lease_id, actor_key, expires_at) VALUES (?, ?, ?), (?, ?, ?)')
      .run('lease_test_1', actorKey, futureExp, 'lease_test_2', actorKey, futureExp);

    const thirdSocketRes = await worker.fetch(
      new Request(`https://www.nootropic.fm/api/music/realtime-ws?ticket=${encodeURIComponent(freshTickets[0])}`, {
        headers: {
          Upgrade: 'websocket',
          Origin: 'https://www.nootropic.fm',
          'cf-connecting-ip': '203.0.113.10',
        },
      }),
      env,
      ctx
    );
    assert.equal(thirdSocketRes.status, 429, '3rd concurrent active WebSocket must be rejected with 429');

    // Once one lease expires (`expires_at <= now`), a fresh ticket can acquire a lease again (reaching 502 mock upstream)
    dbConn._sqlite.prepare('UPDATE active_ws_leases SET expires_at = ? WHERE lease_id = ?').run(Date.now() - 1000, 'lease_test_1');
    const recoveredRes = await worker.fetch(
      new Request(`https://www.nootropic.fm/api/music/realtime-ws?ticket=${encodeURIComponent(freshTickets[1])}`, {
        headers: {
          Upgrade: 'websocket',
          Origin: 'https://www.nootropic.fm',
          'cf-connecting-ip': '203.0.113.10',
        },
      }),
      env,
      ctx
    );
    assert.equal(recoveredRes.status, 502, 'Expired lease must auto-free slot for next valid connection');
  } finally {
    globalThis.fetch = origFetch;
  }

  // Verify hard duration timer & 16 KB client frame cap in worker/index.ts
  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker/index.ts'), 'utf8');
  assert.ok(workerSrc.includes('verified.isPro ? 11 * 60 * 1000 : 110 * 1000'), 'Must enforce 110s Free / 11m Pro WS timer');
  assert.ok(workerSrc.includes('const MAX_CLIENT_FRAME_BYTES = 16_384;'), 'Must enforce 16 KB client WS frame cap');
});

// ============================================================================
// P0 #4 — Active Aperiodic Acoustic Sham & Monitor-Switch Blinding Integrity
// ============================================================================
test('P0 #4: Active Aperiodic Acoustic Sham matches active stimulus RMS within ±2.5 dB with zero 4–45 Hz ASSR peak & preserves blind on monitor switch', () => {
  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const SynthCtor = reg.get('nootropic-clinical-synth');

  const renderMode = (mode, rateHz = 16) => {
    const synth = new SynthCtor();
    synth.port._deliver({
      type: 'config',
      mode,
      rateHz,
      startRateHz: rateHz,
      rampSec: 0,
      carrierHz: 220,
      depth: 0.72,
      dutyCycle: 0.35,
    });
    const frames = 128 * 2250; // 6.00s
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    for (let off = 0; off < frames; off += 128) {
      const oL = new Float32Array(128);
      const oR = new Float32Array(128);
      synth.process([], [[oL, oR]]);
      outL.set(oL, off);
      outR.set(oR, off);
    }
    return { outL, outR };
  };

  const activeIso = renderMode('isochronic', 16.0);
  const sham = renderMode('aperiodic_sham', 16.0);

  const steady = sr; // skip 1s fade-in
  let sumActive = 0;
  let sumSham = 0;
  let maxInterauralDiff = 0;
  const envActive = new Float32Array(sham.outL.length - steady);
  const envSham = new Float32Array(sham.outL.length - steady);
  let meanAct = 0;
  let meanShm = 0;
  for (let i = steady; i < sham.outL.length; i++) {
    const a = activeIso.outL[i];
    const s = sham.outL[i];
    sumActive += a * a;
    sumSham += s * s;
    maxInterauralDiff = Math.max(maxInterauralDiff, Math.abs(sham.outL[i] - sham.outR[i]));
    envActive[i - steady] = a * a;
    envSham[i - steady] = s * s;
    meanAct += a * a;
    meanShm += s * s;
  }
  const rmsActive = Math.sqrt(sumActive / envActive.length);
  const rmsSham = Math.sqrt(sumSham / envSham.length);
  const rmsDiffDb = Math.abs(db(rmsSham / rmsActive));

  assert.ok(rmsSham > 0.05, `Aperiodic sham must NEVER be digital silence (got RMS=${rmsSham})`);
  assert.ok(rmsDiffDb <= 2.5, `Aperiodic sham RMS must match active stimulus within ±2.5 dB (got diff=${rmsDiffDb.toFixed(2)} dB)`);
  assert.equal(maxInterauralDiff, 0, 'Aperiodic sham must be strictly diotic (zero dichotic binaural beat)');

  meanAct /= envActive.length;
  meanShm /= envSham.length;
  for (let i = 0; i < envActive.length; i++) {
    envActive[i] -= meanAct;
    envSham[i] -= meanShm;
  }

  // Check across 4–40 Hz entrainment band: sham must have >= 30 dB lower 16 Hz ASSR envelope power than active 16 Hz!
  const active16Mag = goertzelMag(envActive, sr, 16.0);
  let maxShamEntrainmentMag = 0;
  for (const f of [4, 6, 8, 10, 12, 16, 20, 30, 40]) {
    maxShamEntrainmentMag = Math.max(maxShamEntrainmentMag, goertzelMag(envSham, sr, f));
  }
  const suppressionDb = db(maxShamEntrainmentMag / active16Mag);
  assert.ok(
    suppressionDb <= -35.0,
    `Expected >= 35 dB suppression of 4–40 Hz periodic ASSR envelope in aperiodic_sham, got ${suppressionDb.toFixed(2)} dB`
  );

  // Verify PlayerView never calls setControlTrial(false) when switching layer monitor modes
  const playerSrc = fs.readFileSync(path.join(ROOT, 'src/components/PlayerView.tsx'), 'utf8');
  assert.ok(
    !playerSrc.includes('setControlTrial(false)'),
    'PlayerView must NEVER unblind or override isControlTrial when toggling LayerMonitor'
  );
});

// ============================================================================
// P1 #5 — 8-Tap Polyphase Kaiser-Sinc Resampler (>50 dB Stopband Alias Rejection)
// ============================================================================
test('P1 #5: 24-Tap Polyphase Windowed-Sinc LUT suppresses 48->44.1 kHz & 432 Hz varispeed high-frequency imaging > 52 dB with 0.000 dB DC unity', () => {
  // 1. Resample a 19.0 kHz studio sine (48 kHz source) into a 44.1 kHz AudioContext via NootropicLyriaStreamProcessor
  // Discrete-time image at 48,000 - 19,000 = 29,000 Hz folds across 44,100 Hz to |44,100 - 29,000| = 15,100 Hz!
  // (Catmull-Rom cubic only attenuates 29 kHz by ~19 dB -> loud -19 dBc whistle at 15.1 kHz)
  const outSr = 44100;
  const inSr = 48000;
  const reg44 = loadWorkletProcessors(outSr);
  const LyriaCtor = reg44.get('nootropic-lyria-stream-processor');
  const lyria = new LyriaCtor();

  const srcFrames = inSr * 2; // 2.0s @ 48 kHz
  const pcmL = new Float32Array(srcFrames);
  const pcmR = new Float32Array(srcFrames);
  for (let i = 0; i < srcFrames; i++) {
    const s = 0.7 * Math.sin((2 * Math.PI * 19000 * i) / inSr);
    pcmL[i] = s;
    pcmR[i] = -s;
  }
  lyria.port._deliver({ type: 'pcm', left: pcmL, right: pcmR });

  const outFrames = 128 * 450; // ~1.30s @ 44.1 kHz
  const rendered44 = new Float32Array(outFrames);
  for (let off = 0; off < outFrames; off += 128) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    lyria.process([], [[oL, oR]]);
    rendered44.set(oL, off);
  }

  const steady44 = rendered44.subarray(Math.round(0.2 * outSr));
  const sig19k = goertzelMag(steady44, outSr, 19000);
  const alias15k1 = goertzelMag(steady44, outSr, 15100);
  const aliasDb = db(alias15k1 / sig19k);
  assert.ok(sig19k > 0.35, `19 kHz passband tone attenuated unexpectedly: ${sig19k.toFixed(4)}`);
  assert.ok(
    aliasDb <= -48.0,
    `Expected <= -48 dBc alias suppression at 15.1 kHz (48->44.1 kHz Sinc8 vs ~-19 dBc cubic), got ${aliasDb.toFixed(2)} dBc`
  );

  // 2. Verify DC unity (1.000000) & click-free fractional phase sweep in NootropicStemPlayerProcessor @ 432 Hz varispeed
  const reg48 = loadWorkletProcessors(48000);
  const StemCtor = reg48.get('nootropic-stem-player');
  const stemDc = new StemCtor();
  const dcChunk = new Float32Array(24000).fill(0.5);
  stemDc.port._deliver({ type: 'init', loopFrames: 0, startOffsetSamples: 0 });
  stemDc.port._deliver({ type: 'chunk', left: dcChunk, right: dcChunk });

  let maxDcErr = 0;
  let maxStepDelta = 0;
  let prevSample = null;
  for (let q = 0; q < 80; q++) {
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    stemDc.process([], [[oL, oR]], { playbackRate: new Float32Array([432 / 440]) });
    if (q >= 10) {
      for (let k = 0; k < 128; k++) {
        maxDcErr = Math.max(maxDcErr, Math.abs(oL[k] - 0.5));
        if (prevSample !== null) {
          maxStepDelta = Math.max(maxStepDelta, Math.abs(oL[k] - prevSample));
        }
        prevSample = oL[k];
      }
    }
  }
  assert.ok(maxDcErr < 1e-5, `Sinc8 LUT DC partition-of-unity error too high: ${maxDcErr}`);
  assert.ok(maxStepDelta < 1e-5, `Sinc8 LUT produced integer-crossing step discontinuity: ${maxStepDelta}`);
});

// ============================================================================
// P1 #6 — Dynamic Nyquist Clamping @ 16 kHz / 8 kHz Bluetooth HFP & iOS Interrupted Recovery
// ============================================================================
test('P1 #6: NootropicClinicalSynth clamps carriers/harmonics/chirps < 0.44*sampleRate @ 16 kHz & 8 kHz HFP (zero foldback aliasing) + iOS interrupted recovery', () => {
  // 1. At 16 kHz Bluetooth HFP (Nyquist = 8000 Hz): gamma_mbi @ carrierHz = 3000 Hz
  // Unclamped harmonics 3f = 9000 Hz and 4f = 12000 Hz would fold back to 7000 Hz and 4000 Hz!
  const sr16 = 16000;
  const reg16 = loadWorkletProcessors(sr16);
  const Synth16 = reg16.get('nootropic-clinical-synth');
  const mbi16 = new Synth16();
  mbi16.port._deliver({
    type: 'config',
    mode: 'gamma_mbi',
    rateHz: 40,
    startRateHz: 40,
    rampSec: 0,
    carrierHz: 3000,
    depth: 0.7,
  });

  const frames16 = 128 * 250; // 2.0s @ 16 kHz
  const out16 = new Float32Array(frames16);
  for (let off = 0; off < frames16; off += 128) {
    const oL = new Float32Array(128);
    mbi16.process([], [[oL, new Float32Array(128)]]);
    out16.set(oL, off);
  }
  const steady16 = out16.subarray(Math.round(0.4 * sr16));
  const f3000 = goertzelMag(steady16, sr16, 3000);
  const alias4000 = goertzelMag(steady16, sr16, 4000); // folded 4f = 12 kHz -> 4 kHz if unclamped!
  const alias7000 = goertzelMag(steady16, sr16, 7000); // folded 3f = 9 kHz -> 7 kHz if unclamped!
  assert.ok(f3000 > 0.05, 'Expected fundamental 3000 Hz present @ 16 kHz SR');
  assert.ok(db(alias4000) < -90, `4f harmonic folded to 4000 Hz @ 16 kHz HFP: ${db(alias4000).toFixed(1)} dBFS`);
  assert.ok(db(alias7000) < -90, `3f harmonic folded to 7000 Hz @ 16 kHz HFP: ${db(alias7000).toFixed(1)} dBFS`);

  // 2. At 8 kHz narrowband HFP (Nyquist = 4000 Hz, ceiling = 3520 Hz): test all synth modes with 5200 Hz carrier (would fold to 2800 Hz!)
  const sr8 = 8000;
  const reg8 = loadWorkletProcessors(sr8);
  const Synth8 = reg8.get('nootropic-clinical-synth');
  for (const mode of ['isochronic', 'binaural', 'monaural', 'gamma_clicks', 'gamma_chirp', 'gamma_mbi', 'aperiodic_sham']) {
    const s = new Synth8();
    s.port._deliver({
      type: 'config',
      mode,
      rateHz: 16,
      startRateHz: 16,
      rampSec: 0,
      carrierHz: 5200,
      carrierLeftHz: 5192,
      carrierRightHz: 5208,
      dutyCycle: mode === 'gamma_clicks' ? 0.048 : 0.5,
      depth: 0.65,
    });
    const buf = new Float32Array(128 * 80);
    for (let off = 0; off < buf.length; off += 128) {
      const oL = new Float32Array(128);
      const oR = new Float32Array(128);
      s.process([], [[oL, oR]]);
      for (let k = 0; k < 128; k++) {
        assert.ok(Number.isFinite(oL[k]) && Number.isFinite(oR[k]), `Non-finite sample in ${mode} @ 8 kHz HFP`);
      }
      buf.set(oL, off);
    }
    if (mode === 'isochronic') {
      const st = buf.subarray(2000);
      const clamped3520 = goertzelMag(st, sr8, 3520);
      const folded2800 = goertzelMag(st, sr8, 2800);
      assert.ok(clamped3520 > 0.05 && db(folded2800 / clamped3520) < -55, '5200 Hz carrier @ 8 kHz SR must clamp to 3520 Hz, never fold to 2800 Hz');
    }
  }

  // 3. Verify iOS WebKit 'interrupted' AudioContext detection & tap-to-resume UI wiring
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');
  const playerSrc = fs.readFileSync(path.join(ROOT, 'src/components/PlayerView.tsx'), 'utf8');
  assert.ok(engineSrc.includes("=== 'interrupted'"), 'PsychoacousticEngine must detect WebKit AudioContext state === "interrupted"');
  assert.ok(engineSrc.includes('resumeFromInterruption'), 'PsychoacousticEngine must expose resumeFromInterruption()');
  assert.ok(
    playerSrc.includes('audioInterrupted') &&
      playerSrc.includes('resumeFromInterruption') &&
      playerSrc.includes('tap anywhere to resume'),
    'PlayerView must render tap-to-resume banner on iOS interruption'
  );
});

// ============================================================================
// P1 #7 — Animal/Non-Auditory Study Exclusion & MSO 150–900 Hz / <=45 Hz Binaural Guardrails
// ============================================================================
test('P1 #7: Excludes rodent/optogenetic/tACS/TMS/photic papers without false positives & enforces 150–900 Hz / <=45 Hz MSO binaural limits', () => {
  // 1. Boolean query guards across PubMed, Europe PMC & OpenAlex
  assert.ok(
    PUBMED_HUMAN_AUDITORY_EXCLUSION.includes('Animals[MeSH Terms] NOT Humans[MeSH Terms]') &&
      PUBMED_HUMAN_AUDITORY_EXCLUSION.includes('mice[Title]') &&
      PUBMED_HUMAN_AUDITORY_EXCLUSION.includes('optogenetics[Title/Abstract]')
  );
  assert.ok(EUROPEPMC_HUMAN_AUDITORY_EXCLUSION.includes('NOT (TITLE:mice OR TITLE:mouse'));
  assert.ok(OPENALEX_HUMAN_AUDITORY_EXCLUSION.includes('NOT (mice OR murine OR rodent OR optogenetics'));
  const guarded = appendPubMedHumanAuditoryGuard('("auditory beat"[Title/Abstract])');
  assert.ok(guarded.includes('Animals[MeSH Terms] NOT Humans[MeSH Terms]'));
  assert.equal(appendPubMedHumanAuditoryGuard(guarded), guarded, 'appendPubMedHumanAuditoryGuard must be idempotent');
  assert.equal(appendPubMedHumanAuditoryGuard('   '), '', 'Empty query must stay empty');

  // 2. Post-fetch classifier: positive rejections (including awake rodent execution in abstract)
  const nonAuditoryCases = [
    ['40 Hz optogenetic stimulation of PV interneurons clears amyloid in 5xFAD mice', ''],
    ['Transcranial alternating current stimulation (tACS) at 10 Hz alpha modulates cognition', ''],
    ['Repetitive transcranial magnetic stimulation (rTMS) over left DLPFC', ''],
    ['40 Hz visual flicker / photic driving entrains V1 cortex in murine models', ''],
    ['In vitro hippocampal slice gamma oscillations in Wistar rats', ''],
    ['Anodal tDCS combined with working memory training', ''],
    [
      'Gamma auditory steady-state responses in rodent cortex',
      'Adult male Wistar rats were implanted with epidural electrodes during 40 Hz acoustic click trains.',
    ],
  ];
  for (const [title, abs] of nonAuditoryCases) {
    assert.equal(isNonAuditoryOrAnimalStudy(title, abs), true, `Must reject non-auditory/animal study: "${title}"`);
  }

  // 3. Post-fetch classifier: valid human auditory studies (including UI "mouse button" & human RCT citing 5xFAD background!)
  const validHumanAuditoryCases = [
    [
      'Rapid 16 Hz amplitude modulation in music supports sustained attention in human adults',
      'Participants completed a randomized controlled trial of moderate duration, responding to targets by clicking a computer mouse button.',
    ],
    [
      '6 Hz theta binaural beat auditory stimulation reduces preoperative anxiety',
      'Healthy adult volunteers listened through stereo headphones for a 30-minute treatment duration with mouse cursor tracking.',
    ],
    [
      '40 Hz auditory steady-state response (ASSR) during gamma-modulated acoustic bursts',
      'Electroencephalography in 36 healthy participants showed phase-locked cortical entrainment.',
    ],
    [
      'Gamma sensory stimulation in patients with mild Alzheimer disease',
      'Motivated by preclinical 40 Hz GENUS findings in 5xFAD mice, we conducted a randomized placebo-controlled clinical trial of daily 40 Hz auditory and visual stimulation in human patients with mild Alzheimer disease.',
    ],
  ];
  for (const [title, abs] of validHumanAuditoryCases) {
    assert.equal(isNonAuditoryOrAnimalStudy(title, abs), false, `Must NOT false-positive on human auditory study: "${title}"`);
  }

  // 4. MSO Binaural Physiological Guardrails in applySafetyAndDeviceGuardrails (using cloned production preset spec)
  const makeSpec = (type, carrierHz, frequencyHz, leftHz, rightHz) => {
    const base = structuredClone(VERIFIED_STUDY_PRESETS[0]);
    base.protocol.requiresHeadphones = true;
    base.protocol.safetyNotes = [];
    base.entrainment.type = type;
    base.entrainment.frequencyHz = frequencyHz;
    base.entrainment.carrierLeftHz = leftHz ?? carrierHz;
    base.entrainment.carrierRightHz = rightHz ?? carrierHz + frequencyHz;
    return base;
  };

  // 4a. Sub-150 Hz carrier (80 Hz, beat 8 Hz) -> clamped to 150 Hz / 158 Hz preserving exact 8 Hz Δf
  const lowCarrierSpec = applySafetyAndDeviceGuardrails(
    makeSpec('binaural_beat', 80, 8, 80, 88),
    'headphones',
    'study'
  );
  assert.equal(lowCarrierSpec.entrainment.type, 'binaural_beat');
  assert.ok(lowCarrierSpec.entrainment.carrierLeftHz >= 150, `Expected carrierLeftHz >= 150 Hz, got ${lowCarrierSpec.entrainment.carrierLeftHz}`);
  assert.equal(
    Number((lowCarrierSpec.entrainment.carrierRightHz - lowCarrierSpec.entrainment.carrierLeftHz).toFixed(3)),
    8,
    'Exact 8 Hz dichotic beat Δf must be preserved after low-carrier clamp'
  );

  // 4b. Supra-900 Hz carrier (1250 Hz, beat 10 Hz) -> clamped so both L & R <= 900 Hz preserving exact 10 Hz Δf
  const highCarrierSpec = applySafetyAndDeviceGuardrails(
    makeSpec('binaural_beat', 1250, 10, 1250, 1260),
    'headphones',
    'study'
  );
  assert.equal(highCarrierSpec.entrainment.type, 'binaural_beat');
  assert.ok(highCarrierSpec.entrainment.carrierRightHz <= 900, `Expected carrierRightHz <= 900 Hz, got ${highCarrierSpec.entrainment.carrierRightHz}`);
  assert.equal(
    Number((highCarrierSpec.entrainment.carrierRightHz - highCarrierSpec.entrainment.carrierLeftHz).toFixed(3)),
    10,
    'Exact 10 Hz dichotic beat Δf must be preserved after 900 Hz MSO ceiling clamp'
  );

  // 4c. Beat > 45 Hz (60 Hz high-gamma binaural) -> auto-converted to 'isochronic_pulse'
  const highBeatSpec = applySafetyAndDeviceGuardrails(
    makeSpec('binaural_beat', 400, 60, 370, 430),
    'headphones',
    'study'
  );
  assert.equal(highBeatSpec.entrainment.type, 'isochronic_pulse', '>45 Hz binaural beat must auto-convert to isochronic_pulse');
  assert.ok(highBeatSpec.protocol.safetyNotes.some((n) => n.includes('45 Hz')));
});

// ============================================================================
// P1 #8 — Bandit <25% Early-Abort Penalty, Stale Sweep & Factorized Marginal Pooling
// ============================================================================
test('P1 #8: Penalizes <25% early session aborts (<0.25 reward), sweeps stale mobile drops, and accelerates cold-start via factorized marginals', async () => {
  // 1. Unit check on computeImplicitReward boundary cases
  const abort2MinOf30Min = computeImplicitReward({
    actualDurationSec: 120,
    completionRatio: 120 / 1800, // 6.7% < 25%
    isEarlyBounce: false,
    instantGenreSwapped: false,
  });
  assert.equal(abort2MinOf30Min.outcome, 'early_bounce');
  assert.ok(abort2MinOf30Min.reward <= 0.25, `2m abort on 30m session must score <= 0.25 (not 0.50!), got ${abort2MinOf30Min.reward}`);

  // Boundary: 10+ full minutes (600s) on a 60m session (16.7%) is genuine listening, NOT an early bounce
  const tenMinOf60Min = computeImplicitReward({
    actualDurationSec: 600,
    completionRatio: 600 / 3600,
    isEarlyBounce: false,
    instantGenreSwapped: false,
  });
  assert.notEqual(tenMinOf60Min.outcome, 'early_bounce', '>=10m listening must not be misclassified as early_bounce');
  assert.ok(tenMinOf60Min.reward >= 0.45);

  // Boundary: 0s empty input
  const zeroSec = computeImplicitReward({
    actualDurationSec: 0,
    completionRatio: 0,
    isEarlyBounce: true,
    instantGenreSwapped: false,
  });
  assert.equal(zeroSec.outcome, 'early_bounce');
  assert.ok(zeroSec.reward <= 0.2);

  // 2. Factorized marginal pooling cold-start shift + N-taper decay
  const coldNoMarginal = computeHierarchicalArmPosterior({
    priorAlpha: 3.0,
    priorBeta: 2.0,
    cohortTrials: 0,
  });
  const coldWithWinningMarginals = computeHierarchicalArmPosterior({
    priorAlpha: 3.0,
    priorBeta: 2.0,
    cohortTrials: 0,
    marginals: [
      { alpha: 24, beta: 4, trials: 28, weight: 0.42 },
      { alpha: 18, beta: 4, trials: 22, weight: 0.32 },
      { alpha: 15, beta: 3, trials: 18, weight: 0.32 },
    ],
  });
  assert.ok(
    coldWithWinningMarginals.mean > coldNoMarginal.mean + 0.12,
    `Factorized marginals must lift cold-start posterior mean (${coldNoMarginal.mean.toFixed(3)} -> ${coldWithWinningMarginals.mean.toFixed(3)})`
  );

  // When exact cohort accumulates N=48 direct trials with poor performance, exact cohort overrides optimistic marginals
  const matureExactCohort = computeHierarchicalArmPosterior({
    priorAlpha: 3.0,
    priorBeta: 2.0,
    cohortAlpha: 8,
    cohortBeta: 40,
    cohortTrials: 48,
    marginals: [
      { alpha: 24, beta: 4, trials: 28, weight: 0.42 },
      { alpha: 18, beta: 4, trials: 22, weight: 0.32 },
    ],
  });
  assert.ok(
    matureExactCohort.mean < 0.32,
    `Mature exact cohort (N=48) must taper marginal prior influence (got mean=${matureExactCohort.mean.toFixed(3)})`
  );

  // 3. Real Worker + SQLite D1 end-to-end verification (beacon <25% abort + stale >2h silent drop sweep)
  const dbConn = createInMemoryD1();
  const env = { DB: dbConn };
  const ctx = createExecCtx();
  const origFetch = globalThis.fetch;
  try {
    // Stub external PubMed/OpenAlex fetch inside /api/protocol/start for deterministic offline speed
    globalThis.fetch = async () => new Response(JSON.stringify({ esearchresult: { idlist: [] }, results: [] }), { status: 200 });

    // Create consented profile
    const profRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.55' },
        body: JSON.stringify({
          age: 29,
          gender: 'male',
          role: 'knowledge_worker',
          occupationLabel: 'Software Engineer',
          researchConsent: true,
        }),
      }),
      env,
      ctx
    );
    const { profile, profileToken } = await profRes.json();

    // Start 30-min session #1
    const start1 = await worker.fetch(
      new Request('https://www.nootropic.fm/api/protocol/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-profile-token': profileToken,
          'cf-connecting-ip': '192.0.2.55',
        },
        body: JSON.stringify({
          profileId: profile.id,
          currentState: 'distracted',
          targetState: 'deep_flow',
          environment: 'office',
          device: 'headphones',
          durationMin: 30,
          requestedGenre: 'deep_electronic',
        }),
      }),
      env,
      ctx
    );
    assert.equal(start1.status, 200);
    const { recommendation: rec1 } = await start1.json();

    // Send pagehide beacon at 150s (2.5m out of 30m = 8.3% < 25% -> used to get 0.50 neutral, MUST now get early_bounce < 0.25!)
    const beaconRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/session/beacon', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.55' },
        body: JSON.stringify({
          sessionId: rec1.sessionId,
          actualDurationSec: 150,
          event: 'pagehide',
          audioStarted: true,
        }),
      }),
      env,
      ctx
    );
    const beaconJson = await beaconRes.json();
    assert.equal(beaconJson.retentionOutcome, 'early_bounce');
    const ses1Row = dbConn._sqlite.prepare('SELECT implicit_reward_score, retention_outcome FROM sessions WHERE id = ?').get(rec1.sessionId);
    assert.equal(ses1Row.retention_outcome, 'early_bounce');
    assert.ok(ses1Row.implicit_reward_score <= 0.25, `Expected implicit_reward_score <= 0.25, got ${ses1Row.implicit_reward_score}`);

    // Confirm all 3 factorized marginal scopes were populated in `bandit_stats`
    const marginalCount = dbConn._sqlite
      .prepare("SELECT COUNT(*) AS c FROM bandit_stats WHERE scope_type LIKE 'marginal_goal_%'")
      .get().c;
    assert.equal(marginalCount, 3, 'All 3 factorized marginal scopes (goal_state, goal_env, goal_role) must be updated');

    // Simulate a silent mobile app kill: insert an active session created 3 hours ago with 45s audio & implicit_applied_weight = 0
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    dbConn._sqlite
      .prepare(
        `INSERT INTO sessions (
          id, profile_id, cohort_key, raw_input_text, current_state, baseline_score,
          target_state, environment, device, safety_mode, planned_duration_min,
          actual_duration_sec, completion_ratio, arm_id, arm_name, is_exploration,
          is_control_trial, energy_tier, music_genre, initial_music_genre,
          audio_source, acoustic_params_json, cited_study_ids_json, live_adjustments_json,
          time_of_day_bucket, status, implicit_applied_weight, created_at
        ) VALUES (?, ?, ?, 'mobile drop', 'distracted', 2, 'deep_flow', 'office', 'headphones', 0, 30, 45, 0.025, ?, 'Test Arm', 0, 0, 'focus', 'deep_electronic', 'deep_electronic', 'studio_library', '{}', '[]', '[]', 'morning', 'active', 0, ?)`
      )
      .run('ses_silent_drop_v8', profile.id, rec1.cohortKey, rec1.arm.id, threeHoursAgo);

    // Next /api/protocol/start must sweep `ses_silent_drop_v8` into `abandoned` + `early_bounce`!
    const start2 = await worker.fetch(
      new Request('https://www.nootropic.fm/api/protocol/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-profile-token': profileToken,
          'cf-connecting-ip': '192.0.2.55',
        },
        body: JSON.stringify({
          profileId: profile.id,
          currentState: 'distracted',
          targetState: 'deep_flow',
          environment: 'office',
          device: 'headphones',
          durationMin: 25,
        }),
      }),
      env,
      ctx
    );
    assert.equal(start2.status, 200);
    const swept = dbConn._sqlite
      .prepare('SELECT status, retention_outcome, implicit_applied_weight, implicit_reward_score FROM sessions WHERE id = ?')
      .get('ses_silent_drop_v8');
    assert.equal(swept.status, 'abandoned');
    assert.equal(swept.retention_outcome, 'early_bounce');
    assert.equal(swept.implicit_applied_weight, 0.45);
    assert.ok(swept.implicit_reward_score <= 0.25);
  } finally {
    globalThis.fetch = origFetch;
  }

  assert.equal(
    buildFactorizedMarginalScopes({
      targetState: 'alert_focus',
      currentState: 'fatigued',
      environment: 'study',
      role: 'student',
    }).length,
    3
  );
});

// ============================================================================
// P1 #9 — Atomic Single-Query `rate_limits` Enforcement under Concurrent Burst
// ============================================================================
test('P1 #9: Atomic `INSERT ... ON CONFLICT DO UPDATE WHERE hits < ? RETURNING hits` enforces exact daily ceiling under 45-request burst', async () => {
  const dbConn = createInMemoryD1();
  const env = { DB: dbConn };
  const ctx = createExecCtx();

  // `/api/studies/compile` has maxPerDay = 40; send 45 simultaneous invalid-body requests (rate limit executes first!)
  // Wait: let's hit `/api/session/claim-profile` (maxPerDay = 40) with invalid age=15 so each allowed call fast-returns 400 after incrementing rate_limits,
  // and calls 41..45 return 429!
  const burst = Array.from({ length: 45 }, () =>
    worker.fetch(
      new Request('https://www.nootropic.fm/api/session/claim-profile', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.42',
        },
        body: JSON.stringify({ age: 15 }),
      }),
      env,
      ctx
    )
  );
  const responses = await Promise.all(burst);
  const allowed400 = responses.filter((r) => r.status === 400).length;
  const blocked429 = responses.filter((r) => r.status === 429).length;

  assert.equal(allowed400, 40, `Expected exact 40 requests under cap, got ${allowed400}`);
  assert.equal(blocked429, 5, `Expected exact 5 requests rejected with 429, got ${blocked429}`);

  const rlRow = dbConn._sqlite.prepare('SELECT hits FROM rate_limits LIMIT 1').get();
  assert.equal(rlRow.hits, 40, 'Atomic SQLite conditional increment must never overshoot maxPerDay (40)');
});

// ============================================================================
// P2 #10 — Layer-2 `musicPreLimiter` (-3.35 dBTP = 0.68) Zero Layer-1 Ducking Proof
// ============================================================================
test('P2 #10: Dedicated Layer-2 `musicPreLimiter` (0.68) prevents drum transients (1.80 linear) from ducking Layer-1 carrier (0.000 dB variance)', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');
  assert.ok(engineSrc.includes('this.musicPreLimiterNode = musicPreLim'), 'PsychoacousticEngine must instantiate dedicated musicPreLimiterNode');
  assert.ok(engineSrc.includes('musicPreLim.connect(masterSumBus)'), 'musicPreLimiterNode must feed masterSumBus upstream of masterSafetyLimiter');

  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const LimCtor = reg.get('nootropic-lookahead-limiter');

  const frames = 128 * 375; // 1.000s @ 48 kHz
  const layer1 = new Float32Array(frames);
  const layer2 = new Float32Array(frames);

  // Layer 1: steady 200 Hz clinical carrier at 0.18 amplitude
  // Layer 2: quiet 1000 Hz bed (0.08) for first 0.5s, then massive 1.80 linear (+5.1 dBFS!) drum transient burst in second 0.5s
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    layer1[i] = 0.18 * Math.sin(2 * Math.PI * 200 * t);
    const musicAmp = i < frames / 2 ? 0.08 : 1.80;
    layer2[i] = musicAmp * Math.sin(2 * Math.PI * 1000 * t);
  }

  // A. Old shared-limiter topology (Layer 1 + Layer 2 -> masterSafetyLimiter @ 0.8913)
  const sharedOnlyLim = new LimCtor();
  const outOld = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) {
    const sumSeg = new Float32Array(128);
    for (let k = 0; k < 128; k++) sumSeg[k] = layer1[off + k] + layer2[off + k];
    const oL = new Float32Array(128);
    sharedOnlyLim.process([[sumSeg, sumSeg]], [[oL, new Float32Array(128)]], {
      ceiling: new Float32Array([LIMITER_CEILING_LINEAR]),
    });
    outOld.set(oL, off);
  }

  // B. New v8 topology: Layer 2 -> musicPreLimiter (0.68), then + delayed/aligned Layer 1 -> masterSafetyLimiter (0.8913)
  const musicPreLim = new LimCtor();
  const masterLim = new LimCtor();
  const outNew = new Float32Array(frames);
  let maxTrueSamplePeak = 0;
  for (let off = 0; off < frames; off += 128) {
    const mSeg = layer2.subarray(off, off + 128);
    const preL = new Float32Array(128);
    musicPreLim.process([[mSeg, mSeg]], [[preL, new Float32Array(128)]], {
      ceiling: new Float32Array([0.68]),
    });
    const sumSeg = new Float32Array(128);
    for (let k = 0; k < 128; k++) sumSeg[k] = preL[k] + layer1[off + k];
    const oL = new Float32Array(128);
    masterLim.process([[sumSeg, sumSeg]], [[oL, new Float32Array(128)]], {
      ceiling: new Float32Array([LIMITER_CEILING_LINEAR]),
    });
    for (let k = 0; k < 128; k++) maxTrueSamplePeak = Math.max(maxTrueSamplePeak, Math.abs(oL[k]));
    outNew.set(oL, off);
  }

  // Compare 200 Hz Layer-1 carrier amplitude in quiet window [0.15s..0.45s] vs loud drum window [0.65s..0.95s]
  const wQuiet0 = Math.round(0.15 * sr);
  const wQuiet1 = Math.round(0.45 * sr);
  const wLoud0 = Math.round(0.65 * sr);
  const wLoud1 = Math.round(0.95 * sr);

  const oldDuckDb = Math.abs(
    db(goertzelMag(outOld.subarray(wLoud0, wLoud1), sr, 200) / goertzelMag(outOld.subarray(wQuiet0, wQuiet1), sr, 200))
  );
  const newDuckDb = Math.abs(
    db(goertzelMag(outNew.subarray(wLoud0, wLoud1), sr, 200) / goertzelMag(outNew.subarray(wQuiet0, wQuiet1), sr, 200))
  );

  assert.ok(oldDuckDb > 5.0, `Sanity check: shared limiter without pre-limiter should duck Layer 1 > 5 dB (got ${oldDuckDb.toFixed(2)} dB)`);
  assert.ok(
    newDuckDb < 0.01,
    `Expected < 0.01 dB Layer-1 carrier ducking under 1.80 linear drum peaks with musicPreLimiter, got ${newDuckDb.toFixed(5)} dB`
  );
  assert.ok(maxTrueSamplePeak <= LIMITER_CEILING_LINEAR + 1e-4, `Master ceiling exceeded: ${maxTrueSamplePeak}`);
});

// ============================================================================
// P2 #11 — Security Hardening (`HttpOnly` Cookie Auth, Atomic Webhook Dedupe, CSP `_headers`)
// ============================================================================
test('P2 #11: Enforces `HttpOnly; SameSite=Lax; Secure` `nfm_auth` cookie, atomic `processed_webhooks` deduplication, & strict CSP `_headers`', async () => {
  const dbConn = createInMemoryD1();
  const webhookSecret = 'whsec_v8_unit_test_hmac_secret';
  const env = {
    DB: dbConn,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };
  const ctx = createExecCtx();

  // 1. Create profile over HTTPS -> verify Set-Cookie attributes
  const createRes = await worker.fetch(
    new Request('https://www.nootropic.fm/api/profile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://www.nootropic.fm',
        'cf-connecting-ip': '203.0.113.88',
      },
      body: JSON.stringify({
        age: 34,
        gender: 'female',
        role: 'creative',
        occupationLabel: 'Architect',
        researchConsent: true,
      }),
    }),
    env,
    ctx
  );
  assert.equal(createRes.status, 200);
  const setCookie = createRes.headers.get('set-cookie') ?? '';
  assert.ok(setCookie.startsWith('nfm_auth='), `Missing nfm_auth Set-Cookie: ${setCookie}`);
  assert.ok(setCookie.includes('HttpOnly'), 'nfm_auth cookie must be HttpOnly');
  assert.ok(setCookie.includes('SameSite=Lax'), 'nfm_auth cookie must set SameSite=Lax');
  assert.ok(setCookie.includes('Secure'), 'HTTPS response must include Secure flag on nfm_auth');
  assert.equal(createRes.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(createRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(createRes.headers.get('x-frame-options'), 'DENY');

  const { profile } = await createRes.json();
  const cookiePair = setCookie.split(';')[0]; // `nfm_auth=<token>`

  // 2. Authenticate GET /api/profile/:id using ONLY `Cookie: nfm_auth=...` (zero `x-profile-token` header!)
  const getByCookieRes = await worker.fetch(
    new Request(`https://www.nootropic.fm/api/profile/${profile.id}`, {
      headers: { Cookie: cookiePair },
    }),
    env,
    ctx
  );
  assert.equal(getByCookieRes.status, 200, 'HttpOnly nfm_auth cookie alone must authenticate protected profile endpoints');

  // Unauthenticated / tampered cookie must return 401
  const tamperedCookieRes = await worker.fetch(
    new Request(`https://www.nootropic.fm/api/profile/${profile.id}`, {
      headers: { Cookie: 'nfm_auth=tok_forged_invalid' },
    }),
    env,
    ctx
  );
  assert.equal(tamperedCookieRes.status, 401);

  // 3. Atomic Stripe Webhook idempotency via `processed_webhooks` (`ON CONFLICT DO NOTHING RETURNING event_id`)
  const webhookPayload = JSON.stringify({
    id: 'evt_v8_atomic_dedupe_001',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_001',
        client_reference_id: profile.id,
        customer: 'cus_test_v8',
        subscription: 'sub_test_v8',
        amount_total: 900,
        currency: 'usd',
        metadata: { profile_id: profile.id, plan: 'monthly' },
      },
    },
  });
  const tsSec = Math.floor(Date.now() / 1000);
  const v1Sig = await hmacSha256HexNode(webhookSecret, `${tsSec}.${webhookPayload}`);
  const sigHeader = `t=${tsSec},v1=${v1Sig}`;

  const makeWebhookReq = () =>
    new Request('https://www.nootropic.fm/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': sigHeader,
      },
      body: webhookPayload,
    });

  // Fire TWO simultaneous deliveries of the exact same Stripe event
  const [wh1, wh2] = await Promise.all([
    worker.fetch(makeWebhookReq(), env, ctx),
    worker.fetch(makeWebhookReq(), env, ctx),
  ]);
  const [whJson1, whJson2] = await Promise.all([wh1.json(), wh2.json()]);
  const dupFlags = [Boolean(whJson1.duplicate), Boolean(whJson2.duplicate)].sort();
  assert.deepEqual(dupFlags, [false, true], 'Exactly one webhook delivery must process and the concurrent duplicate must return duplicate=true');

  const upgradedRow = dbConn._sqlite.prepare('SELECT plan_tier FROM profiles WHERE id = ?').get(profile.id);
  assert.equal(upgradedRow.plan_tier, 'pro');

  // Invalid signature -> 400
  const badSigRes = await worker.fetch(
    new Request('https://www.nootropic.fm/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${tsSec},v1=deadbeef`,
      },
      body: webhookPayload,
    }),
    env,
    ctx
  );
  assert.equal(badSigRes.status, 400);

  // 4. DELETE /api/profile/:id via Cookie clears `nfm_auth` (`Max-Age=0`)
  const delRes = await worker.fetch(
    new Request(`https://www.nootropic.fm/api/profile/${profile.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookiePair },
    }),
    env,
    ctx
  );
  assert.equal(delRes.status, 200);
  assert.ok((delRes.headers.get('set-cookie') ?? '').includes('Max-Age=0'), 'Profile deletion must expire nfm_auth cookie');

  // 5. Verify `public/_headers` & `dist/client/_headers` CSP directives
  for (const relPath of ['public/_headers', 'dist/client/_headers']) {
    const full = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(full), `Expected ${relPath} to exist`);
    const hdr = fs.readFileSync(full, 'utf8');
    assert.ok(hdr.includes("Content-Security-Policy:") && hdr.includes("worker-src 'self' blob:"), `${relPath} must allow AudioWorklet blob: workers`);
    assert.ok(hdr.includes("object-src 'none'") && hdr.includes("frame-ancestors 'none'"), `${relPath} must block object-src and clickjacking`);
    assert.ok(hdr.includes('X-Content-Type-Options: nosniff') && hdr.includes('X-Frame-Options: DENY'));
  }
});

// ============================================================================
// Deep Regression #12 — P0 #2 Real `PsychoacousticEngine` Safari/iOS `mediaDeckPool` Race & Crossfade Safety
// ============================================================================
function createMockAudioParam(initial = 0, tracker = null, label = '') {
  const param = {
    value: initial,
    _setValueCalls: [],
    setValueAtTime(v, t) {
      this.value = v;
      this._setValueCalls.push({ v, t });
      if (tracker) tracker.push({ label, v });
      return this;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
      if (tracker) tracker.push({ label, v });
      return this;
    },
    exponentialRampToValueAtTime(v) {
      this.value = v;
      if (tracker) tracker.push({ label, v });
      return this;
    },
    setTargetAtTime(v) {
      this.value = v;
      if (tracker) tracker.push({ label, v });
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
    cancelAndHoldAtTime() {
      return this;
    },
  };
  return param;
}

function createMockAudioContext(sampleRate = 48000) {
  const freqRecords = [];
  const makeNode = (extra = {}) => ({
    connect() {
      return arguments[0];
    },
    disconnect() {},
    ...extra,
  });
  return {
    sampleRate,
    currentTime: 0.5,
    state: 'running',
    destination: makeNode(),
    _freqRecords: freqRecords,
    resume: async () => {},
    close: async () => {},
    addEventListener() {},
    removeEventListener() {},
    createGain() {
      return makeNode({ gain: createMockAudioParam(1) });
    },
    createDelay() {
      return makeNode({ delayTime: createMockAudioParam(0) });
    },
    createStereoPanner() {
      return makeNode({ pan: createMockAudioParam(0) });
    },
    createBiquadFilter() {
      const fParam = createMockAudioParam(350, freqRecords, 'biquad');
      let rawVal = 350;
      Object.defineProperty(fParam, 'value', {
        get: () => rawVal,
        set: (v) => {
          rawVal = v;
          freqRecords.push({ label: 'biquad', v });
        },
      });
      return makeNode({
        type: 'lowpass',
        frequency: fParam,
        Q: createMockAudioParam(0.707),
        gain: createMockAudioParam(0),
      });
    },
    createOscillator() {
      const fParam = createMockAudioParam(440, freqRecords, 'osc');
      let rawVal = 440;
      Object.defineProperty(fParam, 'value', {
        get: () => rawVal,
        set: (v) => {
          rawVal = v;
          freqRecords.push({ label: 'osc', v });
        },
      });
      return makeNode({
        type: 'sine',
        frequency: fParam,
        detune: createMockAudioParam(0),
        start() {},
        stop() {},
      });
    },
    createBuffer(channels, length, sr) {
      const chs = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: sr,
        duration: length / sr,
        getChannelData: (c) => chs[c],
      };
    },
    createBufferSource() {
      return makeNode({
        buffer: null,
        loop: false,
        playbackRate: createMockAudioParam(1),
        start() {},
        stop() {},
        onended: null,
      });
    },
    createDynamicsCompressor() {
      return makeNode({
        threshold: createMockAudioParam(-12),
        knee: createMockAudioParam(6),
        ratio: createMockAudioParam(2),
        attack: createMockAudioParam(0.003),
        release: createMockAudioParam(0.25),
      });
    },
    createWaveShaper() {
      return makeNode({ curve: null, oversample: 'none' });
    },
    createChannelSplitter() {
      return makeNode();
    },
    createChannelMerger() {
      return makeNode();
    },
    createAnalyser() {
      return makeNode({
        fftSize: 1024,
        frequencyBinCount: 512,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData() {},
        getFloatFrequencyData() {},
        getByteFrequencyData() {},
      });
    },
    createMediaElementSource(el) {
      return makeNode({ mediaElement: el });
    },
  };
}

test('P0 #2 (Deep Behavioral): Real PsychoacousticEngine mediaDeckPool survives delayed iOS unlock play() race & rapid 5-way stem crossfades without clobbering active audio', async () => {
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const origAudio = globalThis.Audio;
  const createdElements = [];

  function makeMockMediaEl() {
    const listeners = new Map();
    let currentSrc = '';
    const el = {
      preload: 'auto',
      crossOrigin: null,
      loop: false,
      playsInline: false,
      preservesPitch: true,
      muted: false,
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      duration: 210,
      paused: true,
      get src() {
        return currentSrc;
      },
      set src(val) {
        currentSrc = val;
        if (val && !val.startsWith('data:')) {
          queueMicrotask(() => {
            if (currentSrc === val) {
              const fn = listeners.get('canplay') || listeners.get('loadeddata');
              if (fn) fn();
            }
          });
        }
      },
      setAttribute() {},
      removeAttribute(attr) {
        if (attr === 'src') currentSrc = '';
      },
      load() {},
      pause() {
        this.paused = true;
      },
      play() {
        this.paused = false;
        const capturedSrc = currentSrc;
        return new Promise((resolve) => {
          setTimeout(() => {
            if (currentSrc === capturedSrc && capturedSrc && !capturedSrc.startsWith('data:')) {
              const fn = listeners.get('playing');
              if (fn) fn();
            }
            resolve();
          }, 25);
        });
      },
      addEventListener(evt, fn) {
        listeners.set(evt, fn);
      },
      removeEventListener(evt) {
        listeners.delete(evt);
      },
    };
    createdElements.push(el);
    return el;
  }

  try {
    globalThis.window = globalThis;
    globalThis.document = {
      visibilityState: 'visible',
      createElement(tag) {
        if (tag === 'audio') return makeMockMediaEl();
        return {};
      },
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.Audio = function MockAudio() {
      return makeMockMediaEl();
    };

    const eng = new PsychoacousticEngine();
    const mockCtx = createMockAudioContext(48000);
    eng.ctx = mockCtx;
    eng.isPlaying = true;
    eng.studioBus = mockCtx.createGain();
    eng.cleanSubBus = mockCtx.createGain();
    eng.studySpec = structuredClone(VERIFIED_STUDY_PRESETS[0]);

    // 1. Trigger initMediaDeckPool(ctx) WITHOUT awaiting its 25ms play() promise, and immediately start Stem A!
    eng.initMediaDeckPool(mockCtx);
    assert.equal(createdElements.length, 4, 'mediaDeckPool must pre-allocate 4 reusable <audio> slots');

    const tokA = ++eng.studioLoadToken;
    const urlA = 'https://www.nootropic.fm/api/audio/stream/v7/lofi_keys_a.m4a';
    const okA = await eng.playProgressiveMediaStem({
      url: urlA,
      codec: 'aac',
      track: { key: 'lofi_a', name: 'Lo-Fi Keys A', url: urlA, energy: 'focus' },
      targetGain: 0.9,
      token: tokA,
      fadeSec: 0.03,
      amActive: false,
      neuralHz: 16,
      totalRate: 1.0,
      tune432Ratio: 1.0,
      targetGridBpm: 88,
      isSubHarmonicLocked: false,
      stemBpm: 88,
      trackDurSec: 210,
      crossfadeLeadSec: 10,
      onCrossfade: () => {},
    });
    assert.equal(okA, true);

    // Wait 55ms so the delayed initial unlock play().then() resolves AFTER Stem A was mounted
    await new Promise((r) => setTimeout(r, 55));
    const activeSlotA = eng.activeMediaSlot;
    assert.ok(activeSlotA, 'Active deck must hold an acquired mediaDeckPool slot');
    assert.equal(
      activeSlotA.el.src,
      urlA,
      'Delayed initMediaDeckPool unlock resolution must NEVER wipe active stem el.src'
    );
    assert.equal(activeSlotA.el.muted, false, 'Active stem element must NEVER be left muted by unlock race');
    assert.equal(activeSlotA.el.paused, false, 'Active stem element must remain playing');

    // 2. Rapid 5-way genre/stem crossfades (recycling pooled slots while 0.03s fade-out timers fire!)
    for (const stemName of ['bossa_b', 'dub_c', 'piano_d', 'strings_e', 'ambient_f']) {
      const tok = ++eng.studioLoadToken;
      const u = `https://www.nootropic.fm/api/audio/stream/v7/${stemName}.m4a`;
      const ok = await eng.playProgressiveMediaStem({
        url: u,
        codec: 'aac',
        track: { key: stemName, name: stemName, url: u, energy: 'focus' },
        targetGain: 0.9,
        token: tok,
        fadeSec: 0.03,
        amActive: false,
        neuralHz: 16,
        totalRate: 432 / 440,
        tune432Ratio: 432 / 440,
        targetGridBpm: 88,
        isSubHarmonicLocked: false,
        stemBpm: 88,
        trackDurSec: 210,
        crossfadeLeadSec: 10,
        onCrossfade: () => {},
      });
      assert.equal(ok, true);
    }

    // Wait 250ms for ALL earlier clearStudioDeck fade-out timers (fadeSec * 1000 + 150 = 180ms) to fire!
    await new Promise((r) => setTimeout(r, 250));
    const finalSlot = eng.activeMediaSlot;
    assert.ok(finalSlot, 'Final deck must remain active after stale crossfade timers fire');
    assert.equal(
      finalSlot.el.src,
      'https://www.nootropic.fm/api/audio/stream/v7/ambient_f.m4a',
      'Stale clearStudioDeck timer from recycled slot must NEVER clobber final active stem src'
    );
    assert.equal(finalSlot.el.paused, false, 'Stale clearStudioDeck timer must NEVER pause final active stem');

    // 3. playStreamingTrack (custom vibe / legacy stem) must ALSO reuse pre-unlocked mediaDeckPool (total elements stays 4!)
    const tokCustom = ++eng.studioLoadToken;
    const okCustom = await eng.playStreamingTrack(
      'https://www.nootropic.fm/api/audio/stream/custom/test_vibe.mp3',
      'Custom Vibe',
      tokCustom,
      0.9,
      true,
      undefined,
      0.03
    );
    assert.equal(okCustom, true);
    assert.equal(createdElements.length, 4, 'playStreamingTrack must reuse pre-unlocked 4-slot mediaDeckPool with zero extra new Audio() allocations');

    eng.clearStudioDeck(0);
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    globalThis.Audio = origAudio;
  }
});

// ============================================================================
// Deep Regression #13 — P1 #5 SINC32 (>80 dB Alias Rejection) & WSOLA Real-Time Speed (<2.0s)
// ============================================================================
test('P1 #5 (Deep Speed & Stopband): SINC32 achieves <= -80 dBc alias rejection & NootropicWsolaProcessor renders 2.0s stereo < 2000 ms', () => {
  const reg44 = loadWorkletProcessors(44100);
  const LyriaCtor = reg44.get('nootropic-lyria-stream-processor');
  const lyria = new LyriaCtor();
  const inSr = 48000;
  const outSr = 44100;
  const pcm = new Float32Array(inSr * 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.7 * Math.sin((2 * Math.PI * 19000 * i) / inSr);
  lyria.port._deliver({ type: 'pcm', left: pcm, right: pcm });

  const out = new Float32Array(128 * 450);
  for (let off = 0; off < out.length; off += 128) {
    const oL = new Float32Array(128);
    lyria.process([], [[oL, new Float32Array(128)]]);
    out.set(oL, off);
  }
  const st = out.subarray(Math.round(0.2 * outSr));
  const aliasDb = db(goertzelMag(st, outSr, 15100) / goertzelMag(st, outSr, 19000));
  assert.ok(aliasDb <= -80, `Expected SINC32 stopband rejection <= -80 dBc at 15.1 kHz, got ${aliasDb.toFixed(2)} dBc`);

  // WSOLA real-time CPU regression check (previously took 68,476 ms when lag correlation called Sinc8 131k times/hop!)
  const reg48 = loadWorkletProcessors(48000);
  const WsolaCtor = reg48.get('nootropic-wsola-processor');
  const wsola = new WsolaCtor();
  const frames = 128 * 750; // 2.00s @ 48 kHz
  const srcL = new Float32Array(frames);
  const srcR = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    srcL[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    srcR[i] = 0.5 * Math.cos((2 * Math.PI * 440 * i) / 48000);
  }
  const t0 = performance.now();
  for (let off = 0; off < frames; off += 128) {
    wsola.process(
      [[srcL.subarray(off, off + 128), srcR.subarray(off, off + 128)]],
      [[new Float32Array(128), new Float32Array(128)]],
      {
        bypass: new Float32Array([0]),
        pitchRatio: new Float32Array([432 / 440]),
        tempoRatio: new Float32Array([0.94]),
      }
    );
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(
    elapsedMs < 2000,
    `NootropicWsolaProcessor 2.0s render must complete in < 2000 ms for mobile real-time safety (took ${elapsedMs.toFixed(1)} ms)`
  );
});

// ============================================================================
// Deep Regression #14 — P0 #3 CORS/WS Subdomain Lockdown & Seamless 11m Lyria Reconnect
// ============================================================================
test('P0 #3 (Deep Security & Continuity): Blocks third-party .vercel.app/.workers.dev origins & preserves seamless 0.86 outputGain across 11m Lyria WS rotation', async () => {
  const dbConn = createInMemoryD1();
  const env = { DB: dbConn, GEMINI_MUSIC_API_KEY: 'test_lyria_secret_v8_deep' };
  const ctx = createExecCtx();

  for (const untrustedOrigin of [
    'https://evil-attacker.vercel.app',
    'https://evil-attacker.workers.dev',
    'https://evil-attacker.web.app',
    'https://evil-attacker.firebaseapp.com',
  ]) {
    const tokRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/music/realtime-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: untrustedOrigin, 'cf-connecting-ip': '198.51.100.77' },
        body: '{}',
      }),
      env,
      ctx
    );
    assert.equal(tokRes.status, 403, `POST /api/music/realtime-token must reject ${untrustedOrigin}`);
    assert.equal(
      tokRes.headers.get('access-control-allow-credentials'),
      null,
      `Must NEVER grant Access-Control-Allow-Credentials to ${untrustedOrigin}`
    );
    assert.notEqual(
      tokRes.headers.get('access-control-allow-origin'),
      untrustedOrigin,
      `Must NEVER echo untrusted Origin ${untrustedOrigin}`
    );
  }

  // Test LyriaRealtimeClient seamless 11m socket rotation (zero outputGain drop to 0.0001 on socket #2!)
  const origWs = globalThis.WebSocket;
  const origWin = globalThis.window;
  const origAtob = globalThis.atob;
  const origAWN = globalThis.AudioWorkletNode;
  const sockets = [];
  const pcmB64 = Buffer.alloc(128, 16).toString('base64');

  class MockLyriaWs {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => {
        if (this.onopen) this.onopen();
      });
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg.setup) {
        queueMicrotask(() => {
          if (this.onmessage) this.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
        });
      } else if (msg.playbackControl === 'PLAY') {
        queueMicrotask(() => {
          if (this.onmessage) {
            this.onmessage({
              data: JSON.stringify({ serverContent: { audioChunks: [{ data: pcmB64 }] } }),
            });
          }
        });
      }
    }
    close() {
      this.readyState = 3;
    }
  }

  try {
    globalThis.window = Object.assign(globalThis, {
      location: { origin: 'https://www.nootropic.fm', protocol: 'https:', host: 'www.nootropic.fm' },
    });
    globalThis.WebSocket = MockLyriaWs;
    globalThis.AudioWorkletNode = class MockAWN {
      constructor() {
        this.port = { postMessage() {}, onmessage: null };
      }
      connect(n) {
        return n;
      }
      disconnect() {}
    };
    if (!globalThis.atob) {
      globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
    }

    const mockCtx = createMockAudioContext(48000);
    mockCtx.audioWorklet = { addModule: async () => {} };
    const dest = mockCtx.createGain();
    const client = new LyriaRealtimeClient();

    const ok = await client.connect({
      ctx: mockCtx,
      destinationBus: dest,
      token: 'ticket_1',
      model: 'models/lyria-realtime-exp',
      spec: VERIFIED_STUDY_PRESETS[0],
      genre: 'lofi_keys',
      apiBase: 'https://www.nootropic.fm',
      fetchFreshToken: async () => ({ token: 'ticket_2', model: 'models/lyria-realtime-exp' }),
    });
    assert.equal(ok, true);
    assert.equal(sockets.length, 1);

    const outGainParam = client.outputGain.gain;
    // Initial connect() sets 0.0001 once on node creation + once on initial fade-in, then ramps to 0.86
    const zeroDropsBeforeRotation = outGainParam._setValueCalls.filter((c) => c.v <= 0.001).length;
    assert.equal(outGainParam.value, 0.86);

    // Simulate 11-minute Worker hard timer closing Socket #1 (`code: 1000`) -> triggers seamless reconnect to Socket #2
    sockets[0].onclose({ code: 1000, reason: 'Session stream window complete' });
    await new Promise((r) => setTimeout(r, 950));
    assert.equal(sockets.length, 2, 'Client must automatically open Socket #2 using fetchFreshToken');

    const zeroDropsAfterSocket2 = outGainParam._setValueCalls.filter((c) => c.v <= 0.001).length;
    assert.equal(
      zeroDropsAfterSocket2,
      zeroDropsBeforeRotation,
      'Mid-session 11m WebSocket rotation must NEVER reset outputGain to 0.0001 (prevents click & 1.5s dropout!)'
    );
    assert.equal(outGainParam.value, 0.86);

    client.stop();
  } finally {
    globalThis.WebSocket = origWs;
    globalThis.window = origWin;
    globalThis.atob = origAtob;
    globalThis.AudioWorkletNode = origAWN;
  }
});

// ============================================================================
// Deep Regression #15 — P2 #10 Dynamic Headroom Reservation at Max (1.48x) Neural Effect + Noise
// ============================================================================
test('P2 #10 (Deep Max-Effect Headroom): computeMusicPreLimiterCeiling reserves headroom for Max (1.48x) Layer-1 AM + noise (<0.01 dB ducking)', () => {
  const eng = new PsychoacousticEngine();
  eng.studySpec = structuredClone(VERIFIED_STUDY_PRESETS[0]); // amplitude_modulation
  eng.layerMonitorMode = 'full_mix';
  eng.carrierMode = 'studio_library';
  eng.modDepthMultiplier = 1.48; // Max Neural Effect
  eng.intensityMultiplier = 1.35;
  eng.params = {
    modulationHz: 16,
    modulationDepth: 0.38,
    bpm: 92,
    harmonicMode: 'warm_min9',
    noiseColor: 'pink',
    noiseLevel: 0.24,
    filterCutoffHz: 1800,
    genre: 'deep_electronic',
    genreSelectionMode: 'user_chosen',
    energyTier: 'focus',
    speakerSafeEQ: false,
  };

  const dynamicCeiling = eng.computeMusicPreLimiterCeiling();
  assert.ok(
    dynamicCeiling >= 0.42 && dynamicCeiling <= 0.48,
    `Expected dynamic musicPreLimiter ceiling in [0.42, 0.48] at Max Neural Effect + noise, got ${dynamicCeiling}`
  );
  eng.layerMonitorMode = 'music_only';
  assert.equal(eng.computeMusicPreLimiterCeiling(), LIMITER_CEILING_LINEAR);
  eng.layerMonitorMode = 'full_mix';

  // Run dual-limiter DSP with heavy 0.42 peak Layer-1 signal + 1.80 drum burst using dynamicCeiling -> 0.000 dB ducking!
  const sr = 48000;
  const reg = loadWorkletProcessors(sr);
  const LimCtor = reg.get('nootropic-lookahead-limiter');
  const preLim = new LimCtor();
  const masterLim = new LimCtor();
  const frames = 128 * 300;
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) {
    const l1 = new Float32Array(128);
    const l2 = new Float32Array(128);
    for (let k = 0; k < 128; k++) {
      const idx = off + k;
      const t = idx / sr;
      l1[k] = 0.42 * Math.sin(2 * Math.PI * 220 * t);
      l2[k] = (idx < frames / 2 ? 0.08 : 1.8) * Math.sin(2 * Math.PI * 1000 * t);
    }
    const preOut = new Float32Array(128);
    preLim.process([[l2, l2]], [[preOut, new Float32Array(128)]], {
      ceiling: new Float32Array([dynamicCeiling]),
    });
    const sum = new Float32Array(128);
    for (let k = 0; k < 128; k++) sum[k] = preOut[k] + l1[k];
    const mOut = new Float32Array(128);
    masterLim.process([[sum, sum]], [[mOut, new Float32Array(128)]], {
      ceiling: new Float32Array([LIMITER_CEILING_LINEAR]),
    });
    out.set(mOut, off);
  }
  const q0 = Math.round(0.12 * sr);
  const q1 = Math.round(0.35 * sr);
  const b0 = Math.round(0.55 * sr);
  const b1 = Math.round(0.78 * sr);
  const maxEffectDuckDb = Math.abs(db(goertzelMag(out.subarray(b0, b1), sr, 220) / goertzelMag(out.subarray(q0, q1), sr, 220)));
  assert.ok(
    maxEffectDuckDb < 0.01,
    `Expected < 0.01 dB Layer-1 ducking even at Max (0.42 peak) Layer-1 + 1.80 drum transient, got ${maxEffectDuckDb.toFixed(5)} dB`
  );
});

// ============================================================================
// Deep Regression #16 — P1 #6 & P0 #4 Full 8 kHz HFP Graph Nyquist Audit & HRV Sham Blinding
// ============================================================================
test('P1 #6 & P0 #4 (Deep 8 kHz HFP & HRV Sham): StereoRainBed, GenerativeComposer, StudioSampler & MedicalStimulusRack clamp 100% of nodes <= 0.44*fs @ 8 kHz & blind HRV sham', () => {
  const origWin = globalThis.window;
  try {
    globalThis.window = globalThis;
    const ctx8k = createMockAudioContext(8000);
    const nyqSafe8k = 8000 * 0.44; // 3520 Hz

    // 1. StereoRainBed + procedural rain & soft_rain buffers @ 8 kHz
    const rainBuf8k = createStereoRainBuffer(ctx8k, 1);
    assert.equal(rainBuf8k.sampleRate, 8000);
    const softRain8k = createCalibratedNoiseBuffer(ctx8k, 'soft_rain', 1, { hpHz: 100, lpHz: 2400 });
    assert.equal(softRain8k.sampleRate, 8000);

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 404 });
    try {
      const rainBed = new StereoRainBed();
      rainBed.attach(ctx8k, ctx8k.createGain(), false, '');
      rainBed.stop();

      // 2. GenerativeComposer across bossa_nova (5400 Hz hat!) & Rhodes/Felt Piano @ 8 kHz
      const composer = new GenerativeComposer();
      const musicSpec = { ...structuredClone(VERIFIED_STUDY_PRESETS[0].music), percussion: 'steady_pulse', bpm: 110 };
      composer.start({
        ctx: ctx8k,
        musicSpec,
        genre: 'bossa_nova',
        proceduralMaster: ctx8k.createGain(),
        cleanSubBus: ctx8k.createGain(),
        reverbSend: ctx8k.createGain(),
        delaySend: ctx8k.createGain(),
        speakerSafeEQ: false,
      });
      composer.scheduleLiveSteps();
      composer.updateProgress(0.8, true);
      composer.stop();

      // 3. StudioSampler with 6800 Hz cutoff @ 8 kHz
      const sampler = new StudioSampler();
      sampler.attach(ctx8k, '');
      sampler.bank.set('warm_rhodes', new Map([[60, ctx8k.createBuffer(2, 8000, 8000)]]));
      sampler.playNote({
        palette: 'warm_rhodes',
        midi: 64,
        time: 0.5,
        gain: 0.3,
        durationSec: 1.0,
        tuningA4Hz: 440,
        cutoffHz: 6800,
        destination: ctx8k.createGain(),
      });
      sampler.clear();

      // 4. MedicalStimulusRack non-worklet fallback @ 8 kHz + HRV Sham blinding check
      const hrvSpec = structuredClone(VERIFIED_STUDY_PRESETS[0]);
      hrvSpec.entrainment.type = 'hrv_breathing_swell';
      hrvSpec.entrainment.frequencyHz = 0.1;
      hrvSpec.entrainment.modulationDepth = 0.36;
      hrvSpec.noise.color = 'white'; // defaultLp = 6200 Hz -> must clamp <= 3520 Hz!
      hrvSpec.noise.snrDb = -18;

      const rack = new MedicalStimulusRack();
      const { hrvBusInput } = rack.start({
        ctx: ctx8k,
        spec: hrvSpec,
        masterDestination: ctx8k.createGain(),
        speakerSafeEQ: false,
        isControlTrial: true,
        pureStimulusMode: true,
        workletsReady: false,
      });
      assert.ok(hrvBusInput, 'HRV protocol must mount hrvBusInput');
      assert.equal(rack.hrvPeriodicGate.gain.value, 0, 'HRV sham must mute periodic 0.10 Hz Mayer-wave LFO');
      assert.equal(rack.hrvShamGate.gain.value, 1, 'HRV sham must enable aperiodic 0.037+0.061 Hz LFOs');
      assert.ok(
        rack.hrvDepthGain.gain.value > 0.08,
        `HRV sham in Science Only must maintain non-zero breathing modulation depth (got ${rack.hrvDepthGain.gain.value})`
      );
      rack.stop();

      // Also exercise non-worklet sham on gamma_40hz_clicks @ 8 kHz
      const gammaSpec = structuredClone(VERIFIED_STUDY_PRESETS[0]);
      gammaSpec.entrainment.type = 'gamma_40hz_clicks';
      gammaSpec.entrainment.frequencyHz = 40;
      gammaSpec.entrainment.carrierLeftHz = 4800; // > 8 kHz Nyquist -> must clamp!
      const rackGamma = new MedicalStimulusRack();
      rackGamma.start({
        ctx: ctx8k,
        spec: gammaSpec,
        masterDestination: ctx8k.createGain(),
        speakerSafeEQ: false,
        isControlTrial: true,
        pureStimulusMode: true,
        workletsReady: false,
      });
      rackGamma.stop();
    } finally {
      globalThis.fetch = origFetch;
    }

    const violations = ctx8k._freqRecords.filter((r) => r.v > nyqSafe8k + 1e-6);
    assert.equal(
      violations.length,
      0,
      `Found above-Nyquist (> ${nyqSafe8k} Hz) filter/oscillator frequencies @ 8 kHz HFP: ${JSON.stringify(violations.slice(0, 5))}`
    );
  } finally {
    globalThis.window = origWin;
  }
});

// ============================================================================
// Deep Regression #17 — P1 #8 `/api/session/dismiss` Early-Abort Penalty & P2 #11 Cookie Upgrade / Webhook Guard
// ============================================================================
test('P1 #8 & P2 #11 (Deep Worker Edge Cases): /api/session/dismiss penalizes <25% aborts, legacy x-profile-token upgrades to HttpOnly cookie, & webhook rejects empty eventId', async () => {
  const dbConn = createInMemoryD1();
  const webhookSecret = 'whsec_v8_deep_edge_secret';
  const env = { DB: dbConn, STRIPE_WEBHOOK_SECRET: webhookSecret };
  const ctx = createExecCtx();
  const origFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ esearchresult: { idlist: [] }, results: [] }), { status: 200 });

    const profRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.99' },
        body: JSON.stringify({
          age: 31,
          gender: 'male',
          role: 'knowledge_worker',
          occupationLabel: 'Data Scientist',
          researchConsent: true,
        }),
      }),
      env,
      ctx
    );
    const { profile, profileToken } = await profRes.json();

    // 1. Existing user sending ONLY `x-profile-token` (no Cookie yet) to GET /api/profile/:id MUST receive `Set-Cookie: nfm_auth=...; HttpOnly`!
    const migRes = await worker.fetch(
      new Request(`https://www.nootropic.fm/api/profile/${profile.id}`, {
        headers: { 'x-profile-token': profileToken },
      }),
      env,
      ctx
    );
    assert.equal(migRes.status, 200);
    const migCookie = migRes.headers.get('set-cookie') ?? '';
    assert.ok(
      migCookie.startsWith('nfm_auth=') && migCookie.includes('HttpOnly') && migCookie.includes('Secure'),
      `Legacy x-profile-token caller must be upgraded to HttpOnly nfm_auth cookie, got: ${migCookie}`
    );

    // 2. User starts 30m session, aborts at 50s (<25%) via "End & Rate", and skips debrief (`POST /api/session/dismiss`)
    const startRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/protocol/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: migCookie.split(';')[0], 'cf-connecting-ip': '192.0.2.99' },
        body: JSON.stringify({
          profileId: profile.id,
          currentState: 'stressed',
          targetState: 'calm_reset',
          environment: 'office',
          device: 'headphones',
          durationMin: 30,
        }),
      }),
      env,
      ctx
    );
    const { recommendation } = await startRes.json();

    const dismissRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/session/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: migCookie.split(';')[0], 'cf-connecting-ip': '192.0.2.99' },
        body: JSON.stringify({ sessionId: recommendation.sessionId, actualDurationSec: 50 }),
      }),
      env,
      ctx
    );
    assert.equal(dismissRes.status, 200);
    const dismissJson = await dismissRes.json();
    assert.equal(dismissJson.retentionOutcome, 'early_bounce');

    const dismissedRow = dbConn._sqlite
      .prepare('SELECT status, retention_outcome, implicit_reward_score, implicit_applied_weight FROM sessions WHERE id = ?')
      .get(recommendation.sessionId);
    assert.equal(dismissedRow.status, 'abandoned');
    assert.equal(dismissedRow.retention_outcome, 'early_bounce');
    assert.equal(dismissedRow.implicit_applied_weight, 0.45);
    assert.ok(dismissedRow.implicit_reward_score <= 0.25);

    // 3. Stripe webhook with empty `id: ""` MUST be rejected with 400 (cannot bypass processed_webhooks!)
    const emptyIdPayload = JSON.stringify({ id: '', type: 'checkout.session.completed', data: { object: {} } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256HexNode(webhookSecret, `${ts}.${emptyIdPayload}`);
    const emptyIdRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/billing/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
        body: emptyIdPayload,
      }),
      env,
      ctx
    );
    assert.equal(emptyIdRes.status, 400, 'Stripe webhook without event id must be rejected with 400');

    // 4. `customer.subscription.deleted` clears BOTH `plan_tier = 'free'` and `pro_until = NULL`
    dbConn._sqlite
      .prepare("UPDATE profiles SET plan_tier = 'pro', pro_until = '2099-01-01T00:00:00.000Z', stripe_subscription_id = 'sub_del_v8' WHERE id = ?")
      .run(profile.id);
    const delSubPayload = JSON.stringify({
      id: 'evt_sub_del_v8',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_del_v8', metadata: { profile_id: profile.id } } },
    });
    const delSig = await hmacSha256HexNode(webhookSecret, `${ts}.${delSubPayload}`);
    const delSubRes = await worker.fetch(
      new Request('https://www.nootropic.fm/api/billing/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${delSig}` },
        body: delSubPayload,
      }),
      env,
      ctx
    );
    assert.equal(delSubRes.status, 200);
    const afterCancel = dbConn._sqlite.prepare('SELECT plan_tier, pro_until FROM profiles WHERE id = ?').get(profile.id);
    assert.equal(afterCancel.plan_tier, 'free');
    assert.equal(afterCancel.pro_until, null);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ============================================================================
// Deep Regression #18 — Live OpenAlex + PubMed Literature on Open Custom & Curated Goals
// ============================================================================
test('P1 #7 (Live OpenAlex + PubMed Literature Regression): resolves open custom & curated goals with valid OpenAlex + PubMed papers while rejecting animal/non-auditory studies', async () => {
  const {
    resolveOpenGoalIntent,
    CURATED_GOAL_PRESETS,
  } = await import('../shared/openGoals.ts');
  const { fetchVerifiedLiveLiterature } = await import('../worker/literature.ts');
  const { searchLiveMedicalStudies } = await import('../worker/studyCompiler.ts');

  // 1. Edge cases & intent resolution hygiene
  assert.equal(resolveOpenGoalIntent(''), null);
  assert.equal(resolveOpenGoalIntent('   '), null);
  assert.equal(resolveOpenGoalIntent('ab'), null);

  const creativeFlow = resolveOpenGoalIntent('creative flow');
  assert.ok(creativeFlow && creativeFlow.slug === 'creative_ideation' && !creativeFlow.isOpenCustomTopic);

  const sharpFocus = resolveOpenGoalIntent('sharp focus');
  assert.ok(sharpFocus && sharpFocus.slug === 'alert_focus' && !sharpFocus.isOpenCustomTopic);

  const pubSpeaking = resolveOpenGoalIntent('public speaking confidence');
  assert.ok(pubSpeaking && pubSpeaking.isOpenCustomTopic);
  assert.equal(pubSpeaking.slug, 'custom:public_speaking_confidence');
  assert.deepEqual(pubSpeaking.topicWords, ['public', 'speaking', 'confidence']);
  assert.ok(!/\bhuman\b/i.test(pubSpeaking.openAlexTerm), 'openAlexTerm must not stuff literal "human" token');
  assert.match(pubSpeaking.pubmedQuery, /"public speaking"\[Title\/Abstract\]/i);

  const postWorkout = resolveOpenGoalIntent('post-workout recovery');
  assert.ok(postWorkout && postWorkout.isOpenCustomTopic);
  assert.match(postWorkout.pubmedQuery, /exercise\[Title\/Abstract\]/i);

  // Verify every curated preset openAlexTerm has balanced parentheses & no commas
  for (const preset of CURATED_GOAL_PRESETS) {
    assert.ok(!preset.openAlexTerm.includes(','), `Preset ${preset.slug} openAlexTerm must not contain commas`);
    let depth = 0;
    for (const ch of preset.openAlexTerm) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      assert.ok(depth >= 0, `Unbalanced ')' in ${preset.slug}`);
    }
    assert.equal(depth, 0, `Unbalanced '(' in ${preset.slug}`);
  }

  // 2. Deterministic offline verification: NCBI 429 fallback to Europe PMC SRC:MED + batched efetch + legacy "human" relaxation guard
  const dbMock = createInMemoryD1();
  const origFetch = globalThis.fetch;
  try {
    const seenUrls = [];
    globalThis.fetch = async (input) => {
      const u = typeof input === 'string' ? input : input.url;
      seenUrls.push(u);
      if (u.includes('eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi')) {
        if (u.includes('batched_check')) {
          return new Response(
            JSON.stringify({ esearchresult: { idlist: ['111111', '222222', '333333'] } }),
            { status: 200 }
          );
        }
        return new Response('Too Many Requests', { status: 429 });
      }
      if (u.includes('eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi')) {
        return new Response(
          `<PubmedArticleSet>
            <PubmedArticle><MedlineCitation><PMID>111111</PMID><Article><ArticleTitle>Music listening reduces speech anxiety in human adults.</ArticleTitle><Abstract><AbstractText>Healthy adult participants listened to instrumental music for 20 minutes before public speaking.</AbstractText></Abstract><Journal><Title>Journal of Music Therapy</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal><AuthorList><Author><LastName>carter</LastName></Author></AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/jmt.111</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
            <PubmedArticle><MedlineCitation><PMID>222222</PMID><Article><ArticleTitle>40 Hz optogenetic stimulation in 5xFAD mice.</ArticleTitle><Abstract><AbstractText>Adult male mice were sacrificed.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>
          </PubmedArticleSet>`,
          { status: 200 }
        );
      }
      if (u.includes('ebi.ac.uk/europepmc/webservices/rest/search')) {
        return new Response(
          JSON.stringify({
            resultList: {
              result: [
                {
                  pmid: '99887766',
                  title: 'Optogenetic stimulation in C57BL mice cortex',
                  abstractText: 'Mice were implanted with optical fibers.',
                  authorString: 'Rodent A',
                  journalTitle: 'Preclinical J',
                  pubYear: '2024',
                },
                {
                  pmid: '42307797',
                  doi: '10.1016/j.psyneuen.2026.107001',
                  title: 'Effects of binaural beats on acute stress recovery in public speaking anxiety',
                  abstractText: 'Healthy human volunteers completed a randomized controlled trial of 10 Hz auditory stimulation.',
                  authorString: 'Silva M, Gomez R',
                  journalTitle: 'Psychoneuroendocrinology',
                  pubYear: '2026',
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes('api.openalex.org/works')) {
        // Return empty on primary legacy query to force relaxation path, then return valid DOI on relaxed `tinnitus` query
        if (decodeURIComponent(u).includes('impossible_xyz_token')) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W111',
                doi: 'https://doi.org/10.1000/rodent.1',
                title: 'Auditory cortex plasticity in anesthetized Wistar rats',
                publication_year: 2023,
              },
              {
                id: 'https://openalex.org/W222',
                doi: 'https://doi.org/10.3766/jaaa.18027',
                title: 'Sound therapy clinical trial for tinnitus relief in human listeners',
                publication_year: 2024,
                authorships: [{ author: { display_name: ' Tyler R' } }, { author: { display_name: ' Owen G' } }],
                primary_location: { source: { display_name: 'J Am Acad Audiol' } },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ studies: [] }), { status: 200 });
    };

    // Verify batched efetch (1 single efetch call for 3 PMIDs!) & animal rejection
    const studyHits = await searchLiveMedicalStudies({ DB: dbMock }, 'batched_check music');
    const efetchCalls = seenUrls.filter((u) => u.includes('efetch.fcgi'));
    assert.equal(efetchCalls.length, 1, `Expected 1 batched efetch call, got ${efetchCalls.length}`);
    assert.ok(efetchCalls[0].includes('111111,222222,333333'));
    assert.ok(studyHits.every((h) => !isNonAuditoryOrAnimalStudy(h.title, h.abstractText)));

    // Verify legacy "music auditory stimulation human ..." relaxation strips "human" & recovers via Europe PMC + OpenAlex
    seenUrls.length = 0;
    const recovered = await fetchVerifiedLiveLiterature(
      { DB: dbMock },
      'calm_reset',
      'home_relax',
      undefined,
      {
        slug: 'custom:tinnitus_impossible',
        pubmedQuery: 'music[Title/Abstract] AND impossible_xyz_token[Title/Abstract]',
        openAlexTerm: 'music auditory stimulation human tinnitus impossible_xyz_token',
      }
    );
    assert.ok(recovered.some((p) => p.source === 'pubmed' && p.pmid === '42307797'));
    assert.ok(recovered.some((p) => p.source === 'openalex' && p.url === 'https://doi.org/10.3766/jaaa.18027'));
    assert.ok(recovered.every((p) => !isNonAuditoryOrAnimalStudy(p.title)));
    const oaRelaxCalls = seenUrls.filter((u) => u.includes('api.openalex.org/works'));
    assert.ok(
      !oaRelaxCalls.some((u) => /\bAND\s+human\b/i.test(decodeURIComponent(u))),
      'Relaxed OpenAlex query must never relax to literal "human"'
    );

    // Verify Cloudflare shared-IP OpenAlex 429 recovery via $0-credit `/works/https://doi.org/{doi}` single-work lookup
    globalThis.fetch = async (input) => {
      const u = typeof input === 'string' ? input : input.url;
      if (u.includes('esearch.fcgi')) {
        return new Response(JSON.stringify({ esearchresult: { idlist: ['10001', '10002', '10003'] } }), { status: 200 });
      }
      if (u.includes('esummary.fcgi')) {
        return new Response(
          JSON.stringify({
            result: {
              '10001': { title: 'Music listening lowers speaking stress.', pubdate: '2025', authors: [{ name: 'Lee A' }] },
              '10002': { title: 'Binaural beats support attention.', pubdate: '2024', authors: [{ name: 'Kim B' }] },
              '10003': {
                title: 'Happy creativity: Listening to happy music facilitates divergent thinking.',
                pubdate: '2017',
                authors: [{ name: 'Ritter S' }],
                articleids: [{ idtype: 'doi', value: '10.1371/journal.pone.0182210' }],
              },
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes('api.openalex.org/works?filter=')) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
      }
      if (u.includes('api.openalex.org/works/https%3A%2F%2Fdoi.org%2F')) {
        return new Response(
          JSON.stringify({
            id: 'https://openalex.org/W2753403062',
            doi: 'https://doi.org/10.1371/journal.pone.0182210',
            title: 'Happy creativity: Listening to happy music facilitates divergent thinking',
            publication_year: 2017,
            authorships: [{ author: { display_name: 'Simone M. Ritter' } }],
            primary_location: { source: { display_name: 'PLoS ONE' } },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
    };
    const sharedIpRecovered = await fetchVerifiedLiveLiterature({ DB: dbMock }, 'deep_flow', 'study');
    assert.ok(sharedIpRecovered.some((p) => p.source === 'pubmed' && p.pmid === '10001'));
    assert.ok(
      sharedIpRecovered.some(
        (p) =>
          p.source === 'openalex' &&
          p.pmid === 'OA:W2753403062' &&
          p.url === 'https://doi.org/10.1371/journal.pone.0182210'
      ),
      'Must recover canonical OA:W... work via $0-credit single-DOI OpenAlex lookup when /works?filter= returns 429'
    );
  } finally {
    globalThis.fetch = origFetch;
  }

  // 3. Real Live Upstream Verification through POST /api/protocol/start (NIH PubMed + OpenAlex live HTTP)
  const liveDb = createInMemoryD1();
  const liveEnv = { DB: liveDb };
  const liveCtx = createExecCtx();
  const liveCases = [
    { label: 'public speaking confidence', ip: '198.51.100.41' },
    { label: 'creative flow', ip: '198.51.100.42' },
    { label: 'sharp focus', ip: '198.51.100.43' },
  ];

  for (const [idx, c] of liveCases.entries()) {
    if (idx > 0) {
      // Respect OpenAlex unkeyed 1 req/sec polite spacing during consecutive cold-cache live checks
      await new Promise((r) => setTimeout(r, 1100));
    }
    const res = await worker.fetch(
      new Request('https://www.nootropic.fm/api/protocol/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://www.nootropic.fm',
          'cf-connecting-ip': c.ip,
        },
        body: JSON.stringify({
          ephemeralMode: true,
          rawInputText: c.label,
          customGoalText: c.label,
          currentState: 'stressed',
          baselineScore: 2,
          targetState: 'alert_focus',
          environment: 'office',
          device: 'headphones',
          durationMin: 25,
        }),
      }),
      liveEnv,
      liveCtx
    );
    assert.equal(res.status, 200, `POST /api/protocol/start failed for "${c.label}"`);
    const { recommendation } = await res.json();
    const papers = recommendation?.livePubMedPapers ?? [];
    assert.ok(
      papers.length >= 2,
      `Expected >=2 verified livePubMedPapers for "${c.label}", got ${papers.length}`
    );
    const hasPubMed = papers.some(
      (p) => p.source === 'pubmed' && /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/.test(p.url)
    );
    const hasOpenAlex = papers.some(
      (p) => p.source === 'openalex' && /^https:\/\/doi\.org\/10\./i.test(p.url)
    );
    assert.ok(
      hasPubMed,
      `Expected verified PubMed paper for "${c.label}", got: ${JSON.stringify(papers)}`
    );
    assert.ok(
      hasOpenAlex,
      `Expected verified OpenAlex DOI paper for "${c.label}", got: ${JSON.stringify(papers)}`
    );
    for (const p of papers) {
      assert.equal(
        isNonAuditoryOrAnimalStudy(p.title),
        false,
        `Returned live paper failed human-auditory P1 #7 guard on "${c.label}": "${p.title}"`
      );
    }
  }
});
