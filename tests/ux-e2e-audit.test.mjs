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
      res.end(JSON.stringify({ authenticated: false, profile: null, pendingDebrief: null }));
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
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ available: false, cueType: 'intro_full', breathPauseMs: 720, transcript: '' }));
      });
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
            personalArms: [],
            cohorts: [],
            recentSessions: [],
          },
        })
      );
      return;
    }
    if (cleanUrl === '/api/studies/leaderboard') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ leaderboard: [] }));
      return;
    }
    if (cleanUrl === '/api/intelligence/cohorts') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ cohorts: [], globalRetention: null }));
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

    // Open & Escape-close PVT, Tapping, Huggins, and UpgradePro modals on 375px
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Run PVT/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Visual 1/RT Vigilance Check'))`, 4000, 'PVT Modal');
    await assertContrastWcag('PVT Modal 375px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Visual 1/RT Vigilance Check')`, 4000, 'PVT Modal closed via Escape');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Run \\(15s\\)/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Intrinsic Motor Rhythm Check'))`, 4000, 'Tapping Modal');
    await assertContrastWcag('Tapping Modal 375px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Intrinsic Motor Rhythm Check')`, 4000, 'Tapping Modal closed via Escape');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Verify Headphones/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Huggins Pitch'))`, 4000, 'Huggins Modal');
    await assertContrastWcag('Huggins Modal 375px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('35s Dichotic Headphone Check')`, 4000, 'Huggins Modal closed via Escape');

    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Go Pro/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Unlimited') || document.body.innerText.includes('Pro'))`, 4000, 'UpgradePro Modal');
    await assertContrastWcag('UpgradePro Modal 375px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.querySelector('div.fixed.inset-0.z-50')`, 4000, 'UpgradePro Modal closed via Escape');

    // End Session -> Local-Only Debrief Summary
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /End Session/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('See Local Session Summary'))`, 5000, 'Local-only Debrief');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /See Local Session Summary/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Local-Only Privacy Mode'))`, 5000, 'Local-Only Privacy Summary');
    await assertContrastWcag('Local-Only Debrief 375px');

    // =========================================================================
    // 3) DESKTOP 1280x900: Outcome Deep-Link + Study Lab & Insights + Escape Modals
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

    // Open Study Lab -> verify accurate 20-trial (~75s) PVT text + WCAG contrast
    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Study Lab/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('20-trial (~75s) Pre/Post PVT'))`, 5000, 'Study Lab updated PVT text');
    await assertContrastWcag('StudyLab 1280px');

    // Open Research Brain (Insights) -> verify WCAG contrast
    await evalJs(`Array.from(document.querySelectorAll('header button')).find(b => /Research/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Research Brain') || document.body.innerText.includes('Cohort'))`, 5000, 'InsightsView 1280px');
    await assertContrastWcag('InsightsView 1280px');

    // Open Sound Systems -> WCAG + Escape close
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
