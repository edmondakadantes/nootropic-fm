import { readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const GENRES = [
  'lofi_keys',
  'deep_electronic',
  'cinematic_strings',
  'jazz_rhodes',
  'acoustic_pluck',
  'nature_rain',
];

const ENERGIES = ['calm', 'focus', 'drive'];

const DEFAULT_ENERGY_BY_GENRE = {
  nature_rain: 'calm',
  deep_electronic: 'drive',
  lofi_keys: 'focus',
  cinematic_strings: 'focus',
  jazz_rhodes: 'focus',
  acoustic_pluck: 'focus',
};

const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.opus', '.m4a', '.wav']);
const skipNormalize = process.argv.includes('--no-normalize');

const rootDir = process.cwd();
const stemsDir = join(rootDir, 'audio-stems');
const wranglerBin = join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);

function hasFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return probe.status === 0;
}

const canNormalize = !skipNormalize && hasFfmpeg();
if (!canNormalize && !skipNormalize) {
  console.warn('Warning: ffmpeg not found in PATH — uploading raw audio without -14 LUFS normalization.');
}

const tempOutDir = join(tmpdir(), `nootropic-fm-norm-${Date.now()}`);
if (canNormalize) {
  mkdirSync(tempOutDir, { recursive: true });
}

function inferEnergyFromFile(fileName, genre) {
  const lower = fileName.toLowerCase();
  if (lower.startsWith('calm_') || lower.startsWith('calm-')) return 'calm';
  if (lower.startsWith('drive_') || lower.startsWith('drive-')) return 'drive';
  if (lower.startsWith('focus_') || lower.startsWith('focus-')) return 'focus';
  return DEFAULT_ENERGY_BY_GENRE[genre] ?? 'focus';
}

function normalizeToMp3(localPath, safeOutName) {
  const outPath = join(tempOutDir, safeOutName);
  // EBU R128 Loudness Normalization (-14 LUFS, -1.5 dBTP) + 150ms click-free fade-in + 192k studio MP3
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      localPath,
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.15',
      '-map_metadata',
      '-1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      '-ar',
      '44100',
      outPath,
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  );
  return outPath;
}

let uploaded = 0;

try {
  for (const genre of GENRES) {
    const genreDir = join(stemsDir, genre);
    if (!existsSync(genreDir)) continue;

    // 1. Scan structured subfolders: audio-stems/<genre>/<energy>/
    for (const energy of ENERGIES) {
      const energyDir = join(genreDir, energy);
      if (!existsSync(energyDir)) continue;
      const files = readdirSync(energyDir).filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase()));
      for (const file of files) {
        const localPath = join(energyDir, file);
        const base = basename(file, extname(file)).replace(/[^a-zA-Z0-9_-]+/g, '-');
        const targetFile = canNormalize ? `${base}.mp3` : file;
        const uploadPath = canNormalize ? normalizeToMp3(localPath, `${genre}_${energy}_${targetFile}`) : localPath;
        const r2Key = `nootropic-fm-audio/${genre}/${energy}/${targetFile}`;

        console.log(
          `${canNormalize ? 'Normalized (-14 LUFS) & uploading' : 'Uploading'} ${genre}/${energy}/${targetFile} -> Cloudflare R2...`
        );
        execFileSync(
          wranglerBin,
          ['r2', 'object', 'put', r2Key, '--file', uploadPath, '--content-type', 'audio/mpeg', '--remote'],
          { stdio: 'inherit', shell: process.platform === 'win32' }
        );
        uploaded++;
      }
    }

    // 2. Backward-compatible flat files in audio-stems/<genre>/
    const flatFiles = readdirSync(genreDir).filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase()));
    for (const file of flatFiles) {
      const localPath = join(genreDir, file);
      const energy = inferEnergyFromFile(file, genre);
      const base = basename(file, extname(file)).replace(/[^a-zA-Z0-9_-]+/g, '-');
      const targetFile = canNormalize ? `${base}.mp3` : file;
      const uploadPath = canNormalize ? normalizeToMp3(localPath, `${genre}_${energy}_${targetFile}`) : localPath;
      const r2Key = `nootropic-fm-audio/${genre}/${energy}/${targetFile}`;

      console.log(
        `${canNormalize ? 'Normalized (-14 LUFS) & uploading' : 'Uploading'} ${genre}/${energy}/${targetFile} (from flat folder) -> Cloudflare R2...`
      );
      execFileSync(
        wranglerBin,
        ['r2', 'object', 'put', r2Key, '--file', uploadPath, '--content-type', 'audio/mpeg', '--remote'],
        { stdio: 'inherit', shell: process.platform === 'win32' }
      );
      uploaded++;
    }
  }
} finally {
  if (existsSync(tempOutDir)) {
    rmSync(tempOutDir, { recursive: true, force: true });
  }
}

if (uploaded === 0) {
  console.log(
    'No audio files found. Drop .mp3 files into audio-stems/<genre>/<calm|focus|drive>/ (e.g. audio-stems/lofi_keys/focus/) and run npm run upload:stems!'
  );
} else {
  console.log(
    `\nDone! Uploaded ${uploaded} studio track(s) (${canNormalize ? 'normalized to -14 LUFS, 192 kbps MP3' : 'raw'}) to Cloudflare R2 — immediately live on https://app.nootropic.fm!`
  );
}
