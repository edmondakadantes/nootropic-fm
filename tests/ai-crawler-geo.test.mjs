/**
 * nootropic.fm — AI Crawler Accessibility & GEO / SEO Integrity Suite
 *
 * Ensures AI search & deep-research crawlers (Google-Extended, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot)
 * receive spec-compliant non-HTML static assets (/robots.txt, /favicon.ico, /sitemap.xml, /llms.txt, /llms-full.txt),
 * valid Schema.org JSON-LD without violating strict CSP, and crawlable semantic body content without JS hydration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public/ and dist/client/ include binary favicon.ico, robots.txt, sitemap.xml, and llms docs', () => {
  const required = ['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', 'favicon.ico', '_headers'];
  for (const dir of [path.join(ROOT, 'public'), path.join(ROOT, 'dist', 'client')]) {
    for (const file of required) {
      const full = path.join(dir, file);
      assert.ok(fs.existsSync(full), `Missing ${file} in ${dir}`);
      const st = fs.statSync(full);
      assert.ok(st.size > 100, `Expected non-empty ${full}, got ${st.size} bytes`);
    }
  }

  // Verify binary ICO signature (reserved=0x0000, type=0x0001)
  const ico = fs.readFileSync(path.join(ROOT, 'public', 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1, 'favicon.ico must contain at least one icon image');
});

test('robots.txt explicitly allows major search & AI crawlers while protecting /api/', () => {
  const robots = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
  for (const agent of [
    'Googlebot',
    'Google-Extended',
    'GPTBot',
    'OAI-SearchBot',
    'ClaudeBot',
    'PerplexityBot',
    'Applebot-Extended',
  ]) {
    assert.ok(robots.includes(`User-agent: ${agent}`), `robots.txt missing ${agent}`);
  }
  assert.match(robots, /Allow:\s*\//);
  assert.match(robots, /Disallow:\s*\/api\//);
  assert.match(robots, /Sitemap:\s*https:\/\/www\.nootropic\.fm\/sitemap\.xml/);
});

test('_headers sets explicit MIME headers for GEO/SEO files while keeping strict CSP intact', () => {
  const headers = fs.readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8');
  assert.ok(headers.includes("script-src 'self' blob:"));
  assert.ok(!headers.includes("script-src 'self' 'unsafe-inline'"), 'Must never add unsafe-inline to script-src');
  assert.match(headers, /X-Robots-Tag:\s*index,\s*follow/);
  assert.match(headers, /\/robots\.txt[\s\S]*?Content-Type:\s*text\/plain/);
  assert.match(headers, /\/llms\.txt[\s\S]*?Content-Type:\s*text\/plain/);
  assert.match(headers, /\/sitemap\.xml[\s\S]*?Content-Type:\s*application\/xml/);
  assert.match(headers, /\/favicon\.ico[\s\S]*?Content-Type:\s*image\/x-icon/);
});

test('index.html exposes valid Schema.org JSON-LD + semantic non-JS crawlable content + General Wellness compliance', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.nootropic\.fm\/" \/>/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico"/);
  assert.match(html, /<link rel="alternate" type="text\/plain"[^>]*href="https:\/\/www\.nootropic\.fm\/llms\.txt"/);

  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ldMatch, 'index.html must include JSON-LD metadata');
  const parsed = JSON.parse(ldMatch[1]);
  assert.ok(Array.isArray(parsed['@graph']) && parsed['@graph'].length >= 4);
  const orgNode = parsed['@graph'].find((n) => n['@type'] === 'Organization');
  assert.ok(orgNode && Array.isArray(orgNode.contactPoint) && orgNode.contactPoint.length >= 6, 'index.html Organization must define Schema.org ContactPoint array');

  assert.match(html, /NootropicFM Signature Mode/);
  assert.match(html, /Engineered Exclusively for In-Ear Buds/);
  assert.match(html, /NOOTROPIC FM SOUND SYSTEMS/);

  const llmsFull = fs.readFileSync(path.join(ROOT, 'public', 'llms-full.txt'), 'utf8');
  for (const corpus of [html, llmsFull]) {
    assert.ok(!/\b(treats|cures|diagnoses)\s+(adhd|insomnia|alzheimer|depression|tinnitus)\b/i.test(corpus));
  }
});

test('public/investors/index.html and public/partners/index.html are CSP-safe, expose valid JSON-LD, and enforce institutional Pre-NNN IP & General Wellness hygiene', () => {
  const checks = [
    { rel: ['public', 'investors', 'index.html'], expectedMatch: /Pre-Seed Round Open/i, expectedEmails: ['investors@nootropic.fm', 'founders@nootropic.fm'] },
    { rel: ['public', 'partners', 'index.html'], expectedMatch: /Institutional Pre-Seed/i, expectedEmails: ['partners@nootropic.fm', 'founders@nootropic.fm'] },
  ];

  for (const { rel, expectedMatch, expectedEmails } of checks) {
    const filePath = path.join(ROOT, ...rel);
    assert.ok(fs.existsSync(filePath), `Missing ${rel.join('/')}`);
    const html = fs.readFileSync(filePath, 'utf8');
    assert.ok(html.length > 3000, `Expected substantial HTML on ${rel.join('/')}`);

    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    assert.equal(scriptTags.length, 1, `Expected only JSON-LD metadata script on ${rel.join('/')}`);
    assert.match(scriptTags[0], /type="application\/ld\+json"/);

    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ldMatch, `${rel.join('/')} must include valid JSON-LD metadata`);
    const parsed = JSON.parse(ldMatch[1]);
    assert.ok(Array.isArray(parsed['@graph']) && parsed['@graph'].length >= 2);

    assert.match(html, expectedMatch);
    for (const email of expectedEmails) {
      assert.ok(html.toLowerCase().includes(email), `Missing ${email} on ${rel.join('/')}`);
    }
    assert.ok(!/nootropic\.fm@gmail\.com/i.test(html), `Replace personal gmail on ${rel.join('/')}`);
    assert.ok(!/\$1,000|\$5,000/i.test(html), `Avoid diluting institutional positioning with small microgrant figures on ${rel.join('/')}`);
    assert.ok(!/\b(treats|cures|diagnoses)\s+(adhd|insomnia|alzheimer|depression|tinnitus)\b/i.test(html));
    assert.ok(!/\baddictive\b/i.test(html), 'Must never use clinical term addictive in public copy');
    assert.ok(!/ATECC608B|T_pcb|59\.70|62\.40|dT_core|Envelope Flattener|\$57\b/i.test(html), 'Must never leak Pre-NNN IP or COGS figures');
  }
});

test('SEO + GEO pages (/science/, /compare/, /contact/) are crawlable, CSP-safe, Schema.org-valid, and indexed in sitemap & llms docs', () => {
  const pages = [
    {
      rel: ['science', 'index.html'],
      canonical: 'https://www.nootropic.fm/science/',
      requiredTypes: ['TechArticle', 'FAQPage', 'Organization'],
      mustMatch: [/40 Hz Gamma-MBI/, /6×40 Hz/, /16 Hz Beta/, /0\.10 Hz/, /600 Hz Huggins/, /Woods/, /app\.nootropic\.fm/],
    },
    {
      rel: ['compare', 'index.html'],
      canonical: 'https://www.nootropic.fm/compare/',
      requiredTypes: ['TechArticle', 'FAQPage', 'Organization'],
      mustMatch: [/48 kHz Float64/, /-20 dBc/, /25% Blind Aperiodic Sham/i, /20-Trial PVT/, /0\.261 ms/],
    },
    {
      rel: ['contact', 'index.html'],
      canonical: 'https://www.nootropic.fm/contact/',
      requiredTypes: ['ContactPage', 'Organization'],
      mustMatch: [/Press &amp; AI Fact Sheet|Press & AI Fact Sheet/, /Vasi Cicarac/],
    },
  ];

  for (const page of pages) {
    for (const baseDir of [path.join(ROOT, 'public'), path.join(ROOT, 'dist', 'client')]) {
      const filePath = path.join(baseDir, ...page.rel);
      assert.ok(fs.existsSync(filePath), `Missing ${page.rel.join('/')} in ${baseDir}`);
    }
    const html = fs.readFileSync(path.join(ROOT, 'public', ...page.rel), 'utf8');
    assert.ok(html.length > 4000, `Expected substantial crawlable HTML in ${page.rel.join('/')}`);
    assert.ok(html.includes(`<link rel="canonical" href="${page.canonical}" />`), `Missing canonical on ${page.rel.join('/')}`);

    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    assert.equal(scriptTags.length, 1, `Expected only JSON-LD metadata script on ${page.rel.join('/')}`);
    assert.match(scriptTags[0], /type="application\/ld\+json"/);

    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(ldMatch[1]);
    assert.ok(Array.isArray(parsed['@graph']));
    for (const typeName of page.requiredTypes) {
      assert.ok(
        parsed['@graph'].some((n) => n['@type'] === typeName),
        `Missing @type ${typeName} in JSON-LD of ${page.rel.join('/')}`
      );
    }
    const techArticle = parsed['@graph'].find((n) => n['@type'] === 'TechArticle');
    if (techArticle) {
      assert.ok(techArticle.image, `TechArticle missing image in ${page.rel.join('/')}`);
      assert.ok(techArticle.datePublished, `TechArticle missing datePublished in ${page.rel.join('/')}`);
      assert.ok(techArticle.dateModified, `TechArticle missing dateModified in ${page.rel.join('/')}`);
      assert.ok(techArticle.mainEntityOfPage, `TechArticle missing mainEntityOfPage in ${page.rel.join('/')}`);
    }

    for (const rx of page.mustMatch) {
      assert.match(html, rx, `Expected ${rx} in ${page.rel.join('/')}`);
    }

    assert.ok(!/nootropic\.fm@gmail\.com/i.test(html), `Personal gmail leaked on ${page.rel.join('/')}`);
    assert.ok(!/\b(treats|cures|diagnoses)\s+(adhd|insomnia|alzheimer|depression|tinnitus)\b/i.test(html));
    assert.ok(!/\baddictive\b/i.test(html), `Forbidden clinical term addictive on ${page.rel.join('/')}`);
    assert.ok(!/ATECC608B|T_pcb|59\.70|62\.40|dT_core|Envelope Flattener|\$57\b/i.test(html), `Pre-NNN IP leak on ${page.rel.join('/')}`);
    assert.ok(!/\b(brain\.fm|endel|focus@will|focusatwill|spotify|apple music|youtube music)\b/i.test(html), `Avoid trademarked competitor names on ${page.rel.join('/')}`);
    assert.match(html, /not a medical device/i, `Missing non-medical wellness disclaimer on ${page.rel.join('/')}`);
  }

  const sitemap = fs.readFileSync(path.join(ROOT, 'public', 'sitemap.xml'), 'utf8');
  const llms = fs.readFileSync(path.join(ROOT, 'public', 'llms.txt'), 'utf8');
  const llmsFull = fs.readFileSync(path.join(ROOT, 'public', 'llms-full.txt'), 'utf8');
  for (const slug of ['/science/', '/compare/', '/contact/']) {
    assert.ok(sitemap.includes(`https://www.nootropic.fm${slug}`), `sitemap.xml missing ${slug}`);
    assert.ok(llms.includes(`https://www.nootropic.fm${slug}`), `llms.txt missing ${slug}`);
    assert.ok(llmsFull.includes(`https://www.nootropic.fm${slug}`), `llms-full.txt missing ${slug}`);
  }
});

test('department email suite is routed by role with zero vasi@nootropic.fm anywhere in source or public assets', () => {
  const deptEmails = [
    'hello@nootropic.fm',
    'partners@nootropic.fm',
    'research@nootropic.fm',
    'press@nootropic.fm',
    'investors@nootropic.fm',
    'founders@nootropic.fm',
    'support@nootropic.fm',
    'privacy@nootropic.fm',
  ];

  const forbiddenAddress = ['vasi', 'nootropic.fm'].join('@');
  const scanDirs = ['public', 'src', 'worker', 'shared'];
  const collectFiles = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectFiles(full));
      else if (/\.(html|ts|tsx|js|mjs|txt|xml|json)$/i.test(entry.name)) out.push(full);
    }
    return out;
  };
  const allScanned = [path.join(ROOT, 'index.html'), ...scanDirs.flatMap((d) => collectFiles(path.join(ROOT, d)))];
  for (const file of allScanned) {
    const content = fs.readFileSync(file, 'utf8').toLowerCase();
    assert.ok(!content.includes(forbiddenAddress), `Forbidden ${forbiddenAddress} found in ${file}`);
  }

  for (const rel of [
    ['index.html'],
    ['public', 'contact', 'index.html'],
    ['public', 'llms.txt'],
    ['public', 'llms-full.txt'],
    ['src', 'components', 'FlagshipShowcaseView.tsx'],
  ]) {
    const content = fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
    for (const email of deptEmails) {
      assert.ok(content.includes(email), `Missing department email ${email} in ${rel.join('/')}`);
    }
  }

  const datasetModal = fs.readFileSync(path.join(ROOT, 'src', 'components', 'DatasetInquiryModal.tsx'), 'utf8');
  assert.ok(datasetModal.includes('research@nootropic.fm'), 'DatasetInquiryModal must route direct emails to research@nootropic.fm');

  const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
  for (const email of deptEmails) {
    assert.ok(appSrc.includes(email), `Missing ${email} in src/App.tsx`);
  }
  for (const roleLabel of ['General:', 'Research:', 'Support:', 'Privacy:', 'Founders:']) {
    assert.ok(appSrc.includes(roleLabel), `Missing role label "${roleLabel}" in src/App.tsx`);
  }
  for (const link of ['/science/', '/compare/', '/contact/']) {
    assert.ok(appSrc.includes(link), `Missing ${link} in src/App.tsx`);
  }

  const rootHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(rootHtml.includes('"price": "9.99"'), 'index.html Schema.org Offer must reflect $9.99/mo');
  const contactHtml = fs.readFileSync(path.join(ROOT, 'public', 'contact', 'index.html'), 'utf8');
  assert.ok(contactHtml.includes('$9.99/mo'), 'contact/index.html Fact Sheet must reflect $9.99/mo');
});

test('founder identity is strictly Vasi Cicarac (zero Edmond/Vasile), founders@nootropic.fm is surfaced site-wide, and BIMI SVG Tiny-PS logo exists', () => {
  const noOldNameTargets = [
    ['index.html'],
    ['public', 'science', 'index.html'],
    ['public', 'compare', 'index.html'],
    ['public', 'contact', 'index.html'],
    ['public', 'investors', 'index.html'],
    ['public', 'partners', 'index.html'],
    ['public', 'privacy', 'index.html'],
    ['public', 'terms', 'index.html'],
    ['public', 'delete-data', 'index.html'],
    ['public', 'llms.txt'],
    ['public', 'llms-full.txt'],
    ['tests', 'voice-concierge.test.mjs'],
    ['tests', 'circadian-earbuds-trance.test.mjs'],
    ['tests', 'split-domain-showcase.test.mjs'],
  ];
  for (const rel of noOldNameTargets) {
    const content = fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
    assert.ok(!/\bedmond\b/i.test(content), `Found forbidden "Edmond" in ${rel.join('/')}`);
    assert.ok(!/\bvasile\b/i.test(content), `Found forbidden "Vasile" in ${rel.join('/')}`);
  }

  for (const rel of [
    ['index.html'],
    ['public', 'science', 'index.html'],
    ['public', 'compare', 'index.html'],
    ['public', 'contact', 'index.html'],
    ['public', 'investors', 'index.html'],
    ['public', 'partners', 'index.html'],
    ['public', 'llms.txt'],
  ]) {
    const content = fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
    assert.ok(content.includes('Vasi Cicarac'), `Missing Vasi Cicarac in ${rel.join('/')}`);
  }

  for (const rel of [
    ['index.html'],
    ['public', 'science', 'index.html'],
    ['public', 'compare', 'index.html'],
    ['public', 'contact', 'index.html'],
    ['public', 'investors', 'index.html'],
    ['public', 'partners', 'index.html'],
    ['public', 'privacy', 'index.html'],
    ['public', 'terms', 'index.html'],
    ['public', 'delete-data', 'index.html'],
    ['public', 'llms.txt'],
    ['public', 'llms-full.txt'],
    ['src', 'components', 'FlagshipShowcaseView.tsx'],
    ['src', 'components', 'HeroLandingView.tsx'],
    ['src', 'App.tsx'],
  ]) {
    const content = fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
    assert.ok(content.includes('founders@nootropic.fm'), `Missing founders@nootropic.fm in ${rel.join('/')}`);
  }

  for (const dir of [path.join(ROOT, 'public'), path.join(ROOT, 'dist', 'client')]) {
    const bimiPath = path.join(dir, 'brand', 'bimi-logo.svg');
    assert.ok(fs.existsSync(bimiPath), `Missing brand/bimi-logo.svg in ${dir}`);
    const bimiSvg = fs.readFileSync(bimiPath, 'utf8');
    assert.match(bimiSvg, /baseProfile="tiny-ps"/);
    assert.match(bimiSvg, /<title>nootropic\.fm<\/title>/);
  }

  const headers = fs.readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8');
  assert.match(headers, /\/brand\/bimi-logo\.svg[\s\S]*?Content-Type:\s*image\/svg\+xml/);
});

test('Headless Edge: /science/, /compare/, and /contact/ pass 375px mobile viewport (zero zoom-out) + WCAG contrast + zero runtime errors', async (t) => {
  const edgePath = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => fs.existsSync(p));
  if (!edgePath) {
    t.skip('Edge/Chrome binary not found');
    return;
  }

  const distDir = path.join(ROOT, 'dist', 'client');
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
  };

  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    let relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    let filePath = path.resolve(distDir, relPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
      res.writeHead(404, { Connection: 'close' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', Connection: 'close' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfm-seo-geo-e2e-'));

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

    const runtimeExceptions = [];
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.method === 'Runtime.exceptionThrown') {
        runtimeExceptions.push(JSON.stringify(msg.params));
      }
    });

    await sendCdp('Page.enable');
    await sendCdp('Runtime.enable');

    for (const vp of [
      { width: 375, height: 812, mobile: true },
      { width: 1280, height: 900, mobile: false },
    ]) {
      await sendCdp('Emulation.setDeviceMetricsOverride', { ...vp, deviceScaleFactor: 1 });
      for (const slug of ['/science/', '/compare/', '/contact/']) {
        await sendCdp('Page.navigate', { url: `http://127.0.0.1:${port}${slug}` });
        await new Promise((r) => setTimeout(r, 400));
        const evalOut = await sendCdp('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const parseRgb = (str) => {
              const m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
              if (!m) return null;
              return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
            };
            const relLum = ({ r, g, b }) => {
              const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
              return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
            const effectiveBg = (el) => {
              const layers = [];
              let cur = el;
              while (cur && cur.nodeType === 1) {
                const c = parseRgb(getComputedStyle(cur).backgroundColor);
                if (c && c.a > 0) layers.push(c);
                cur = cur.parentElement;
              }
              let res = { r: 10, g: 11, b: 12, a: 1 };
              for (let i = layers.length - 1; i >= 0; i--) res = blend(layers[i], res);
              return res;
            };
            const bad = [];
            for (const el of document.querySelectorAll('a, h1, h2, h3, p, td, th, div, span, code, strong')) {
              const rect = el.getBoundingClientRect();
              if (rect.width < 8 || rect.height < 8) continue;
              const hasDirectText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
              if (!hasDirectText && el.tagName !== 'A') continue;
              if (!(el.innerText || '').trim()) continue;
              const st = getComputedStyle(el);
              const fgRaw = parseRgb(st.color);
              const bg = effectiveBg(el);
              if (!fgRaw) continue;
              const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
              const l1 = Math.max(relLum(fg), relLum(bg));
              const l2 = Math.min(relLum(fg), relLum(bg));
              const ratio = (l1 + 0.05) / (l2 + 0.05);
              const fs = parseFloat(st.fontSize) || 14;
              const minReq = fs >= 18 ? 3.0 : 4.5;
              if (ratio < minReq) bad.push({ tag: el.tagName, text: (el.innerText || '').trim().slice(0, 28), ratio: Number(ratio.toFixed(2)), minReq });
            }
            return {
              innerW: window.innerWidth,
              scrollW: document.documentElement.scrollWidth,
              bad,
            };
          })()`,
        });
        const metrics = evalOut.result.value;
        assert.equal(metrics.innerW, vp.width, `${slug} at ${vp.width}px expanded viewport to ${metrics.innerW}px`);
        assert.ok(metrics.scrollW <= vp.width, `${slug} at ${vp.width}px overflowed horizontally: ${metrics.scrollW} > ${vp.width}`);
        assert.deepEqual(metrics.bad, [], `${slug} at ${vp.width}px had WCAG contrast issues: ${JSON.stringify(metrics.bad)}`);
      }
    }
    assert.deepEqual(runtimeExceptions, [], `Unexpected runtime exceptions: ${JSON.stringify(runtimeExceptions)}`);
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
