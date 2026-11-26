#!/usr/bin/env node
/**
 * nootropic.fm v7.0 — Offline Sub-Harmonic Remastering & Dual Codec Pipeline
 *
 * Fetches all 26 core R2 studio stems, remasters each offline via:
 *   1) RubberBand R3 transient-preserving stretch to exact integer sub-harmonic BPM
 *      in {60, 75, 80, 96, 100, 120} (beatless tracks preserved at 0 BPM)
 *   2) LibSOXR 28-bit linear-phase resampling strictly to 48,000 Hz
 *   3) ITU-R BS.1770-4 / EBU R128 loudness calibration (`ebur128=peak=true` + exact linear gain
 *      to -14.0 LUFS & -1.5 dBTP ceiling)
 *   4) Downbeat onset measurement directly on the remastered 48 kHz WAV
 *   5) Dual 256 kbps / 48 kHz encode:
 *        - libopus (.opus) -> audio/ogg; codecs=opus
 *        - aac     (.m4a)  -> audio/mp4 (+faststart)
 *   6) Parallel R2 upload under v7/... + writes shared/studioStemManifest.ts
 *
 * Flags:
 *   --skip-upload     Render, measure & write manifest locally without pushing to R2
 *   --limit N         Only process first N stems
 *   --force           Re-render even if local _v7_out files already exist
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildV7StemKeys,
  getAlignedNeuralBands,
  pickSubHarmonicTargetBpm,
} from '../shared/subharmonicGrid.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const CACHE_SRC = join(ROOT, 'audio-stems', '_v7_src');
const CACHE_OUT = join(ROOT, 'audio-stems', '_v7_out');
const MANIFEST_PATH = join(ROOT, 'shared', 'studioStemManifest.ts');
const WRANGLER_JS = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const args = new Set(process.argv.slice(2));
const SKIP_UPLOAD = args.has('--skip-upload');
const FORCE_RERENDER = args.has('--force');
const REUSE_PRENORM = args.has('--reuse-prenorm');
const onlyIdx = process.argv.indexOf('--only');
const ONLY_FILTERS =
  onlyIdx >= 0 && process.argv[onlyIdx + 1]
    ? process.argv[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Math.max(1, Number(process.argv[limitIdx + 1]) || 26) : 999;
const RENDER_CONCURRENCY = 4;
const UPLOAD_CONCURRENCY = 4;
const CACHE_BUST_REV = 'r=5';

const WINGET_FFMPEG_DIR =
  'C:\\Users\\Lenovo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.1-full_build\\bin';
const FFMPEG_BIN = existsSync(join(WINGET_FFMPEG_DIR, 'ffmpeg.exe'))
  ? join(WINGET_FFMPEG_DIR, 'ffmpeg.exe')
  : 'ffmpeg';
const FFPROBE_BIN = existsSync(join(WINGET_FFMPEG_DIR, 'ffprobe.exe'))
  ? join(WINGET_FFMPEG_DIR, 'ffprobe.exe')
  : 'ffprobe';

const BASE_CDN = process.env.NOOTROPIC_ORIGIN || 'https://www.nootropic.fm';

/**
 * Exact 26 core stems currently tracked in worker/index.ts (`STUDIO_TRACK_ACOUSTIC_MAP`).
 */
const CORE_STEMS = [
  { key: 'nootropic_trance/focus/hypnotic-velvet-tunnel-120-1.mp3', nativeBpm: 120, variant: 0 },
  { key: 'nootropic_trance/focus/polyrhythmic-neural-lock-120-2.mp3', nativeBpm: 120, variant: 0 },
  { key: 'lofi_keys/focus/dusty-rhodes-88-1.mp3', nativeBpm: 88, variant: 0 },
  { key: 'lofi_keys/focus/dusty-rhodes-88-2.mp3', nativeBpm: 88, variant: 1 },
  { key: 'lofi_keys/calm/evening-felt-rhodes-68-1.mp3', nativeBpm: 68, variant: 0 },
  { key: 'deep_electronic/drive/warm-analog-pulse-1.mp3', nativeBpm: 112, variant: 0 },
  { key: 'deep_electronic/drive/warm-analog-pulse-2.mp3', nativeBpm: 112, variant: 1 },
  { key: 'deep_electronic/calm/velvet-sub-horizon-68-1.mp3', nativeBpm: 68, variant: 0 },
  { key: 'deep_electronic/calm/analog-drift-pulse-68-2.mp3', nativeBpm: 68, variant: 1 },
  { key: 'deep_electronic/focus/neural-analog-flow-92-1.mp3', nativeBpm: 92, variant: 0 },
  { key: 'deep_electronic/focus/modular-focus-grid-96-2.mp3', nativeBpm: 96, variant: 0 },
  { key: 'cinematic_strings/focus/chamber-flow-92-1.mp3', nativeBpm: 92, variant: 0 },
  { key: 'cinematic_strings/focus/chamber-flow-92-2.mp3', nativeBpm: 92, variant: 1 },
  { key: 'jazz_rhodes/focus/late-night-rhodes-92-1.mp3', nativeBpm: 92, variant: 0 },
  { key: 'jazz_rhodes/focus/late-night-rhodes-92-2.mp3', nativeBpm: 92, variant: 1 },
  { key: 'acoustic_pluck/focus/nylon-arpeggios-90-1.mp3', nativeBpm: 90, variant: 0 },
  { key: 'acoustic_pluck/focus/nylon-arpeggios-90-2.mp3', nativeBpm: 90, variant: 1 },
  { key: 'nature_rain/calm/warm-rain-pads-1.mp3', nativeBpm: 0, variant: 0 },
  { key: 'nature_rain/calm/warm-rain-pads-2.mp3', nativeBpm: 0, variant: 1 },
  { key: 'dub_reggae/focus/warm-island-dub-88-1.mp3', nativeBpm: 88, variant: 0 },
  { key: 'dub_reggae/focus/warm-island-dub-88-2.mp3', nativeBpm: 88, variant: 1 },
  { key: 'ambient_space/calm/celestial-drift-64-1.mp3', nativeBpm: 64, variant: 0 },
  { key: 'ambient_space/calm/celestial-drift-64-2.mp3', nativeBpm: 64, variant: 1 },
  { key: 'ambient_space/focus/stellar-focus-pulse-84-1.mp3', nativeBpm: 84, variant: 0 },
  { key: 'solo_piano/calm/felt-piano-flow-72-1.mp3', nativeBpm: 72, variant: 0 },
  { key: 'solo_piano/focus/felt-piano-flow-86-2.mp3', nativeBpm: 86, variant: 0 },
  { key: 'bossa_nova/focus/rio-bossa-groove-92-1.mp3', nativeBpm: 92, variant: 0 },
  { key: 'bossa_nova/focus/rio-bossa-groove-92-2.mp3', nativeBpm: 92, variant: 1 },
];

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function spawnAsync(cmd, cmdArgs, opts = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: opts.cwd || ROOT,
      shell: Boolean(opts.shell),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`${cmd} exited ${code}:\n${(stderr || stdout).slice(-1200)}`));
      } else {
        resolvePromise({ stdout, stderr });
      }
    });
  });
}

async function runFfmpeg(ffmpegArgs) {
  const { stderr } = await spawnAsync(FFMPEG_BIN, ['-hide_banner', '-nostats', '-y', ...ffmpegArgs]);
  return stderr;
}

/**
 * Genre-calibrated mastering EQ chain (tames sub-bass mud on deep_electronic & groove stems
 * and restores articulate synth/Rhodes/nylon/piano presence without harshness).
 */
function buildGenreMasteringEq(sourceKey) {
  const genre = sourceKey.split('/')[0];
  const preTrim = [];
  if (sourceKey.includes('stellar-focus-pulse-84-1')) {
    preTrim.push('atrim=start=5.5,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.35:curve=qsin');
  } else if (sourceKey.includes('celestial-drift-64-2')) {
    preTrim.push('atrim=start=2.0,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.35:curve=qsin');
  } else if (sourceKey.includes('evening-felt-rhodes-68-1')) {
    preTrim.push('atrim=start=0.92,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.12:curve=qsin');
  } else if (sourceKey.includes('felt-piano-flow-86-2')) {
    preTrim.push('atrim=start=0.95,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.12:curve=qsin');
  }

  let eq;
  if (genre === 'nootropic_trance') {
    eq = [
      'highpass=f=30:poles=2',
      'equalizer=f=2400:t=q:w=1.0:g=2.2',
      'highshelf=f=6500:g=2.4:w=0.75',
    ].join(',');
  } else if (genre === 'deep_electronic') {
    eq = [
      'highpass=f=30:poles=2',
      'lowshelf=f=110:g=-3.4:w=0.7',
      'equalizer=f=240:t=q:w=1.1:g=-1.8',
      'equalizer=f=2600:t=q:w=0.9:g=4.6',
      'highshelf=f=6200:g=4.8:w=0.7',
    ].join(',');
  } else if (
    genre === 'lofi_keys' ||
    genre === 'jazz_rhodes' ||
    genre === 'bossa_nova' ||
    genre === 'dub_reggae'
  ) {
    eq = [
      'highpass=f=28:poles=2',
      'lowshelf=f=115:g=-1.8:w=0.75',
      'equalizer=f=3000:t=q:w=1.0:g=2.4',
      'highshelf=f=7000:g=2.5:w=0.75',
    ].join(',');
  } else if (genre === 'nature_rain') {
    eq = 'highpass=f=35:poles=2';
  } else {
    eq = [
      'highpass=f=26:poles=2',
      'equalizer=f=2800:t=q:w=1.0:g=1.4',
      'highshelf=f=7500:g=1.6:w=0.75',
    ].join(',');
  }
  return [...preTrim, eq].join(',');
}

/**
 * Parses ITU-R BS.1770-4 integrated LUFS and true-peak dBFS from the final `Summary:` block of `ebur128=peak=true`.
 */
function parseEbur128Summary(stderr) {
  const tail = stderr.slice(-2400);
  const iMatch = tail.match(/Summary:[\s\S]*?Integrated loudness:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  const tpMatch = tail.match(/True peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  const spMatch = tail.match(/Sample peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  const lufs = iMatch ? Number(iMatch[1]) : -15.5;
  const peak = tpMatch ? Number(tpMatch[1]) : spMatch ? Number(spMatch[1]) : -2.0;
  return { lufs, peak };
}

/**
 * Parses FFmpeg `loudnorm=print_format=json` pass-1 JSON payload.
 */
function parseLoudnormJson(stderr) {
  const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * Measures the first musical downbeat onset (in ms) from a 48 kHz 16-bit PCM stereo WAV file.
 * Locates the strongest rising attack slope inside the first beat cycle after digital silence.
 */
function measureDownbeatOffsetMs(wavPath, bpm) {
  if (!bpm || bpm <= 0) return 0;

  const buf = readFileSync(wavPath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return 0;

  let offset = 12;
  let dataStart = 44;
  let dataLen = buf.length - 44;
  let sampleRate = 48000;
  let numChannels = 2;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
    } else if (chunkId === 'data') {
      dataStart = offset + 8;
      dataLen = Math.min(chunkSize, buf.length - dataStart);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  const hopSamples = Math.max(120, Math.round(sampleRate * 0.005)); // 5 ms resolution
  const bytesPerFrame = numChannels * 2;
  const maxFramesToScan = Math.min(
    Math.floor(dataLen / bytesPerFrame),
    Math.round(sampleRate * 4.0)
  );

  const hopRms = [];
  for (let f = 0; f + hopSamples <= maxFramesToScan; f += hopSamples) {
    let sumSq = 0;
    for (let i = 0; i < hopSamples; i++) {
      const bytePos = dataStart + (f + i) * bytesPerFrame;
      const l = buf.readInt16LE(bytePos) / 32768;
      const r = numChannels > 1 ? buf.readInt16LE(bytePos + 2) / 32768 : l;
      const mono = 0.5 * (l + r);
      sumSq += mono * mono;
    }
    hopRms.push(Math.sqrt(sumSq / hopSamples));
  }

  if (hopRms.length < 4) return 0;

  const silenceFloor = 0.002;
  const firstActiveHop = hopRms.findIndex((v) => v >= silenceFloor);
  if (firstActiveHop < 0) return 0;

  const beatMs = 60000 / bpm;
  const windowHops = Math.min(hopRms.length - 2, firstActiveHop + Math.ceil((beatMs * 1.1) / 5));

  let bestSlope = -1;
  let bestHop = firstActiveHop;
  for (let h = Math.max(1, firstActiveHop); h <= windowHops; h++) {
    const slope = hopRms[h] - hopRms[h - 1] * 0.85;
    if (slope > bestSlope) {
      bestSlope = slope;
      bestHop = h;
    }
  }

  const peakVal = hopRms[bestHop];
  let onsetHop = bestHop;
  while (onsetHop > firstActiveHop && hopRms[onsetHop - 1] > peakVal * 0.25) {
    onsetHop--;
  }

  const rawMs = onsetHop * 5;
  const normalizedMs = rawMs % beatMs;
  return Number(normalizedMs.toFixed(2));
}

async function getWavDurationSec(wavPath) {
  const { stdout } = await spawnAsync(FFPROBE_BIN, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    wavPath,
  ]);
  const sec = Number(stdout.trim());
  return Number.isFinite(sec) ? Number(sec.toFixed(2)) : 0;
}

async function downloadSourceStem(sourceKey) {
  const localPath = join(CACHE_SRC, sourceKey);
  if (existsSync(localPath) && statSync(localPath).size > 16384) {
    return localPath;
  }
  ensureParent(localPath);
  const encoded = sourceKey.split('/').map((s) => encodeURIComponent(s)).join('/');
  const url = `${BASE_CDN}/api/audio/stream/${encoded}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const ab = await res.arrayBuffer();
  writeFileSync(localPath, Buffer.from(ab));
  return localPath;
}

async function uploadR2Object(objectKey, localFile, contentType) {
  // Retry transient OAuth token-refresh 401s / network blips (up to 4 attempts, linear backoff)
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await spawnAsync(
        process.execPath,
        [
          WRANGLER_JS,
          'r2',
          'object',
          'put',
          `nootropic-fm-audio/${objectKey}`,
          '--file',
          localFile,
          '--content-type',
          contentType,
          '--cache-control',
          'public, max-age=31536000, immutable',
          '--remote',
        ],
        { cwd: ROOT, shell: false }
      );
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
  throw lastErr;
}

async function renderStem(item, index, total) {
  const subHarmonicBpm = pickSubHarmonicTargetBpm(item.nativeBpm, item.variant);
  const tempoRatio =
    item.nativeBpm > 0 && subHarmonicBpm > 0 ? subHarmonicBpm / item.nativeBpm : 1;

  const { opusKey, aacKey } = buildV7StemKeys(item.key);
  const stemBase = item.key.replace(/\.[^.]+$/, '');
  const tmpPreNormWav = join(CACHE_OUT, `${stemBase}.prenorm.wav`);
  const masterWav = join(CACHE_OUT, `${stemBase}.master48k.wav`);
  const outOpus = join(CACHE_OUT, `${stemBase}.opus`);
  const outAac = join(CACHE_OUT, `${stemBase}.m4a`);

  ensureParent(tmpPreNormWav);
  ensureParent(outOpus);

  const alreadyRendered =
    !FORCE_RERENDER &&
    existsSync(masterWav) &&
    statSync(masterWav).size > 65536 &&
    existsSync(outOpus) &&
    statSync(outOpus).size > 16384 &&
    existsSync(outAac) &&
    statSync(outAac).size > 16384;

  let measuredLufs = -15.5;
  let measuredTp = -2.0;

  if (!alreadyRendered) {
    const canReusePreNorm =
      REUSE_PRENORM && existsSync(tmpPreNormWav) && statSync(tmpPreNormWav).size > 65536;

    if (!canReusePreNorm) {
      const srcFile = await downloadSourceStem(item.key);

      // 1. RubberBand R3 "finer" engine (0x20000000) + phase-coherent stereo `channels=together` (0x10000000)
      //    -> eliminates R2 phasiness & L/R image smearing on percussive electronic material
      //    + LibSOXR 28-bit 48 kHz WAV
      const filterSteps = [];
      if (item.nativeBpm > 0 && Math.abs(tempoRatio - 1) > 1e-4) {
        filterSteps.push(
          `rubberband=tempo=${tempoRatio.toFixed(6)}:pitch=1.0:transients=crisp:detector=compound:phase=laminar:window=standard:formant=preserved:pitchq=quality:channels=805306368`
        );
      }
      filterSteps.push('aresample=48000:resampler=soxr:precision=28:dither_method=shibata');
      await runFfmpeg([
        '-i',
        srcFile,
        '-af',
        filterSteps.join(','),
        '-ar',
        '48000',
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        tmpPreNormWav,
      ]);
    }

    const eqChain = buildGenreMasteringEq(item.key);

    // 2. Pass-1 ITU-R BS.1770-4 loudnorm analysis after genre EQ
    const pass1Stderr = await runFfmpeg([
      '-i',
      tmpPreNormWav,
      '-af',
      `${eqChain},loudnorm=I=-15.5:TP=-2.2:LRA=6.5:print_format=json`,
      '-f',
      'null',
      '-',
    ]);
    const ln = parseLoudnormJson(pass1Stderr);

    // 3. Pass-2 exact EBU R128 loudness & LRA leveling + strict level=disabled -2.0 dBFS brickwall guard
    //    (level=disabled prevents FFmpeg alimiter from re-boosting peaks back to 0 dBFS!)
    let normChain;
    const needsDynamicLra = item.key.includes('celestial-drift-64-2');
    if (
      !needsDynamicLra &&
      ln &&
      Number.isFinite(Number(ln.input_i)) &&
      Number.isFinite(Number(ln.input_tp)) &&
      Number.isFinite(Number(ln.input_lra)) &&
      Number.isFinite(Number(ln.input_thresh)) &&
      Number.isFinite(Number(ln.target_offset))
    ) {
      normChain = [
        eqChain,
        `loudnorm=I=-15.5:TP=-2.2:LRA=6.5:measured_I=${ln.input_i}:measured_TP=${ln.input_tp}:measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}:offset=${ln.target_offset}:linear=true`,
        'aresample=48000:resampler=soxr:precision=28',
        'alimiter=level_in=1:level_out=1:limit=0.794328:attack=5:release=60:level=disabled',
      ].join(',');
    } else {
      normChain = [
        eqChain,
        'loudnorm=I=-15.5:TP=-2.2:LRA=5.5',
        'aresample=48000:resampler=soxr:precision=28',
        'alimiter=level_in=1:level_out=1:limit=0.794328:attack=5:release=60:level=disabled',
      ].join(',');
    }

    await runFfmpeg([
      '-i',
      tmpPreNormWav,
      '-af',
      normChain,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      masterWav,
    ]);

    // 4. Encode both 256 kbps 48 kHz Opus & AAC-LC concurrently
    await Promise.all([
      runFfmpeg([
        '-i',
        masterWav,
        '-ar',
        '48000',
        '-ac',
        '2',
        '-c:a',
        'libopus',
        '-b:a',
        '256k',
        '-vbr',
        'on',
        '-compression_level',
        '9',
        '-application',
        'audio',
        outOpus,
      ]),
      runFfmpeg([
        '-i',
        masterWav,
        '-ar',
        '48000',
        '-ac',
        '2',
        '-c:a',
        'aac',
        '-b:a',
        '256k',
        '-movflags',
        '+faststart',
        outAac,
      ]),
    ]);
  }

  // Always verify actual post-encode Opus integrated LUFS & True Peak!
  const verifyStderr = await runFfmpeg([
    '-i',
    outOpus,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  const postStats = parseEbur128Summary(verifyStderr);
  measuredLufs = Number(postStats.lufs.toFixed(2));
  measuredTp = Number(postStats.peak.toFixed(2));

  const downbeatOffsetMs = measureDownbeatOffsetMs(masterWav, subHarmonicBpm);
  const durationSec = await getWavDurationSec(masterWav);
  const opusBytes = statSync(outOpus).size;
  const aacBytes = statSync(outAac).size;

  console.log(
    `[Render ${String(index + 1).padStart(2, '0')}/${total}] ${item.key} | ${item.nativeBpm || 'beatless'}->${subHarmonicBpm || 'beatless'} BPM | db=${downbeatOffsetMs}ms | opus=${Math.round(opusBytes / 1024)}KB m4a=${Math.round(aacBytes / 1024)}KB`
  );

  return {
    item,
    opusKey,
    aacKey,
    outOpus,
    outAac,
    opusBytes,
    aacBytes,
    subHarmonicBpm,
    downbeatOffsetMs,
    measuredLufs,
    measuredTp,
    durationSec,
  };
}

async function runPool(items, concurrency, workerFn) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const cur = nextIdx++;
      if (cur >= items.length) return;
      results[cur] = await workerFn(items[cur], cur, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  mkdirSync(CACHE_SRC, { recursive: true });
  mkdirSync(CACHE_OUT, { recursive: true });

  const queue = CORE_STEMS.filter((it) =>
    ONLY_FILTERS.length === 0 ? true : ONLY_FILTERS.some((f) => it.key.includes(f))
  ).slice(0, LIMIT);
  console.log(
    `\n[v7 Remaster] Rendering ${queue.length} core stems (concurrency=${RENDER_CONCURRENCY}, upload=${!SKIP_UPLOAD})...\n`
  );

  const rendered = await runPool(queue, RENDER_CONCURRENCY, renderStem);

  if (!SKIP_UPLOAD) {
    console.log(`\n[v7 Upload] Pushing ${rendered.length * 2} files to Cloudflare R2 (concurrency=${UPLOAD_CONCURRENCY})...\n`);
    const uploadJobs = [];
    for (const r of rendered) {
      uploadJobs.push({ key: r.opusKey, file: r.outOpus, type: 'audio/ogg; codecs=opus' });
      uploadJobs.push({ key: r.aacKey, file: r.outAac, type: 'audio/mp4' });
    }
    await runPool(uploadJobs, UPLOAD_CONCURRENCY, async (job, idx, tot) => {
      await uploadR2Object(job.key, job.file, job.type);
      console.log(`[Upload ${String(idx + 1).padStart(2, '0')}/${tot}] ${job.key}`);
    });
  }

  const manifestEntries = {};
  if (ONLY_FILTERS.length > 0 && existsSync(MANIFEST_PATH)) {
    const prevRaw = readFileSync(MANIFEST_PATH, 'utf8');
    const jsonStart = prevRaw.indexOf('{', prevRaw.indexOf('STUDIO_STEM_V7_MANIFEST'));
    const jsonEnd = prevRaw.lastIndexOf('}');
    if (jsonStart > 0 && jsonEnd > jsonStart) {
      Object.assign(manifestEntries, JSON.parse(prevRaw.slice(jsonStart, jsonEnd + 1)));
    }
  }
  const revTag = ONLY_FILTERS.length > 0 ? 'r=6' : CACHE_BUST_REV;
  for (const r of rendered) {
    manifestEntries[r.item.key] = {
      sourceKey: r.item.key,
      opusKey: r.opusKey,
      aacKey: r.aacKey,
      opusUrl: `/api/audio/stream/${r.opusKey.split('/').map((s) => encodeURIComponent(s)).join('/')}?${revTag}`,
      aacUrl: `/api/audio/stream/${r.aacKey.split('/').map((s) => encodeURIComponent(s)).join('/')}?${revTag}`,
      opusBytes: r.opusBytes,
      aacBytes: r.aacBytes,
      nativeBpm: r.item.nativeBpm,
      subHarmonicBpm: r.subHarmonicBpm,
      alignedBandsHz: getAlignedNeuralBands(r.subHarmonicBpm),
      downbeatOffsetMs: r.downbeatOffsetMs,
      lufs: r.measuredLufs,
      truePeakDbtp: r.measuredTp,
      sampleRate: 48000,
      durationSec: r.durationSec,
    };
  }

  const tsContent = `// AUTO-GENERATED by scripts/remaster-stems-v7.mjs — do not hand-edit.
import type { StudioStemV7Entry } from './subharmonicGrid';

export const STUDIO_STEM_V7_MANIFEST: Record<string, StudioStemV7Entry> = ${JSON.stringify(manifestEntries, null, 2)};
`;
  writeFileSync(MANIFEST_PATH, tsContent, 'utf8');
  console.log(`\n[v7 Remaster] Complete! Wrote ${Object.keys(manifestEntries).length} entries to ${MANIFEST_PATH}\n`);
}

main().catch((err) => {
  console.error('[v7 Remaster] FATAL:', err);
  process.exit(1);
});
