import {
  ArrowRight,
  FlaskConical,
  KeyRound,
  SlidersHorizontal,
} from 'lucide-react';
import type { QuickTryId } from '../lib/quickTryProtocols';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';

interface HeroLandingViewProps {
  onSelectMoodPreset: (id: QuickTryId) => void;
  onStartCustomize: () => void;
  onOpenStudyLab: () => void;
  onOpenIdentityModal: () => void;
}

const CHANNEL_PRESETS: Array<{
  id: QuickTryId;
  tag: string;
  from: string;
  to: string;
  sub: string;
}> = [
  {
    id: 'focus_lofi',
    tag: '16 HZ AM',
    from: 'Distracted',
    to: 'Focused',
    sub: 'Lo-Fi Beats · 35 min',
  },
  {
    id: 'mood_uplift',
    tag: '12 HZ',
    from: 'Sad',
    to: 'Happy',
    sub: 'Acoustic Guitar · 20 min',
  },
  {
    id: 'calm_rain',
    tag: '0.1 HZ',
    from: 'Stressed',
    to: 'Calm',
    sub: 'Soft Rain & Nature · 20 min',
  },
  {
    id: 'energy_electronic',
    tag: '18 HZ',
    from: 'Tired',
    to: 'Awake',
    sub: 'Deep Electronic · 20 min',
  },
];

export function HeroLandingView({
  onSelectMoodPreset,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center space-y-7 py-3 sm:space-y-9 sm:py-8">
      {/* Above-the-Fold Precision Studio Hero */}
      <section className="animate-rise flex w-full flex-col items-center text-center space-y-5 px-1">
        <div className="inline-flex items-center gap-2 font-mono-tech text-[10px] font-medium uppercase tracking-[0.18em] text-[#A3A39E] sm:text-[11px]">
          <span className="h-1.5 w-1.5 bg-[#34D399]" />
          <span>48.0 kHz Web Audio · Peer-Reviewed Acoustics · Live Oscilloscope</span>
        </div>

        <h1 className="max-w-3xl font-display text-[2rem] font-semibold tracking-tight text-[#F3F1EC] sm:text-5xl leading-[1.06]">
          Shift how you feel{' '}
          <span className="text-[#34D399]">with music you can actually measure.</span>
        </h1>

        <p className="max-w-2xl text-sm leading-relaxed text-[#A3A39E] sm:text-base">
          Move from stressed to calm, distracted to focused, or tired to awake. Published acoustic
          rhythms blended live into 10 instrumental styles, verified on a built-in oscilloscope.
        </p>

        {/* Primary Tactile Chalk Studio CTA */}
        <div className="flex w-full max-w-md flex-col items-center justify-center pt-1">
          <button
            type="button"
            onClick={onStartCustomize}
            className="btn-aurora inline-flex w-full items-center justify-center gap-2.5 rounded-xl px-7 py-3.5 text-sm font-semibold sm:w-auto sm:min-w-[270px] sm:text-base"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span>Configure Session</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </button>
        </div>

        <p className="max-w-lg font-mono-tech text-[11px] leading-relaxed text-[#7E7E78]">
          5-min free preview · No card required · 10 curated styles + Endless Stream · 18+
        </p>
      </section>

      {/* CH 01–04 Quick Channel Presets */}
      <section className="animate-step w-full rounded-2xl border border-white/10 bg-[#101114] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#8E8E88]">
            CH 01–04 · Quick Start Presets
          </span>
          <button
            type="button"
            onClick={onOpenIdentityModal}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#A3A39E] transition hover:text-[#F3F1EC]"
          >
            <KeyRound className="h-3 w-3 text-[#34D399]" />
            Restore Sync Key
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {CHANNEL_PRESETS.map((pad) => (
            <button
              key={pad.id}
              type="button"
              onClick={() => onSelectMoodPreset(pad.id)}
              className="group flex flex-col items-start rounded-xl border border-white/[0.08] bg-[#15171B] px-3.5 py-3 text-left transition hover:border-emerald-400/50 hover:bg-[#191C21]"
            >
              <div className="flex w-full items-center justify-between gap-1.5">
                <span className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
                  {pad.tag}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#6E6E68] transition-transform group-hover:translate-x-0.5 group-hover:text-[#F3F1EC]" />
              </div>
              <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#A3A39E]">
                <span>{pad.from}</span>
                <ArrowRight className="h-3 w-3 opacity-70" />
                <span className="text-[#F3F1EC]">{pad.to}</span>
              </div>
              <span className="mt-1 text-[11px] text-[#7E7E78]">{pad.sub}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-xs text-[#8E8E88]">
          <span>Want Jazz, Dub Reggae, Solo Piano, Bossa Nova, Classical, or Ambient Space?</span>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onStartCustomize}
              className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] transition hover:text-[#34D399]"
            >
              <span>Choose from all 10 styles</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenStudyLab}
              className="inline-flex items-center gap-1 font-medium text-[#34D399] transition hover:text-emerald-300"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Browse published studies</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3-Column Instrument Spec Grid */}
      <section className="animate-rise delay-150 grid w-full grid-cols-1 divide-y divide-white/[0.08] rounded-2xl border border-white/10 bg-[#0E0F12] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            01 / State Ramp
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Pick How You Want to Feel</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Tell us your current state and how much time you have. The audio ramps gradually from
            where you are to your target.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            02 / Measurable Signal
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Measurable on Any Oscilloscope</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Every frequency (16 Hz focus AM, 10 Hz calm, 40 Hz bursts, 432 Hz) runs live on our
            built-in dual-trace oscilloscope.{' '}
            <button
              type="button"
              onClick={onStartCustomize}
              className="font-medium text-[#F3F1EC] underline decoration-white/30 underline-offset-2 hover:text-[#34D399] hover:decoration-[#34D399]"
            >
              Isolate Pure Wave
            </button>{' '}
            anytime to inspect it externally.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            03 / 10 Styles + Endless
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Blended With Real Music</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Pair your protocol with Lo-Fi, Solo Piano, Jazz, Dub Reggae, Bossa Nova, Classical, Soft
            Rain, or switch to Endless Stream with zero loops.
          </p>
        </div>
      </section>

      {/* B2B Cohort Intelligence Showcase */}
      <CohortIntelligenceShowcase mode="compact" />

      {/* Quiet Spec Footnote */}
      <div className="font-mono-tech text-center text-[10px] uppercase tracking-[0.12em] text-[#7E7E78]">
        Optional 15-second reaction benchmark included before and after each session
      </div>
    </div>
  );
}
