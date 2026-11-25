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
  isPro?: boolean;
  hasProfile?: boolean;
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
    sub: 'Deep Electronic · 25 min',
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
 * Interactive HiDPI Dual-Lane Hero Oscilloscope Preview Strip showing separated CH1 carrier
 * waveform + CH2 16 Hz AM envelope geometry matching the in-player CRT instrument.
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(80, Math.floor(rect.height));
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Recessed dark-phosphor CRT surface
      ctx.fillStyle = '#030706';
      ctx.fillRect(0, 0, w, h);

      // CRT graticule (8 vertical x 4 horizontal)
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.13)';
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

      // Upper Lane (CH1 Audio Carrier): 0 V reference + green phosphor wave + halo
      const ch1MidY = h * 0.31;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.2)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(ch1MidY) + 0.5);
      ctx.lineTo(w, Math.round(ch1MidY) + 0.5);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i <= 260; i++) {
        const norm = i / 260;
        const x = norm * w;
        const env = 0.68 + 0.32 * Math.sin(norm * Math.PI * 8 - phase * 0.9);
        const carrier = Math.sin(norm * Math.PI * 44 - phase * 3.1);
        const y = ch1MidY - carrier * env * (h * 0.19);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.24)';
      ctx.lineWidth = 4.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 1.9;
      ctx.stroke();

      // Dashed horizontal divider at 55% height
      const divY = Math.round(h * 0.55) + 0.5;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, divY);
      ctx.lineTo(w, divY);
      ctx.stroke();
      ctx.restore();

      // Lower Lane (CH2 16 Hz Beta Envelope): gradient fill + amber wave + halo
      const ch2BaseY = h - 6;
      const ch2SpanH = h * 0.34;
      const grad = ctx.createLinearGradient(0, ch2BaseY - ch2SpanH, 0, ch2BaseY);
      grad.addColorStop(0, 'rgba(245, 158, 11, 0.18)');
      grad.addColorStop(1, 'rgba(245, 158, 11, 0.01)');

      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const norm = i / 180;
        const x = norm * w;
        const pulse = 0.5 + 0.44 * Math.sin(norm * Math.PI * 8 - phase * 0.9);
        const y = ch2BaseY - pulse * ch2SpanH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.24)';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 1.9;
      ctx.stroke();

      ctx.lineTo(w, ch2BaseY);
      ctx.lineTo(0, ch2BaseY);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Crisp in-screen CRT HUD labels
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#34D399';
      ctx.fillText('CH1 CARRIER', 8, 5);
      ctx.fillStyle = '#FBBF24';
      ctx.fillText('CH2 16 HZ ENVELOPE', 8, divY + 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(243, 241, 236, 0.78)';
      ctx.fillText('CLICK TO UNMUTE', w - 8, 5);

      ctx.restore();

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
      className="group w-full max-w-2xl rounded-2xl border border-emerald-400/25 bg-[#080B0A] px-4 py-3 text-left transition hover:border-emerald-400/50 shadow-[0_0_24px_rgba(16,185,129,0.06)]"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px]">
        <div className="flex flex-wrap items-center gap-3 text-[#A3A39E]">
          <span className="inline-flex items-center gap-1.5 text-[#34D399]">
            <Activity className="h-3 w-3" />
            CH1 AUDIO CARRIER
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#FBBF24]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#FBBF24]" />
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
        height={92}
        className="h-20 sm:h-24 w-full rounded-xl border border-emerald-400/25 bg-[#030706]"
      />
    </button>
  );
}

export function HeroLandingView({
  isPro = false,
  hasProfile = false,
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
          {isPro
            ? 'nootropic.fm Pro Active · Unlimited full-length sessions & all 10 styles · 18+'
            : '5-min free calibration · Share for +30 min free · No card or login required · 18+'}
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
            {hasProfile ? 'Your Neural Pass' : 'Restore Sync Key'}
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
