/**
 * nootropic.fm — Circadian Daylight/Night Mode, Standalone NootropicFM Lock & Earbuds-Only Suite
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
const { resolveCircadianTheme } = await import('../src/lib/circadianTheme.ts');
const { DEVICE_LABELS, STUDIO_MIX_GENRES } = await import('../shared/types.ts');
const { selectProtocolRecommendation } = await import('../shared/protocols.ts');
const { buildVoiceConciergePlan } = await import('../shared/voiceConcierge.ts');

test('resolveCircadianTheme switches automatically between Daylight (07:00-19:00) and Night (19:00-07:00)', () => {
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T10:30:00')), 'daylight');
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T18:59:00')), 'daylight');
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T19:00:00')), 'night');
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T03:15:00')), 'night');
  assert.equal(resolveCircadianTheme('daylight', new Date('2026-11-26T23:00:00')), 'daylight');
  assert.equal(resolveCircadianTheme('night', new Date('2026-11-26T12:00:00')), 'night');
});

test('STUDIO_MIX_GENRES cleanly isolates standalone NootropicFM Mode from the 10 Studio Mix genres', () => {
  assert.equal(STUDIO_MIX_GENRES.length, 10);
  assert.ok(!STUDIO_MIX_GENRES.includes('nootropic_trance'));
  assert.equal(DEVICE_LABELS.headphones, 'In-Ear Buds');
  assert.match(DEVICE_LABELS.speakers, /Degraded/i);
});

test('Standalone NootropicFM Mode locks 6x40 Hz arm across targets and strictly disables 25% sham control dilution', () => {
  const dummyProfile = {
    id: 'anon_trance_test',
    displayName: 'Vasi',
    age: 34,
    ageBand: '25-34',
    role: 'entrepreneur',
    texturePref: 'rhythmic_pulse',
    noiseSensitivity: 'medium',
    defaultDevice: 'headphones',
    primaryChallenge: 'distraction',
    researchConsent: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (let i = 0; i < 12; i++) {
    const rec = selectProtocolRecommendation({
      sessionId: `ses_trance_${i}`,
      profile: dummyProfile,
      currentState: 'distracted',
      baselineScore: 2,
      targetState: 'energy_lift',
      customGoalSlug: 'trance_lock',
      environment: 'office',
      device: 'headphones',
      durationMin: 25,
      requestedGenre: 'nootropic_trance',
      cohortStats: [],
      profileStats: [],
      recentControlFlags: [false, false, false],
      allowControlTrial: true,
    });
    assert.equal(rec.arm.id, 'nootropic-trance-6x40hz');
    assert.equal(rec.params.genre, 'nootropic_trance');
    assert.equal(rec.isControlTrial, false, 'Standalone NootropicFM Mode must never be diluted by sham control');
  }
});

test('Voice Concierge explicitly reinforces In-Ear Buds seal and warns gently when on degraded speakers', () => {
  const earbudsTrance = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'Vasi',
    currentState: 'calm_neutral',
    targetState: 'deep_flow',
    armId: 'nootropic-trance-6x40hz',
    modulationHz: 6,
    genre: 'nootropic_trance',
    isDriving: false,
    device: 'headphones',
    timeBucket: 'morning',
  });
  assert.match(earbudsTrance.bodyText, /earbuds/i);

  const degradedSpeakers = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'Vasi',
    currentState: 'distracted',
    targetState: 'alert_focus',
    armId: 'beta-16hz',
    modulationHz: 16,
    genre: 'deep_electronic',
    isDriving: false,
    device: 'speakers',
    timeBucket: 'afternoon',
  });
  assert.match(degradedSpeakers.bodyText, /earbuds/i);
  assert.match(degradedSpeakers.bodyCacheSlug, /_spk$/);
});

function findEdgeExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => fs.existsSync(p));
}

test('Headless Edge: Daylight/Night segmented switch, persistence across reload, and >=3.0:1 button contrast across all views', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found');
    return;
  }
  const distDir = path.join(ROOT, 'dist', 'client');
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/client/index.html missing');

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
            regionRequiresOptIn: false,
            countryCode: 'US',
            customLiveGenAvailable: false,
            lyriaRealtimeAvailable: false,
            workersAiCompilerAvailable: false,
            stripeBillingAvailable: false,
            musicProvider: 'cache_only',
            dailyCapMax: 0,
            dailyCapRemaining: 0,
            popularCustomVibes: [],
          },
        })
      );
      return;
    }
    if (cleanUrl === '/api/profile' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(
          JSON.stringify({
            profile: {
              id: 'anon_daylight_test',
              displayName: 'Alex',
              age: 32,
              ageBand: '25-34',
              gender: 'male',
              role: 'knowledge_worker',
              noiseSensitivity: 'medium',
              defaultDevice: 'headphones',
              primaryChallenge: 'distraction',
              researchConsent: true,
              planTier: 'pro',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            profileToken: 'tok_daylight_test',
            syncCode: 'NFM-DAYL-TEST',
          })
        );
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
              sessionId: 'ses_daylight_test',
              cohortKey: '25-34|office|deep_flow',
              cohortLabel: 'Ages 25-34 · Office · Deep Flow',
              arm: {
                id: 'nootropic-trance-6x40hz',
                name: 'NootropicFM Trance · 6×40 Hz CFC',
                tagline: '6 Hz Theta × 40 Hz Gamma Lock',
                description: 'Standalone NootropicFM Signature Mode',
                targetStates: ['deep_flow'],
                drivingSafe: false,
                priorAlpha: 5,
                priorBeta: 1,
                studyIds: ['lisman-jensen-2013-theta-gamma-cfc'],
                baseParams: {
                  modulationHz: 6,
                  modulationDepth: 0.42,
                  crossoverHz: 190,
                  upperCrossoverHz: 4500,
                  bpm: 120,
                  pulseIntensity: 0.55,
                  noiseColor: 'pink',
                  noiseLevel: 0.06,
                  harmonicMode: 'suspended_open',
                  rootNoteHz: 110,
                  filterCutoffHz: 2600,
                  speakerSafeEQ: false,
                  antiMonotonyCycleMin: 0,
                  binauralOffsetHz: 0,
                },
              },
              params: {
                modulationHz: 6,
                modulationDepth: 0.42,
                crossoverHz: 190,
                upperCrossoverHz: 4500,
                stereoAmSpread: true,
                bpm: 120,
                pulseIntensity: 0.55,
                noiseColor: 'pink',
                noiseLevel: 0.06,
                harmonicMode: 'suspended_open',
                rootNoteHz: 110,
                filterCutoffHz: 2600,
                speakerSafeEQ: false,
                antiMonotonyCycleMin: 0,
                binauralOffsetHz: 0,
                genre: 'nootropic_trance',
                genreSelectionMode: 'user_chosen',
                energyTier: 'focus',
              },
              isExploration: false,
              isControlTrial: false,
              ephemeralMode: true,
              safetyMode: false,
              safetyWarnings: [],
              audioSource: 'generative_live',
              fallbackCoreGenre: 'nootropic_trance',
              personalizationSummary: ['Standalone NootropicFM Mode'],
              formulaIngredients: [
                { role: 'Layer 1', compound: '6x40 Hz CFC', dose: '42%', evidenceTag: 'Lisman 2013' },
              ],
              rationale: 'Phase-locked 6x40 Hz flow lock.',
              studies: [
                {
                  id: 'lisman-jensen-2013-theta-gamma-cfc',
                  authors: 'Lisman, J. E., & Jensen, O.',
                  year: 2013,
                  journal: 'Neuron',
                  title: 'The theta-gamma neural code',
                  mechanism: 'Theta-gamma cross-frequency coupling',
                  soundEffect: '6 Hz envelope nested with 40 Hz bursts',
                  summary: 'Phase-amplitude coupling supports deep binding.',
                  caveat: 'Wellness only.',
                  doiOrUrl: 'https://doi.org/10.1016/j.neuron.2013.03.007',
                  applicableTargets: ['deep_flow'],
                },
              ],
              confidencePct: 92,
              cohortTrials: 12,
              profileTrials: 1,
              plannedDurationMin: 25,
              currentState: 'distracted',
              microStateId: 'brain_fog',
              microStateLabel: 'Brain Fog',
              arousalPct: 35,
              clarityPct: 30,
              targetState: 'deep_flow',
              baselineScore: 2,
              environment: 'office',
              device: 'headphones',
            },
          })
        );
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfm-daylight-e2e-'));

  let resolvePort;
  const cdpPortPromise = new Promise((res, rej) => {
    resolvePort = { res, rej };
  });

  const child = spawn(
    edgePath,
    [
      '--headless=new',
      '--disable-gpu',
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
    if (m) resolvePort.res(Number(m[1]));
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

    const pageErrors = [];
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.method === 'Runtime.exceptionThrown') {
        pageErrors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'exception');
      }
    });

    const waitUntil = async (expr, timeoutMs = 8000, desc = 'condition') => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const val = await evalJs(expr);
        if (val) return val;
        await new Promise((r) => setTimeout(r, 120));
      }
      const diag = await evalJs(`document.body ? document.body.innerHTML.slice(0, 400) : 'nobody'`).catch(() => '');
      throw new Error(`Timed out waiting for ${desc} | errs=${JSON.stringify(pageErrors)} | dom=${diag}`);
    };

    const assertContrastClean = async (stageLabel) => {
      await evalJs(`new Promise((resolve) => {
        for (const anim of document.getAnimations()) {
          if (typeof CSSTransition !== 'undefined' && anim instanceof CSSTransition) {
            try { anim.finish(); } catch {}
          }
        }
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      })`);
      const violations = await evalJs(`(() => {
        const parseRgb = (str) => {
          const m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
          if (!m) return null;
          return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
        };
        const relLum = ({ r, g, b }) => {
          const f = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const blend = (fg, bg) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
          a: 1,
        });
        const effectiveBg = (el) => {
          const layers = [];
          let cur = el;
          while (cur && cur.nodeType === 1) {
            const c = parseRgb(getComputedStyle(cur).backgroundColor);
            if (c && c.a > 0) layers.push(c);
            cur = cur.parentElement;
          }
          let res = parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 241, g: 245, b: 249, a: 1 };
          res.a = 1;
          for (let i = layers.length - 1; i >= 0; i--) res = blend(layers[i], res);
          return res;
        };
        const bad = [];
        for (const el of document.querySelectorAll('button, h1, h2, h3, label, p, span, a, code, kbd, strong')) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || Number(st.opacity) < 0.45) continue;
          if (el.closest('[aria-hidden="true"]')) continue;
          // Only check leaf-ish elements with direct text nodes so parent wrappers don't double-report
          const hasDirectText = Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0
          );
          if (!hasDirectText && el.tagName !== 'BUTTON') continue;
          if (!(el.innerText || '').trim()) continue;
          const fgRaw = parseRgb(st.color);
          const bg = effectiveBg(el);
          if (!fgRaw || !bg) continue;
          const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
          const l1 = Math.max(relLum(fg), relLum(bg));
          const l2 = Math.min(relLum(fg), relLum(bg));
          const ratio = (l1 + 0.05) / (l2 + 0.05);
          const fontSize = parseFloat(st.fontSize) || 14;
          const minReq = fontSize >= 18 ? 3.0 : 4.5;
          if (ratio < minReq) {
            bad.push({ tag: el.tagName, text: (el.innerText || '').trim().slice(0, 32), ratio: Number(ratio.toFixed(2)), minReq, color: st.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')' });
          }
        }
        return bad;
      })()`);
      assert.deepEqual(violations, [], `Contrast violations in ${stageLabel}: ${JSON.stringify(violations)}`);
    };

    const assertDaylightLayoutAndSurfaces = async (stageLabel, expectedWidth) => {
      const check = await evalJs(`(() => {
        const overflow = document.documentElement.scrollWidth - ${expectedWidth};
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const parseRgb = (str) => {
          const m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
          if (!m) return null;
          return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
        };
        const darkPanels = [];
        for (const el of document.querySelectorAll('.glass-stage, .glass-card, section, aside, header, nav, [role="dialog"], [data-testid="system-pill-drawer"], [data-testid="mini-player-bar"]')) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 32 || rect.height < 24) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || Number(st.opacity) < 0.45) continue;
          const c = parseRgb(st.backgroundColor);
          if (!c || c.a < 0.5) continue;
          // Exclude intentional dark active pills or CTA buttons
          const cls = typeof el.className === 'string' ? el.className : '';
          if (cls.includes('btn-aurora') || cls.includes('bg-[#22252A]') || cls.includes('bg-[#0F172A]')) continue;
          if (c.r < 140 && c.g < 140 && c.b < 140) {
            darkPanels.push({ tag: el.tagName, cls: cls.slice(0, 60), bg: st.backgroundColor });
          }
        }
        return { overflow, bodyBg, darkPanels };
      })()`);
      assert.ok(check.overflow <= 1, `Horizontal overflow in ${stageLabel} (${expectedWidth}px): ${check.overflow}px`);
      assert.equal(check.bodyBg, 'rgb(241, 245, 249)', `Expected crisp Daylight canvas #F1F5F9 in ${stageLabel}, got ${check.bodyBg}`);
      assert.deepEqual(check.darkPanels, [], `Found unmapped dark panel surfaces in Daylight ${stageLabel}: ${JSON.stringify(check.darkPanels)}`);
    };

    const saveDaylightShot = async (filename) => {
      const dir = process.env.SAVE_DAYLIGHT_SHOTS;
      if (!dir) return;
      fs.mkdirSync(dir, { recursive: true });
      const snap = await sendCdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(dir, filename), Buffer.from(snap.data, 'base64'));
    };

    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });

    // Wait for segmented Day / Night toggle
    await waitUntil(`Boolean(document.querySelector('button[aria-label="Daylight Mode"]'))`, 8000, 'Daylight Mode button');

    // Click Night -> assert dark class + data-theme=night -> reload -> assert persisted
    await evalJs(`document.querySelector('button[aria-label="Night Mode"]').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const nightState = await evalJs(`({
      theme: document.documentElement.dataset.theme,
      hasDark: document.documentElement.classList.contains('dark'),
      stored: localStorage.getItem('nootropic_fm_circadian_v1'),
    })`);
    assert.equal(nightState.theme, 'night');
    assert.equal(nightState.hasDark, true);
    assert.equal(nightState.stored, 'night');

    await sendCdp('Page.reload', {});
    await waitUntil(`Boolean(document.querySelector('button[aria-label="Daylight Mode"]'))`, 8000, 'reload Night');
    assert.equal(await evalJs(`document.documentElement.dataset.theme`), 'night');

    // Click Day -> assert dark class removed + data-theme=daylight -> reload -> assert persisted
    await evalJs(`document.querySelector('button[aria-label="Daylight Mode"]').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const dayState = await evalJs(`({
      theme: document.documentElement.dataset.theme,
      hasDark: document.documentElement.classList.contains('dark'),
      bg: getComputedStyle(document.body).backgroundColor,
      stored: localStorage.getItem('nootropic_fm_circadian_v1'),
    })`);
    assert.equal(dayState.theme, 'daylight');
    assert.equal(dayState.hasDark, false);
    assert.equal(dayState.bg, 'rgb(241, 245, 249)');
    assert.equal(dayState.stored, 'daylight');

    await sendCdp('Page.reload', {});
    await waitUntil(`Boolean(document.querySelector('button[aria-label="Daylight Mode"]'))`, 8000, 'reload Daylight');
    assert.equal(await evalJs(`document.documentElement.dataset.theme`), 'daylight');

    // StudioHomeView contrast + layout check in Daylight Mode (1440px Desktop & 375px Mobile)
    await waitUntil(`Boolean(document.querySelector('[data-testid="open-precision-checkin"]'))`, 5000, 'Daylight StudioHomeView');
    await assertContrastClean('Daylight StudioHomeView 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight StudioHomeView 1440px', 1440);
    await saveDaylightShot('daylight_studio_home_1440.png');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertContrastClean('Daylight StudioHomeView 375px');
    await assertDaylightLayoutAndSurfaces('Daylight StudioHomeView 375px', 375);
    await saveDaylightShot('daylight_studio_home_375.png');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Open Precision Check-In (starts at Beat 2 with zero Beat 1 wall), then open optional Beat 1 Priors
    await evalJs(`document.querySelector('[data-testid="open-precision-checkin"]')?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label="Interactive 2D Neural State Compass"]'))`, 5000, 'Beat 2');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Add Age & Role Priors/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('input[type="number"]'))`, 5000, 'Optional Beat 1 Priors');
    await assertContrastClean('Daylight Beat 1');

    // Walk to Beat 2 (2D Brain Map) -> verify contrast + visible studio-grid stroke
    await evalJs(`(() => {
      const ageInput = document.querySelector('input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (ageInput._valueTracker) ageInput._valueTracker.setValue('');
      setter.call(ageInput, '32');
      ageInput.dispatchEvent(new Event('input', { bubbles: true }));
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => /^male$/i.test((b.textContent || '').trim()))?.click();
      btns.find(b => /programmer|student|creative/i.test(b.textContent || ''))?.click();
      const cb = document.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) cb.click();
    })()`);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /continue:\\s*current state/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label="Interactive 2D Neural State Compass"]'))`, 5000, 'Beat 2');
    const gridStroke = await evalJs(`getComputedStyle(document.querySelector('.studio-grid-strong')).stroke`);
    assert.match(gridStroke, /rgba?\(15,\s*23,\s*42/);
    await assertContrastClean('Daylight Beat 2 Brain Map 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight Beat 2 Brain Map 1440px', 1440);
    await saveDaylightShot('daylight_compass_1440.png');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 120));
    await assertContrastClean('Daylight Beat 2 Brain Map 375px');
    await assertDaylightLayoutAndSurfaces('Daylight Beat 2 Brain Map 375px', 375);
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Walk to Beat 3 -> Beat 4 -> Reveal -> PlayerView
    await waitUntil(`(() => {
      const lm = Array.from(document.querySelectorAll('button[data-landmark="true"]')).find(b => /brain fog|stressed|distracted/i.test(b.textContent || '')) || document.querySelector('button[data-landmark="true"]');
      if (!lm) return false;
      lm.click();
      return true;
    })()`, 5000, 'Select landmark');
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*target/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /sharp alert focus|deep flow/i.test(b.textContent || '')));
    })()`, 6000, 'Beat 3');
    await assertContrastClean('Daylight Beat 3 Target');

    await waitUntil(`(() => {
      const targetBtn = Array.from(document.querySelectorAll('button')).find(b => /sharp alert focus|deep flow/i.test(b.textContent || ''));
      if (!targetBtn) return false;
      targetBtn.click();
      return true;
    })()`, 4000, 'Select target');
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /next:\\s*music style/i.test(b.textContent || ''))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || '')));
    })()`, 6000, 'Beat 4');
    await assertContrastClean('Daylight Beat 4 Music');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Lock NootropicFM Mode/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`(() => {
      Array.from(document.querySelectorAll('button')).find(b => /^skip/i.test((b.textContent || '').trim()))?.click();
      return Boolean(Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || '')));
    })()`, 8000, 'Reveal');
    await assertContrastClean('Daylight Reveal');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /apply layers\\s*&\\s*start/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(Array.from(document.querySelectorAll('button')).find(b => /End (Session|& Rate)/.test(b.textContent || '')))`, 8000, 'PlayerView');
    await new Promise((r) => setTimeout(r, 250));
    await assertContrastClean('Daylight PlayerView Tier-1 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight PlayerView Tier-1 1440px', 1440);
    await saveDaylightShot('daylight_player_t1_1440.png');

    // Tier-1 Calm Cockpit starts with isLabOpen=false (0 active canvases) -> expand Tier-2 Lab Drawer
    assert.equal(
      await evalJs(`document.querySelectorAll('main canvas').length`),
      0,
      'Tier-1 Calm Cockpit must mount 0 GPU canvases until Lab Drawer opens'
    );
    await evalJs(`document.querySelector('[data-testid="toggle-lab-drawer"]')?.click()`);
    await waitUntil(`document.querySelectorAll('main canvas').length >= 2`, 4000, 'Tier-2 Lab Drawer Canvases');
    await new Promise((r) => setTimeout(r, 250));
    await assertContrastClean('Daylight PlayerView Tier-2 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight PlayerView Tier-2 1440px', 1440);
    await saveDaylightShot('daylight_player_t2_1440.png');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 150));
    await assertContrastClean('Daylight PlayerView Tier-2 375px');
    await assertDaylightLayoutAndSurfaces('Daylight PlayerView Tier-2 375px', 375);
    await saveDaylightShot('daylight_player_t2_375.png');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Verify both Oscillator & Spectrum Bar canvases switched to Daylight lab surface (#E8EFF7 -> r>=224,g>=232,b>=240)
    const canvasAudit = await evalJs(`(() => {
      const canvases = Array.from(document.querySelectorAll('main canvas'));
      return canvases.map((c) => {
        const ctx = c.getContext('2d');
        const p = ctx ? ctx.getImageData(4, 4, 1, 1).data : [0, 0, 0, 0];
        return {
          aria: c.getAttribute('aria-label') || '',
          bg: getComputedStyle(c).backgroundColor,
          r: p[0],
          g: p[1],
          b: p[2],
        };
      });
    })()`);
    assert.ok(canvasAudit.length >= 2, `Expected >=2 instrument canvases in PlayerView, got ${canvasAudit.length}`);
    for (const c of canvasAudit) {
      assert.ok(c.r >= 224 && c.g >= 232 && c.b >= 240, `Canvas stayed dark in Daylight Mode: ${JSON.stringify(c)}`);
    }

    // Verify X/Y Lissajous toggle, Inline Protocol Blueprint modal & Plain Music monitor in Daylight Mode
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /X\\/Y Lissajous/i.test(b.textContent || ''))?.click()`);
    await new Promise((r) => setTimeout(r, 260));
    await assertContrastClean('Daylight PlayerView X/Y Lissajous');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Plain Music/i.test(b.textContent || ''))?.click()`);
    await new Promise((r) => setTimeout(r, 260));
    await assertContrastClean('Daylight PlayerView Plain Music');

    await evalJs(`document.querySelector('[data-testid="inline-protocol-pill"]')?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Verified Science & Acoustic Blueprint'))`, 4000, 'Daylight Blueprint Modal');
    await assertContrastClean('Daylight PlayerView Blueprint Modal');
    await evalJs(`document.querySelector('button[aria-label="Close protocol blueprint"]')?.click()`);
    await new Promise((r) => setTimeout(r, 150));

    // Verify PVT, Tapping & Huggins Modals in Daylight Mode
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Run PVT/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Visual 1/RT Vigilance Check'))`, 4000, 'Daylight PVT Modal');
    await assertContrastClean('Daylight PvtBenchmarkModal 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight PvtBenchmarkModal 1440px', 1440);
    await saveDaylightShot('daylight_pvt_1440.png');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Visual 1/RT Vigilance Check')`, 3000, 'PVT Modal closed');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Run \\(15s\\)/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Intrinsic Motor Rhythm Check'))`, 4000, 'Daylight Tapping Modal');
    await assertContrastClean('Daylight TappingTestModal 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight TappingTestModal 1440px', 1440);
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Intrinsic Motor Rhythm Check')`, 3000, 'Tapping Modal closed');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Verify Headphones/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Huggins Pitch'))`, 4000, 'Daylight Huggins Modal');
    await assertContrastClean('Daylight HugginsCheckModal 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight HugginsCheckModal 1440px', 1440);
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('35s Dichotic Headphone Check')`, 3000, 'Huggins Modal closed');

    // Minimize PlayerView -> exit Zen Focus Lock -> reveal AppShell nav + MiniPlayerBar + SystemPillDrawer
    await evalJs(`document.querySelector('[data-testid="minimize-player-btn"]')?.click()`);
    await waitUntil(`Boolean(document.querySelector('[data-testid="mini-player-bar"]'))`, 4000, 'MiniPlayerBar visible');
    await assertContrastClean('Daylight MiniPlayerBar 1440px');

    // Verify SystemPillDrawer, Sound Systems, Go Pro, and OnboardingView in Daylight Mode
    await evalJs(`document.querySelector('[data-testid="system-pill-trigger"]')?.click()`);
    await waitUntil(`Boolean(document.querySelector('[data-testid="system-pill-drawer"]'))`, 4000, 'SystemPillDrawer');
    await assertContrastClean('Daylight SystemPillDrawer');
    await assertDaylightLayoutAndSurfaces('Daylight SystemPillDrawer 1440px', 1440);
    await saveDaylightShot('daylight_system_drawer_1440.png');

    await evalJs(`Array.from(document.querySelectorAll('[data-testid="system-pill-drawer"] button')).find(b => /Sound Systems|Earbuds/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`/Acoustic Hardware Lab/i.test(document.body.innerText)`, 4000, 'SoundSystemsModal');
    await assertContrastClean('Daylight SoundSystemsModal');
    await evalJs(`document.querySelector('button[aria-label="Close Sound Systems modal"]')?.click()`);
    await new Promise((r) => setTimeout(r, 100));

    await evalJs(`document.querySelector('[data-testid="system-pill-trigger"]')?.click()`);
    await waitUntil(`Boolean(document.querySelector('[data-testid="system-pill-drawer"]'))`, 4000, 'SystemPillDrawer for Pro Modal');
    await evalJs(`Array.from(document.querySelectorAll('[data-testid="system-pill-drawer"] button')).find(b => /NootropicFM Pro Active|Unlock Pro/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`/Pro Subscription|Unlock Full Sessions/i.test(document.body.innerText)`, 4000, 'UpgradeProModal');
    await assertContrastClean('Daylight UpgradeProModal');
    await evalJs(`document.querySelector('button[aria-label="Close Pro modal"]')?.click()`);
    await waitUntil(`!document.querySelector('button[aria-label="Close Pro modal"]')`, 3000, 'UpgradeProModal closed');

    // Verify Study Lab & Memory (Insights + CohortIntelligenceShowcase + DatasetInquiryModal + Admin Export Modal) in Daylight Mode
    await evalJs(`Array.from(document.querySelectorAll('aside button, nav[aria-label="Studio Mobile Navigation"] button')).find(b => /Study Lab/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Turn Published'))`, 5000, 'StudyLabView');
    await assertContrastClean('Daylight StudyLabView 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight StudyLabView 1440px', 1440);
    await saveDaylightShot('daylight_studylab_1440.png');

    await evalJs(`Array.from(document.querySelectorAll('aside button, nav[aria-label="Studio Mobile Navigation"] button')).find(b => /Memory/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Personal Neural Memory') || document.body.innerText.includes('Research Brain'))`, 5000, 'InsightsView');
    await assertContrastClean('Daylight InsightsView 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight InsightsView 1440px', 1440);
    await saveDaylightShot('daylight_insights_1440.png');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /License Full Dataset/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Unlock Full Aggregated Cohort Datasets'))`, 4000, 'Daylight DatasetInquiryModal');
    await assertContrastClean('Daylight DatasetInquiryModal 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight DatasetInquiryModal 1440px', 1440);
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Unlock Full Aggregated Cohort Datasets')`, 3000, 'DatasetInquiryModal closed');

    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Admin Dataset Export/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Protected Research Export'))`, 4000, 'Daylight Admin Export Modal');
    await assertContrastClean('Daylight Admin Export Modal 1440px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Protected Research Export')`, 3000, 'Admin Export Modal closed');

    // Privacy & Delete Data modal in Daylight Mode
    await evalJs(`Array.from(document.querySelectorAll('footer button')).find(b => /Privacy, Credits/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Privacy & Your Data'))`, 4000, 'Daylight Privacy Modal');
    await assertContrastClean('Daylight Privacy Modal 1440px');
    await sendCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await waitUntil(`!document.body.innerText.includes('Privacy & Your Data')`, 3000, 'Privacy Modal closed');

    // OnboardingView via Edit Profile Details in SystemPillDrawer
    await evalJs(`document.querySelector('[data-testid="system-pill-trigger"]')?.click()`);
    await waitUntil(`Boolean(document.querySelector('[data-testid="system-pill-drawer"]'))`, 4000, 'SystemPillDrawer for OnboardingView');
    await evalJs(`Array.from(document.querySelectorAll('[data-testid="system-pill-drawer"] button')).find(b => /Edit Profile Details/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('Refine your Neural Identity'))`, 4000, 'Daylight OnboardingView');
    await assertContrastClean('Daylight OnboardingView 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight OnboardingView 1440px', 1440);
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /Back|Cancel/i.test((b.textContent || '').trim()))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[data-testid="mini-player-bar"]'))`, 4000, 'Return from OnboardingView');

    // Expand MiniPlayerBar back to PlayerView -> End & Rate -> verify DebriefView contrast
    await evalJs(`document.querySelector('[data-testid="mini-player-bar"] button[aria-label="Expand player"]')?.click()`);
    await waitUntil(`Boolean(Array.from(document.querySelectorAll('button')).find(b => /End (Session|& Rate)/.test(b.textContent || '')))`, 4000, 'Return to PlayerView');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /End (Session|& Rate)/.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.body.innerText.includes('How did your mind'))`, 5000, 'DebriefView');
    await assertContrastClean('Daylight DebriefView 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight DebriefView 1440px', 1440);

    // FlagshipShowcaseView (?surface=showcase) in Daylight Mode (Photo + CAD X-Ray Blueprint) at 1440px & 375px
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=showcase` });
    await waitUntil(`Boolean(document.querySelector('[aria-label*="Acoustic"]')) || Boolean(document.body.innerText.includes('NootropicFM Earbuds'))`, 6000, 'Daylight FlagshipShowcaseView');
    await assertContrastClean('Daylight FlagshipShowcaseView 1440px');
    await assertDaylightLayoutAndSurfaces('Daylight FlagshipShowcaseView 1440px', 1440);
    await saveDaylightShot('daylight_showcase_1440.png');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => /CAD X-Ray/i.test(b.textContent || ''))?.click()`);
    await waitUntil(`Boolean(document.querySelector('[aria-label*="Acoustic CAD X-Ray"]'))`, 4000, 'Daylight Showcase CAD X-Ray');
    await assertContrastClean('Daylight FlagshipShowcaseView CAD 1440px');
    await saveDaylightShot('daylight_showcase_cad_1440.png');
    await sendCdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 150));
    await assertContrastClean('Daylight FlagshipShowcaseView 375px');
    await assertDaylightLayoutAndSurfaces('Daylight FlagshipShowcaseView 375px', 375);
    await saveDaylightShot('daylight_showcase_375.png');

    ws.close();
  } finally {
    if (child.pid) {
      await new Promise((r) => {
        const tk = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        tk.on('close', r);
        tk.on('error', r);
      });
    }
    await new Promise((r) => setTimeout(r, 150));
    server.closeAllConnections?.();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
});
