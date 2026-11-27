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
import path from 'node:path';
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
    { rel: ['public', 'investors', 'index.html'], expectedMatch: /Pre-Seed Round Open/i },
    { rel: ['public', 'partners', 'index.html'], expectedMatch: /Institutional Pre-Seed/i },
  ];

  for (const { rel, expectedMatch } of checks) {
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
    assert.match(html, /founders@nootropic\.fm/i);
    assert.ok(!/nootropic\.fm@gmail\.com/i.test(html), `Replace personal gmail with founders@nootropic.fm on ${rel.join('/')}`);
    assert.ok(!/\$1,000|\$5,000/i.test(html), `Avoid diluting institutional positioning with small microgrant figures on ${rel.join('/')}`);
    assert.ok(!/\b(treats|cures|diagnoses)\s+(adhd|insomnia|alzheimer|depression|tinnitus)\b/i.test(html));
    assert.ok(!/\baddictive\b/i.test(html), 'Must never use clinical term addictive in public copy');
    assert.ok(!/ATECC608B|T_pcb|59\.70|62\.40|dT_core/i.test(html), 'Must never leak Pre-NNN IP or COGS figures');
  }
});

test('founder identity is strictly Vasi Cicarac (zero Edmond/Vasile), founders@nootropic.fm is surfaced site-wide, and BIMI SVG Tiny-PS logo exists', () => {
  const noOldNameTargets = [
    ['index.html'],
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
    ['public', 'investors', 'index.html'],
    ['public', 'partners', 'index.html'],
    ['public', 'llms.txt'],
  ]) {
    const content = fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
    assert.ok(content.includes('Vasi Cicarac'), `Missing Vasi Cicarac in ${rel.join('/')}`);
  }

  for (const rel of [
    ['index.html'],
    ['public', 'investors', 'index.html'],
    ['public', 'partners', 'index.html'],
    ['public', 'privacy', 'index.html'],
    ['public', 'terms', 'index.html'],
    ['public', 'delete-data', 'index.html'],
    ['public', 'llms.txt'],
    ['public', 'llms-full.txt'],
    ['src', 'components', 'FlagshipShowcaseView.tsx'],
    ['src', 'components', 'HeroLandingView.tsx'],
    ['src', 'components', 'DatasetInquiryModal.tsx'],
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
