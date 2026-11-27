import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  Cpu,
  Crown,
  FlaskConical,
  Headphones,
  KeyRound,
  Layers,
  Mail,
  Moon,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  Sun,
  Waves,
  Zap,
} from 'lucide-react';
import { ShowcaseMiniDemo, type ShowcaseDemoMode } from '../audio/ShowcaseMiniDemo';
import { api } from '../lib/api';
import { buildStudioUrl } from '../lib/domainRouting';
import type { ResolvedThemeMode } from '../lib/circadianTheme';
import type { TargetState, UserProfile } from '../../shared/types';
import { NeuralFingerprintSigil } from './NeuralFingerprintPass';
import type { SoundSystemProductCode } from './SoundSystemsModal';

interface FlagshipShowcaseViewProps {
  profile: UserProfile | null;
  syncCode: string | null;
  themeMode: ResolvedThemeMode;
  onSetThemeMode: (mode: ResolvedThemeMode) => void;
  onOpenProModal: () => void;
  onOpenIdentityModal: () => void;
  onOpenPrivacyModal: () => void;
  onEnterStudio?: (opts?: {
    launch?: string;
    target?: TargetState;
    durationMin?: number;
    screen?: 'studylab' | 'insights';
  }) => void;
}

const DEMO_MODES: Array<{
  id: ShowcaseDemoMode;
  step: string;
  label: string;
  badge: string;
  detail: string;
}> = [
  {
    id: 'flat',
    step: '01',
    label: 'Flat Consumer Audio',
    badge: 'UNMODULATED',
    detail: 'Plain warm chord pad — smooth listening without cortical 6×40 Hz phase lock.',
  },
  {
    id: 'signature_6x40',
    step: '02',
    label: '6×40 Hz Signature Mode',
    badge: '190–4.5k Hz LR4',
    detail: 'Nested 40 Hz Gamma micro-pulses + 6 Hz Theta envelope + 0.10 Hz stereo Mayer orbit.',
  },
  {
    id: 'huggins_600',
    step: '03',
    label: '600 Hz Dichotic Seal Test',
    badge: 'IN-EAR CHECK',
    detail:
      'Hear a soft 600 Hz chime inside filtered noise? Your earbuds have clean L/R phase separation. Silent/flat = crosstalk or Spatial Audio mixing.',
  },
];

const HARDWARE_DROPS: Array<{
  code: SoundSystemProductCode;
  series: string;
  name: string;
  price: string;
  subPrice: string;
  statusBadge: string;
  image: string;
  imageAlt: string;
  specs: string[];
  acousticRationale: string;
}> = [
  {
    code: 'earbuds_pro_hrv',
    series: 'FLAGSHIP WIRELESS · CLOSED-LOOP BIOMETRIC',
    name: 'NootropicFM Earbuds Pro',
    price: '$249',
    subPrice: '100% Cordless · Includes 1 Yr Biometric Pro',
    statusBadge: 'Flagship Wireless · In-Ear PPG',
    image: '/brand/hardware/earbuds-pro-hrv.png',
    imageAlt:
      'NootropicFM Earbuds Pro cordless CNC Orbital Phase-Ring earbuds showing inner optical PPG HRV sensor window and aluminum charging case branded nootropic.fm',
    specs: [
      'True Wireless Bluetooth LE Audio LC3 (20 ms) + aptX Lossless Reference Path',
      'Concha Optical PPG Multi-Wavelength Sensor + NTC Thermal + 3-Axis Motion Compensation',
      'Live Ear-Canal RMSSD & 0.10 Hz Mayer Biofeedback Adapting AI Tuning in Real Time',
    ],
    acousticRationale:
      'Zero cables and lab-grade HRV telemetry from inside the ear concha — continuously teaching the AI how your nervous system reacts.',
  },
  {
    code: 'sound_system_01',
    series: 'ARCHITECTURAL DESK & SLEEP',
    name: 'NootropicFM Sound System 01',
    price: '$549',
    subPrice: 'Halo Architectural Nearfield Instrument',
    statusBadge: 'Nearfield XTC · No Wearable Needed',
    image: '/brand/hardware/sound-system-01.png',
    imageAlt:
      'NootropicFM Sound System 01 bead-blasted dark anodized aluminum desktop nearfield crosstalk-canceled speaker with rotary CNC dial and nootropic.fm logo',
    specs: [
      '4-Driver Nearfield Waveguide Array with Real-Time Acoustic Crosstalk Cancellation (XTC)',
      'Dedicated SHARC DSP + mmWave/ToF Head-Tracking & Contactless Sleep Respiration',
      '1800K Nocturnal Amber to 480 nm Daylight Circadian Lighting Architecture',
    ],
    acousticRationale:
      'Reconstructs dichotic binaural phase isolation at your desk or bedside without wearing anything in your ears.',
  },
  {
    code: 'earbuds_01_usb_c',
    series: 'STUDIO REFERENCE EDITION · OPTIONAL WIRED',
    name: 'NootropicFM Earbuds 01 (Wired USB-C)',
    price: '$129',
    subPrice: '$119 Pre-Order · Zero-Battery Desk Reference',
    statusBadge: 'Optional Wired Studio Variant',
    image: '/brand/hardware/earbuds-01-hero.png',
    imageAlt:
      'NootropicFM Earbuds 01 matte obsidian CNC Orbital Phase-Ring in-ear monitors with braided cable and 24-bit 48 kHz USB-C DAC monolith engraved with nootropic.fm logo',
    specs: [
      '10 mm LCP/Beryllium Dynamic Driver + Knowles/Sonion Balanced Armature (190–4,500 Hz)',
      'Integrated 24-bit / 48 kHz USB-C DAC/DSP (CS43131 class) with EEPROM Hardware Auto-ID',
      'Zero Li-Ion Battery Degradation · ±1 dB L/R Match · Memory-Foam Passive Seal',
    ],
    acousticRationale:
      'Optional pure USB-C wired monitor for purists wanting zero RF and zero battery aging at fixed desks.',
  },
];

const OUTCOME_LAUNCHERS: Array<{
  target: TargetState;
  label: string;
  hzTag: string;
  durationMin: number;
  desc: string;
}> = [
  {
    target: 'deep_flow',
    label: 'Deep Flow',
    hzTag: '6×40 Hz CFC',
    durationMin: 45,
    desc: 'Uninterrupted coding, writing, and complex problem solving.',
  },
  {
    target: 'alert_focus',
    label: 'Sharp Focus',
    hzTag: '16 Hz Beta LR4',
    durationMin: 25,
    desc: 'Sustained reading and attention without harsh drones.',
  },
  {
    target: 'energy_lift',
    label: 'Energy Lift',
    hzTag: '18 Hz Drive',
    durationMin: 20,
    desc: 'Clear afternoon mental fog with bright harmonic drive.',
  },
  {
    target: 'calm_reset',
    label: 'Calm Reset',
    hzTag: '0.10 Hz HRV',
    durationMin: 15,
    desc: 'Slow baroreflex paced breathing tide to drop nervous tension.',
  },
  {
    target: 'sleep_winddown',
    label: 'Sleep Wind-Down',
    hzTag: '6 Hz Theta',
    durationMin: 30,
    desc: 'Gentle evening decompression with nocturnal >3.2 kHz silk filter.',
  },
];

export function FlagshipShowcaseView({
  profile,
  syncCode,
  themeMode,
  onSetThemeMode,
  onOpenProModal,
  onOpenIdentityModal,
  onOpenPrivacyModal,
  onEnterStudio,
}: FlagshipShowcaseViewProps) {
  const [heroView, setHeroView] = useState<'photo' | 'xray'>('photo');
  const [demoMode, setDemoMode] = useState<ShowcaseDemoMode>('signature_6x40');
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoSecLeft, setDemoSecLeft] = useState(30);
  const [demoError, setDemoError] = useState<string | null>(null);

  const [selectedProduct, setSelectedProduct] =
    useState<SoundSystemProductCode>('earbuds_pro_hrv');
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [reservedQueue, setReservedQueue] = useState<number | null>(null);

  const demoRef = useRef<ShowcaseMiniDemo | null>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDay = themeMode === 'daylight';

  useEffect(() => {
    return () => {
      demoRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!demoPlaying) return undefined;
    const id = window.setInterval(() => {
      setDemoSecLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [demoPlaying]);

  // 60fps Oscilloscope visualizer synced to live ShowcaseMiniDemo or standby phase preview
  useEffect(() => {
    const canvas = scopeCanvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const sampleBuf = new Float32Array(new ArrayBuffer(1024 * 4));
    let phase = 0;
    let rafId = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(260, Math.floor(rect.width));
      const h = Math.max(92, Math.floor(rect.height));
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = isDay ? '#E8EFF7' : '#030706';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.13)' : 'rgba(52, 211, 153, 0.14)';
      ctx.lineWidth = 1;
      for (let gx = 1; gx < 8; gx++) {
        const x = Math.round((gx / 8) * w) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let gy = 1; gy < 4; gy++) {
        const y = Math.round((gy / 4) * h) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const midY = h * 0.5;
      ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.22)' : 'rgba(52, 211, 153, 0.22)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(midY) + 0.5);
      ctx.lineTo(w, Math.round(midY) + 0.5);
      ctx.stroke();

      const hasLive = demoPlaying && demoRef.current?.getWaveformSamples(sampleBuf);
      ctx.beginPath();
      const N = 220;
      for (let i = 0; i <= N; i++) {
        const norm = i / N;
        const x = norm * w;
        let yVal = 0;
        if (hasLive) {
          const idx = Math.min(sampleBuf.length - 1, Math.floor(norm * (sampleBuf.length - 1)));
          yVal = Math.max(-1, Math.min(1, sampleBuf[idx] * 2.2));
        } else {
          const env =
            demoMode === 'signature_6x40'
              ? 0.52 + 0.48 * Math.sin(norm * Math.PI * 6 - phase * 0.9)
              : demoMode === 'huggins_600'
                ? 0.35 + 0.25 * Math.sin(norm * Math.PI * 19 + phase * 1.4)
                : 0.42;
          const carrier =
            demoMode === 'huggins_600'
              ? Math.sin(norm * Math.PI * 36 - phase * 2.7) * 0.5 +
                Math.sin(norm * Math.PI * 59 + phase * 1.9) * 0.35
              : Math.sin(norm * Math.PI * 26 - phase * 2.2);
          yVal = carrier * env * 0.72;
        }
        const y = midY - yVal * (h * 0.36);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle =
        demoMode === 'flat'
          ? isDay
            ? '#1E40AF'
            : '#93C5FD'
          : isDay
            ? '#047857'
            : '#34D399';
      ctx.lineWidth = 2.1;
      ctx.stroke();
      ctx.restore();

      phase += demoPlaying ? 0.09 : 0.03;
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [demoMode, demoPlaying, isDay]);

  const handleToggleDemo = async () => {
    setDemoError(null);
    if (!demoRef.current) {
      demoRef.current = new ShowcaseMiniDemo();
    }
    if (demoPlaying) {
      demoRef.current.stop();
      setDemoPlaying(false);
      setDemoSecLeft(30);
      return;
    }
    try {
      setDemoSecLeft(30);
      await demoRef.current.start(demoMode, {
        durationMs: 30_000,
        onAutoStop: () => {
          setDemoPlaying(false);
          setDemoSecLeft(30);
        },
      });
      setDemoPlaying(true);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Unable to start browser audio.');
      setDemoPlaying(false);
    }
  };

  const handleSelectDemoMode = (next: ShowcaseDemoMode) => {
    setDemoMode(next);
    if (demoPlaying && demoRef.current) {
      demoRef.current.setMode(next);
    }
  };

  const handleStudioNavigate = (
    e: React.MouseEvent<HTMLAnchorElement>,
    opts?: {
      launch?: string;
      target?: TargetState;
      durationMin?: number;
      screen?: 'studylab' | 'insights';
    }
  ) => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
    const isLocalOrWorkers =
      hostname !== 'nootropic.fm' && hostname !== 'www.nootropic.fm';
    if (isLocalOrWorkers && onEnterStudio) {
      e.preventDefault();
      onEnterStudio(opts);
    }
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaitlistError(null);
    const cleanEmail = waitlistEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setWaitlistError('Please enter a valid email address for Founding Batch priority access.');
      return;
    }
    setWaitlistBusy(true);
    try {
      const res = await api.joinHardwareWaitlist({
        email: cleanEmail,
        productCode: selectedProduct,
        profileId: profile?.id,
      });
      setReservedQueue(res.queueNumber);
    } catch (err) {
      setWaitlistError(err instanceof Error ? err.message : 'Unable to join waitlist right now.');
    } finally {
      setWaitlistBusy(false);
    }
  };

  const scrollToWaitlistWithProduct = (code: SoundSystemProductCode) => {
    setSelectedProduct(code);
    setReservedQueue(null);
    const el = document.getElementById('waitlist-form');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const studioRootUrl = buildStudioUrl();

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Precision Flagship Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0A0B0C]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3.5">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="group flex shrink-0 items-center gap-2.5 text-left"
            title="nootropic.fm · Hardware & Psychoacoustic Architecture"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#131518] text-[#34D399] sm:h-9 sm:w-9">
              <Radio className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
            </div>
            <div className="whitespace-nowrap">
              <div className="font-display text-sm font-bold tracking-tight text-[#F3F1EC] leading-none sm:text-base">
                nootropic<span className="text-[#34D399]">.fm</span>
              </div>
              <div className="mt-0.5 text-[9px] font-mono-tech uppercase tracking-[0.14em] text-[#34D399]/85 sm:text-[10px]">
                Neural Tuning AI
              </div>
            </div>
          </button>

          <nav className="hidden items-center gap-1 xl:flex" aria-label="Showcase Sections">
            <a
              href="#hardware"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              Earbuds
            </a>
            <a
              href="#demo"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              30s Proof
            </a>
            <a
              href="/science/"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              Science
            </a>
            <a
              href="/compare/"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              Compare
            </a>
            <a
              href="#pricing"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              Pricing
            </a>
            <a
              href="/investors/"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              Investors
            </a>
            <a
              href="/contact/"
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:bg-white/[0.05] hover:text-[#F3F1EC]"
            >
              Contact
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <div
              role="group"
              aria-label="Display Mode"
              className="inline-flex shrink-0 items-center rounded-lg border border-white/12 bg-[#131518] p-0.5 text-[11px] font-semibold"
            >
              <button
                type="button"
                onClick={() => onSetThemeMode('daylight')}
                aria-pressed={themeMode === 'daylight'}
                aria-label="Daylight Mode"
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 sm:px-2 ${
                  themeMode === 'daylight'
                    ? 'bg-[#22252A] text-[#F3F1EC]'
                    : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                }`}
              >
                <Sun className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Day</span>
              </button>
              <button
                type="button"
                onClick={() => onSetThemeMode('night')}
                aria-pressed={themeMode === 'night'}
                aria-label="Night Mode"
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 sm:px-2 ${
                  themeMode === 'night'
                    ? 'bg-emerald-500/15 text-[#34D399]'
                    : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                }`}
              >
                <Moon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Night</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenProModal}
              className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-[#34D399] transition hover:bg-emerald-500/20 sm:inline-flex"
            >
              <Crown className="h-3.5 w-3.5 shrink-0" />
              <span>{profile?.planTier === 'pro' ? 'PRO' : 'Go Pro'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenIdentityModal}
              className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/12 bg-[#131518] px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC] sm:inline-flex"
              title="Sync or Restore Neural Pass"
            >
              {profile ? (
                <>
                  <NeuralFingerprintSigil seed={syncCode || profile.id} size={20} />
                  <span>{profile.displayName || 'Pass Active'}</span>
                </>
              ) : (
                <>
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                  <span>Sync QR</span>
                </>
              )}
            </button>

            <a
              href={studioRootUrl}
              onClick={(e) => handleStudioNavigate(e)}
              className="btn-aurora inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold sm:gap-1.5 sm:px-3"
            >
              <span>Open Studio</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        </div>

        {/* Compact & Tablet Quick-Access Strip (<1280px) — 1-tap navigation to every showcase section & institutional page */}
        <nav
          className="flex items-center gap-1.5 overflow-x-auto border-t border-white/[0.06] px-3 py-1.5 xl:hidden"
          aria-label="Mobile Showcase Sections"
        >
          <a
            href="#hardware"
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE]"
          >
            Earbuds
          </a>
          <a
            href="#demo"
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE]"
          >
            30s Proof
          </a>
          <a
            href="/science/"
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE]"
          >
            Science
          </a>
          <a
            href="/compare/"
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE]"
          >
            Compare
          </a>
          <a
            href="#pricing"
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE]"
          >
            Pricing
          </a>
          <a
            href="/investors/"
            className="shrink-0 whitespace-nowrap rounded-md border border-emerald-400/25 bg-emerald-500/[0.07] px-2.5 py-1 text-[11px] font-semibold text-[#34D399]"
          >
            Investors
          </a>
          <a
            href="/contact/"
            className="shrink-0 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE]"
          >
            Contact
          </a>
          <button
            type="button"
            onClick={onOpenProModal}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-[#34D399] sm:hidden"
          >
            <Crown className="h-3 w-3 shrink-0" />
            <span>{profile?.planTier === 'pro' ? 'PRO' : 'Go Pro'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenIdentityModal}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-white/10 bg-[#131518] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE] sm:hidden"
          >
            <KeyRound className="h-3 w-3 text-[#34D399]" />
            <span>{profile ? 'Pass' : 'Sync QR'}</span>
          </button>
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 py-8 sm:space-y-16 sm:px-6 sm:py-12">
        {/* SECTION 1: HERO & ORBITAL PHASE-RING STAGE */}
        <section className="glass-stage animate-rise rounded-3xl p-5 sm:p-8 lg:p-10">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
            {/* Hero Copy */}
            <div className="space-y-5 lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                <Headphones className="h-3.5 w-3.5 shrink-0" />
                Adaptive Neural-Acoustic AI · Precision In-Ear Hardware
              </div>

              <h1 className="font-display text-3xl font-bold tracking-tight text-[#F3F1EC] sm:text-4xl lg:text-[42px] lg:leading-[1.08]">
                The AI That Learns How Sound{' '}
                <span className="text-aurora">Tunes the Human Mind.</span>
              </h1>

              <p className="text-sm leading-relaxed text-[#D4D4CE] sm:text-base">
                How the human brain responds to sound remains largely uncharted territory.{' '}
                <strong className="text-[#F3F1EC]">nootropic.fm</strong> (<code className="font-mono-tech text-[#34D399]">app.nootropic.fm</code>)
                is a self-learning AI that maps <strong className="text-[#F3F1EC]">how you feel right now</strong> to{' '}
                <strong className="text-[#F3F1EC]">where you want to arrive</strong>, tests peer-reviewed acoustic studies on your nervous system, learns from your reaction, and pairs with{' '}
                <strong className="text-[#F3F1EC]">Orbital Phase-Ring Earbuds</strong> built to preserve subtle{' '}
                <span className="font-mono-tech font-semibold text-[#F3F1EC]">-20 dBc</span> neural waves.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href={studioRootUrl}
                  onClick={(e) => handleStudioNavigate(e)}
                  className="btn-aurora inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
                >
                  <Zap className="h-4 w-4 shrink-0" />
                  <span>Launch Audio Studio</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => scrollToWaitlistWithProduct('earbuds_pro_hrv')}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#131518] px-4 py-3 text-sm font-semibold text-[#F3F1EC] transition hover:border-white/30 hover:bg-[#1B1E24]"
                >
                  <span>Reserve Earbuds Pro ($249)</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 pt-2 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3 py-2.5">
                  <div className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                    Cordless LC3 + HRV
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#A3A39E]">
                    Zero Wires · Live In-Ear PPG
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3 py-2.5">
                  <div className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                    6×40 Hz Signature
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#A3A39E]">
                    Phase-Locked 120.000 BPM Engine
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3 py-2.5">
                  <div className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                    25% Blind Sham
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#A3A39E]">
                    Verified via 20-Trial PVT &amp; HRV
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Flagship Hardware Stage (Photo vs Acoustic CAD X-Ray) */}
            <div className="space-y-3 lg:col-span-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono-tech text-[10px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                    ORBITAL PHASE-RING WIRELESS · IN-EAR HRV
                  </div>
                  <div className="text-xs font-semibold text-[#F3F1EC]">
                    100% Cordless CNC Torus + Sapphire Wave Core &amp; Optical PPG
                  </div>
                </div>

                <div
                  role="group"
                  aria-label="Earbuds Pro Inspection Mode"
                  className="inline-flex rounded-lg border border-white/15 bg-[#131518] p-0.5 text-[11px] font-semibold"
                >
                  <button
                    type="button"
                    onClick={() => setHeroView('photo')}
                    aria-pressed={heroView === 'photo'}
                    className={`rounded-md px-2.5 py-1 ${
                      heroView === 'photo'
                        ? 'bg-[#22252A] text-[#F3F1EC]'
                        : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                    }`}
                  >
                    Studio Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroView('xray')}
                    aria-pressed={heroView === 'xray'}
                    className={`rounded-md px-2.5 py-1 ${
                      heroView === 'xray'
                        ? 'bg-[#22252A] text-[#F3F1EC]'
                        : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                    }`}
                  >
                    Acoustic CAD X-Ray
                  </button>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-[#0B0C0E]">
                {heroView === 'photo' ? (
                  <div className="relative">
                    <img
                      src="/brand/hardware/earbuds-pro-hrv.png"
                      alt="NootropicFM Earbuds Pro cordless Orbital Phase-Ring wireless earbuds with in-ear optical PPG HRV sensor and aluminum case engraved with nootropic.fm"
                      className="aspect-[16/9] w-full object-cover"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#121417] px-3.5 py-2.5 text-[11px]">
                      <span className="font-mono-tech font-semibold text-[#F3F1EC]">
                        Cordless Aluminum Case · <span className="text-[#34D399]">nootropic.fm</span> Etched Ring &amp; Inner PPG Window
                      </span>
                      <span className="rounded border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 font-mono-tech text-[10px] font-bold text-[#34D399]">
                        LC3 LOSSLESS · PPG HRV
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 sm:p-5">
                    <div className="rounded-xl border border-white/10 bg-[#050706] p-3">
                      <svg
                        viewBox="0 0 640 330"
                        className="w-full h-auto"
                        role="img"
                        aria-label="Acoustic CAD X-Ray Cross-Section of NootropicFM Earbuds Pro Wireless"
                      >
                        {/* Blueprint Grid */}
                        <defs>
                          <pattern id="nfmCadGrid" width="32" height="32" patternUnits="userSpaceOnUse">
                            <path
                              d="M 32 0 L 0 0 0 32"
                              fill="none"
                              stroke="currentColor"
                              className="studio-grid-faint"
                              strokeWidth="1"
                            />
                          </pattern>
                        </defs>
                        <rect width="640" height="330" fill="url(#nfmCadGrid)" />

                        {/* Cordless Wireless SoC Core (inside Ring housing — zero cable!) */}
                        <rect x="28" y="138" width="66" height="54" rx="10" fill="#1E293B" stroke="#38BDF8" strokeWidth="1.8" />
                        <text x="61" y="162" textAnchor="middle" fill="#FFFFFF" fontSize="9.5" fontWeight="700" fontFamily="monospace">LC3 SoC</text>
                        <text x="61" y="176" textAnchor="middle" fill="#6EE7B7" fontSize="8.5" fontFamily="monospace">PPG · HRV</text>
                        <line x1="94" y1="165" x2="123" y2="165" stroke={isDay ? '#1E40AF' : '#38BDF8'} strokeWidth="2" strokeDasharray="4 3" />

                        {/* Outer Orbital CNC Ring */}
                        <circle
                          cx="225"
                          cy="165"
                          r="102"
                          fill={isDay ? '#CBD5E1' : '#111827'}
                          stroke={isDay ? '#047857' : '#34D399'}
                          strokeWidth="2.5"
                        />
                        <circle
                          cx="225"
                          cy="165"
                          r="78"
                          fill={isDay ? '#E2E8F0' : '#0F172A'}
                          stroke={isDay ? '#1E40AF' : '#38BDF8'}
                          strokeWidth="1.5"
                          strokeDasharray="6 4"
                        />
                        {/* Concentric Sapphire Wave Core */}
                        <circle cx="225" cy="165" r="56" fill="none" stroke={isDay ? '#047857' : '#34D399'} strokeOpacity="0.7" strokeWidth="1.2" />
                        <circle cx="225" cy="165" r="38" fill="none" stroke={isDay ? '#047857' : '#34D399'} strokeOpacity="0.85" strokeWidth="1.2" />
                        <circle cx="225" cy="165" r="20" fill="#047857" fillOpacity={isDay ? '0.88' : '0.35'} stroke={isDay ? '#065F46' : '#34D399'} strokeWidth="1.8" />
                        <text
                          x="225"
                          y="169"
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="12"
                          fontWeight="700"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          nootropic.fm
                        </text>

                        {/* Dual Driver Schematic Nozzle */}
                        <rect x="308" y="132" width="84" height="66" rx="14" fill="#1E293B" stroke={isDay ? '#047857' : '#34D399'} strokeWidth="1.8" />
                        <rect x="320" y="141" width="26" height="19" rx="4" fill="#047857" stroke="#6EE7B7" strokeWidth="1.2" />
                        <text x="333" y="154" textAnchor="middle" fill="#FFFFFF" fontSize="8.5" fontFamily="monospace">BA</text>
                        <circle cx="366" cy="165" r="18" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
                        <text x="366" y="168" textAnchor="middle" fill="#FFFFFF" fontSize="8.5" fontFamily="monospace">10mm</text>

                        {/* Tympanic Seal Tip */}
                        <path
                          d="M392 140 C414 134, 428 144, 428 165 C428 186, 414 196, 392 190 Z"
                          fill="#334155"
                          stroke="#94A3B8"
                          strokeWidth="1.5"
                        />

                        {/* Leader Callouts */}
                        <line x1="225" y1="63" x2="275" y2="34" stroke={isDay ? '#047857' : '#34D399'} strokeWidth="1.2" />
                        <text x="282" y="38" fill={isDay ? '#0F172A' : '#F3F1EC'} fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                          Cordless CNC Orbital Torus + Sapphire ((•)) Core
                        </text>

                        <line x1="333" y1="141" x2="385" y2="82" stroke={isDay ? '#047857' : '#34D399'} strokeWidth="1.2" />
                        <text x="392" y="86" fill={isDay ? '#0F172A' : '#F3F1EC'} fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                          Knowles/Sonion BA: 190–4,500 Hz LR4 Lock
                        </text>

                        <line x1="366" y1="183" x2="395" y2="235" stroke={isDay ? '#1E40AF' : '#38BDF8'} strokeWidth="1.2" />
                        <text x="402" y="239" fill={isDay ? '#0F172A' : '#F3F1EC'} fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                          10 mm Beryllium DD (&lt;190 Hz Zero V-Curve Bloat)
                        </text>

                        <line x1="422" y1="176" x2="462" y2="176" stroke={isDay ? '#475569' : '#94A3B8'} strokeWidth="1.2" />
                        <text x="468" y="180" fill={isDay ? '#0F172A' : '#F3F1EC'} fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                          Sealed Chamber
                        </text>

                        <line x1="61" y1="192" x2="88" y2="275" stroke={isDay ? '#1E40AF' : '#38BDF8'} strokeWidth="1.2" />
                        <text x="95" y="279" fill={isDay ? '#0F172A' : '#F3F1EC'} fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
                          Wireless LC3 / Lossless SoC + Concha PPG HRV
                        </text>
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: 30-SECOND INTERACTIVE IN-EAR SOUND PROOF */}
        <section id="demo" className="glass-stage scroll-mt-28 rounded-3xl p-5 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                <Waves className="h-3.5 w-3.5" />
                30-Second Interactive Proof · Put Both Earbuds In
              </div>
              <h2 className="font-display text-xl font-bold tracking-tight text-[#F3F1EC] sm:text-2xl">
                Hear What Consumer Bluetooth Destroys vs. Our 6×40 Hz Engine
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleToggleDemo()}
                className="btn-aurora inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold"
              >
                {demoPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5 shrink-0" />
                    <span>Stop Proof ({demoSecLeft}s)</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 shrink-0" />
                    <span>Play 30s In-Ear Proof</span>
                  </>
                )}
              </button>
              <a
                href={studioRootUrl}
                onClick={(e) => handleStudioNavigate(e)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#131518] px-3.5 py-2.5 text-xs font-semibold text-[#F3F1EC] transition hover:border-white/30 hover:bg-[#1B1E24]"
              >
                <span>Open Full Studio</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="space-y-2 lg:col-span-5">
              {DEMO_MODES.map((m) => {
                const active = demoMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectDemoMode(m.id)}
                    aria-pressed={active}
                    className={`w-full rounded-2xl border p-3.5 text-left transition ${
                      active
                        ? 'border-emerald-400/65 bg-[#16231E] text-[#F3F1EC]'
                        : 'border-white/10 bg-[#121417] text-[#D4D4CE] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                        {m.step} · {m.label}
                      </span>
                      <span className="rounded border border-white/12 bg-[#0B0C0E] px-2 py-0.5 font-mono-tech text-[9.5px] font-semibold text-[#D4D4CE]">
                        {m.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#A3A39E]">{m.detail}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-white/12 bg-[#0B0C0E] p-4 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                  <Activity className="h-3.5 w-3.5" />
                  Live 48 kHz Envelope Monitor ·{' '}
                  {DEMO_MODES.find((x) => x.id === demoMode)?.label}
                </div>
                <span className="font-mono-tech text-[10px] text-[#A3A39E]">
                  {demoPlaying ? `LIVE AUDIO · ${demoSecLeft}s` : 'STANDBY PREVIEW · TAP PLAY'}
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/15">
                <canvas
                  ref={scopeCanvasRef}
                  className="block h-36 w-full sm:h-44"
                  aria-label="Live Acoustic Envelope Oscilloscope"
                />
              </div>

              {demoError && (
                <p className="mt-2 text-xs font-medium text-rose-300">{demoError}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#A3A39E]">
                <span>
                  Powered directly in your browser at <strong className="text-[#F3F1EC]">48,000 Hz</strong>{' '}
                  via Web Audio API.
                </span>
                <a
                  href={studioRootUrl}
                  onClick={(e) => handleStudioNavigate(e)}
                  className="inline-flex items-center gap-1 font-semibold text-[#34D399] underline-offset-2 hover:underline"
                >
                  <span>Continue Full Calibration on app.nootropic.fm</span>
                  <ArrowRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: NOOTROPIC FM SOUND SYSTEMS HARDWARE + PHYSICS */}
        <section id="hardware" className="scroll-mt-28 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                <Cpu className="h-3.5 w-3.5" />
                NOOTROPIC FM SOUND SYSTEMS · Acoustic Hardware Lab
              </div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-[#F3F1EC] sm:text-3xl">
                Distinctively Engineered to Preserve Every Micro-Envelope
              </h2>
            </div>
            <span className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#34D399]">
              Stage-Gated Founding Releases
            </span>
          </div>

          {/* Acoustic Physics Trio */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="glass-card rounded-2xl p-4 space-y-1.5">
              <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#34D399]">
                1. Zero Speaker Comb-Notch
              </div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Desk speakers at 60 cm introduce <strong className="text-[#F3F1EC]">0.261 ms</strong>{' '}
                inter-aural crosstalk, carving a destructive null at{' '}
                <strong className="text-[#F3F1EC]">1,914.8 Hz</strong> and a{' '}
                <strong className="text-[#F3F1EC]">56.4°</strong> dichotic phase error.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4 space-y-1.5">
              <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#34D399]">
                2. Zero Bluetooth ERB Masking
              </div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Subtle <strong className="text-[#F3F1EC]">-20 to -26 dBc</strong> neural sidebands
                sit inside a single critical band (ERB); AAC/SBC encoders strip them out. Our USB-C{' '}
                <strong className="text-[#F3F1EC]">24-bit/48 kHz</strong> DAC keeps 100% intact.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4 space-y-1.5">
              <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#34D399]">
                3. Orbital Phase-Ring Signature
              </div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Stemless CNC aluminum ring around a recessed sapphire acoustic core, precision
                laser-marked <strong className="text-[#F3F1EC]">nootropic.fm</strong> — built for
                multi-hour deep work without awkward stems or forehead headbands.
              </p>
            </div>
          </div>

          {/* 3 Hardware Product Cards */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {HARDWARE_DROPS.map((item) => {
              const selected = selectedProduct === item.code;
              return (
                <article
                  key={item.code}
                  className={`flex flex-col justify-between overflow-hidden rounded-3xl border transition ${
                    selected
                      ? 'border-emerald-400/65 bg-[#121417]'
                      : 'border-white/12 bg-[#101114] hover:border-white/25'
                  }`}
                >
                  <div>
                    <div className="relative overflow-hidden border-b border-white/10 bg-[#0B0C0E]">
                      <img
                        src={item.image}
                        alt={item.imageAlt}
                        className="aspect-[16/9] w-full object-cover"
                      />
                    </div>
                    <div className="space-y-3 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                          {item.series}
                        </span>
                        <span className="rounded border border-white/12 bg-[#0B0C0E] px-2 py-0.5 font-mono-tech text-[9.5px] font-semibold text-[#D4D4CE]">
                          {item.statusBadge}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-display text-lg font-bold text-[#F3F1EC]">
                          {item.name}
                        </h3>
                        <span className="font-mono-tech text-base font-bold text-[#34D399]">
                          {item.price}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-[#D4D4CE]">{item.subPrice}</div>

                      <ul className="space-y-1.5 pt-1 text-xs leading-relaxed text-[#A3A39E]">
                        {item.specs.map((spec) => (
                          <li key={spec} className="flex items-start gap-2">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                            <span>{spec}</span>
                          </li>
                        ))}
                      </ul>

                      <p className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3 text-[11px] leading-relaxed text-[#D4D4CE]">
                        {item.acousticRationale}
                      </p>
                    </div>
                  </div>

                  <div className="px-5 pb-5">
                    <button
                      type="button"
                      onClick={() => scrollToWaitlistWithProduct(item.code)}
                      className={
                        selected
                          ? 'btn-aurora inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold'
                          : 'inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#131518] px-4 py-2.5 text-xs font-semibold text-[#F3F1EC] transition hover:border-white/30 hover:bg-[#1B1E24]'
                      }
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {selected ? `Selected · Reserve ${item.name}` : `Select ${item.name}`}
                      </span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Inline Founding Batch Waitlist */}
          <div id="waitlist-form" className="glass-stage scroll-mt-28 rounded-3xl p-5 sm:p-7">
            <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-12">
              <div className="space-y-1.5 lg:col-span-6">
                <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                  FOUNDING BATCH PRIORITY ACCESS · HSA/FSA FRIENDLY ROADMAP
                </div>
                <h3 className="font-display text-lg font-bold text-[#F3F1EC] sm:text-xl">
                  Reserve Your Spot for{' '}
                  {HARDWARE_DROPS.find((d) => d.code === selectedProduct)?.name}
                </h3>
                <p className="text-xs leading-relaxed text-[#A3A39E]">
                  No upfront payment today. Enter your email to claim a numbered Founding Batch
                  queue slot and receive private invitation pricing ($119 Pre-Order Bundle w/ 1 Yr
                  NootropicFM Pro).
                </p>
                <p className="text-[11px] text-[#A3A39E]">
                  Hardware &amp; OEM partnerships:{' '}
                  <a
                    href="mailto:partners@nootropic.fm"
                    className="font-mono-tech font-semibold text-[#34D399] underline-offset-2 hover:underline"
                  >
                    partners@nootropic.fm
                  </a>{' '}
                  · Executive desk:{' '}
                  <a
                    href="mailto:founders@nootropic.fm"
                    className="font-mono-tech font-semibold text-[#34D399] underline-offset-2 hover:underline"
                  >
                    founders@nootropic.fm
                  </a>
                </p>
              </div>

              <div className="lg:col-span-6">
                {reservedQueue !== null ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/45 bg-emerald-500/12 p-4 text-xs text-[#F3F1EC]">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[#34D399]" />
                    <div>
                      <div className="font-semibold">
                        Founding Batch Spot #{String(reservedQueue).padStart(4, '0')} Confirmed
                      </div>
                      <div className="text-[11px] text-[#A3A39E]">
                        <strong>{waitlistEmail.trim()}</strong> is locked in for{' '}
                        {HARDWARE_DROPS.find((d) => d.code === selectedProduct)?.name}. Meanwhile,
                        start streaming on{' '}
                        <a
                          href={studioRootUrl}
                          onClick={(e) => handleStudioNavigate(e)}
                          className="font-semibold text-[#34D399] underline"
                        >
                          app.nootropic.fm
                        </a>
                        .
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={(e) => void handleWaitlistSubmit(e)} className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="email"
                        required
                        value={waitlistEmail}
                        onChange={(e) => setWaitlistEmail(e.target.value)}
                        placeholder="you@domain.com — reserve Founding Batch queue..."
                        className="flex-1 rounded-xl border border-white/15 bg-[#0B0C0E] px-3.5 py-3 text-xs text-[#F3F1EC] placeholder-[#8E8E88] focus:border-emerald-400 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={waitlistBusy}
                        className="btn-aurora inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-5 py-3 text-xs font-semibold disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        <span>{waitlistBusy ? 'Reserving...' : 'Join Founding Waitlist'}</span>
                      </button>
                    </div>
                    {waitlistError && (
                      <p className="text-xs font-medium text-rose-300">{waitlistError}</p>
                    )}
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: THE AUDIO STUDIO PLATFORM (app.nootropic.fm) */}
        <section id="platform" className="glass-stage scroll-mt-28 rounded-3xl p-5 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                <Layers className="h-3.5 w-3.5" />
                Self-Learning Neural Engine · app.nootropic.fm
              </div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-[#F3F1EC] sm:text-3xl">
                How the AI Learns Your Brain — Session After Session
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={buildStudioUrl({ screen: 'studylab' })}
                onClick={(e) => handleStudioNavigate(e, { screen: 'studylab' })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#131518] px-3 py-2 text-xs font-semibold text-[#F3F1EC] transition hover:border-white/30"
              >
                <FlaskConical className="h-3.5 w-3.5 text-[#34D399]" />
                <span>Study Lab</span>
              </a>
              <a
                href={buildStudioUrl({ screen: 'insights' })}
                onClick={(e) => handleStudioNavigate(e, { screen: 'insights' })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#131518] px-3 py-2 text-xs font-semibold text-[#F3F1EC] transition hover:border-white/30"
              >
                <BarChart3 className="h-3.5 w-3.5 text-[#34D399]" />
                <span>Research Brain</span>
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                01 · CURRENT STATE
              </div>
              <div className="font-display text-sm font-bold text-[#F3F1EC]">How You Feel Now</div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Maps your 2D Energy × Clarity coordinates and cognitive baseline during onboarding.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                02 · TARGET STATE
              </div>
              <div className="font-display text-sm font-bold text-[#F3F1EC]">Where You Want to Arrive</div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Deep Flow, Sharp Focus, Energy Lift, Calm Reset, Sleep, or any open custom goal.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                03 · STUDY SYNTHESIS
              </div>
              <div className="font-display text-sm font-bold text-[#F3F1EC]">Live Neuroscience Protocols</div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Compiles peer-reviewed NIH PubMed &amp; OpenAlex studies directly into 48 kHz LR4 music.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                04 · AI ADAPTATION
              </div>
              <div className="font-display text-sm font-bold text-[#F3F1EC]">Learns Your Brain&apos;s Reaction</div>
              <p className="text-xs leading-relaxed text-[#A3A39E]">
                Tracks PVT reaction speed, retention &amp; 25% blind sham delta via Bayesian Thompson Sampling to tune you sharper every time.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {OUTCOME_LAUNCHERS.map((goal) => (
              <a
                key={goal.target}
                href={buildStudioUrl({ target: goal.target, durationMin: goal.durationMin })}
                onClick={(e) =>
                  handleStudioNavigate(e, { target: goal.target, durationMin: goal.durationMin })
                }
                className="group flex flex-col justify-between rounded-2xl border border-white/12 bg-[#121417] p-4 transition hover:border-emerald-400/60 hover:bg-[#171B20]"
              >
                <div className="space-y-1.5">
                  <div className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                    {goal.hzTag} · {goal.durationMin}m
                  </div>
                  <div className="font-display text-base font-bold text-[#F3F1EC]">
                    {goal.label}
                  </div>
                  <p className="text-xs leading-relaxed text-[#A3A39E]">{goal.desc}</p>
                </div>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#34D399]">
                  <span>Launch in Studio</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </a>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                3-BAND LR4 CROSSOVER
              </div>
              <p className="text-xs text-[#A3A39E]">
                Modulates only <strong className="text-[#F3F1EC]">190–4,500 Hz</strong> so warm
                sub-bass and upper harmonics stay clean without distortion.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                10 GENRES + ENDLESS STREAM
              </div>
              <p className="text-xs text-[#A3A39E]">
                Remastered <code className="font-mono-tech text-[#F3F1EC]">-15.5 LUFS</code> lyric-free
                studio tracks paired with infinite procedural and Lyria RealTime synthesis.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                ALANYA STUDIO CONCIERGE
              </div>
              <p className="text-xs text-[#A3A39E]">
                Calm spoken briefings by Alanya (0.96× pace) delayed smoothly with -20 dB vocal
                ducking and gradual 6-second music bloom.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold text-[#34D399]">
                MEASURABLE RESEARCH BRAIN
              </div>
              <p className="text-xs text-[#A3A39E]">
                Pre/post Psychomotor Vigilance Task (PVT ms), motor tapping CV, BLE HRV &amp; 25%
                blind sham verification.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 5: PRICING & BUNDLES */}
        <section id="pricing" className="scroll-mt-28 space-y-5">
          <div className="space-y-1 text-center">
            <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
              TRANSPARENT ECOSYSTEM PRICING
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#F3F1EC] sm:text-3xl">
              Start Free in Your Browser. Upgrade or Bundle Hardware Anytime.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="glass-card flex flex-col justify-between rounded-3xl p-6 space-y-4">
              <div className="space-y-2">
                <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#A3A39E]">
                  FREE CALIBRATION
                </div>
                <div className="font-display text-3xl font-bold text-[#F3F1EC]">$0</div>
                <p className="text-xs text-[#A3A39E]">
                  Daily 5-minute calibrated sessions on any earbuds, Study Lab access, and Huggins
                  phase check.
                </p>
              </div>
              <a
                href={studioRootUrl}
                onClick={(e) => handleStudioNavigate(e)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#131518] px-4 py-2.5 text-xs font-semibold text-[#F3F1EC] transition hover:border-white/30"
              >
                <span>Open Free Studio</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="glass-stage flex flex-col justify-between rounded-3xl border-emerald-400/50 p-6 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#34D399]">
                    NOOTROPICFM PRO
                  </span>
                  <span className="rounded border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 font-mono-tech text-[9.5px] font-bold text-[#34D399]">
                    7-DAY FREE TRIAL
                  </span>
                </div>
                <div className="font-display text-3xl font-bold text-[#F3F1EC]">
                  $59<span className="text-sm font-medium text-[#A3A39E]">/year</span>
                </div>
                <p className="text-xs text-[#A3A39E]">
                  Unlimited 20–60 min sessions, all 10 Studio Mix styles, Endless Stream, synced
                  across both <code className="font-mono-tech text-[#34D399]">nootropic.fm</code> &amp;{' '}
                  <code className="font-mono-tech text-[#34D399]">app.nootropic.fm</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenProModal}
                className="btn-aurora inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold"
              >
                <Crown className="h-3.5 w-3.5 shrink-0" />
                <span>{profile?.planTier === 'pro' ? 'Manage Pro Plan' : 'Start 7-Day Free Trial'}</span>
              </button>
            </div>

            <div className="glass-card flex flex-col justify-between rounded-3xl p-6 space-y-4">
              <div className="space-y-2">
                <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-wider text-[#34D399]">
                  EARBUDS PRO WIRELESS BUNDLE
                </div>
                <div className="font-display text-3xl font-bold text-[#F3F1EC]">
                  $249 <span className="text-sm font-medium text-[#A3A39E]">(wireless + 1 Yr Pro)</span>
                </div>
                <p className="text-xs text-[#A3A39E]">
                  100% Cordless Orbital Phase-Ring IEM with In-Ear PPG HRV + 12 months NootropicFM
                  Biometric Pro. (Optional $129 USB-C wired edition also in waitlist.)
                </p>
              </div>
              <button
                type="button"
                onClick={() => scrollToWaitlistWithProduct('earbuds_pro_hrv')}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#131518] px-4 py-2.5 text-xs font-semibold text-[#F3F1EC] transition hover:border-white/30"
              >
                <Headphones className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span>Reserve Earbuds Pro</span>
              </button>
            </div>
          </div>
        </section>
        {/* SECTION 6: OFFICIAL DEPARTMENT DIRECTORY & SEO/SCIENCE RESOURCES */}
        <section id="contact" className="glass-stage scroll-mt-28 rounded-3xl p-5 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <div className="font-mono-tech text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                OFFICIAL DEPARTMENT DIRECTORY · NOOTROPIC.FM
              </div>
              <h2 className="font-display text-xl font-bold tracking-tight text-[#F3F1EC] sm:text-2xl">
                Direct Role-Based Contact Channels
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href="/science/"
                className="rounded-lg border border-white/15 bg-[#131518] px-3 py-1.5 font-semibold text-[#F3F1EC] transition hover:border-white/30"
              >
                Science Atlas →
              </a>
              <a
                href="/compare/"
                className="rounded-lg border border-white/15 bg-[#131518] px-3 py-1.5 font-semibold text-[#F3F1EC] transition hover:border-white/30"
              >
                DSP vs. Playlists →
              </a>
              <a
                href="/contact/"
                className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-1.5 font-semibold text-[#34D399] transition hover:bg-emerald-500/20"
              >
                Fact Sheet &amp; Press →
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { role: 'General & Product', email: 'hello@nootropic.fm' },
              { role: 'Partnerships & OEM', email: 'partners@nootropic.fm' },
              { role: 'Research & Datasets', email: 'research@nootropic.fm' },
              { role: 'Press & Briefings', email: 'press@nootropic.fm' },
              { role: 'Investor Relations', email: 'investors@nootropic.fm' },
              { role: 'Founder Desk', email: 'founders@nootropic.fm' },
              { role: 'Listener Support', email: 'support@nootropic.fm' },
              { role: 'Privacy & Data Rights', email: 'privacy@nootropic.fm' },
            ].map((dept) => (
              <div
                key={dept.email}
                className="rounded-2xl border border-white/10 bg-[#0B0C0E] px-3.5 py-3 space-y-1"
              >
                <div className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#A3A39E]">
                  {dept.role}
                </div>
                <a
                  href={`mailto:${dept.email}`}
                  className="block font-mono-tech text-xs font-semibold text-[#34D399] underline-offset-2 hover:underline"
                >
                  {dept.email}
                </a>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] px-4 py-6 text-center text-[11px] text-[#8E8E88]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <span>
            nootropic.fm &amp; NOOTROPIC FM SOUND SYSTEMS · General cognitive wellness audio &amp;
            reference acoustic hardware (not a medical device). Listeners 18+.
          </span>
          <a
            href={studioRootUrl}
            onClick={(e) => handleStudioNavigate(e)}
            className="font-semibold text-[#34D399] underline-offset-2 hover:underline"
          >
            app.nootropic.fm Audio Studio →
          </a>
          <button
            type="button"
            onClick={onOpenPrivacyModal}
            className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] underline-offset-2 hover:text-[#34D399] hover:underline"
          >
            <ShieldCheck className="h-3 w-3" />
            <span>Privacy &amp; Delete Data</span>
          </button>
          <a href="/science/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            Science Atlas
          </a>
          <a href="/compare/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            DSP vs. Playlists
          </a>
          <a href="/investors/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            Investors
          </a>
          <a href="/partners/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            R&amp;D Partners
          </a>
          <a href="/contact/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            Contact Directory
          </a>
          <a href="/privacy/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            Privacy Policy
          </a>
          <a href="/terms/" className="text-[#A3A39E] underline-offset-2 hover:underline">
            Terms
          </a>
          <a href="/llms.txt" className="text-[#A3A39E] underline-offset-2 hover:underline">
            llms.txt
          </a>
          <a
            href="mailto:hello@nootropic.fm"
            className="inline-flex items-center gap-1 font-medium text-[#34D399] underline-offset-2 hover:underline"
          >
            <Mail className="h-3 w-3" />
            <span>hello@nootropic.fm</span>
          </a>
          <a
            href="mailto:founders@nootropic.fm"
            className="inline-flex items-center gap-1 font-medium text-[#34D399] underline-offset-2 hover:underline"
          >
            <span>founders@nootropic.fm</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
