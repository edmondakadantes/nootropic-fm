import {
  ArrowRight,
  Compass,
  FlaskConical,
  KeyRound,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Waves,
} from 'lucide-react';
import type { QuickTryId } from '../lib/quickTryProtocols';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';
import { SonicOrb } from './SonicOrb';

interface HeroLandingViewProps {
  onSelectMoodPreset: (id: QuickTryId) => void;
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
    from: 'Distracted',
    to: 'Focused',
    sub: 'Chill Lo-Fi · Deep Focus',
    accent:
      'border-cyan-400/40 bg-cyan-400/10 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/20',
  },
  {
    id: 'mood_uplift',
    from: 'Sad',
    to: 'Happy',
    sub: 'Warm Guitar · Good Mood',
    accent:
      'border-amber-400/40 bg-amber-400/10 text-amber-100 hover:border-amber-300 hover:bg-amber-400/20',
  },
  {
    id: 'calm_rain',
    from: 'Stressed',
    to: 'Calm',
    sub: 'Soft Rain & Piano · Relax',
    accent:
      'border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300 hover:bg-emerald-500/20',
  },
  {
    id: 'energy_electronic',
    from: 'Tired',
    to: 'Awake',
    sub: 'Upbeat Electronic · Energy',
    accent:
      'border-indigo-400/40 bg-indigo-500/12 text-indigo-100 hover:border-indigo-300 hover:bg-indigo-500/22',
  },
];

export function HeroLandingView({
  onSelectMoodPreset,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center space-y-7 py-2 sm:space-y-8 sm:py-6">
      {/* Above-the-Fold 3-Second State-Shift Hero */}
      <section className="animate-rise flex w-full flex-col items-center text-center space-y-5 px-1">
        <SonicOrb mood="focus" size="md" label="Tune your mind" />

        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-400/[0.09] px-3.5 py-1 text-[11px] font-semibold tracking-wide text-cyan-200">
          <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)] animate-pulse" />
          Science-Backed Music · 5-Min Free Preview
        </div>

        <h1 className="max-w-3xl font-display text-[1.95rem] font-bold tracking-tight text-white sm:text-5xl leading-[1.08]">
          Go from how you feel{' '}
          <span className="text-aurora">to how you want to feel.</span>
        </h1>

        <p className="max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
          Stressed to calm. Distracted to focused. Sad to happy. We turn real sound science into
          music tailored to <strong className="text-white">your favorite style</strong>.
        </p>

        {/* Single Commanding Primary CTA */}
        <div className="flex w-full max-w-md flex-col items-center justify-center pt-1">
          <button
            type="button"
            onClick={onStartCustomize}
            className="btn-aurora inline-flex w-full items-center justify-center gap-2.5 rounded-2xl px-7 py-4 text-base font-bold text-slate-950 shadow-[0_0_32px_rgba(34,211,238,0.28)] sm:w-auto sm:min-w-[290px]"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span>Choose My Mood &amp; Music</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </button>
        </div>

        {/* Zero-Friction Trust Strip */}
        <p className="max-w-lg text-[11px] leading-relaxed text-slate-400">
          First 5 minutes free · No card required · 10 curated styles + Infinite Live AI · 18+
        </p>
      </section>

      {/* 4 Quick Starting Points (Pre-fills your mood shift -> pick your favorite music) */}
      <section className="animate-step glass-stage w-full rounded-3xl border border-cyan-400/20 p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="font-mono-tech text-[11px] uppercase tracking-[0.12em] text-cyan-300/90">
            Or pick a starting goal — then choose your music:
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
              onClick={() => onSelectMoodPreset(pill.id)}
              className={`group flex flex-col items-start rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${pill.accent}`}
            >
              <div className="flex w-full items-center justify-between gap-1 text-xs font-bold">
                <span className="inline-flex items-center gap-1.5">
                  <span>{pill.from}</span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-80" />
                  <span className="text-white">{pill.to}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-75 transition-transform group-hover:translate-x-0.5" />
              </div>
              <span className="mt-1 text-[10px] opacity-80">{pill.sub}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-0.5 text-[11px] text-slate-400">
          <span>Prefer Jazz, Dub Reggae, Solo Piano, Bossa Nova, or Beatless Space?</span>
          <button
            type="button"
            onClick={onStartCustomize}
            className="inline-flex items-center gap-1 font-semibold text-cyan-300 transition hover:text-cyan-200"
          >
            Choose From All 10 Styles
            <ArrowRight className="h-3 w-3" />
          </button>
          <span className="hidden text-slate-700 sm:inline">·</span>
          <button
            type="button"
            onClick={onOpenStudyLab}
            className="inline-flex items-center gap-1 font-semibold text-emerald-300 transition hover:text-emerald-200"
          >
            <FlaskConical className="h-3 w-3" />
            Browse Science Studies
          </button>
        </div>
      </section>

      {/* 3-Step Visual Story: How We Take You Where You Want To Go */}
      <section className="animate-rise delay-150 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Compass className="h-4 w-4 text-cyan-300" />
            1. Pick How You Want to Feel
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Tell us how you feel right now—stressed, sad, distracted, or tired—and where you want to
            get.
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Waves className="h-4 w-4 text-indigo-300" />
            2. Science Turned Into Sound
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            We turn real sound studies into gentle focus and calm rhythms—and show the live wave
            working on screen.
          </p>
        </div>

        <div className="glass-card rounded-2xl border border-white/[0.08] p-4 space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-white">
            <Music2 className="h-4 w-4 text-emerald-300" />
            3. Blended With Music You Love
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            No boring background hums. Pick from{' '}
            <span className="text-slate-200">10 curated instrumental styles</span> — Lo-Fi, Electronic,
            Jazz, Classical, Reggae, Piano, Bossa Nova &amp; more — plus Infinite Live AI.
          </p>
        </div>
      </section>

      {/* Blurred B2B Cohort Intelligence Showcase */}
      <CohortIntelligenceShowcase mode="compact" />

      {/* Subtle Bottom Prompt */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
        <span>
          Includes an optional 15-second reaction speed test before and after listening so you can
          see the difference.
        </span>
      </div>
    </div>
  );
}
