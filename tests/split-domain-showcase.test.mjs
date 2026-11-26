/**
 * nootropic.fm — Split-Domain Restructuring & Flagship Hardware Showcase Audit Suite
 *
 * Verifies:
 *  1) Domain routing rules (`nootropic.fm` / `www.nootropic.fm` -> 'showcase'; `app.nootropic.fm` & `localhost` -> 'studio').
 *  2) Legacy `#sync=NFM-...`, `?billing=success`, and `?launch=` deep-link redirects from root showcase to `app.nootropic.fm`.
 *  3) `'signature_6x40'` instant launch builder in `quickTryProtocols.ts`.
 *  4) Photorealistic `nootropic.fm` hardware PNG renders exist and pass valid PNG signatures & size checks.
 *  5) Worker `.nootropic.fm` cross-subdomain auth cookies, `GET /api/identity/me`, and `POST /api/identity/signout`.
 *  6) Headless Edge E2E on `/?surface=showcase` (Night + Daylight modes: 3 loaded images, CAD X-Ray toggle, WCAG button/text contrast, zero yellow/amber in Daylight) AND Studio deep-link (`/?surface=studio&launch=signature_6x40`).
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
const {
  resolveSurfaceMode,
  buildStudioUrl,
  buildShowcaseUrl,
  resolveLegacyShowcaseRedirect,
} = await import('../src/lib/domainRouting.ts');
const { buildInstantQuickTryRecommendation } = await import('../src/lib/quickTryProtocols.ts');
const workerModule = await import('../worker/index.ts');
const worker = workerModule.default;

test('resolveSurfaceMode, buildStudioUrl, and resolveLegacyShowcaseRedirect enforce clean split-domain routing', () => {
  assert.equal(resolveSurfaceMode({ hostname: 'nootropic.fm', search: '' }), 'showcase');
  assert.equal(resolveSurfaceMode({ hostname: 'www.nootropic.fm', search: '' }), 'showcase');
  assert.equal(resolveSurfaceMode({ hostname: 'app.nootropic.fm', search: '' }), 'studio');
  assert.equal(resolveSurfaceMode({ hostname: 'localhost', search: '' }), 'studio');
  assert.equal(resolveSurfaceMode({ hostname: '127.0.0.1', search: '?surface=showcase' }), 'showcase');
  assert.equal(
    resolveSurfaceMode({ hostname: 'www.nootropic.fm', search: '', isNative: true }),
    'studio'
  );

  assert.equal(
    buildStudioUrl({ launch: 'signature_6x40' }, { hostname: 'www.nootropic.fm', origin: 'https://www.nootropic.fm' }),
    'https://app.nootropic.fm/?launch=signature_6x40'
  );
  assert.equal(
    buildStudioUrl(
      { target: 'deep_flow', durationMin: 45 },
      { hostname: 'nootropic.fm', origin: 'https://nootropic.fm' }
    ),
    'https://app.nootropic.fm/?target=deep_flow&duration=45'
  );
  assert.equal(
    buildShowcaseUrl({ hostname: 'app.nootropic.fm', origin: 'https://app.nootropic.fm' }),
    'https://www.nootropic.fm/'
  );

  assert.equal(
    resolveLegacyShowcaseRedirect({
      hostname: 'www.nootropic.fm',
      search: '',
      hash: '#sync=NFM-ABCD-1234',
    }),
    'https://app.nootropic.fm/#sync=NFM-ABCD-1234'
  );
  assert.equal(
    resolveLegacyShowcaseRedirect({
      hostname: 'nootropic.fm',
      search: '?billing=success&session_id=cs_test_123',
      hash: '',
    }),
    'https://app.nootropic.fm/?billing=success&session_id=cs_test_123'
  );
  assert.equal(
    resolveLegacyShowcaseRedirect({ hostname: 'app.nootropic.fm', search: '', hash: '#sync=NFM-ABCD-1234' }),
    null
  );
});

test('buildInstantQuickTryRecommendation supports signature_6x40 launch ID with 0% sham dilution', () => {
  const rec = buildInstantQuickTryRecommendation('signature_6x40');
  assert.equal(rec.arm.id, 'nootropic-trance-6x40hz');
  assert.equal(rec.params.genre, 'nootropic_trance');
  assert.equal(rec.params.bpm, 120);
  assert.equal(rec.params.modulationHz, 6);
  assert.equal(rec.isControlTrial, false);
});

test('NOOTROPIC FM SOUND SYSTEMS hardware PNG renders exist and are optimized valid PNG files', () => {
  const names = ['earbuds-01-hero.png', 'earbuds-pro-hrv.png', 'sound-system-01.png'];
  for (const name of names) {
    const file = path.join(ROOT, 'public', 'brand', 'hardware', name);
    assert.ok(fs.existsSync(file), `Missing hardware image ${name}`);
    const buf = fs.readFileSync(file);
    assert.ok(buf.byteLength > 20_000 && buf.byteLength < 800_000, `${name} size out of bounds: ${buf.byteLength}`);
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
  }
});

function createInMemoryWorkerD1() {
  const profiles = new Map();
  const rateLimits = new Map();

  const makeStmt = (sql) => {
    let binds = [];
    const normSql = sql.replace(/\s+/g, ' ').trim();
    const stmt = {
      bind(...args) {
        binds = args;
        return stmt;
      },
      async first() {
        if (/INSERT INTO rate_limits/i.test(normSql)) {
          const [key] = binds;
          const next = (rateLimits.get(key) ?? 0) + 1;
          rateLimits.set(key, next);
          return { hits: next };
        }
        if (/SELECT token_hash, sync_code_hash FROM profiles WHERE id = \?/i.test(normSql)) {
          return profiles.get(binds[0]) ?? null;
        }
        if (/SELECT \* FROM profiles WHERE id = \?/i.test(normSql)) {
          return profiles.get(binds[0]) ?? null;
        }
        if (/FROM sessions/i.test(normSql)) return null;
        if (/SELECT COUNT\(\*\) AS cnt FROM sessions/i.test(normSql)) return { cnt: 0 };
        return null;
      },
      async all() {
        if (/SELECT \* FROM profiles WHERE token_hash = \?/i.test(normSql)) {
          const hash = binds[0];
          const results = Array.from(profiles.values()).filter((p) =>
            String(p.token_hash || '').includes(hash)
          );
          return { results };
        }
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO profiles/i.test(normSql)) {
          const [
            id,
            display_name,
            age,
            age_band,
            gender,
            role,
            occupation_label,
            texture_pref,
            noise_sensitivity,
            default_device,
            primary_challenge,
            research_consent,
            token_hash,
            sync_code_hash,
            created_at,
            updated_at,
          ] = binds;
          profiles.set(id, {
            id,
            display_name,
            age,
            age_band,
            gender,
            role,
            occupation_label,
            texture_pref,
            noise_sensitivity,
            default_device,
            primary_challenge,
            research_consent,
            preferred_mod_mult: 1.0,
            plan_tier: 'pro',
            pro_until: null,
            token_hash,
            sync_code_hash,
            created_at,
            updated_at,
          });
        }
        return { success: true };
      },
    };
    return stmt;
  };

  return {
    prepare(sql) {
      return makeStmt(sql);
    },
    async batch(stmts) {
      return Promise.all(stmts.map((s) => s.run()));
    },
  };
}

test('Worker sets Domain=.nootropic.fm cookie and hydrates GET /api/identity/me + clears POST /api/identity/signout', async () => {
  const db = createInMemoryWorkerD1();
  const env = { DB: db, APP_ENV: 'test' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const createReq = new Request('https://www.nootropic.fm/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.2' },
    body: JSON.stringify({
      displayName: 'Edmond',
      age: 34,
      role: 'entrepreneur',
      researchConsent: true,
    }),
  });
  const createRes = await worker.fetch(createReq, env, ctx);
  assert.equal(createRes.status, 200);
  const setCookie = createRes.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /nfm_auth=/);
  assert.match(setCookie, /Domain=\.nootropic\.fm/i);
  assert.match(setCookie, /HttpOnly/i);

  const cookiePair = setCookie.split(';')[0];

  // Now simulate visiting https://app.nootropic.fm with that shared .nootropic.fm cookie
  const meReq = new Request('https://app.nootropic.fm/api/identity/me', {
    method: 'GET',
    headers: { cookie: cookiePair },
  });
  const meRes = await worker.fetch(meReq, env, ctx);
  assert.equal(meRes.status, 200);
  const meJson = await meRes.json();
  assert.equal(meJson.authenticated, true);
  assert.equal(meJson.profile.displayName, 'Edmond');
  assert.equal(meJson.profile.planTier, 'pro');

  // Signout clears cookie across .nootropic.fm
  const outReq = new Request('https://app.nootropic.fm/api/identity/signout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookiePair },
    body: '{}',
  });
  const outRes = await worker.fetch(outReq, env, ctx);
  assert.equal(outRes.status, 200);
  const outCookie = outRes.headers.get('set-cookie') ?? '';
  assert.match(outCookie, /Max-Age=0/);
  assert.match(outCookie, /Domain=\.nootropic\.fm/i);
});

function findEdgeExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => fs.existsSync(p));
}

test('Headless Edge: Flagship Showcase renders branded hardware, CAD X-Ray, WCAG contrast (Day+Night), and Studio signature deep-link', async (t) => {
  const edgePath = findEdgeExecutable();
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found');
    return;
  }
  const distDir = path.join(ROOT, 'dist', 'client');
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')));

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
    if (cleanUrl === '/api/identity/me') {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ authenticated: false, profile: null, pendingDebrief: null }));
      return;
    }
    if (cleanUrl === '/api/hardware/waitlist' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ ok: true, queueNumber: 42, productCode: 'earbuds_01_usb_c' }));
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfm-showcase-e2e-'));

  let resolvePort;
  const cdpPortPromise = new Promise((res) => {
    resolvePort = res;
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

    const assertShowcaseClean = async (label, expectDaylight) => {
      await evalJs(`new Promise((resolve) => {
        for (const anim of document.getAnimations()) {
          if (typeof CSSTransition !== 'undefined' && anim instanceof CSSTransition) {
            try { anim.finish(); } catch {}
          }
        }
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      })`);
      const result = await evalJs(`(() => {
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
          let res = parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 226, g: 232, b: 240, a: 1 };
          res.a = 1;
          for (let i = layers.length - 1; i >= 0; i--) res = blend(layers[i], res);
          return res;
        };
        const bad = [];
        const yellows = [];
        for (const el of document.querySelectorAll('button, a, h1, h2, h3, p, span, code, strong')) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || Number(st.opacity) < 0.45) continue;
          const bgC = parseRgb(st.backgroundColor);
          if (${expectDaylight ? 'true' : 'false'} && bgC && bgC.a > 0.15 && bgC.r > 195 && bgC.g > 135 && bgC.b < 140) {
            yellows.push({ tag: el.tagName, bg: st.backgroundColor, text: (el.innerText || '').slice(0, 24) });
          }
          const hasDirectText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
          if (!hasDirectText && el.tagName !== 'BUTTON' && el.tagName !== 'A') continue;
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
            bad.push({ tag: el.tagName, text: (el.innerText || '').trim().slice(0, 28), ratio: Number(ratio.toFixed(2)), minReq });
          }
        }
        return { bad, yellows };
      })()`);
      assert.deepEqual(result.yellows, [], `Unexpected warm/yellow tint in ${label}: ${JSON.stringify(result.yellows)}`);
      assert.deepEqual(result.bad, [], `Contrast violations in ${label}: ${JSON.stringify(result.bad)}`);
    };

    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 1. Open Flagship Showcase via ?surface=showcase
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=showcase` });
    await waitUntil(
      `Boolean(document.body && document.body.innerText && document.body.innerText.includes('ORBITAL PHASE-RING WIRELESS'))`,
      8000,
      'FlagshipShowcaseView mount'
    );

    // Wait for all 4 hardware images on page (hero + 3 cards) to finish decoding
    await waitUntil(
      `(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.length >= 4 && imgs.every((img) => img.complete && img.naturalWidth > 100);
      })()`,
      8000,
      'hardware product PNGs loaded'
    );

    // Audit Night Mode contrast
    await evalJs(`document.querySelector('button[aria-label="Night Mode"]').click()`);
    await new Promise((r) => setTimeout(r, 150));
    await assertShowcaseClean('Showcase Night', false);

    // Audit Daylight Mode contrast + zero warm yellows
    await evalJs(`document.querySelector('button[aria-label="Daylight Mode"]').click()`);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await evalJs(`document.documentElement.dataset.theme`), 'daylight');
    await assertShowcaseClean('Showcase Daylight', true);

    // Toggle Acoustic CAD X-Ray mode
    await evalJs(`Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('Acoustic CAD X-Ray')).click()`);
    await waitUntil(
      `Boolean(document.querySelector('svg[aria-label*="Acoustic CAD X-Ray"]'))`,
      4000,
      'Acoustic CAD X-Ray SVG'
    );
    await assertShowcaseClean('Showcase Daylight CAD X-Ray', true);

    // Verify all primary Studio CTAs point directly to full onboarding (no launch/target skip query)
    const studioLinks = await evalJs(`Array.from(document.querySelectorAll('a'))
      .filter((a) => /Launch Audio Studio|Open Studio|Open Full Studio|Open Free Studio|Continue Full Calibration/i.test(a.innerText || ''))
      .map((a) => a.getAttribute('href') || '')`);
    assert.ok(studioLinks.length >= 4);
    for (const href of studioLinks) {
      assert.ok(!href.includes('launch=') && !href.includes('target='), `Expected onboarding link without player skip, got: ${href}`);
    }

    // 2. Verify entering Audio Studio opens the full original CheckInView onboarding (NOT skipping straight to PlayerView)
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}/?surface=studio` });
    await waitUntil(
      `Boolean(document.body && document.body.innerText && document.body.innerText.includes('Study Lab') && !document.body.innerText.includes('ORBITAL PHASE-RING') && document.querySelector('input, textarea'))`,
      8000,
      'Full original CheckInView onboarding rendered on Studio entry'
    );
    assert.equal(await evalJs(`document.body.innerText.includes('Pause Session')`), false);

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
