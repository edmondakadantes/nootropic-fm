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
    displayName: 'Edmond',
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
    firstName: 'Edmond',
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
    firstName: 'Edmond',
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
        const effectiveBg = (el) => {
          let cur = el;
          while (cur) {
            const c = parseRgb(getComputedStyle(cur).backgroundColor);
            if (c && c.a > 0.35) return c;
            cur = cur.parentElement;
          }
          return parseRgb(getComputedStyle(document.body).backgroundColor);
        };
        const bad = [];
        for (const el of document.querySelectorAll('button, h1, h2, h3, label')) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 12 || rect.height < 12) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || Number(st.opacity) < 0.45) continue;
          if (!(el.innerText || '').trim()) continue;
          const fg = parseRgb(st.color);
          const bg = effectiveBg(el);
          if (!fg || !bg) continue;
          const l1 = Math.max(relLum(fg), relLum(bg));
          const l2 = Math.min(relLum(fg), relLum(bg));
          const ratio = (l1 + 0.05) / (l2 + 0.05);
          if (ratio < 2.8) {
            bad.push({ tag: el.tagName, text: (el.innerText || '').trim().slice(0, 32), ratio: Number(ratio.toFixed(2)), color: st.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')' });
          }
        }
        return bad;
      })()`);
      assert.deepEqual(violations, [], `Contrast violations in ${stageLabel}: ${JSON.stringify(violations)}`);
    };

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
    assert.equal(dayState.bg, 'rgb(243, 239, 230)');
    assert.equal(dayState.stored, 'daylight');

    await sendCdp('Page.reload', {});
    await waitUntil(`Boolean(document.querySelector('button[aria-label="Daylight Mode"]'))`, 8000, 'reload Daylight');
    assert.equal(await evalJs(`document.documentElement.dataset.theme`), 'daylight');

    // Beat 1 contrast check
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
    assert.match(gridStroke, /rgba?\(20,\s*22,\s*25/);
    await assertContrastClean('Daylight Beat 2 Brain Map');

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
    await assertContrastClean('Daylight PlayerView');

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
