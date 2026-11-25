import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4e);
  assert.equal(buf[3], 0x47);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.byteLength,
  };
}

test('Google Play Legal, Wellness Disclaimer & Self-Service Data Deletion Pages are CSP-safe', () => {
  const privacyHtml = fs.readFileSync(path.join(ROOT, 'public', 'privacy', 'index.html'), 'utf8');
  const termsHtml = fs.readFileSync(path.join(ROOT, 'public', 'terms', 'index.html'), 'utf8');
  const deleteHtml = fs.readFileSync(path.join(ROOT, 'public', 'delete-data', 'index.html'), 'utf8');
  const deleteJs = fs.readFileSync(path.join(ROOT, 'public', 'delete-data', 'delete-data.js'), 'utf8');

  // Zero inline scripts allowed under strict Content-Security-Policy (script-src 'self' blob:)
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(privacyHtml), false, 'privacy page must have no inline script');
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(termsHtml), false, 'terms page must have no inline script');
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(deleteHtml), false, 'delete-data page must have no inline script');

  assert.match(privacyHtml, /18 years/i);
  assert.match(privacyHtml, /not a medical device/i);
  assert.match(termsHtml, /NOT a medical device/i);
  assert.match(deleteHtml, /\/delete-data\/delete-data\.js/);
  assert.match(deleteJs, /\/api\/identity\/delete-by-sync-code/);
});

test('Android Digital Asset Links (/.well-known/assetlinks.json) matches fm.nootropic.app', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'public', '.well-known', 'assetlinks.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed) && parsed.length >= 1);
  assert.equal(parsed[0].target.namespace, 'android_app');
  assert.equal(parsed[0].target.package_name, 'fm.nootropic.app');
  assert.ok(
    /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(parsed[0].target.sha256_cert_fingerprints[0]),
    'SHA-256 fingerprint must be 32 colon-separated hex bytes'
  );
});

test('Google Play Store en-US ASO metadata & graphics strictly satisfy Play Console specs', () => {
  const metaDir = path.join(ROOT, 'playstore', 'metadata', 'android', 'en-US');
  const title = fs.readFileSync(path.join(metaDir, 'title.txt'), 'utf8').trim();
  const shortDesc = fs.readFileSync(path.join(metaDir, 'short_description.txt'), 'utf8').trim();
  const fullDesc = fs.readFileSync(path.join(metaDir, 'full_description.txt'), 'utf8').trim();
  const notes = fs.readFileSync(path.join(metaDir, 'changelogs', 'default.txt'), 'utf8').trim();

  assert.ok([...title].length >= 5 && [...title].length <= 30, `title length=${[...title].length}`);
  assert.ok([...shortDesc].length >= 20 && [...shortDesc].length <= 80, `shortDesc length=${[...shortDesc].length}`);
  assert.ok([...fullDesc].length >= 300 && [...fullDesc].length <= 4000, `fullDesc length=${[...fullDesc].length}`);
  assert.ok([...notes].length >= 20 && [...notes].length <= 500, `notes length=${[...notes].length}`);
  assert.match(fullDesc, /not a medical device/i);

  const icon = readPngSize(path.join(ROOT, 'playstore', 'graphics', 'icon-512.png'));
  assert.equal(icon.width, 512);
  assert.equal(icon.height, 512);
  assert.ok(icon.bytes <= 1024 * 1024);

  const fg = readPngSize(path.join(ROOT, 'playstore', 'graphics', 'feature-graphic-1024x500.png'));
  assert.equal(fg.width, 1024);
  assert.equal(fg.height, 500);

  const shotDir = path.join(ROOT, 'playstore', 'graphics', 'phone-screenshots');
  const shots = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png'));
  assert.ok(shots.length >= 4 && shots.length <= 8, `Expected 4..8 screenshots, got ${shots.length}`);
  for (const f of shots) {
    const dim = readPngSize(path.join(shotDir, f));
    assert.equal(dim.width, 1080);
    assert.equal(dim.height, 1920);
  }
});

test('Worker, Payments Policy & Native Android Foreground Audio Service are properly wired', () => {
  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker', 'index.ts'), 'utf8');
  assert.match(workerSrc, /\/api\/identity\/delete-by-sync-code/);
  assert.match(workerSrc, /'https:\/\/localhost'/);
  assert.match(workerSrc, /x-ws-client-id/);

  const upgradeSrc = fs.readFileSync(path.join(ROOT, 'src', 'components', 'UpgradeProModal.tsx'), 'utf8');
  const playerSrc = fs.readFileSync(path.join(ROOT, 'src', 'components', 'PlayerView.tsx'), 'utf8');
  assert.match(upgradeSrc, /isNativePlayStoreApp/);
  assert.match(playerSrc, /isNativePlayStoreApp/);

  const manifestXml = fs.readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8'
  );
  assert.match(manifestXml, /FOREGROUND_SERVICE_MEDIA_PLAYBACK/);
  assert.match(manifestXml, /com\.google\.android\.gms\.permission\.AD_ID/);
  assert.match(manifestXml, /NootropicAudioService/);
});
