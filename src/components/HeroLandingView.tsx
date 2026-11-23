import {
  Activity,
  ArrowRight,
  FlaskConical,
  KeyRound,
  Play,
  SlidersHorizontal,
  Waves,
  Zap,
} from 'lucide-react';
import type { QuickTryId } from '../lib/quickTryProtocols';
import { SonicOrb } from './SonicOrb';

interface HeroLandingViewProps {
  onQuickTry: (id: QuickTryId) => void;
  onStartCustomize: () => void;
  onOpenStudyLab: () => void;
  onOpenIdentityModal: () => void;
}

const QUICK_TRY_PILLS: Array<{
  id: QuickTryId;
  label: string;
  accent: string;
}> = [
  {
    id: 'focus_lofi',
    label: 'Deep Focus · Lo-Fi Keys (16 Hz)',
    accent:
      'border-cyan-400/40 bg-cyan-400/10 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/20',
  },
  {
    id: 'energy_electronic',
    label: 'Alert Energy · Deep Electronic (18 Hz)',
    accent:
      'border-indigo-400/40 bg-indigo-500/12 text-indigo-100 hover:border-indigo-300 hover:bg-indigo-500/22',
  },
  {
    id: 'calm_rain',
    label: 'Calm Reset · Rain & Piano (0.1 Hz)',
    accent:
      'border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300 hover:bg-emerald-500/20',
  },
];

export function HeroLandingView({
  onQuickTry,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center space-y-8 py-2 sm:py-6">
      {/* Above-the-Fold 3-Second Hero */}
      <section className="animate-rise flex flex-col items-center text-center space-y-5">
        <SonicOrb mood="focus" size="md" label="Tune your mind" />

        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/[0.08] px-3.5 py-1 text-[11px] font-semibold tracking-wide text-cyan-200">
          <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)] animate-pulse" />
          Study-Backed Music · Free Beta
        </div>

        <h1 className="max-w-3xl font-display text-3xl font-bold tracking-tight text-white sm:text-5xl leading-[1.08]">
          Real focus science,{' '}
          <span className="text-aurora">inside any music you love.</span>
        </h1>

        <p className="max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
          Play studio tracks or custom instrumental genres shaped by real-time modulation from
          published focus studies, free with zero signup.
        </p>

        {/* Primary & Secondary CTAs */}
        <div className="flex w-full max-w-lg flex-col items-center justify-center gap-3 pt-1 sm:flex-row">
          <button
            type="button"
            onClick={() => onQuickTry('focus_lofi')}
            className="btn-aurora inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 sm:w-auto sm:min-w-[210px] sm:text-base"
          >
            <Play className="h-4 w-4 fill-slate-950" />
            Start Listening Free
          </button>

          <button
            type="button"
            onClick={onStartCustomize}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700/90 bg-slate-900/75 px-6 py-4 text-sm font-semibold text-white backdrop-blur-md transition hover:border-cyan-400/50 hover:bg-slate-900 sm:w-auto sm:min-w-[210px] sm:text-base"
          >
            <SlidersHorizontal className="h-4 w-4 text-cyan-300" />
            Customize State &amp; Genre
          </button>
        </div>

        {/* Zero-Friction Trust Strip */}
        <p className="text-[11px] text-slate-400">
          Year 1 Free Open Research Beta · Zero email or password · Driving-Safe &amp; Local-Only
          Privacy Mode · 18+
        </p>
      </section>

      {/* 1-Click Instant Preview Bar (Audio in <5s, Zero Form) */}
      <section className="animate-step glass-stage w-full rounded-3xl border border-cyan-400/20 p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="font-mono-tech text-[11px] uppercase tracking-[0.14em] text-cyan-300/90">
            Instant Preview — tap once to hear live modulation:
          </span>
          <button
            type="button"
            onClick={onOpenIdentityModal}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-cyan-200"
          >
            <KeyRound className="h-3 w-3" />
            Have a Sync QR? Restore
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {QUICK_TRY_PILLS.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => onQuickTry(pill.id)}
              className={`group flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${pill.accent}`}
            >
              <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
              <span className="truncate">{pill.label}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-0.5 text-[11px] text-slate-400">
          <span>Want Reggae, Synthwave, Jazz, Classical, or any custom vibe?</span>
          <button
            type="button"
            onClick={onStartCustomize}
            className="inline-flex items-center gap-1 font-semibold text-cyan-300 transition hover:text-cyan-200"
          >
            Pick any genre
            <ArrowRight className="h-3 w-3" />
          </button>
          <span className="hidden text-slate-700 sm:inline">·</span>
          <button
            type="button"
            onClick={onOpenStudyLab}
            className="inline-flex items-center gap-1 font-semibold text-emerald-300 transition hover:text-emerald-200"
          >
            <FlaskConical className="h-3 w-3" />
            Explore 9 Compiled Studies
          </button>
        </div>
      </section>

      {/* 3-Card Micro-Proof Strip (Bottom of First Viewport) */}
      <section className="animate-rise delay-150 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Waves className="h-4 w-4 text-cyan-300" />
            Study-Backed 3-Band Modulation
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Applies published 16 Hz Beta, 40 Hz Gamma, and 0.1 Hz HRV timing strictly to the
            mid-band so sub-bass and highs stay crisp.
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Activity className="h-4 w-4 text-indigo-300" />
            60fps Live Audio Scope
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Watch your real-time audio output waveform alongside the active modulation pattern as
            you listen.
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Zap className="h-4 w-4 text-emerald-300" />
            15s Millisecond Benchmark
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Run an optional Pre vs. Post reaction-time check in milliseconds and inspect direct DOI
            study citations.
          </p>
        </div>
      </section>
    </div>
  );
}
