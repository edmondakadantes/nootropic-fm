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
