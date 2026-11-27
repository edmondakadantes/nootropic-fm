/**
 * nootropic.fm — End-to-End Mobile (375px) & Desktop (1280px) UX, Audio, Modal & Bundle Audit Suite
 *
 * Covers:
 *  1) Bundle splitting invariant: zero client JS chunks > 500 kB; zero stale Monique / compliance leaks.
 *  2) Worker API malformed URI path hardening (/api/audio/stream/%ZZ, /api/profile/%ZZ -> 400, never 500).
 *  3) Headless Edge 375x812 Mobile E2E on Flagship Showcase (?surface=showcase):
 *     - Zero horizontal overflow (scrollWidth <= 375), zero clipped header/mobile-nav buttons
 *     - ALANYA STUDIO CONCIERGE copy, outcome deep-links (?target=...&duration=...), 30s WebAudio Proof play/stop
 *     - Daylight & Night WCAG contrast
 *  4) Headless Edge 375x812 Mobile + 1280x900 Desktop E2E on Audio Studio (?surface=studio):
 *     - Zero horizontal overflow & zero clipped header/nav controls on 375px
 *     - Genuine Local-Only Opt-Out (unchecked consent) through Beat 1 -> Beat 2 -> Beat 3 -> Beat 4 -> Reveal -> PlayerView -> Modals (PVT, Tapping, Huggins, SoundSystems, GoPro + Escape key close) -> DebriefView
 *     - Outcome deep-link hydration (?surface=studio&target=deep_flow&duration=45)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerModule = await import('../worker/index.ts');
const worker = workerModule.default;

function walkFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test('Bundle splitting keeps every client JS chunk under 500 kB and enforces Alanya & compliance hygiene', () => {
  const assetsDir = path.join(ROOT, 'dist', 'client', 'assets');
  assert.ok(fs.existsSync(assetsDir), 'dist/client/assets must exist (run build first)');
  const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  assert.ok(jsFiles.length >= 6, `Expected code-split JS chunks, found ${jsFiles.length}`);

  for (const f of jsFiles) {
    const size = fs.statSync(path.join(assetsDir, f)).size;
    assert.ok(
      size < 500_000,
      `Chunk ${f} exceeds 500 kB Vite budget (${(size / 1024).toFixed(1)} kB)`
    );
  }

  const uiAndPublic = [
    ...walkFiles(path.join(ROOT, 'src'), ['.ts', '.tsx']),
    ...walkFiles(path.join(ROOT, 'public'), ['.html', '.txt', '.xml']),
    path.join(ROOT, 'index.html'),
  ];
  for (const file of uiAndPublic) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/\bmonique\b/i.test(text), `Stale Monique reference found in ${file}`);
    assert.ok(!/vasi@nootropic\.fm/i.test(text), `Personal email leaked in ${file}`);
    assert.ok(!/\bedmond\b|\bvasile\b/i.test(text), `Wrong founder name in ${file}`);
    assert.ok(!/\baddictive\b/i.test(text), `Prohibited term 'addictive' in ${file}`);
    assert.ok(
      !/ATECC608B|T_pcb|dT_core|59\.70|62\.40/.test(text),
      `Pre-NNN IP or COGS figure exposed in ${file}`
    );
  }
});

test('Worker API handles malformed URI-encoded path segments cleanly with HTTP 400 (never 500)', async () => {
  const fakeDb = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (typeof sql === 'string' && sql.includes('rate_limits')) {
            return { hits: 1 };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
    async batch() {
      return [];
    },
  };
  const fakeBucket = {
    async head() {
      return null;
    },
    async get() {
      return null;
    },
  };
  const env = { DB: fakeDb, AUDIO_BUCKET: fakeBucket, APP_ENV: 'test' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const badStreamRes = await worker.fetch(
    new Request('https://app.nootropic.fm/api/audio/stream/%ZZbad', { method: 'GET' }),
    env,
    ctx
  );
  assert.equal(badStreamRes.status, 400);

  const badProfileRes = await worker.fetch(
    new Request('https://app.nootropic.fm/api/profile/%ZZbad', { method: 'GET' }),
    env,
    ctx
  );
  assert.equal(badProfileRes.status, 400);

  const badDeleteProfileRes = await worker.fetch(
    new Request('https://app.nootropic.fm/api/profile/%ZZbad', { method: 'DELETE' }),
    env,
    ctx
  );
  assert.equal(badDeleteProfileRes.status, 400);
});

function findEdgeExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => fs.existsSync(p));
}

test('Headless Edge E2E (375px Mobile & 1280px Desktop): Showcase + Studio 90s Flow + Modals + Audio Proof', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found');
    return;
  }

  const distDir = path.join(ROOT, 'dist', 'client');
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
  };

  const voiceConciergeCalls = [];
  let currentMockProfile = null;

  const makeTestWavBytes = (durationSec = 0.25, sampleRate = 48000) => {
    const numSamples = Math.floor(durationSec * sampleRate);
    const buf = Buffer.alloc(44 + numSamples * 2);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + numSamples * 2, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(numSamples * 2, 40);
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(Math.sin((2 * Math.PI * 240 * i) / sampleRate) * 4000);
      buf.writeInt16LE(sample, 44 + i * 2);
    }
    return buf;
  };
  const testWavBuf = makeTestWavBytes(0.25);

  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    if (cleanUrl === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({
          config: {
            regionRequiresOptIn: true,
            countryCode: 'RO',
            customLiveGenAvailable: false,
            lyriaRealtimeAvailable: false,
            workersAiCompilerAvailable: false,
            stripeBillingAvailable: true,
            musicProvider: 'cache_only',
            dailyCapMax: 0,
            dailyCapRemaining: 0,
            popularCustomVibes: [],
          },
        })
      );
      return;
    }
    if (cleanUrl === '/api/identity/me') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ authenticated: Boolean(currentMockProfile), profile: currentMockProfile, pendingDebrief: null }));
      return;
    }
    if (cleanUrl === '/api/profile' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (c) => { bodyStr += c; });
      req.on('end', () => {
        const body = JSON.parse(bodyStr || '{}');
        const age = Number(body.age ?? 34);
        if (!Number.isFinite(age) || age < 18 || age > 95) {
          res.writeHead(400, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ error: 'nootropic.fm is restricted to listeners aged 18+.' }));
          return;
        }
        currentMockProfile = {
          id: body.id || 'prof_e2e_01',
          displayName: body.displayName || undefined,
          age: Math.round(age),
          ageBand: age < 25 ? '18-24' : age < 35 ? '25-34' : '35-44',
          gender: body.gender || 'female',
          role: body.role || 'entrepreneur',
          occupationLabel: body.occupationLabel || undefined,
          texturePref: body.texturePref || 'warm_organic',
          noiseSensitivity: body.noiseSensitivity || 'medium',
          defaultDevice: body.defaultDevice || 'headphones',
          primaryChallenge: body.primaryChallenge || 'distraction',
          researchConsent: body.researchConsent === true,
          preferredModMult: 1.0,
          planTier: 'free',
          proUntil: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ profile: currentMockProfile, profileToken: 'tok_e2e_01', syncCode: 'NFM-TEST-2027' }));
      });
      return;
    }
    if (cleanUrl.startsWith('/api/profile/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({
          profile: currentMockProfile || {
            id: 'prof_e2e_01',
            displayName: 'Elena',
            age: 34,
            ageBand: '25-34',
            gender: 'female',
            role: 'entrepreneur',
            texturePref: 'warm_organic',
            noiseSensitivity: 'medium',
            defaultDevice: 'headphones',
            primaryChallenge: 'distraction',
            researchConsent: true,
            preferredModMult: 1.0,
            planTier: 'free',
            proUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          profileToken: 'tok_e2e_01',
          syncCode: 'NFM-TEST-2027',
          pendingDebrief: null,
        })
      );
      return;
    }
    if (cleanUrl === '/api/identity/restore' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        currentMockProfile = {
          id: 'prof_e2e_01',
          displayName: 'Elena',
          age: 34,
          ageBand: '25-34',
          gender: 'female',
          role: 'entrepreneur',
          texturePref: 'warm_organic',
          noiseSensitivity: 'medium',
          defaultDevice: 'headphones',
          primaryChallenge: 'distraction',
          researchConsent: true,
          preferredModMult: 1.0,
          planTier: 'free',
          proUntil: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(
          JSON.stringify({
            profile: currentMockProfile,
            profileToken: 'tok_e2e_01',
            syncCode: 'NFM-TEST-2027',
            pendingDebrief: null,
          })
        );
      });
      return;
    }
    if (cleanUrl === '/api/audio/catalog') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({
          tracksByGenre: {
            nootropic_trance: [],
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
          },
        })
      );
      return;
    }
    if (cleanUrl === '/api/voice/voices') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({
          available: true,
          provider: 'elevenlabs',
          defaultVoiceId: 'iRb5bX2IzJDUAwy4jeki',
          voices: [
            {
              voiceId: 'iRb5bX2IzJDUAwy4jeki',
              name: 'Alanya - Smooth',
              shortLabel: 'Alanya · Smooth',
              category: 'custom',
            },
          ],
        })
      );
      return;
    }
    if (cleanUrl === '/api/voice/concierge') {
      let bodyStr = '';
      req.on('data', (c) => { bodyStr += c; });
      req.on('end', () => {
        const parsed = JSON.parse(bodyStr || '{}');
        voiceConciergeCalls.push(parsed);
        const enableAudio = req.url?.includes('voice=1') || voiceConciergeCalls._enableAudio;
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        if (enableAudio) {
          res.end(
            JSON.stringify({
              available: true,
              cueType: parsed.cueType || 'intro_full',
              greetingUrl: '/api/voice/test-greet.wav',
              bodyUrl: '/api/voice/test-body.wav',
              breathPauseMs: 250,
              transcript: 'Take a calm breath. Seal both earbuds for full phase lock.',
            })
          );
        } else {
          res.end(JSON.stringify({ available: false, cueType: 'intro_full', breathPauseMs: 720, transcript: '' }));
        }
      });
      return;
    }
    if (cleanUrl === '/api/voice/test-greet.wav' || cleanUrl === '/api/voice/test-body.wav') {
      res.writeHead(200, { 'Content-Type': 'audio/wav', Connection: 'close' });
      res.end(testWavBuf);
      return;
    }
    if (cleanUrl === '/api/protocol/start' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(
          JSON.stringify({
            recommendation: {
              sessionId: 'eph_e2e_audit_01',
              ephemeralMode: true,
              isControlTrial: false,
              isExploration: false,
              confidencePct: 84,
              cohortTrials: 12,
              cohortLabel: '18–95 · Entrepreneur · Sharp Focus',
              currentState: 'distracted',
              microStateId: 'brain_fog',
              microStateLabel: 'Brain Fog',
              arousalPct: 38,
              clarityPct: 32,
              baselineScore: 2,
              targetState: 'deep_flow',
              environment: 'office',
              device: 'headphones',
              plannedDurationMin: 45,
              safetyMode: false,
              safetyWarnings: [],
              audioSource: 'studio_library',
              fallbackCoreGenre: 'nootropic_trance',
              rationale: 'Nested 6x40 Hz Theta-Gamma phase lock for deep flow.',
              personalizationSummary: ['190–4,500 Hz LR4', '6×40 Hz CFC'],
              formulaIngredients: [
                { role: 'Entrainment', compound: '6×40 Hz Theta-Gamma CFC', dose: '6 Hz × 40 Hz', evidenceTag: 'Lisman 2013' },
              ],
              arm: { id: 'nootropic-trance-6x40hz', name: '6×40 Hz Signature Lock', studyIds: ['woods_2024'] },
              params: {
                genre: 'nootropic_trance',
                energyTier: 'focus',
                bpm: 120,
                modulationHz: 6,
                modulationDepth: 0.34,
                crossoverHz: 190,
                upperCrossoverHz: 4500,
                stereoAmSpread: true,
                speakerSafeEQ: false,
                binauralOffsetHz: 0,
                noiseColor: 'pink',
                noiseLevel: 0.08,
                harmonicMode: 'warm_min9',
                rootNoteHz: 110,
                pulseIntensity: 0.55,
                filterCutoffHz: 2400,
              },
              studies: [
                {
                  id: 'woods_2024',
                  authors: 'Woods, K. et al.',
                  year: '2024',
                  journal: 'PLOS ONE',
                  title: 'Rapid cortical phase locking to amplitude-modulated music',
                  summary: 'Phase-locked AM sustains attention without interrupting lyric-free music.',
                  soundEffect: '6 Hz × 40 Hz LR4 modulation inside 190–4,500 Hz',
                  doiOrUrl: 'https://doi.org/10.1371/journal.pone.0298921',
                },
              ],
              livePubMedPapers: [],
            },
          })
        );
      });
      return;
    }
    if (cleanUrl === '/api/insights') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({
          insights: {
            totalProfiles: 14,
            totalSessions: 42,
            completedDebriefs: 28,
            globalSuccessRatePct: 82,
            globalAvgDelta: 1.6,
            explorationSharePct: 14,
            retentionMetrics: {
              trackedSessions: 42,
              returningProfiles: 9,
              avgListenRetentionPct: 84,
              completionRatePct: 76,
              earlyBounceRatePct: 7,
              instantSwapRatePct: 5,
              d1ReturnRatePct: 48,
              d7ReturnRatePct: 64,
            },
            abValidation: {
              readyForStats: true,
              activeSessions: 31,
              activeAvgDelta: 1.8,
              activeSuccessRatePct: 84,
              activeListenRetentionPct: 86,
              controlSessions: 11,
              controlAvgDelta: 0.9,
              controlSuccessRatePct: 62,
              controlListenRetentionPct: 71,
              deltaLift: 0.9,
              retentionLiftPct: 15,
            },
            personalArms: [
              {
                armId: 'nootropic-trance-6x40hz',
                armName: '6×40 Hz Signature Lock',
                trials: 8,
                alpha: 8.5,
                beta: 1.5,
                successRatePct: 85,
                avgDelta: 1.9,
                avgCompletionPct: 88,
              },
            ],
            genreLeaderboard: [
              {
                genre: 'nootropic_trance',
                label: 'NootropicFM Mode',
                isCustom: false,
                sessions: 18,
                successRatePct: 88,
                avgDelta: 1.9,
                avgRetentionPct: 91,
              },
            ],
            topArchetypeCombos: [
              {
                cohortKey: '25-34|entrepreneur|deep_flow|office',
                cohortLabel: '25–34 · Founder · Deep Flow',
                armName: '6×40 Hz Signature Lock',
                genreSlug: 'nootropic_trance',
                genreLabel: 'NootropicFM Mode',
                sessions: 12,
                successRatePct: 86,
                avgDelta: 1.8,
                avgRetentionPct: 89,
              },
            ],
            cohorts: [
              {
                cohortKey: '25-34|entrepreneur|deep_flow|office',
                cohortLabel: '25–34 · Founder · Deep Flow',
                totalSessions: 14,
                completedSessions: 12,
                topArmName: '6×40 Hz Signature Lock',
                successRatePct: 86,
                avgDelta: 1.8,
                arms: [
                  {
                    armId: 'nootropic-trance-6x40hz',
                    armName: '6×40 Hz Signature Lock',
                    trials: 12,
                    alpha: 10.5,
                    beta: 2.0,
                    successRatePct: 86,
                    avgDelta: 1.8,
                    avgCompletionPct: 89,
                  },
                ],
              },
            ],
            recentSessions: [
              {
                id: 'sess_e2e_01',
                cohortKey: '25-34|entrepreneur|deep_flow|office',
                rawInputText: 'Brain fog -> deep flow',
                currentState: 'distracted',
                baselineScore: 2,
                targetState: 'deep_flow',
                environment: 'office',
                device: 'headphones',
                safetyMode: false,
                plannedDurationMin: 45,
                actualDurationSec: 2520,
                completionRatio: 0.93,
                armId: 'nootropic-trance-6x40hz',
                armName: '6×40 Hz Signature Lock',
                isExploration: false,
                isControlTrial: false,
                energyTier: 'focus',
                musicGenre: 'nootropic_trance',
                audioSource: 'studio_library',
                retentionOutcome: 'completed_full',
                acousticParams: { modulationHz: 6, bpm: 120 },
                citedStudyIds: ['woods_2024'],
                liveAdjustments: [],
                timeOfDayBucket: 'morning',
                status: 'completed',
                postScore: 4,
                deltaScore: 2,
                workedRating: 'yes',
                feedbackTags: ['Kept me locked in'],
                rewardScore: 0.92,
                notes: '',
                createdAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              },
            ],
          },
        })
      );
      return;
    }
    if (cleanUrl === '/api/intelligence/inquire' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ ok: true, inquiryId: 'inq_e2e_01' }));
      });
      return;
    }
    if (cleanUrl === '/api/studies/leaderboard') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ leaderboard: [] }));
      return;
    }
    if (cleanUrl === '/api/intelligence/cohorts') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({
          cohorts: [],
          globalRetention: {
            measuredSessions: 36,
            avgCompletionPct: 58,
            pct25: 69,
            pct50: 54,
            pct75: 42,
            pct90: 36,
          },
        })
      );
      return;
    }
    if (cleanUrl.startsWith('/api/')) {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    let filePath = path.resolve(distDir, relPath);
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', Connection: 'close' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfm-ux-e2e-'));

  let resolvePort;
  const cdpPortPromise = new Promise((res) => {
    resolvePort = res;
  });
  const child = spawn(
    edgePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
    const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderrBuf);
    if (m) resolvePort(Number(m[1]));
  });

  try {
    const debugPort = await cdpPortPromise;
    let targets = null;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
      if (res?.ok) {
        const list = await res.json();
        if (list.some((x) => x.type === 'page')) {
          targets = list;
          break;
        }
      }
    }
    const pageTarget = targets.find((x) => x.type === 'page') ?? targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((r, rej) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    let msgId = 0;
    const runtimeErrors = [];
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.method === 'Runtime.exceptionThrown') {
        runtimeErrors.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
      }
    });

    const sendCdp = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++msgId;
        const onMsg = (evt) => {
          const msg = JSON.parse(String(evt.data));
          if (msg.id === id) {
            ws.removeEventListener('message', onMsg);
            if (msg.error) rej(new Error(JSON.stringify(msg.error)));
            else res(msg.result);
          }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evalJs = async (expression) => {
      const out = await sendCdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || 'Eval error');
      return out.result?.value;
    };

    const waitUntil = async (expr, timeoutMs = 8000, desc = 'condition') => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const val = await evalJs(expr);
        if (val) return val;
        await new Promise((r) => setTimeout(r, 120));
      }
      throw new Error(`Timed out waiting for ${desc}`);
    };

    const assertNoOverflowAndClippedHeader = async (label, viewportW) => {
      const audit = await evalJs(`(() => {
        const sw = document.documentElement.scrollWidth;
        const headerButtons = Array.from(document.querySelectorAll('header button, header a'))
          .filter((el) => {
            const st = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
              left: Math.round(r.left),
              right: Math.round(r.right),
              inScrollNav: Boolean(el.closest('nav.overflow-x-auto')),
            };
          });
        const clipped = headerButtons.filter((b) => !b.inScrollNav && (b.left < -1 || b.right > ${viewportW} + 1));
        return { scrollWidth: sw, headerButtons, clipped };
      })()`);
      assert.ok(
        audit.scrollWidth <= viewportW,
        `Horizontal overflow in ${label}: scrollWidth=${audit.scrollWidth} > ${viewportW}`
      );
      assert.deepEqual(
        audit.clipped,
        [],
        `Clipped header controls on ${label} (${viewportW}px): ${JSON.stringify(audit.clipped)}`
      );
    };

    const setThemeAndWait = async (mode) => {
      await evalJs(`(() => {
        const isDay = document.documentElement.getAttribute('data-theme') === 'daylight';
        if (${mode === 'daylight'} !== isDay) {
          const b = Array.from(document.querySelectorAll('header button')).find((x) =>
            /${mode === 'daylight' ? 'Daylight Mode' : 'Night Mode'}/i.test(x.getAttribute('aria-label') || '')
          );
          if (b) b.click();
          else document.documentElement.setAttribute('data-theme', '${mode}');
        }
      })()`);
      await new Promise((r) => setTimeout(r, 550));
    };

    const assertContrastWcag = async (label, modes = ['night', 'daylight']) => {
      for (const mode of modes) {
        await setThemeAndWait(mode);
        const low = await evalJs(`(() => {
          const cvs = document.createElement('canvas');
          cvs.width = 1; cvs.height = 1;
          const ctx = cvs.getContext('2d', { willReadFrequently: true });
          const parseCssColor = (s) => {
            if (!s || s === 'transparent') return [0, 0, 0, 0];
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = 'rgba(0,0,0,0)';
            ctx.fillStyle = s;
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return [d[0], d[1], d[2], d[3] / 255];
          };
          const lum = ([r, g, b]) =>
            [r, g, b]
              .map((v) => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              })
              .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
          const cr = (a, b) => {
            const l1 = lum(a), l2 = lum(b);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          const blend = (fg, bg) =>
            fg[3] >= 0.99
              ? fg
              : [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
          const isDay = document.documentElement.getAttribute('data-theme') === 'daylight';
          const getBg = (el) => {
            const layers = [];
            for (let cur = el; cur; cur = cur.parentElement) {
              const bg = parseCssColor(getComputedStyle(cur).backgroundColor);
              if (bg && bg[3] > 0.01) layers.unshift(bg);
            }
            let cur = isDay ? [246, 247, 249, 1] : [10, 11, 12, 1];
            for (const l of layers) cur = blend(l, cur);
            return cur;
          };
          const topModal = document.querySelector('div.fixed.inset-0.z-50');
          const lowContrast = [];
          const w = document.createTreeWalker(topModal || document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            if (!n.nodeValue || !n.nodeValue.trim()) continue;
            const el = n.parentElement;
            if (!el) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.2) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const fg = parseCssColor(cs.color);
            if (!fg || fg[3] < 0.05) continue;
            const bg = getBg(el);
            const actualFg = blend(fg, bg);
            const ratio = cr(actualFg, bg);
            const fs = parseFloat(cs.fontSize);
            const fw = parseInt(cs.fontWeight, 10) || 400;
            const minReq = fs >= 24 || (fs >= 18.66 && fw >= 700) ? 3.0 : 4.5;
            if (ratio < minReq) {
              lowContrast.push({
                text: n.nodeValue.trim().slice(0, 45),
                ratio: +ratio.toFixed(2),
                minReq,
                fg: actualFg.map(Math.round).slice(0, 3).join(','),
                bg: bg.map(Math.round).slice(0, 3).join(','),
                cls: String(el.className).slice(0, 60),
              });
            }
          }
          return lowContrast.slice(0, 8);
        })()`);
        assert.deepEqual(
          low,
          [],
          `WCAG contrast failures on ${label} (${mode}): ${JSON.stringify(low)}`
        );
      }
      await setThemeAndWait('night');
    };

    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');

    // =========================================================================
    // 1) MOBILE 375px + TABLET/DESKTOP 640/768/1024/1280px: Flagship Showcase
    // =========================================================================
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=showcase` });
    await waitUntil(
      `Boolean(document.body && document.body.innerText.includes('ALANYA STUDIO CONCIERGE'))`,
      8000,
      'Showcase Alanya update'
    );
    assert.equal(await evalJs(`/monique/i.test(document.body.innerText)`), false);
    await assertNoOverflowAndClippedHeader('Showcase 375px', 375);
    await assertContrastWcag('Showcase 375px');

    for (const bp of [640, 768, 1024, 1280]) {
      await sendCdp('Emulation.setDeviceMetricsOverride', {
        width: bp,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 120));
      await assertNoOverflowAndClippedHeader(`Showcase ${bp}px`, bp);
    }

    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 100));

    // Mobile quick-access nav strip must be visible with Investors & Science
    const mobileNavLinks = await evalJs(`Array.from(document.querySelectorAll('nav[aria-label="Mobile Showcase Sections"] a, nav[aria-label="Mobile Showcase Sections"] button')).map(el => el.innerText.trim())`);
    assert.ok(mobileNavLinks.includes('Earbuds') && mobileNavLinks.includes('Investors') && mobileNavLinks.includes('Science'));

    // Showcase anchor scroll-mt-28 clearance on 375px & 1280px (sections never clipped behind sticky header)
    const assertAnchorClearance = async (bpLabel, selector, targetId) => {
      await evalJs(`document.querySelector('${selector}')?.click()`);
      await new Promise((r) => setTimeout(r, 380));
      const pos = await evalJs(`(() => {
        const hdr = document.querySelector('header')?.getBoundingClientRect();
        const sec = document.getElementById('${targetId}')?.getBoundingClientRect();
        return { hdrBottom: hdr ? hdr.bottom : 0, secTop: sec ? sec.top : -999 };
      })()`);
      assert.ok(
        pos.secTop >= pos.hdrBottom - 2,
        `Anchor #${targetId} clipped behind sticky header on ${bpLabel}: secTop=${pos.secTop}, hdrBottom=${pos.hdrBottom}`
      );
    };
    await assertAnchorClearance('Showcase 375px', 'nav[aria-label="Mobile Showcase Sections"] a[href="#demo"]', 'demo');
    await assertAnchorClearance('Showcase 375px', 'nav[aria-label="Mobile Showcase Sections"] a[href="#hardware"]', 'hardware');
    await assertAnchorClearance('Showcase 375px', 'nav[aria-label="Mobile Showcase Sections"] a[href="#pricing"]', 'pricing');

    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 844, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertAnchorClearance('Showcase 1280px', 'nav[aria-label="Showcase Sections"] a[href="#hardware"]', 'hardware');
    await assertAnchorClearance('Showcase 1280px', 'nav[aria-label="Showcase Sections"] a[href="#pricing"]', 'pricing');

    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 100));

    // Outcome cards carry ?target=...&duration=... deep links
    const outcomeHref = await evalJs(`Array.from(document.querySelectorAll('a')).find(a => /Deep Flow/i.test(a.innerText || ''))?.getAttribute('href') || ''`);
    assert.match(outcomeHref, /target=deep_flow/);
    assert.match(outcomeHref, /duration=45/);

    // 30s In-Ear Proof starts and stops cleanly
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Play 30s In-Ear Proof/i.test(b.innerText || ''))?.click()`);
    await waitUntil(
      `Boolean(Array.from(document.querySelectorAll('button')).find(b => /Stop Proof/i.test(b.innerText || '')))`,
      4000,
      'Showcase 30s Proof started'
    );
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Stop Proof/i.test(b.innerText || ''))?.click()`);

    // Clicking Open Studio locally updates history URL so reloads remain in Studio
    await evalJs(`Array.from(document.querySelectorAll('header a')).find(a => /Open Studio/i.test(a.innerText || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('input[type="number"]'))`, 6000, 'Transition Showcase -> Studio');
    assert.match(await evalJs(`window.location.search`), /surface=studio/);

    // =========================================================================
    // 2) STUDIO RESPONSIVE HEADER (375/640/768/1024/1280) + 90s LOCAL-ONLY FLOW
    // =========================================================================
    for (const bp of [375, 640, 768, 1024, 1280]) {
      await sendCdp('Emulation.setDeviceMetricsOverride', {
        width: bp,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 120));
      await assertNoOverflowAndClippedHeader(`Studio ${bp}px`, bp);
    }

    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=studio` });
    await waitUntil(
      `Boolean(document.querySelector('input[type="number"]'))`,
      8000,
      'Studio Beat 1 on 375px'
    );
    await assertNoOverflowAndClippedHeader('Studio Beat 1 375px', 375);
    await assertContrastWcag('Studio Beat 1 375px');

    // Fill Age 29, Gender Female, Role Founder, LEAVE checkbox UNCHECKED (genuine EEA/GPC opt-out!)
    await evalJs(`(() => {
      const ageInput = document.querySelector('input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (ageInput._valueTracker) ageInput._valueTracker.setValue('');
      setter.call(ageInput, '29');
      ageInput.dispatchEvent(new Event('input', { bubbles: true }));
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => /^female$/i.test((b.textContent || '').trim()))?.click();
      btns.find(b => /Founder/i.test(b.textContent || ''))?.click();
      const cb = document.querySelector('input[type="checkbox"]');
      if (cb && cb.checked) cb.click();
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /continue:\\s*current state/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label="Interactive 2D Neural State Compass"]'))`, 5000, 'Beat 2 local-only opt-out');
    await assertNoOverflowAndClippedHeader('Studio Beat 2 375px', 375);

    // Beat 2 -> Beat 3 -> Beat 4 -> Reveal -> PlayerView
    await evalJs(`document.querySelector('button[data-landmark="true"]')?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*target/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Sharp Alert Focus|Deep Uninterrupted Flow/i.test(b.textContent || '')));
    })()`, 5000, 'Beat 3 375px');
    await assertNoOverflowAndClippedHeader('Studio Beat 3 375px', 375);
    await assertContrastWcag('Studio Beat 3 375px');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Deep Uninterrupted Flow/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*music style/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || '')));
    })()`, 5000, 'Beat 4 375px');
    await assertNoOverflowAndClippedHeader('Studio Beat 4 375px', 375);

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /^skip/i.test((b.textContent || '').trim()))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || '')));
    })()`, 8000, 'Reveal 375px');
    await assertNoOverflowAndClippedHeader('Studio Reveal 375px', 375);
    await assertContrastWcag('Studio Reveal 375px');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(Array.from(document.querySelectorAll('button')).find(b => /End (Session|& Rate)/.test(b.textContent || '')))`, 8000, 'PlayerView 375px');
    await assertNoOverflowAndClippedHeader('Studio PlayerView 375px', 375);
    await assertContrastWcag('Studio PlayerView 375px');

    // Open & test PvtBenchmarkModal: 60-trial Lab switcher + false_start (<100ms / early tap) retry + 20-trial completion
    await evalJs(`(() => {
      if (!window.__origSetTimeout) window.__origSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => {
        const d = typeof delay === 'number' && delay >= 500 && delay <= 4500 ? 22 : delay;
        return window.__origSetTimeout(fn, d, ...args);
      };
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Run PVT/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Visual 1/RT Vigilance Check'))`, 4000, 'PVT Modal');
    await assertContrastWcag('PVT Modal 375px');

    // Verify 60-trial Lab mode switcher & revert back to 20-trial Standard
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Lab \\(60 trials/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Trial 1 / 60'))`, 3000, 'PVT 60-trial Lab mode');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Standard \\(20 trials/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Trial 1 / 20'))`, 3000, 'PVT 20-trial Standard mode');

    // Trigger false_start by tapping early during 'waiting', verify recovery -> then complete 20 valid trials
    await evalJs(`document.querySelector('button[data-pvt-target="true"]')?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Hold steady'))`, 2500, 'PVT waiting stage');
    await evalJs(`document.querySelector('button[data-pvt-target="true"]')?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Too early (< 100 ms)!'))`, 2500, 'PVT false_start stage');
    await assertContrastWcag('PVT False Start 375px');
    await evalJs(`document.querySelector('button[data-pvt-target="true"]')?.click()`);

    for (let trial = 0; trial < 20; trial++) {
      await waitUntil(`Boolean(document.body.innerText.includes('TAP NOW!'))`, 2500, `PVT trial ${trial + 1} flash`);
      await new Promise((r) => setTimeout(r, 125));
      await evalJs(`(() => {
        const t = document.querySelector('button[data-pvt-target="true"]');
        if (t) t.click();
      })()`);
    }
    await waitUntil(`Boolean(/Mean Inverse Speed \\(1\\/RT\\) · 20 Visual Trials/i.test(document.body.innerText))`, 4000, 'PVT 20-trial done stage');
    await assertContrastWcag('PVT Modal Done 375px');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Save 20-Trial 1\\/RT Benchmark/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Baseline Recorded:'))`, 4000, 'PVT baseline saved on PlayerView');
    await evalJs(`(() => { if (window.__origSetTimeout) window.setTimeout = window.__origSetTimeout; })()`);

    // Drive TappingTestModal end-to-end (pacing -> continuation taps -> result -> Done)
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Run \\(15s\\)/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Intrinsic Motor Rhythm Check'))`, 4000, 'Tapping Modal');
    await assertContrastWcag('Tapping Modal 375px');
    await evalJs(`(() => {
      window.__origPerfNow = performance.now.bind(performance);
      window.__origRaf = window.requestAnimationFrame.bind(window);
      const basePerf = window.__origPerfNow();
      window.__fakeTappingMs = 0;
      performance.now = () => basePerf + window.__fakeTappingMs;
      window.requestAnimationFrame = (cb) => window.__origRaf(() => cb(basePerf + window.__fakeTappingMs));
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Start 15s Tapping Check/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('button[data-tapping-target="true"]'))`, 3000, 'Tapping running stage');
    // Jump into continuation phase (5200 ms) and deliver 7 steady 600 ms continuation taps, then complete >=15100 ms
    for (let k = 0; k < 7; k++) {
      const tMs = 5400 + k * 600;
      await evalJs(`(() => {
        window.__fakeTappingMs = ${tMs};
        document.querySelector('button[data-tapping-target="true"]')?.click();
      })()`);
      await new Promise((r) => setTimeout(r, 25));
    }
    await evalJs(`(() => { window.__fakeTappingMs = 15200; })()`);
    await waitUntil(`Boolean(/Stability/i.test(document.body.innerText) && /ITI CV%/i.test(document.body.innerText))`, 4000, 'Tapping Modal result');
    await evalJs(`(() => {
      if (window.__origPerfNow) performance.now = window.__origPerfNow;
      if (window.__origRaf) window.requestAnimationFrame = window.__origRaf;
    })()`);
    await assertContrastWcag('Tapping Modal Result 375px');
    await evalJs(`Array.from(document.querySelectorAll('div.fixed.inset-0.z-50 button')).find(b => /^Done$/i.test((b.textContent || '').trim()))?.click()`);
    await waitUntil(`!document.body.innerText.includes('Intrinsic Motor Rhythm Check')`, 4000, 'Tapping Modal closed via Done');
    await waitUntil(`Boolean(document.body.innerText.includes('Tapping CV'))`, 4000, 'Tapping CV recorded on PlayerView');

    // Drive HugginsCheckModal end-to-end (6 rounds -> result -> Apply Profile & Resume)
    await evalJs(`(() => {
      if (!window.__origSetTimeout) window.__origSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => {
        const d = typeof delay === 'number' && delay >= 400 && delay <= 3000 ? 15 : delay;
        return window.__origSetTimeout(fn, d, ...args);
      };
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Verify Headphones/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Huggins Pitch'))`, 4000, 'Huggins Modal');
    await assertContrastWcag('Huggins Modal 375px');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Start 6-Round Check/i.test(b.textContent || ''))?.click()`);
    for (let round = 0; round < 6; round++) {
      await waitUntil(`Boolean(document.body.innerText.includes('Pick the sound that contained'))`, 4000, `Huggins round ${round + 1} choose`);
      await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Sound 1/i.test(b.textContent || ''))?.click()`);
    }
    await waitUntil(`Boolean(document.body.innerText.includes('Apply Profile & Resume'))`, 4000, 'Huggins Modal result stage');
    await assertContrastWcag('Huggins Modal Result 375px');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Apply Profile & Resume/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`!document.body.innerText.includes('35s Dichotic Headphone Check')`, 4000, 'Huggins Modal closed after completion');
    await evalJs(`(() => { if (window.__origSetTimeout) window.setTimeout = window.__origSetTimeout; })()`);

    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Go Pro/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Unlimited') || document.body.innerText.includes('Pro'))`, 4000, 'UpgradePro Modal');
    await assertContrastWcag('UpgradePro Modal 375px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.querySelector('div.fixed.inset-0.z-50')`, 4000, 'UpgradePro Modal closed via Escape');

    // End Session -> Local-Only Debrief Summary -> Start a New Session -> HeroLandingView (375px & 1280px)
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /End Session/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('See Local Session Summary'))`, 5000, 'Local-only Debrief');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /See Local Session Summary/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Local-Only Privacy Mode'))`, 5000, 'Local-Only Privacy Summary');
    await assertContrastWcag('Local-Only Debrief 375px');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Start a New Session/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label="Interactive 2D Neural Brain Map"]'))`, 6000, 'HeroLandingView 375px');
    const quickCount375 = await evalJs(`(() => {
      const labels = ['Stressed', 'Tired', 'Brain Fog', 'Distracted', 'Anxious', 'Calm'];
      const txt = document.body.innerText;
      return labels.filter(l => txt.includes(l)).length;
    })()`);
    assert.equal(quickCount375, 6, 'HeroLandingView must expose all 6 quick starter states');
    await assertNoOverflowAndClippedHeader('HeroLandingView 375px', 375);
    await assertContrastWcag('HeroLandingView 375px');

    // Also test DatasetInquiryModal from HeroLandingView CohortIntelligenceShowcase at 375px & 1280px
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /License Full Dataset/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Unlock Full Aggregated Cohort Datasets'))`, 4000, 'DatasetInquiryModal 375px');
    await assertNoOverflowAndClippedHeader('DatasetInquiryModal 375px', 375);
    await assertContrastWcag('DatasetInquiryModal 375px');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertContrastWcag('DatasetInquiryModal 1280px');
    await evalJs(`(() => {
      const modal = document.querySelector('div.fixed.inset-0.z-50');
      const emailIn = modal.querySelector('input[type="email"]');
      const orgIn = modal.querySelectorAll('input[type="text"]')[0];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (emailIn._valueTracker) emailIn._valueTracker.setValue('');
      setter.call(emailIn, 'researcher@lab.org');
      emailIn.dispatchEvent(new Event('input', { bubbles: true }));
      if (orgIn._valueTracker) orgIn._valueTracker.setValue('');
      setter.call(orgIn, 'Cognitive Sound Lab');
      orgIn.dispatchEvent(new Event('input', { bubbles: true }));
      modal.querySelector('button[type="submit"]')?.click();
    })()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Dataset Request Received') && document.body.innerText.includes('inq_e2e_01'))`, 4000, 'DatasetInquiryModal submitted');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Return to nootropic\\.fm/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`!document.querySelector('div.fixed.inset-0.z-50')`, 4000, 'DatasetInquiryModal closed');

    // HeroLandingView 1280px WCAG + 2D Map Step 1 + Step 2 -> Discover
    await assertNoOverflowAndClippedHeader('HeroLandingView 1280px', 1280);
    await assertContrastWcag('HeroLandingView 1280px');

    // =========================================================================
    // 3) DESKTOP 1280x900 & MOBILE 375x812: Outcome Deep-Link + Study Lab + Insights (Admin Export Modal) + OnboardingView
    // =========================================================================
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=studio&target=deep_flow&duration=45` });
    await waitUntil(`Boolean(document.body.innerText.includes('Selected shift:') && document.body.innerText.includes('Deep Flow State (45m)'))`, 6000, 'Outcome Deep-Link pre-selection');
    await waitUntil(`Boolean(Array.from(document.querySelectorAll('button')).find(b => /Continue:\\s*Choose Music Style/i.test(b.textContent || '')))`, 4000, 'Beat 1 Deep-Link CTA matches destination Beat 4');

    // Restore sync pass to access OnboardingView ('Edit Profile Details') & verify both 375px and 1280px
    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Restore Sync QR|Neural Fingerprint Pass/i.test(b.getAttribute('aria-label') || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Restore your Neural Pass on this device'))`, 4000, 'Identity Restore Modal');
    await evalJs(`(() => {
      const inp = document.querySelector('div.fixed.inset-0.z-50 input[placeholder="NFM-XXXX-XXXX"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (inp._valueTracker) inp._valueTracker.setValue('');
      setter.call(inp, 'NFM-TEST-2027');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('div.fixed.inset-0.z-50 button')).find(b => /^Restore$/i.test((b.textContent || '').trim()))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Welcome back, Elena'))`, 5000, 'Profile restored');
    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Neural Fingerprint Pass/i.test(b.getAttribute('aria-label') || ''))?.click()`);
    await waitUntil(`Boolean(Array.from(document.querySelectorAll('button')).find(b => /Edit Profile Details/i.test(b.textContent || '')))`, 4000, 'Neural Pass Modal with Edit Profile');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Edit Profile Details/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Refine your Neural Identity'))`, 5000, 'OnboardingView 1280px');
    await assertNoOverflowAndClippedHeader('OnboardingView 1280px', 1280);
    await assertContrastWcag('OnboardingView 1280px');

    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertNoOverflowAndClippedHeader('OnboardingView 375px', 375);
    await assertContrastWcag('OnboardingView 375px');

    // Verify OnboardingView age backspace stays '' (never snaps to 0) & 'Other' role renders single profession box
    const onbCheck = await evalJs(`(() => {
      const ageIn = document.getElementById('onb-age');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (ageIn._valueTracker) ageIn._valueTracker.setValue('34');
      setter.call(ageIn, '');
      ageIn.dispatchEvent(new Event('input', { bubbles: true }));
      const emptyVal = ageIn.value;
      setter.call(ageIn, '32');
      ageIn.dispatchEvent(new Event('input', { bubbles: true }));
      const otherBtn = Array.from(document.querySelectorAll('button')).find(b => /^Other$/i.test((b.textContent || '').trim()));
      otherBtn?.click();
      return { emptyVal };
    })()`);
    assert.equal(onbCheck.emptyVal, '', 'Clearing OnboardingView age input must stay empty instead of snapping to 0');
    await waitUntil(`Boolean(document.getElementById('onb-custom-role') && !document.getElementById('onb-occupation'))`, 3000, 'OnboardingView single profession input for Other role');
    await evalJs(`(() => {
      const inp = document.getElementById('onb-custom-role');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (inp._valueTracker) inp._valueTracker.setValue('');
      setter.call(inp, 'Acoustic Engineer');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // Save Onboarding changes -> cleanly returns to CheckInView
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Save Profile Changes/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Welcome back, Elena'))`, 5000, 'OnboardingView save -> CheckInView');

    // Open Research Brain (Insights) on 375px AND 1280px + Admin Dataset Export Modal
    await evalJs(`Array.from(document.querySelectorAll('nav[aria-label="Studio Mobile Navigation"] button')).find(b => /Research/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Research Brain') && document.body.innerText.includes('Implicit Retention'))`, 5000, 'InsightsView 375px');
    await assertNoOverflowAndClippedHeader('InsightsView 375px', 375);
    await assertContrastWcag('InsightsView 375px');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Admin Dataset Export/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Protected Research Export'))`, 4000, 'Insights Admin Export Modal 375px');
    await assertNoOverflowAndClippedHeader('Insights Admin Export Modal 375px', 375);
    await assertContrastWcag('Insights Admin Export Modal 375px');

    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertContrastWcag('Insights Admin Export Modal 1280px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Protected Research Export')`, 4000, 'Admin Export Modal closed via Escape');
    await assertNoOverflowAndClippedHeader('InsightsView 1280px', 1280);
    await assertContrastWcag('InsightsView 1280px');

    // Open Study Lab -> verify 375px & 1280px layout + WCAG contrast + accurate 20-trial (~75s) PVT text
    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Study Lab/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('20-trial (~75s) Pre/Post PVT'))`, 5000, 'Study Lab updated PVT text');
    await assertNoOverflowAndClippedHeader('StudyLab 1280px', 1280);
    await assertContrastWcag('StudyLab 1280px');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertNoOverflowAndClippedHeader('StudyLab 375px', 375);
    await assertContrastWcag('StudyLab 375px');

    // Open Privacy & Delete Data modal -> WCAG + Escape close
    await evalJs(`Array.from(document.querySelectorAll('footer button')).find(b => /Privacy, Credits/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Privacy & Your Data'))`, 4000, 'Privacy Modal');
    await assertContrastWcag('Privacy Modal 375px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Official Department Channels')`, 4000, 'Privacy Modal closed via Escape');

    // Open Sound Systems -> WCAG + Escape close
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Sound Systems|Earbuds/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`/Acoustic Hardware Lab/i.test(document.body.innerText)`, 6000, 'Sound Systems modal');
    await assertContrastWcag('SoundSystems Modal 1280px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Why NootropicFM Is Engineered Exclusively')`, 4000, 'Sound Systems closed via Escape');

    assert.deepEqual(runtimeErrors, [], `Unexpected browser runtime errors: ${JSON.stringify(runtimeErrors)}`);
    ws.close();
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {}
    await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 250));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
    } catch {}
  }
});

test('Headless Edge E2E: PlayerView suspended-AudioContext autoplay recovery + deferred Alanya voice cue', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found');
    return;
  }

  const distDir = path.join(ROOT, 'dist', 'client');
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
  };

  const makeWav = (durationSec = 0.2, sampleRate = 48000) => {
    const numSamples = Math.floor(durationSec * sampleRate);
    const buf = Buffer.alloc(44 + numSamples * 2);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + numSamples * 2, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(numSamples * 2, 40);
    return buf;
  };
  const wavBuf = makeWav();
  const voiceCalls = [];

  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    if (cleanUrl === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ config: { regionRequiresOptIn: true, countryCode: 'RO', customLiveGenAvailable: false, lyriaRealtimeAvailable: false, workersAiCompilerAvailable: false, stripeBillingAvailable: false, musicProvider: 'cache_only', dailyCapMax: 0, dailyCapRemaining: 0, popularCustomVibes: [] } }));
      return;
    }
    if (cleanUrl === '/api/identity/me') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ authenticated: false, profile: null, pendingDebrief: null }));
      return;
    }
    if (cleanUrl === '/api/audio/catalog') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ tracksByGenre: { nootropic_trance: [], lofi_keys: [], deep_electronic: [], cinematic_strings: [], jazz_rhodes: [], acoustic_pluck: [], nature_rain: [], dub_reggae: [], ambient_space: [], solo_piano: [], bossa_nova: [] } }));
      return;
    }
    if (cleanUrl === '/api/voice/voices') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ available: true, provider: 'elevenlabs', defaultVoiceId: 'iRb5bX2IzJDUAwy4jeki', voices: [{ voiceId: 'iRb5bX2IzJDUAwy4jeki', name: 'Alanya - Smooth', shortLabel: 'Alanya · Smooth', category: 'custom' }] }));
      return;
    }
    if (cleanUrl === '/api/voice/concierge') {
      let bodyStr = '';
      req.on('data', (c) => { bodyStr += c; });
      req.on('end', () => {
        voiceCalls.push(JSON.parse(bodyStr || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ available: true, cueType: 'intro_full', greetingUrl: '/api/voice/greet.wav', bodyUrl: '/api/voice/body.wav', breathPauseMs: 250, transcript: 'Take a gentle breath. Put both earbuds in.' }));
      });
      return;
    }
    if (cleanUrl === '/api/voice/greet.wav' || cleanUrl === '/api/voice/body.wav') {
      res.writeHead(200, { 'Content-Type': 'audio/wav', Connection: 'close' });
      res.end(wavBuf);
      return;
    }
    if (cleanUrl === '/api/protocol/start' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({
          recommendation: {
            sessionId: 'eph_autoplay_01',
            ephemeralMode: true,
            isControlTrial: false,
            isExploration: false,
            confidencePct: 84,
            cohortTrials: 5,
            cohortLabel: '18–95 · Founder',
            currentState: 'distracted',
            microStateId: 'brain_fog',
            microStateLabel: 'Brain Fog',
            arousalPct: 38,
            clarityPct: 32,
            baselineScore: 2,
            targetState: 'deep_flow',
            environment: 'office',
            device: 'headphones',
            plannedDurationMin: 25,
            safetyMode: false,
            safetyWarnings: [],
            audioSource: 'studio_library',
            fallbackCoreGenre: 'nootropic_trance',
            rationale: 'Nested 6x40 Hz phase lock.',
            personalizationSummary: ['190–4,500 Hz LR4'],
            formulaIngredients: [],
            arm: { id: 'nootropic-trance-6x40hz', name: '6×40 Hz Signature Lock', studyIds: ['woods_2024'] },
            params: { genre: 'nootropic_trance', energyTier: 'focus', bpm: 120, modulationHz: 6, modulationDepth: 0.34, crossoverHz: 190, upperCrossoverHz: 4500, stereoAmSpread: true, speakerSafeEQ: false, binauralOffsetHz: 0, noiseColor: 'pink', noiseLevel: 0.08, harmonicMode: 'warm_min9', rootNoteHz: 110, pulseIntensity: 0.55, filterCutoffHz: 2400 },
            studies: [{ id: 'woods_2024', authors: 'Woods, K. et al.', year: '2024', journal: 'PLOS ONE', title: 'Rapid cortical phase locking', summary: 'Phase-locked AM.', soundEffect: '6x40 Hz', doiOrUrl: 'https://doi.org/10.1371/journal.pone.0298921' }],
            livePubMedPapers: [],
          },
        }));
      });
      return;
    }
    if (cleanUrl.startsWith('/api/')) {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    let filePath = path.resolve(distDir, relPath);
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', Connection: 'close' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfm-autoplay-e2e-'));

  let resolvePort;
  const cdpPortPromise = new Promise((res) => { resolvePort = res; });
  const child = spawn(
    edgePath,
    ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
    const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderrBuf);
    if (m) resolvePort(Number(m[1]));
  });

  try {
    const debugPort = await cdpPortPromise;
    let targets = null;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
      if (res?.ok) {
        const list = await res.json();
        if (list.some((x) => x.type === 'page')) { targets = list; break; }
      }
    }
    const pageTarget = targets.find((x) => x.type === 'page') ?? targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((r, rej) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', rej, { once: true }); });

    let msgId = 0;
    const runtimeErrors = [];
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.method === 'Runtime.exceptionThrown') {
        runtimeErrors.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
      }
    });
    const sendCdp = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++msgId;
        const onMsg = (evt) => {
          const msg = JSON.parse(String(evt.data));
          if (msg.id === id) {
            ws.removeEventListener('message', onMsg);
            if (msg.error) rej(new Error(JSON.stringify(msg.error)));
            else res(msg.result);
          }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalJs = async (expression) => {
      const out = await sendCdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || 'Eval error');
      return out.result?.value;
    };
    const waitUntil = async (expr, timeoutMs = 8000, desc = 'condition') => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const val = await evalJs(expr);
        if (val) return val;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Timed out waiting for ${desc}`);
    };

    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');
    // Force initial AudioContext into suspended autoplay-blocked state until explicit user gesture
    await sendCdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const OrigAudioContext = window.AudioContext || window.webkitAudioContext;
        if (!OrigAudioContext) return;
        let unlockedByGesture = false;
        window.addEventListener('pointerdown', () => { unlockedByGesture = true; }, { capture: true });
        class AutoplayBlockedAudioContext extends OrigAudioContext {
          constructor(opts) {
            super(opts);
            this.__blocked = !unlockedByGesture;
            const origStateDesc = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state');
            Object.defineProperty(this, 'state', {
              configurable: true,
              get: () => (this.__blocked ? 'suspended' : origStateDesc.get.call(this)),
            });
          }
          resume() {
            if (!unlockedByGesture && this.__blocked) {
              return new Promise(() => {});
            }
            this.__blocked = false;
            return super.resume();
          }
        }
        window.AudioContext = AutoplayBlockedAudioContext;
        if (window.webkitAudioContext) window.webkitAudioContext = AutoplayBlockedAudioContext;
      })();`,
    });

    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=studio` });
    await waitUntil(`Boolean(document.querySelector('input[type="number"]'))`, 8000, 'Beat 1');

    // Fill Beat 1 -> Beat 2 -> Beat 3 -> Beat 4 -> Reveal -> Apply & Start
    await evalJs(`(() => {
      const ageInput = document.querySelector('input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (ageInput._valueTracker) ageInput._valueTracker.setValue('');
      setter.call(ageInput, '31');
      ageInput.dispatchEvent(new Event('input', { bubbles: true }));
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => /^female$/i.test((b.textContent || '').trim()))?.click();
      btns.find(b => /Founder/i.test(b.textContent || ''))?.click();
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /continue:\\s*current state/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label="Interactive 2D Neural State Compass"]'))`, 5000, 'Beat 2');
    await evalJs(`document.querySelector('button[data-landmark="true"]')?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*target/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Deep Uninterrupted Flow/i.test(b.textContent || '')));
    })()`, 5000, 'Beat 3');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Deep Uninterrupted Flow/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*music style/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || '')));
    })()`, 5000, 'Beat 4');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /^skip/i.test((b.textContent || '').trim()))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || '')));
    })()`, 8000, 'Reveal');

    // Note: use JS .click() (no pointerdown) so unlockedByGesture stays false on Apply Layers & Start!
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || ''))?.click()`);

    // Assert Start Audio interruption banner appears without hanging and Alanya has NOT been called yet
    await waitUntil(`Boolean(document.body.innerText.includes('Start Audio') && document.body.innerText.includes('Browser audio is awaiting a quick tap to start'))`, 6000, 'Start Audio interruption banner');
    assert.equal(voiceCalls.length, 0, 'Alanya voice cue must stay deferred while AudioContext is suspended');

    // Real pointer tap on "Start Audio" banner via CDP Input.dispatchMouseEvent
    const bannerBox = await evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Start Audio'));
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await sendCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: bannerBox.x, y: bannerBox.y, button: 'left', clickCount: 1 });
    await sendCdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bannerBox.x, y: bannerBox.y, button: 'left', clickCount: 1 });

    // Assert banner clears, Alanya deferred cue fires, and playback timer advances
    await waitUntil(`!document.body.innerText.includes('Browser audio is awaiting a quick tap to start')`, 5000, 'Interruption banner cleared after Start Audio tap');
    await waitUntil(`Boolean(document.querySelector('button[aria-label="Pause"]'))`, 5000, 'Player transitioned to playing state');
    assert.equal(voiceCalls.length, 1, 'Deferred Alanya voice cue must fire exactly once on Start Audio resume');
    assert.equal(voiceCalls[0].cueType, 'intro_full');

    await waitUntil(`!/00:00/.test(document.body.innerText.match(/\\d{2}:\\d{2}/)?.[0] || '00:00')`, 4000, 'Session timer advancing after audio resume');

    // Also verify tapping the Play button directly (rather than the banner) while AudioContext is suspended does NOT self-pause
    await sendCdp('Page.reload', { ignoreCache: false });
    await waitUntil(`Boolean(document.querySelector('input[type="number"]'))`, 8000, 'Reload Beat 1 for Play-button autoplay test');
    await evalJs(`(() => {
      const ageInput = document.querySelector('input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (ageInput._valueTracker) ageInput._valueTracker.setValue('');
      setter.call(ageInput, '31');
      ageInput.dispatchEvent(new Event('input', { bubbles: true }));
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => /^female$/i.test((b.textContent || '').trim()))?.click();
      btns.find(b => /Founder/i.test(b.textContent || ''))?.click();
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /continue:\\s*current state/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label="Interactive 2D Neural State Compass"]'))`, 5000, 'Beat 2 (Play-button test)');
    await evalJs(`document.querySelector('button[data-landmark="true"]')?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*target/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Deep Uninterrupted Flow/i.test(b.textContent || '')));
    })()`, 5000, 'Beat 3 (Play-button test)');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Deep Uninterrupted Flow/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*music style/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || '')));
    })()`, 5000, 'Beat 4 (Play-button test)');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /^skip/i.test((b.textContent || '').trim()))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || '')));
    })()`, 8000, 'Reveal (Play-button test)');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Start Audio') && document.querySelector('button[aria-label="Play"]'))`, 6000, 'Play button visible while suspended');
    const playBtnBox = await evalJs(`(() => {
      const b = document.querySelector('button[aria-label="Play"]');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await sendCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: playBtnBox.x, y: playBtnBox.y, button: 'left', clickCount: 1 });
    await sendCdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: playBtnBox.x, y: playBtnBox.y, button: 'left', clickCount: 1 });
    await waitUntil(`Boolean(document.querySelector('button[aria-label="Pause"]') && !document.body.innerText.includes('Browser audio is awaiting a quick tap to start'))`, 5000, 'Play button tap transitions to playing without self-pausing');
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(await evalJs(`Boolean(document.querySelector('button[aria-label="Pause"]'))`), 'Play button must remain in Pause (playing) state after click completes');
    assert.equal(voiceCalls.length, 2, 'Deferred Alanya voice cue must fire on Play button resume too');

    assert.deepEqual(runtimeErrors, [], `Unexpected browser runtime errors: ${JSON.stringify(runtimeErrors)}`);
    ws.close();
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 250));
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 }); } catch {}
  }
});
