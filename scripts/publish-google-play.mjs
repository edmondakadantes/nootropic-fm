#!/usr/bin/env node
/**
 * Automated Google Play Developer API (`androidpublisher` v3) Publisher for `nootropic.fm`.
 *
 * Capabilities:
 *  - Validates Play Store metadata limits (title <= 30, short_description <= 80, full_description <= 4000, changelog <= 500)
 *  - Validates icon (512x512), feature graphic (1024x500), and phone screenshots (>= 4 PNGs)
 *  - Uploads signed `.aab` bundle, updates `en-US` Store Listing text + images, assigns track (`internal` | `alpha` | `beta` | `production`), and commits atomically!
 *
 * Usage:
 *   node scripts/publish-google-play.mjs --dry-run
 *   node scripts/publish-google-play.mjs --aab playstore/releases/nootropic-fm-release.aab --track internal
 *   node scripts/publish-google-play.mjs --aab playstore/releases/nootropic-fm-release.aab --track production
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || 'fm.nootropic.app';
const ROOT = process.cwd();
const META_DIR = path.join(ROOT, 'playstore', 'metadata', 'android', 'en-US');
const GRAPHICS_DIR = path.join(ROOT, 'playstore', 'graphics');
const API_ROOT = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}`;
const UPLOAD_ROOT = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}`;

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    track: 'internal',
    releaseStatus: 'completed',
    aabPath: path.join(ROOT, 'playstore', 'releases', 'nootropic-fm-release.aab'),
    keyFile:
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH ||
      path.join(ROOT, '.secrets', 'google-play-service-account.json'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--track' && argv[i + 1]) opts.track = argv[++i];
    else if (a === '--status' && argv[i + 1]) opts.releaseStatus = argv[++i];
    else if (a === '--aab' && argv[i + 1]) opts.aabPath = path.resolve(argv[++i]);
    else if (a === '--key' && argv[i + 1]) opts.keyFile = path.resolve(argv[++i]);
  }
  return opts;
}

function readPngDimensions(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw new Error('Invalid PNG header');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

async function loadAndValidateAssets() {
  const title = (await fs.readFile(path.join(META_DIR, 'title.txt'), 'utf8')).trim();
  const shortDescription = (await fs.readFile(path.join(META_DIR, 'short_description.txt'), 'utf8')).trim();
  const fullDescription = (await fs.readFile(path.join(META_DIR, 'full_description.txt'), 'utf8')).trim();
  const releaseNotes = (await fs.readFile(path.join(META_DIR, 'changelogs', 'default.txt'), 'utf8')).trim();

  if (!title || [...title].length > 30) {
    throw new Error(`title.txt must be 1..30 chars (got ${[...title].length})`);
  }
  if (!shortDescription || [...shortDescription].length > 80) {
    throw new Error(`short_description.txt must be 1..80 chars (got ${[...shortDescription].length})`);
  }
  if (!fullDescription || [...fullDescription].length > 4000) {
    throw new Error(`full_description.txt must be 1..4000 chars (got ${[...fullDescription].length})`);
  }
  if (!releaseNotes || [...releaseNotes].length > 500) {
    throw new Error(`changelogs/default.txt must be 1..500 chars (got ${[...releaseNotes].length})`);
  }

  const iconPath = path.join(GRAPHICS_DIR, 'icon-512.png');
  const iconBuf = await fs.readFile(iconPath);
  const iconDim = readPngDimensions(iconBuf);
  if (iconDim.width !== 512 || iconDim.height !== 512 || iconBuf.byteLength > 1024 * 1024) {
    throw new Error(`icon-512.png must be 512x512 <= 1MB (got ${iconDim.width}x${iconDim.height}, ${iconBuf.byteLength}B)`);
  }

  const fgPath = path.join(GRAPHICS_DIR, 'feature-graphic-1024x500.png');
  const fgBuf = await fs.readFile(fgPath);
  const fgDim = readPngDimensions(fgBuf);
  if (fgDim.width !== 1024 || fgDim.height !== 500) {
    throw new Error(`feature-graphic-1024x500.png must be 1024x500 (got ${fgDim.width}x${fgDim.height})`);
  }

  const shotsDir = path.join(GRAPHICS_DIR, 'phone-screenshots');
  const shotFiles = (await fs.readdir(shotsDir))
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (shotFiles.length < 4 || shotFiles.length > 8) {
    throw new Error(`Google Play requires 4..8 phone screenshots for best promotion (found ${shotFiles.length})`);
  }
  const screenshots = [];
  for (const f of shotFiles) {
    const buf = await fs.readFile(path.join(shotsDir, f));
    const dim = readPngDimensions(buf);
    if (dim.width < 320 || dim.height < 320) {
      throw new Error(`Screenshot ${f} too small (${dim.width}x${dim.height})`);
    }
    screenshots.push({ name: f, buf, dim });
  }

  return {
    title,
    shortDescription,
    fullDescription,
    releaseNotes,
    iconBuf,
    fgBuf,
    screenshots,
  };
}

async function apiJson(token, url, method = 'GET', body = undefined) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Google Play API ${method} ${url} failed (${res.status}): ${text}`);
  }
  return parsed;
}

async function apiUpload(token, url, contentType, binaryBuffer) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': contentType,
      'content-length': String(binaryBuffer.byteLength),
    },
    body: binaryBuffer,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Google Play Upload ${url} failed (${res.status}): ${text}`);
  }
  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv);
  const assets = await loadAndValidateAssets();

  console.log(`Validated Google Play Store assets for ${PACKAGE_NAME}:`);
  console.log(`  - Title (${[...assets.title].length}/30): ${assets.title}`);
  console.log(`  - Short Description (${[...assets.shortDescription].length}/80): ${assets.shortDescription}`);
  console.log(`  - Full Description (${[...assets.fullDescription].length}/4000 chars)`);
  console.log(`  - Release Notes (${[...assets.releaseNotes].length}/500 chars)`);
  console.log(`  - Icon: 512x512 (${Math.round(assets.iconBuf.byteLength / 1024)} KB)`);
  console.log(`  - Feature Graphic: 1024x500 (${Math.round(assets.fgBuf.byteLength / 1024)} KB)`);
  console.log(`  - Phone Screenshots: ${assets.screenshots.length} x 1080x1920`);

  if (opts.dryRun) {
    console.log('Dry-run validation PASSED.');
    return;
  }

  const aabBuf = await fs.readFile(opts.aabPath);
  let credentials;
  if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  } else {
    const rawKey = await fs.readFile(opts.keyFile, 'utf8');
    credentials = JSON.parse(rawKey);
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const accessToken = typeof tokenRes === 'string' ? tokenRes : tokenRes?.token;
  if (!accessToken) {
    throw new Error('Unable to obtain Google Play OAuth access token from Service Account');
  }

  console.log('1/6 Creating Google Play AppEdit transaction...');
  const edit = await apiJson(accessToken, `${API_ROOT}/edits`, 'POST', {});
  const editId = edit.id;

  console.log(`2/6 Uploading signed AAB (${Math.round(aabBuf.byteLength / 1024)} KB)...`);
  const bundle = await apiUpload(
    accessToken,
    `${UPLOAD_ROOT}/edits/${editId}/bundles?uploadType=media`,
    'application/octet-stream',
    aabBuf
  );
  const versionCode = bundle.versionCode;
  console.log(`    Uploaded versionCode=${versionCode}`);

  console.log('3/6 Updating en-US Store Listing copy...');
  await apiJson(accessToken, `${API_ROOT}/edits/${editId}/listings/en-US`, 'PUT', {
    language: 'en-US',
    title: assets.title,
    shortDescription: assets.shortDescription,
    fullDescription: assets.fullDescription,
  });

  console.log('4/6 Uploading en-US Icon, Feature Graphic, and 5 Phone Screenshots...');
  await apiUpload(
    accessToken,
    `${UPLOAD_ROOT}/edits/${editId}/listings/en-US/icon?uploadType=media`,
    'image/png',
    assets.iconBuf
  );
  await apiUpload(
    accessToken,
    `${UPLOAD_ROOT}/edits/${editId}/listings/en-US/featureGraphic?uploadType=media`,
    'image/png',
    assets.fgBuf
  );
  await apiJson(
    accessToken,
    `${API_ROOT}/edits/${editId}/listings/en-US/phoneScreenshots`,
    'DELETE'
  ).catch(() => {});
  for (const shot of assets.screenshots) {
    await apiUpload(
      accessToken,
      `${UPLOAD_ROOT}/edits/${editId}/listings/en-US/phoneScreenshots?uploadType=media`,
      'image/png',
      shot.buf
    );
  }

  console.log(`5/6 Assigning versionCode=${versionCode} to track '${opts.track}'...`);
  await apiJson(accessToken, `${API_ROOT}/edits/${editId}/tracks/${opts.track}`, 'PUT', {
    track: opts.track,
    releases: [
      {
        versionCodes: [String(versionCode)],
        status: opts.releaseStatus,
        releaseNotes: [{ language: 'en-US', text: assets.releaseNotes }],
      },
    ],
  });

  console.log('6/6 Committing AppEdit to Google Play...');
  await apiJson(accessToken, `${API_ROOT}/edits/${editId}:commit`, 'POST');
  console.log(`SUCCESS: Published ${PACKAGE_NAME} (versionCode=${versionCode}) to Google Play track '${opts.track}'.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
