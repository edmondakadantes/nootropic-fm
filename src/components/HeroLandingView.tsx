import {
  ArrowRight,
  Compass,
  FlaskConical,
  KeyRound,
  Music2,
  Play,
  SlidersHorizontal,
  Sparkles,
  Waves,
} from 'lucide-react';
import type { QuickTryId } from '../lib/quickTryProtocols';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';
import { SonicOrb } from './SonicOrb';

interface HeroLandingViewProps {
  onQuickTry: (id: QuickTryId) => void;
  onStartCustomize: () => void;
  onOpenStudyLab: () => void;
  onOpenIdentityModal: () => void;
}

const STATE_SHIFT_PILLS: Array<{
  id: QuickTryId;
  from: string;
  to: string;
  sub: string;
  accent: string;
}> = [
  {
    id: 'focus_lofi',
    from: 'Foggy',
    to: 'Locked In',
    sub: 'Lo-Fi Keys · 16 Hz Focus',
    accent:
      'border-cyan-400/40 bg-cyan-400/10 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/20',
  },
  {
    id: 'mood_uplift',
    from: 'Down',
    to: 'Uplifted',
    sub: 'Warm Acoustic · Major Lift',
    accent:
      'border-amber-400/40 bg-amber-400/10 text-amber-100 hover:border-amber-300 hover:bg-amber-400/20',
  },
  {
    id: 'calm_rain',
    from: 'Stressed',
    to: 'Calm',
    sub: 'Rain & Piano · 0.1 Hz Breath',
    accent:
      'border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300 hover:bg-emerald-500/20',
  },
  {
    id: 'energy_electronic',
    from: 'Tired',
    to: 'Energized',
    sub: 'Deep Electronic · 18 Hz Drive',
    accent:
      'border-indigo-400/40 bg-indigo-500/12 text-indigo-100 hover:border-indigo-300 hover:bg-indigo-500/22',
  },
];

export function HeroLandingView({
  onQuickTry,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center space-y-8 py-2 sm:py-6">
      {/* Above-the-Fold 3-Second State-Shift Hero */}
      <section className="animate-rise flex flex-col items-center text-center space-y-5">
        <SonicOrb mood="focus" size="md" label="Tune your mind" />

        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-400/[0.09] px-3.5 py-1 text-[11px] font-semibold tracking-wide text-cyan-200">
          <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)] animate-pulse" />
          Open Beta · Science-Engineered Music
        </div>

        <h1 className="max-w-3xl font-display text-3xl font-bold tracking-tight text-white sm:text-5xl leading-[1.08]">
          Go from how you feel{' '}
          <span className="text-aurora">to how you want to feel.</span>
        </h1>

        <p className="max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
          Stressed to calm. Foggy to locked in. Down to uplifted. We translate published acoustic
          science into precision soundwaves—and fuse them into{' '}
          <strong className="text-white">your favorite music genre</strong>.
        </p>

        {/* Primary & Secondary CTAs */}
        <div className="flex w-full max-w-xl flex-col items-center justify-center gap-3 pt-1 sm:flex-row">
          <button
            type="button"
            onClick={onStartCustomize}
            className="btn-aurora inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 sm:w-auto sm:min-w-[235px] sm:text-base"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Tune My State Now
          </button>

          <button
            type="button"
            onClick={() => onQuickTry('focus_lofi')}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-6 py-4 text-sm font-semibold text-cyan-100 backdrop-blur-md transition hover:border-cyan-300 hover:bg-cyan-400/18 sm:w-auto sm:min-w-[215px] sm:text-base"
          >
            <Play className="h-4 w-4 fill-current" />
            Instant Preview (3s)
          </button>
        </div>

        {/* Zero-Friction Trust Strip */}
        <p className="text-[11px] text-slate-400">
          Try instantly during Open Beta · No card required · Reggae, Lo-Fi, Electronic, Jazz,
          Classical &amp; more · 18+
        </p>
      </section>

      {/* 4 Instant State-Shift Quick-Try Pills (Zero Form, Audio in <3s) */}
      <section className="animate-step glass-stage w-full rounded-3xl border border-cyan-400/20 p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="font-mono-tech text-[11px] uppercase tracking-[0.14em] text-cyan-300/90">
            Tap any shift to hear science + music live right now:
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

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {STATE_SHIFT_PILLS.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => onQuickTry(pill.id)}
              className={`group flex flex-col items-start rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${pill.accent}`}
            >
              <div className="flex w-full items-center justify-between gap-1 text-xs font-bold">
                <span className="inline-flex items-center gap-1.5">
                  <span>{pill.from}</span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-80" />
                  <span className="text-white">{pill.to}</span>
                </span>
                <Play className="h-3.5 w-3.5 shrink-0 fill-current opacity-85" />
              </div>
              <span className="mt-1 text-[10px] opacity-80">{pill.sub}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-0.5 text-[11px] text-slate-400">
          <span>Want to type your exact mood &amp; favorite genre (Reggae, Synthwave, Rock, Bossa Nova)?</span>
          <button
            type="button"
            onClick={onStartCustomize}
            className="inline-flex items-center gap-1 font-semibold text-cyan-300 transition hover:text-cyan-200"
          >
            Build My Profile &amp; Sound
            <ArrowRight className="h-3 w-3" />
          </button>
          <span className="hidden text-slate-700 sm:inline">·</span>
          <button
            type="button"
            onClick={onOpenStudyLab}
            className="inline-flex items-center gap-1 font-semibold text-emerald-300 transition hover:text-emerald-200"
          >
            <FlaskConical className="h-3 w-3" />
            Study-to-Sound Lab
          </button>
        </div>
      </section>

      {/* 3-Step Visual Story: How We Take You Where You Want To Go */}
      <section className="animate-rise delay-150 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Compass className="h-4 w-4 text-cyan-300" />
            1. Tell Us Where You Want to Go
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Start from any headspace—down, stressed, foggy, or drained—and set your target state,
            profession profile, and session length.
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Waves className="h-4 w-4 text-indigo-300" />
            2. We Turn Science Into Live Sound
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Our engine compiles published acoustic studies (16 Hz AM, 40 Hz Gamma, 0.1 Hz HRV,
            major-mode tempo) into real-time 3-Band LR4 DSP—verifiable on a 60fps scope.
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Music2 className="h-4 w-4 text-emerald-300" />
            3. Fused Into Your Favorite Music
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            No boring monotonous drones. Pick mastered studio tracks, live sampled instruments, or
            type <span className="text-slate-200">any instrumental genre</span> powered by Lyria AI.
          </p>
        </div>
      </section>

      {/* Blurred B2B Cohort Intelligence Showcase (Explains 100% Free Forever + Monetization Teaser) */}
      <CohortIntelligenceShowcase mode="compact" />

      {/* Subtle Bottom Prompt */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
        <span>
          Optional 15-second Pre/Post millisecond reaction benchmark included in every session.
        </span>
      </div>
    </div>
  );
}
