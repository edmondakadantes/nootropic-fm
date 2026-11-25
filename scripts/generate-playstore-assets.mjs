import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC_ICON = path.join(ROOT, 'public', 'brand', 'stripe-icon.png');
const PLAY_GRAPHICS = path.join(ROOT, 'playstore', 'graphics');
const SCREENSHOTS_DIR = path.join(PLAY_GRAPHICS, 'phone-screenshots');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTwoLines(text, maxChars = 56) {
  const words = String(text).trim().split(/\s+/);
  let line1 = '';
  let idx = 0;
  while (idx < words.length) {
    const candidate = line1 ? `${line1} ${words[idx]}` : words[idx];
    if (candidate.length > maxChars && line1) break;
    line1 = candidate;
    idx++;
  }
  const line2 = words.slice(idx).join(' ');
  return [line1, line2];
}

async function createFeatheredOrb(size) {
  const half = size / 2;
  const featherMask = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="72%" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${half}" cy="${half}" r="${half}" fill="url(#fade)"/>
    </svg>
  `);
  const resized = await sharp(SRC_ICON)
    .resize(size, size, { fit: 'contain', background: '#07090E' })
    .png()
    .toBuffer();
  return await sharp(resized)
    .composite([{ input: featherMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function generateIcons() {
  await fs.mkdir(PLAY_GRAPHICS, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  // 1. Official Google Play 512x512 Hi-Res Icon (full-bleed opaque #07090E, 32-bit PNG, < 1024 KB)
  const playIconPath = path.join(PLAY_GRAPHICS, 'icon-512.png');
  await sharp(SRC_ICON)
    .resize(512, 512, { fit: 'cover' })
    .flatten({ background: '#07090E' })
    .png({ compressionLevel: 9 })
    .toFile(playIconPath);

  // Also emit PWA icons in public/brand/
  await sharp(SRC_ICON)
    .resize(512, 512, { fit: 'cover' })
    .flatten({ background: '#07090E' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'public', 'brand', 'icon-512.png'));

  await sharp(SRC_ICON)
    .resize(192, 192, { fit: 'cover' })
    .flatten({ background: '#07090E' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'public', 'brand', 'icon-192.png'));

  // 2. Android mipmap launcher icons (if android/res exists)
  try {
    await fs.access(ANDROID_RES);
    const densities = [
      { folder: 'mipmap-mdpi', launcher: 48, fg: 108 },
      { folder: 'mipmap-hdpi', launcher: 72, fg: 162 },
      { folder: 'mipmap-xhdpi', launcher: 96, fg: 216 },
      { folder: 'mipmap-xxhdpi', launcher: 144, fg: 324 },
      { folder: 'mipmap-xxxhdpi', launcher: 192, fg: 432 },
    ];

    for (const d of densities) {
      const dir = path.join(ANDROID_RES, d.folder);
      await fs.mkdir(dir, { recursive: true });

      // Standard square-safe launcher icon
      await sharp(SRC_ICON)
        .resize(d.launcher, d.launcher, { fit: 'cover' })
        .flatten({ background: '#07090E' })
        .png({ compressionLevel: 9 })
        .toFile(path.join(dir, 'ic_launcher.png'));

      // Circular mask for ic_launcher_round.png
      const r = d.launcher / 2;
      const circleMask = Buffer.from(
        `<svg width="${d.launcher}" height="${d.launcher}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`
      );
      const resizedSquare = await sharp(SRC_ICON)
        .resize(d.launcher, d.launcher, { fit: 'cover' })
        .flatten({ background: '#07090E' })
        .png()
        .toBuffer();
      await sharp(resizedSquare)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png({ compressionLevel: 9 })
        .toFile(path.join(dir, 'ic_launcher_round.png'));

      // Adaptive foreground (66% safe zone centered on transparent canvas)
      const innerSize = Math.round(d.fg * 0.68);
      const pad = Math.floor((d.fg - innerSize) / 2);
      const innerOrb = await sharp(SRC_ICON)
        .resize(innerSize, innerSize, { fit: 'contain', background: '#07090E' })
        .png()
        .toBuffer();
      await sharp({
        create: {
          width: d.fg,
          height: d.fg,
          channels: 4,
          background: { r: 7, g: 9, b: 14, alpha: 0 },
        },
      })
        .composite([{ input: innerOrb, left: pad, top: pad }])
        .png({ compressionLevel: 9 })
        .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    }
  } catch {
    // android/ not yet generated
  }
}

async function generateFeatureGraphic() {
  // Exact 1024x500 opaque 24-bit PNG required by Google Play Console
  const orbBuf = await createFeatheredOrb(400);

  const overlaySvg = Buffer.from(`
    <svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#07090E"/>
          <stop offset="55%" stop-color="#0B1018"/>
          <stop offset="100%" stop-color="#071512"/>
        </linearGradient>
        <radialGradient id="glow" cx="78%" cy="50%" r="42%">
          <stop offset="0%" stop-color="#34D399" stop-opacity="0.22"/>
          <stop offset="60%" stop-color="#38BDF8" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="#07090E" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1024" height="500" fill="url(#bgGrad)"/>
      <rect width="1024" height="500" fill="url(#glow)"/>

      <!-- Subtle acoustic grid lines -->
      <line x1="64" y1="92" x2="580" y2="92" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="1"/>
      <line x1="64" y1="412" x2="580" y2="412" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="1"/>

      <!-- Brand pill -->
      <rect x="64" y="108" width="236" height="34" rx="17" fill="#10231D" stroke="#34D399" stroke-opacity="0.45" stroke-width="1.2"/>
      <circle cx="84" cy="125" r="5" fill="#34D399"/>
      <text x="98" y="130" fill="#34D399" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.4">STUDY-BACKED AUDIO</text>

      <!-- Main Wordmark & Headline -->
      <text x="64" y="202" fill="#F3F1EC" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="54" font-weight="800" letter-spacing="-1">
        nootropic<tspan fill="#34D399">.fm</tspan>
      </text>
      <text x="64" y="258" fill="#E7E5DF" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="28" font-weight="600">
        Tune your mind for focus,
      </text>
      <text x="64" y="296" fill="#34D399" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="28" font-weight="600">
        calm, and deep flow.
      </text>

      <text x="64" y="348" fill="#9CA3AF" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="17" font-weight="400">
        48 kHz Studio Music + Precision Psychoacoustic Soundscapes
      </text>

      <!-- Feature chips -->
      <rect x="64" y="372" width="144" height="30" rx="8" fill="#12161D" stroke="#FFFFFF" stroke-opacity="0.12"/>
      <text x="136" y="392" text-anchor="middle" fill="#D4D4CE" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="600">10 Studio Genres</text>

      <rect x="218" y="372" width="156" height="30" rx="8" fill="#12161D" stroke="#FFFFFF" stroke-opacity="0.12"/>
      <text x="296" y="392" text-anchor="middle" fill="#D4D4CE" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="600">2D Neural Map</text>

      <rect x="384" y="372" width="170" height="30" rx="8" fill="#12161D" stroke="#FFFFFF" stroke-opacity="0.12"/>
      <text x="469" y="392" text-anchor="middle" fill="#D4D4CE" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="600">Lock-Screen Play</text>
    </svg>
  `);

  const base = await sharp(overlaySvg).png().toBuffer();
  await sharp(base)
    .composite([{ input: orbBuf, left: 602, top: 55, blend: 'screen' }])
    .flatten({ background: '#07090E' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(PLAY_GRAPHICS, 'feature-graphic-1024x500.png'));
}

async function generatePhoneScreenshots() {
  const orbSmall = await createFeatheredOrb(156);

  const slides = [
    {
      file: '01-neural-state-map.png',
      badge: 'STEP 1 · 2D NEURAL STATE MAP',
      title1: 'Go from how you feel',
      title2: 'to how you want to feel.',
      subtitle: 'Pick your exact mental state across 19 micro-states and get a tailored audio trajectory.',
      accent: '#34D399',
      cardTitle: 'Current State → Target State',
      rows: [
        { left: 'Scattered & Restless', right: '72% Energy · 28% Clarity', highlight: false },
        { left: 'Target: Deep Flow', right: '16 Hz Beta · LR4 Mid-Band', highlight: true },
        { left: 'Output Calibration', right: 'Stereo Headphones · 48 kHz', highlight: false },
        { left: 'Session Horizon', right: '45 Min Iso-Principle Ramp', highlight: false },
      ],
      waveMode: 'map',
    },
    {
      file: '02-science-blueprint.png',
      badge: 'STEP 2 · TRANSPARENT SOUND SCIENCE',
      title1: 'Every session cites',
      title2: 'peer-reviewed acoustics.',
      subtitle: 'Inspect live PubMed & OpenAlex acoustic protocols before pressing play.',
      accent: '#38BDF8',
      cardTitle: 'Executable Acoustic Blueprint',
      rows: [
        { left: 'Entrainment Layer', right: '16 Hz Cortical Salience AM', highlight: true },
        { left: 'Crossover Isolation', right: '190 Hz – 4,500 Hz (0 dB Sub)', highlight: false },
        { left: 'Stochastic Floor', right: 'Calibrated Pink Noise (-22 dB)', highlight: false },
        { left: 'Literature Match', right: 'PubMed & OpenAlex Verified', highlight: false },
      ],
      waveMode: 'bars',
    },
    {
      file: '03-two-layer-music-engine.png',
      badge: 'STEP 3 · 2-LAYER 48 KHZ AUDIO',
      title1: 'Music you actually love,',
      title2: 'zero harsh drone fatigue.',
      subtitle: 'Switch genres anytime without altering the underlying psychoacoustic carrier.',
      accent: '#34D399',
      cardTitle: '10 Instrumental Styles + Endless Stream',
      rows: [
        { left: 'Deep Electronic', right: '92 BPM · Sub-Harmonic Locked', highlight: true },
        { left: 'Canopy Rainfall', right: 'True-Stereo 48 kHz Recording', highlight: false },
        { left: 'Solo Grand Piano', right: 'Warm Felt · Zero Lyrics', highlight: false },
        { left: 'Lo-Fi Study & Jazz', right: 'Endless Non-Repeating Stream', highlight: false },
      ],
      waveMode: 'sine',
    },
    {
      file: '04-live-signal-proof.png',
      badge: 'REAL-TIME OSCILLOSCOPE PROOF',
      title1: 'See and isolate every',
      title2: 'sound wave in real time.',
      subtitle: 'Verify live Y(t) modulation envelopes, stereo X/Y phase, and LUFS loudness.',
      accent: '#FBBF24',
      cardTitle: 'Live 48 kHz Telemetry & Layer Monitor',
      rows: [
        { left: 'Monitor Mode', right: 'Full Mix · Pure Wave · Music', highlight: true },
        { left: 'Envelope Depth', right: 'Phase-Locked · -1.0 dBTP Safe', highlight: false },
        { left: 'Headphone Crossfeed', right: 'Bauer M/S Fatigue-Free Stage', highlight: false },
        { left: 'Lock-Screen Audio', right: 'Uninterrupted Background Play', highlight: false },
      ],
      waveMode: 'lissajous',
    },
    {
      file: '05-adaptive-personalization.png',
      badge: 'ADAPTIVE PERSONALIZATION',
      title1: 'Learns which frequencies',
      title2: 'work best for your brain.',
      subtitle: 'Private passwordless Neural Pass syncs your best-performing protocols anywhere.',
      accent: '#A78BFA',
      cardTitle: 'Personal & Cohort Signal Learning',
      rows: [
        { left: 'Post-Session Check', right: '10-Second Focus Shift Rating', highlight: true },
        { left: 'Optional Reaction Test', right: 'Objective Pre/Post PVT Timing', highlight: false },
        { left: 'Neural Sync Key', right: 'NFM-XXXX-XXXX · Zero Passwords', highlight: false },
        { left: '1-Tap Data Control', right: 'Zero Ad SDKs · Instant Delete', highlight: false },
      ],
      waveMode: 'sine',
    },
  ];

  for (const s of slides) {
    const rowBoxes = s.rows
      .map((r, idx) => {
        const y = 980 + idx * 142;
        const border = r.highlight ? s.accent : '#FFFFFF';
        const borderOp = r.highlight ? '0.65' : '0.11';
        const bg = r.highlight ? '#11221E' : '#12151C';
        return `
          <rect x="116" y="${y}" width="848" height="118" rx="22" fill="${bg}" stroke="${border}" stroke-opacity="${borderOp}" stroke-width="1.8"/>
          <text x="156" y="${y + 50}" fill="#F3F1EC" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="27" font-weight="700">${escapeXml(r.left)}</text>
          <text x="156" y="${y + 88}" fill="${r.highlight ? s.accent : '#9CA3AF'}" font-family="Consolas, Courier New, monospace" font-size="22" font-weight="600">${escapeXml(r.right)}</text>
          <circle cx="912" cy="${y + 59}" r="11" fill="${r.highlight ? s.accent : '#2A303C'}"/>
        `;
      })
      .join('\n');

    let visualGraphic = '';
    if (s.waveMode === 'map') {
      visualGraphic = `
        <rect x="116" y="640" width="848" height="250" rx="24" fill="#0B0E14" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1.5"/>
        <line x1="540" y1="665" x2="540" y2="865" stroke="#FFFFFF" stroke-opacity="0.12" stroke-dasharray="6 6"/>
        <line x1="150" y1="765" x2="930" y2="765" stroke="#FFFFFF" stroke-opacity="0.12" stroke-dasharray="6 6"/>
        <circle cx="310" cy="720" r="16" fill="#F59E0B"/>
        <path d="M 310 720 Q 530 670 760 710" fill="none" stroke="${s.accent}" stroke-width="5" stroke-dasharray="10 6"/>
        <circle cx="760" cy="710" r="22" fill="${s.accent}" fill-opacity="0.25"/>
        <circle cx="760" cy="710" r="11" fill="${s.accent}"/>
        <text x="235" y="762" fill="#FCD34D" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="20" font-weight="600">Now: Scattered</text>
        <text x="665" y="762" fill="${s.accent}" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="20" font-weight="700">Goal: Deep Flow</text>
      `;
    } else if (s.waveMode === 'lissajous') {
      visualGraphic = `
        <rect x="116" y="640" width="848" height="250" rx="24" fill="#0B0E14" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1.5"/>
        <ellipse cx="340" cy="765" rx="135" ry="78" transform="rotate(-24 340 765)" fill="none" stroke="${s.accent}" stroke-width="3.5" stroke-opacity="0.9"/>
        <ellipse cx="340" cy="765" rx="95" ry="52" transform="rotate(24 340 765)" fill="none" stroke="#34D399" stroke-width="2.5" stroke-opacity="0.75"/>
        <path d="M 540 765 C 575 685, 610 845, 645 765 C 680 685, 715 845, 750 765 C 785 685, 820 845, 855 765 C 880 710, 905 820, 925 765" fill="none" stroke="#34D399" stroke-width="4"/>
        <text x="245" y="868" fill="#9CA3AF" font-family="Consolas, monospace" font-size="18">X/Y PHASE SCOPE</text>
        <text x="655" y="868" fill="#34D399" font-family="Consolas, monospace" font-size="18">Y(t) LR4 ENVELOPE</text>
      `;
    } else {
      visualGraphic = `
        <rect x="116" y="640" width="848" height="250" rx="24" fill="#0B0E14" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1.5"/>
        <path d="M 156 765 Q 205 675 254 765 T 352 765 T 450 765 T 548 765 T 646 765 T 744 765 T 842 765 T 924 765" fill="none" stroke="${s.accent}" stroke-width="5"/>
        <path d="M 156 765 Q 205 715 254 765 T 352 765 T 450 765 T 548 765 T 646 765 T 744 765 T 842 765 T 924 765" fill="none" stroke="#38BDF8" stroke-width="2.5" stroke-opacity="0.65"/>
        <text x="160" y="864" fill="#9CA3AF" font-family="Consolas, monospace" font-size="19">48,000 Hz · 3-BAND LINKWITZ-RILEY DSP · ZERO CLIPPING</text>
      `;
    }

    const [subLine1, subLine2] = wrapTwoLines(s.subtitle, 56);

    const svg = Buffer.from(`
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#07090E"/>
            <stop offset="50%" stop-color="#0B1018"/>
            <stop offset="100%" stop-color="#07090E"/>
          </linearGradient>
          <radialGradient id="topGlow" cx="50%" cy="18%" r="48%">
            <stop offset="0%" stop-color="${s.accent}" stop-opacity="0.20"/>
            <stop offset="100%" stop-color="#07090E" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1080" height="1920" fill="url(#bg)"/>
        <rect width="1080" height="1920" fill="url(#topGlow)"/>

        <!-- Top Badge -->
        <rect x="84" y="108" width="490" height="50" rx="25" fill="#111822" stroke="${s.accent}" stroke-opacity="0.5" stroke-width="1.5"/>
        <text x="329" y="141" text-anchor="middle" fill="${s.accent}" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="21" font-weight="700" letter-spacing="1.8">${escapeXml(s.badge)}</text>

        <!-- Headline -->
        <text x="84" y="246" fill="#F3F1EC" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="64" font-weight="800" letter-spacing="-1.2">${escapeXml(s.title1)}</text>
        <text x="84" y="324" fill="${s.accent}" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="64" font-weight="800" letter-spacing="-1.2">${escapeXml(s.title2)}</text>
        <text x="84" y="396" fill="#A3A39E" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="28" font-weight="400">${escapeXml(subLine1)}</text>
        <text x="84" y="436" fill="#A3A39E" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="28" font-weight="400">${escapeXml(subLine2)}</text>

        <!-- Phone Device Mockup Frame -->
        <rect x="68" y="498" width="944" height="1330" rx="56" fill="#0E1117" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="3"/>
        <rect x="440" y="524" width="200" height="10" rx="5" fill="#FFFFFF" fill-opacity="0.18"/>

        <!-- App Header inside Phone -->
        <text x="116" y="598" fill="#F3F1EC" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="32" font-weight="800">nootropic<tspan fill="#34D399">.fm</tspan></text>
        <text x="964" y="596" text-anchor="end" fill="#9CA3AF" font-family="Consolas, monospace" font-size="21">${escapeXml(s.cardTitle)}</text>

        ${visualGraphic}

        ${rowBoxes}

        <!-- Bottom Brand Caption -->
        <text x="540" y="1772" text-anchor="middle" fill="#6E6E68" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="21">nootropic.fm · Study-Backed Psychoacoustic Audio · Listeners 18+</text>
      </svg>
    `);

    const base = await sharp(svg).png().toBuffer();
    await sharp(base)
      .composite([{ input: orbSmall, left: 846, top: 82, blend: 'screen' }])
      .flatten({ background: '#07090E' })
      .png({ compressionLevel: 9 })
      .toFile(path.join(SCREENSHOTS_DIR, s.file));
  }
}

async function main() {
  await generateIcons();
  await generateFeatureGraphic();
  await generatePhoneScreenshots();
  console.log('Generated Google Play Store icon (512x512), feature graphic (1024x500), PWA icons, and 5 phone screenshots (1080x1920).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
