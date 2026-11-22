import { readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const GENRES = [
  'lofi_keys',
  'deep_electronic',
  'cinematic_strings',
  'jazz_rhodes',
  'acoustic_pluck',
  'nature_rain',
];

const MIME_MAP = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

const rootDir = process.cwd();
const stemsDir = join(rootDir, 'audio-stems');
const wranglerBin = join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);

let uploaded = 0;

for (const genre of GENRES) {
  const dir = join(stemsDir, genre);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => Object.keys(MIME_MAP).includes(extname(f).toLowerCase()));
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const localPath = join(dir, file);
    const r2Key = `nootropic-fm-audio/${genre}/${file}`;
    console.log(`Uploading ${genre}/${file} -> Cloudflare R2...`);
    execFileSync(
      wranglerBin,
      ['r2', 'object', 'put', r2Key, '--file', localPath, '--content-type', MIME_MAP[ext], '--remote'],
      { stdio: 'inherit', shell: process.platform === 'win32' }
    );
    uploaded++;
  }
}

if (uploaded === 0) {
  console.log('No audio files found in audio-stems/<genre>/. Drop .mp3 files into the genre folders first!');
} else {
  console.log(`\nDone! Uploaded ${uploaded} studio audio stem(s) to Cloudflare R2 — they are immediately live on https://app.nootropic.fm!`);
}
