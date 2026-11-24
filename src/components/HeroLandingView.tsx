import { useEffect, useRef } from 'react';
import {
  Activity,
  ArrowRight,
  FlaskConical,
  KeyRound,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import type { QuickTryId } from '../lib/quickTryProtocols';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';

interface HeroLandingViewProps {
  onInstantPlay: (id: QuickTryId) => void;
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
    sub: 'Lo-Fi Beats · 25 min',
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
    sub: 'Soft Rain & Nature · 15 min',
  },
  {
    id: 'energy_electronic',
    tag: '18 HZ',
    from: 'Tired',
    to: 'Awake',
    sub: 'Deep Electronic · 20 min',
  },
];

/**
 * Interactive Hero Oscilloscope Preview Strip showing live carrier + AM envelope geometry
 * and inviting visitors to unmute the real Web Audio engine in 1 click (<1s TTFV).
 */
function HeroScopeStrip({ onStart }: { onStart: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let phase = 0;
    let rafId = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Subtle phosphor graticule
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.08)';
      ctx.lineWidth = 1;
      for (let gx = 1; gx < 10; gx++) {
        const x = (gx / 10) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // CH1 Preview Trace (Phosphor Green: 16 Hz AM-modulated carrier shape)
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.86)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const norm = i / 240;
        const x = norm * w;
        const env = 0.72 + 0.28 * Math.sin(norm * Math.PI * 6 - phase * 0.9);
        const carrier = Math.sin(norm * Math.PI * 38 - phase * 3.1);
        const y = h / 2 - carrier * env * (h * 0.34);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // CH2 Preview Trace (Tungsten Amber: 16 Hz modulation envelope)
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const norm = i / 160;
        const x = norm * w;
        const y = h / 2 - Math.sin(norm * Math.PI * 6 - phase * 0.9) * (h * 0.28);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (!prefersReduced) {
        phase += 0.04;
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <button
      type="button"
      onClick={onStart}
      className="group w-full max-w-2xl rounded-xl border border-white/10 bg-[#070908] px-4 py-3 text-left transition hover:border-emerald-400/45"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px]">
        <div className="flex flex-wrap items-center gap-3 text-[#A3A39E]">
          <span className="inline-flex items-center gap-1.5 text-[#34D399]">
            <Activity className="h-3 w-3" />
            CH1 AUDIO CARRIER
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#F59E0B]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
            CH2 16.0 HZ BETA AM
          </span>
        </div>
        <span className="inline-flex items-center gap-1 font-semibold text-[#F3F1EC] group-hover:text-[#34D399]">
          Unmute Live Engine
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={620}
        height={64}
        className="h-14 w-full rounded-lg border border-white/[0.06] bg-[#040605]"
      />
    </button>
  );
}

export function HeroLandingView({
  onInstantPlay,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center space-y-7 py-3 sm:space-y-9 sm:py-8">
      {/* Above-the-Fold Precision Studio Hero (<1s Instant Audio Entry) */}
      <section className="animate-rise flex w-full flex-col items-center text-center space-y-5 px-1">
        <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/[0.07] px-3.5 py-1 font-mono-tech text-[10px] font-medium uppercase tracking-[0.16em] text-[#A3A39E] sm:text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" />
          <span className="font-semibold text-[#34D399]">Tune Your Mind</span>
          <span className="text-white/25">·</span>
          <span>48.0 kHz Psychoacoustic Studio · Live Oscilloscope</span>
        </div>

        <h1 className="max-w-3xl font-display text-[2rem] font-semibold tracking-tight text-[#F3F1EC] sm:text-5xl leading-[1.06]">
          Reach your best mental state{' '}
          <span className="text-[#34D399]">with music you can actually measure.</span>
        </h1>

        <p className="max-w-2xl text-sm leading-relaxed text-[#A3A39E] sm:text-base">
          The adaptive psychoacoustic platform that blends study-backed sound waves into music you
          love, helping you achieve your best focus, calm, and flow.
        </p>

        {/* Primary Instant-Play + Custom Session CTA Pair */}
        <div className="flex w-full max-w-xl flex-col items-center justify-center gap-3 pt-1 sm:flex-row">
          <button
            type="button"
            onClick={() => onInstantPlay('focus_lofi')}
            className="btn-aurora inline-flex w-full items-center justify-center gap-2.5 rounded-xl px-7 py-3.5 text-sm font-semibold sm:w-auto sm:text-base"
          >
            <Play className="h-4 w-4 shrink-0 fill-[#0A0B0C]" />
            <span>Listen Live · 16 Hz Focus</span>
          </button>
          <button
            type="button"
            onClick={onStartCustomize}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#14161A] px-5 py-3.5 text-sm font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50 hover:bg-[#191C21] sm:w-auto"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#34D399]" />
            <span>Configure Custom Session</span>
          </button>
        </div>

        <p className="max-w-lg font-mono-tech text-[11px] leading-relaxed text-[#7E7E78]">
          15-min free session · No card or login required · 10 styles + Endless Stream · 18+
        </p>

        {/* Interactive Oscilloscope Preview Strip */}
        <HeroScopeStrip onStart={() => onInstantPlay('focus_lofi')} />
      </section>

      {/* CH 01–04 1-Click Instant Channel Pads */}
      <section className="animate-step w-full rounded-2xl border border-white/10 bg-[#101114] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#8E8E88]">
            CH 01–04 · 1-Click Instant Channels
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
              onClick={() => onInstantPlay(pad.id)}
              className="group flex flex-col items-start rounded-xl border border-white/[0.08] bg-[#15171B] px-3.5 py-3 text-left transition hover:border-emerald-400/50 hover:bg-[#191C21]"
            >
              <div className="flex w-full items-center justify-between gap-1.5">
                <span className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
                  {pad.tag}
                </span>
                <span className="inline-flex items-center gap-1 font-mono-tech text-[10px] font-semibold text-[#7E7E78] transition group-hover:text-[#34D399]">
                  <Play className="h-2.5 w-2.5 fill-current" />
                  Play
                </span>
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
              <span>Personalize all 10 styles</span>
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
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Hear It in 1 Second</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Start listening immediately with zero signup walls, or calibrate the frequency ramp to
            your current mental state and session length.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            02 / Measurable Signal
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Measurable on Any Oscilloscope</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Every frequency (16 Hz focus AM, 10 Hz calm, 40 Hz bursts, 432 Hz) runs live on our
            built-in Y(t) and X/Y Lissajous scope.{' '}
            <button
              type="button"
              onClick={() => onInstantPlay('focus_lofi')}
              className="font-medium text-[#F3F1EC] underline decoration-white/30 underline-offset-2 hover:text-[#34D399] hover:decoration-[#34D399]"
            >
              Isolate Pure Wave
            </button>{' '}
            anytime to verify externally.
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
