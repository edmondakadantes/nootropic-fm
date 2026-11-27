import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Fingerprint, Lock, QrCode, Share2, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { formatProfileSummary, type UserProfile } from '../../shared/types';

const PALETTES: Array<[string, string, string]> = [
  ['#0891b2', '#4f46e5', '#059669'], // Cyan · Indigo · Emerald
  ['#7c3aed', '#0891b2', '#db2777'], // Violet · Cyan · Rose
  ['#059669', '#0891b2', '#2563eb'], // Emerald · Cyan · Royal Blue
  ['#0284c7', '#0891b2', '#6366f1'], // Cobalt · Cyan · Indigo
  ['#0284c7', '#7c3aed', '#0d9488'], // Sky · Purple · Teal
];

function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1337;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SigilSpec {
  palette: [string, string, string];
  hexTag: string;
  layers: Array<{
    path: string;
    points: Array<[number, number]>;
    color: string;
    opacity: number;
    width: number;
  }>;
  nodes: Array<{ x: number; y: number; r: number; color: string }>;
  ticks: Array<{ x1: number; y1: number; x2: number; y2: number; opacity: number }>;
}

function buildSigilSpec(seedStr: string, cx = 100, cy = 100, scale = 1): SigilSpec {
  const h = hashSeed(seedStr || 'nootropic.fm');
  const rand = mulberry32(h);
  const palette = PALETTES[h % PALETTES.length];
  const hexTag = (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);

  const layers: SigilSpec['layers'] = [];
  const baseRadii = [64 * scale, 48 * scale, 31 * scale];

  for (let l = 0; l < 3; l++) {
    const k1 = 3 + Math.floor(rand() * 6); // 3..8 harmonic petals
    const k2 = 5 + Math.floor(rand() * 8); // 5..12 overtone ripples
    const amp1 = (7 + rand() * 8) * scale;
    const amp2 = (3 + rand() * 5) * scale;
    const phase1 = rand() * Math.PI * 2;
    const phase2 = rand() * Math.PI * 2;
    const steps = 160;
    const pts: Array<[number, number]> = [];
    let d = '';

    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const r =
        baseRadii[l] +
        Math.sin(k1 * theta + phase1) * amp1 +
        Math.cos(k2 * theta + phase2) * amp2;
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;
      pts.push([x, y]);
      d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    d += ' Z';

    layers.push({
      path: d,
      points: pts,
      color: palette[l],
      opacity: l === 0 ? 0.92 : l === 1 ? 0.72 : 0.85,
      width: (l === 0 ? 1.8 : l === 1 ? 1.35 : 1.1) * scale,
    });
  }

  // Neural constellation nodes anchored along the first two harmonic rings
  const nodes: SigilSpec['nodes'] = [];
  const nodeCount = 7 + Math.floor(rand() * 5);
  for (let i = 0; i < nodeCount; i++) {
    const layer = layers[i % 2];
    const idx = Math.floor(rand() * (layer.points.length - 1));
    const [x, y] = layer.points[idx];
    nodes.push({
      x,
      y,
      r: (1.8 + rand() * 1.6) * scale,
      color: palette[i % 3],
    });
  }

  // Outer perimeter calibration ticks
  const ticks: SigilSpec['ticks'] = [];
  const tickCount = 36;
  for (let i = 0; i < tickCount; i++) {
    const theta = (i / tickCount) * Math.PI * 2;
    const major = i % 3 === 0;
    const r1 = (major ? 82 : 85) * scale;
    const r2 = 89 * scale;
    ticks.push({
      x1: cx + Math.cos(theta) * r1,
      y1: cy + Math.sin(theta) * r1,
      x2: cx + Math.cos(theta) * r2,
      y2: cy + Math.sin(theta) * r2,
      opacity: major ? 0.45 : 0.18,
    });
  }

  return { palette, hexTag, layers, nodes, ticks };
}

/**
 * Deterministic 1-of-1 Generative Cymatic Neural Fingerprint SVG.
 * Pure client-side math — zero PII, zero blockchain gas, uniquely tied to the listener's seed.
 */
export function NeuralFingerprintSigil({
  seed,
  size = 136,
  className = '',
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const spec = useMemo(() => buildSigilSpec(seed, 100, 100, 1), [seed]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={`shrink-0 text-white ${className}`}
      aria-label={`Neural acoustic fingerprint ${spec.hexTag}`}
    >
      <defs>
        <radialGradient id={`nfmBg_${spec.hexTag}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={spec.palette[0]} stopOpacity="0.22" />
          <stop offset="55%" stopColor={spec.palette[1]} stopOpacity="0.08" />
          <stop offset="100%" stopColor="#050814" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="100" r="94" fill={`url(#nfmBg_${spec.hexTag})`} />
      <circle
        cx="100"
        cy="100"
        r="89"
        fill="none"
        stroke="rgba(148,163,184,0.16)"
        strokeWidth="0.8"
      />

      {spec.ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={spec.palette[0]}
          strokeOpacity={t.opacity}
          strokeWidth="1"
        />
      ))}

      {spec.layers.map((layer, idx) => (
        <path
          key={idx}
          d={layer.path}
          fill={layer.color}
          fillOpacity="0.045"
          stroke={layer.color}
          strokeOpacity={layer.opacity}
          strokeWidth={layer.width}
        />
      ))}

      {spec.nodes.map((n, idx) => (
        <circle key={idx} cx={n.x} cy={n.y} r={n.r} fill="currentColor" stroke={n.color} strokeWidth="1.4" />
      ))}

      <circle cx="100" cy="100" r="6" fill={spec.palette[0]} fillOpacity="0.35" />
      <circle cx="100" cy="100" r="2.8" fill="currentColor" />
    </svg>
  );
}

export interface PublicFingerprintShareHighlight {
  protocolLabel?: string;
  frequencyHz?: number;
  shiftDelta?: number;
  pvtDeltaMs?: number | null;
}

const PUBLIC_SHARE_URL = 'https://www.nootropic.fm';

/**
 * Renders a 100% SAFE PUBLIC Shareable Neural Fingerprint Card (1080x1350 PNG)
 * styled as a Swiss Acoustic Calibration Certificate / Vinyl Lab Specimen (#F6F4EE archival stock).
 * Strictly NEVER includes the user's private Sync Key or #sync login URL — QR points ONLY to https://www.nootropic.fm.
 */
export async function renderPublicFingerprintCardBlob(opts: {
  seed: string;
  profile?: UserProfile | null;
  highlight?: PublicFingerprintShareHighlight;
}): Promise<{ blob: Blob; hexTag: string }> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas unavailable');
  }

  const plateCx = W / 2;
  const plateCy = 444;
  const hiSpec = buildSigilSpec(opts.seed, plateCx, plateCy, 2.38);
  const hexTag = hiSpec.hexTag;
  const studioPalette = ['#34D399', '#F3F1EC', '#F59E0B'];

  // 1. Archival Swiss Paper Stock (#F6F4EE -> #EDEAE0) + Deterministic Micro-Grain
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#F6F4EE');
  bgGrad.addColorStop(0.55, '#F2EFE7');
  bgGrad.addColorStop(1, '#EAE6DB');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const grainRand = mulberry32(hashSeed(`grain:${opts.seed}`));
  ctx.fillStyle = 'rgba(20, 20, 19, 0.032)';
  for (let i = 0; i < 1800; i++) {
    const gx = Math.floor(grainRand() * W);
    const gy = Math.floor(grainRand() * H);
    ctx.fillRect(gx, gy, 1.5, 1.5);
  }

  // 2. Outer Architectural Technical Frame
  ctx.strokeStyle = '#141413';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(44, 44, W - 88, H - 88, 12);
  ctx.stroke();

  // Horizontal Structural Hairlines
  ctx.strokeStyle = 'rgba(20, 20, 19, 0.22)';
  ctx.lineWidth = 1.25;
  [148, 796, 982].forEach((hy) => {
    ctx.beginPath();
    ctx.moveTo(44, hy);
    ctx.lineTo(W - 44, hy);
    ctx.stroke();
  });

  // 3. Header Certificate Title + Stamp Badge
  ctx.fillStyle = '#141413';
  ctx.font = 'bold 21px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('NOOTROPIC.FM // ACOUSTIC CALIBRATION CERTIFICATE', 84, 106);

  // NO. Stamp Box
  const stampText = `NO. ${hexTag}`;
  ctx.font = 'bold 20px monospace';
  const stampW = 210;
  ctx.fillStyle = '#E6EFEA';
  ctx.fillRect(W - 84 - stampW, 74, stampW, 44);
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 2;
  ctx.strokeRect(W - 84 - stampW, 74, stampW, 44);
  ctx.fillStyle = '#047857';
  ctx.textAlign = 'center';
  ctx.fillText(stampText, W - 84 - stampW / 2, 103);

  // 4. Center Recessed Matte-Carbon CRT Specimen Plate (x=280, y=184, w=520, h=520)
  ctx.fillStyle = '#0B0C0E';
  ctx.beginPath();
  ctx.roundRect(280, 184, 520, 520, 28);
  ctx.fill();
  ctx.strokeStyle = '#141413';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Faint CRT Crosshairs & Outer Scope Ring inside Specimen Plate
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(298, plateCy);
  ctx.lineTo(782, plateCy);
  ctx.moveTo(plateCx, 202);
  ctx.lineTo(plateCx, 686);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(243, 241, 236, 0.16)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(plateCx, plateCy, 224, 0, Math.PI * 2);
  ctx.stroke();

  // Degree perimeter ticks around specimen sigil
  for (const t of hiSpec.ticks) {
    ctx.strokeStyle = '#34D399';
    ctx.globalAlpha = Math.min(0.85, t.opacity + 0.15);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(t.x1, t.y1);
    ctx.lineTo(t.x2, t.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 1-of-1 Deterministic Cymatic Layers rendered in Phosphor / Ivory / Amber
  hiSpec.layers.forEach((layer, lIdx) => {
    const col = studioPalette[lIdx % studioPalette.length];
    ctx.beginPath();
    layer.points.forEach(([x, y], idx) => {
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = col === '#34D399' ? 'rgba(52,211,153,0.06)' : 'rgba(243,241,236,0.035)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.globalAlpha = Math.min(0.95, layer.opacity + 0.1);
    ctx.lineWidth = layer.width;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  hiSpec.nodes.forEach((n, nIdx) => {
    const col = studioPalette[nIdx % studioPalette.length];
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = '#0B0C0E';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(plateCx, plateCy, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#34D399';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(plateCx, plateCy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#F3F1EC';
  ctx.fill();

  // Specimen Plate Corner Micro-Annotations
  ctx.fillStyle = 'rgba(163, 163, 158, 0.72)';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FIG.01 // PHASE SPECIMEN', 304, 214);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#34D399';
  ctx.fillText('48.0 KHZ', 776, 682);

  // 5. Specimen Title Line
  ctx.textAlign = 'center';
  ctx.fillStyle = '#141413';
  ctx.font = 'bold 42px sans-serif';
  const rawTitle = opts.profile?.displayName?.trim()
    ? `${opts.profile.displayName.trim().toUpperCase()} · #${hexTag}`
    : `SPECIMEN #${hexTag}`;
  ctx.fillText(rawTitle.slice(0, 28), plateCx, 764);

  // 6. 2x2 Architectural Hairline Telemetry Grid (y=804..968)
  const gridX = 84;
  const gridY = 808;
  const gridW = W - 168;
  const gridH = 158;
  ctx.strokeStyle = 'rgba(20, 20, 19, 0.2)';
  ctx.lineWidth = 1.25;
  ctx.strokeRect(gridX, gridY, gridW, gridH);
  ctx.beginPath();
  ctx.moveTo(gridX + gridW / 2, gridY);
  ctx.lineTo(gridX + gridW / 2, gridY + gridH);
  ctx.moveTo(gridX, gridY + gridH / 2);
  ctx.lineTo(gridX + gridW, gridY + gridH / 2);
  ctx.stroke();

  const profileValue = opts.profile ? formatProfileSummary(opts.profile) : '1-of-1 Acoustic Signature';
  const protocolValue = opts.highlight?.protocolLabel || '3-Band LR4 Entrainment';
  const freqValue =
    opts.highlight?.frequencyHz && opts.highlight.frequencyHz > 0
      ? `${opts.highlight.frequencyHz} Hz Phase-Locked`
      : '48.0 kHz Studio Synthesis';
  const verifiedValue =
    typeof opts.highlight?.pvtDeltaMs === 'number' && opts.highlight.pvtDeltaMs < 0
      ? `${Math.abs(opts.highlight.pvtDeltaMs)} ms Faster Reaction`
      : typeof opts.highlight?.shiftDelta === 'number' && opts.highlight.shiftDelta > 0
        ? `State Shift +${opts.highlight.shiftDelta}`
        : 'Oscilloscope Measurable';

  const specCells = [
    { label: 'PROFILE', val: profileValue, x: gridX + 22, y: gridY + 26 },
    { label: 'PROTOCOL', val: protocolValue, x: gridX + gridW / 2 + 22, y: gridY + 26 },
    { label: 'FREQUENCY', val: freqValue, x: gridX + 22, y: gridY + gridH / 2 + 26 },
    { label: 'VERIFIED', val: verifiedValue, x: gridX + gridW / 2 + 22, y: gridY + gridH / 2 + 26 },
  ];

  ctx.textAlign = 'left';
  for (const cell of specCells) {
    ctx.fillStyle = '#6E6E68';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(cell.label, cell.x, cell.y);

    ctx.fillStyle = '#141413';
    ctx.font = 'bold 23px sans-serif';
    ctx.fillText(cell.val.slice(0, 31), cell.x, cell.y + 32);
  }

  // 7. Bottom Public QR Footer (STRICTLY points to https://www.nootropic.fm — NEVER private sync key!)
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, PUBLIC_SHARE_URL, {
    width: 244,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#141413', light: '#F6F4EE' },
  });
  ctx.strokeStyle = '#141413';
  ctx.lineWidth = 2;
  ctx.strokeRect(84, 1018, 260, 260);
  ctx.drawImage(qrCanvas, 92, 1026, 244, 244);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#047857';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('SCAN TO VERIFY ON OSCILLOSCOPE', 386, 1070);

  ctx.fillStyle = '#141413';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText('nootropic.fm', 386, 1134);

  ctx.fillStyle = '#4A4A46';
  ctx.font = '500 23px sans-serif';
  ctx.fillText('Reach your best mental state', 386, 1188);
  ctx.fillText('with music you can measure.', 386, 1222);

  ctx.fillStyle = '#6E6E68';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('5-MIN FREE CALIBRATION · +30M SHARE BONUS', 386, 1268);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
  });
  return { blob, hexTag };
}

/**
 * Shares the public Neural Fingerprint PNG via native OS Share Sheet on mobile (Instagram/WhatsApp/TikTok/X),
 * or downloads PNG + copies a ready-to-paste share caption on desktop.
 */
export async function sharePublicNeuralFingerprint(opts: {
  seed: string;
  profile?: UserProfile | null;
  highlight?: PublicFingerprintShareHighlight;
}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const { blob, hexTag } = await renderPublicFingerprintCardBlob(opts);
  const fileName = `nootropic-neural-fingerprint-${hexTag}.png`;
  const shareText = `My 1-of-1 Neural Fingerprint (Sigil #${hexTag}) on nootropic.fm — real focus & calm sound science you can measure on an oscilloscope. Generate yours free: ${PUBLIC_SHARE_URL}`;

  try {
    const file = new File([blob], fileName, { type: 'image/png' });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await nav.share({
        title: `My Neural Fingerprint #${hexTag} · nootropic.fm`,
        text: shareText,
        url: PUBLIC_SHARE_URL,
        files: [file],
      });
      return 'shared';
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'cancelled';
    }
    // Fall through to instant download + clipboard copy
  }

  const objUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = fileName;
  link.href = objUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objUrl), 4000);

  try {
    await navigator.clipboard.writeText(shareText);
  } catch {
    // ignore clipboard permission denial
  }
  return 'downloaded';
}

interface NeuralPassCardProps {
  profile: UserProfile;
  syncCode: string | null;
}

export function NeuralPassCard({ profile, syncCode }: NeuralPassCardProps) {
  const seed = syncCode || profile.id;
  const spec = useMemo(() => buildSigilSpec(seed, 100, 100, 1), [seed]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  // URL fragment (#sync=...) keeps the Sync Key strictly client-side (never sent in HTTP server logs!)
  const magicQrUrl = syncCode
    ? `${window.location.origin}/#sync=${encodeURIComponent(syncCode)}`
    : null;

  useEffect(() => {
    if (!magicQrUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(magicQrUrl, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#e0f2fe',
        light: '#060b18',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [magicQrUrl]);

  const handleCopy = async () => {
    if (!syncCode) return;
    try {
      await navigator.clipboard.writeText(syncCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  /**
   * Renders a high-res futuristic collectible PNG Pass Card (900x1200) directly on HTML5 Canvas
   * containing the 1-of-1 Cymatic Neural Fingerprint + Scannable QR Magic Link + Sync Key.
   */
  const handleDownloadPass = async () => {
    if (!syncCode) return;
    setDownloading(true);
    try {
      const W = 900;
      const H = 1200;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Deep Obsidian Space Backdrop
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, '#040712');
      bgGrad.addColorStop(0.5, '#091124');
      bgGrad.addColorStop(1, '#040710');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Subtle bioluminescent aura behind sigil
      const aura = ctx.createRadialGradient(W / 2, 415, 20, W / 2, 415, 310);
      aura.addColorStop(0, `${spec.palette[0]}38`);
      aura.addColorStop(0.55, `${spec.palette[1]}18`);
      aura.addColorStop(1, 'rgba(4,7,18,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, W, H);

      // Sleek outer border frame
      ctx.strokeStyle = 'rgba(34,211,238,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(36, 36, W - 72, H - 72, 40);
      ctx.stroke();

      // Header branding
      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('NOOTROPIC.FM · NEURAL FINGERPRINT PASS', 78, 102);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 18px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`SIGIL #${spec.hexTag}`, W - 78, 102);
      ctx.textAlign = 'left';

      // Draw exact 1-of-1 Generative Cymatic Neural Fingerprint
      const hiSpec = buildSigilSpec(seed, W / 2, 420, 2.45);
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(W / 2, 420, 218, 0, Math.PI * 2);
      ctx.stroke();

      for (const t of hiSpec.ticks) {
        ctx.strokeStyle = hiSpec.palette[0];
        ctx.globalAlpha = t.opacity;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.x1, t.y1);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const layer of hiSpec.layers) {
        ctx.beginPath();
        layer.points.forEach(([x, y], idx) => {
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = `${layer.color}12`;
        ctx.fill();
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = layer.opacity;
        ctx.lineWidth = layer.width;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of hiSpec.nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(W / 2, 420, 12, 0, Math.PI * 2);
      ctx.fillStyle = hiSpec.palette[0];
      ctx.fill();
      ctx.beginPath();
      ctx.arc(W / 2, 420, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Identity Metadata
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(profile.displayName || `Resonance #${spec.hexTag}`, W / 2, 715);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '500 24px monospace';
      ctx.fillText(formatProfileSummary(profile), W / 2, 760);

      ctx.fillStyle = '#64748b';
      ctx.font = '500 18px sans-serif';
      ctx.fillText(
        'Zero-PII Anonymous Acoustic Signature · Tune your mind',
        W / 2,
        798
      );

      // Divider
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(78, 842);
      ctx.lineTo(W - 78, 842);
      ctx.stroke();

      // Bottom QR + Sync Key panel
      if (magicQrUrl) {
        const qrCanvas = document.createElement('canvas');
        await QRCode.toCanvas(qrCanvas, magicQrUrl, {
          width: 230,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#e0f2fe', light: '#060b18' },
        });
        ctx.strokeStyle = 'rgba(34,211,238,0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(96, 882, 246, 246, 20);
        ctx.stroke();
        ctx.drawImage(qrCanvas, 104, 890, 230, 230);
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('SCAN QR TO SYNC ANY DEVICE', 384, 945);

      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(syncCode, 384, 1004);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '500 20px sans-serif';
      ctx.fillText('Point your phone camera at this QR', 384, 1054);
      ctx.fillText('to carry your learned sound model', 384, 1084);
      ctx.fillText('anywhere — zero email or password.', 384, 1114);

      const link = document.createElement('a');
      link.download = `nootropic-neural-pass-${syncCode}.png`;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setDownloading(false);
    }
  };

  const handleSharePublic = async () => {
    setSharing(true);
    setShareFeedback(null);
    try {
      const outcome = await sharePublicNeuralFingerprint({ seed, profile });
      if (outcome === 'cancelled') return;
      setShareFeedback(
        outcome === 'shared'
          ? 'Public Fingerprint Card shared!'
          : 'Public Card PNG saved + link copied (private key hidden)!'
      );
      window.setTimeout(() => setShareFeedback(null), 4000);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#0D0E10] p-4 space-y-3.5">
      {/* Studio Header */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="inline-flex items-center gap-1 font-mono-tech font-bold uppercase tracking-[0.16em] text-[#34D399]">
          <Fingerprint className="h-3.5 w-3.5" />
          Neural Fingerprint Pass
        </span>
        <span className="font-mono-tech rounded border border-white/15 bg-[#15171B] px-2 py-0.5 text-[9px] font-semibold text-[#D4D4CE]">
          NO. {spec.hexTag}
        </span>
      </div>

      {/* 1-of-1 Generative Cymatic Sigil + Scannable QR Code */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-center">
        <div className="flex flex-col items-center rounded-xl border border-white/[0.08] bg-[#131417] p-3 text-center">
          <NeuralFingerprintSigil seed={seed} size={132} />
          <div className="mt-1.5 text-xs font-semibold text-[#F3F1EC]">
            {profile.displayName || `Specimen #${spec.hexTag}`}
          </div>
          <div className="font-mono-tech text-[10px] text-[#34D399]">
            {formatProfileSummary(profile)}
          </div>
          <div className="mt-0.5 text-[10px] text-[#8E8E88]">
            {profile.sessionCount ?? 0} sessions tuned
          </div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-[#131417] p-3 text-center space-y-2">
          {qrDataUrl ? (
            <div className="rounded-lg border border-white/15 bg-[#08090B] p-1.5">
              <img
                src={qrDataUrl}
                alt={`Scannable QR Sync Key ${syncCode}`}
                className="h-28 w-28 rounded"
              />
            </div>
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-white/10 text-[#8E8E88]">
              <QrCode className="h-8 w-8" />
            </div>
          )}
          <div className="space-y-0.5">
            <div className="text-[10px] font-semibold text-[#F3F1EC]">Scan QR on Phone / Laptop</div>
            <p className="text-[10px] leading-snug text-[#8E8E88]">
              Instant zero-password sync via private URL hash.
            </p>
          </div>
        </div>
      </div>

      {/* Zero-PII Philosophy Line */}
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[#A3A39E]">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-[#34D399]" />
        <span>
          We never ask for email or passwords — your unique acoustic sigil &amp; QR pass are your
          cryptographic brain key.
        </span>
      </p>

      {/* Primary Viral Public Share CTA (100% Safe — Hides Private Sync Key!) */}
      <div className="space-y-2 border-t border-white/[0.08] pt-3">
        <button
          type="button"
          disabled={sharing}
          onClick={() => void handleSharePublic()}
          className="btn-aurora flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-60"
        >
          <Share2 className="h-3.5 w-3.5" />
          {sharing ? 'Generating Certificate PNG...' : 'Share My Neural Fingerprint (Safe Public Certificate)'}
        </button>
        {shareFeedback && (
          <p className="text-center text-[11px] font-medium text-[#34D399]">{shareFeedback}</p>
        )}
      </div>

      {/* Private Sync Key + Copy + Download Private Backup Pass */}
      {syncCode && (
        <div className="space-y-2 border-t border-white/[0.08] pt-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-200/90">
            <Lock className="h-3 w-3 shrink-0 text-amber-300" />
            <span>Private Sync Key — keep for your own devices only (never post publicly)</span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/12 bg-[#08090B] px-3 py-2">
            <code className="font-mono-tech text-xs font-bold tracking-widest text-[#34D399] sm:text-sm">
              {syncCode}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#16181C] px-2.5 py-1 text-[11px] font-semibold text-[#F3F1EC] hover:border-emerald-400/50"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownloadPass()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-[#141518] px-4 py-2 text-xs font-semibold text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC] disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5 text-[#34D399]" />
            {downloading ? 'Rendering Private Backup...' : 'Download Private Backup Pass (PNG + Sync QR)'}
          </button>
        </div>
      )}
    </div>
  );
}
