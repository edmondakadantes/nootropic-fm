import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  FlaskConical,
  KeyRound,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { TargetState, UserProfile } from '../../shared/types';
import {
  QUICK_FEELINGS,
  previewStateGoalTrajectory,
  type QuickFeelingId,
  type QuickTryId,
} from '../lib/quickTryProtocols';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';

interface HeroLandingViewProps {
  isPro?: boolean;
  hasProfile?: boolean;
  profile?: UserProfile | null;
  onInstantPlay: (id: QuickTryId) => void;
  onLaunchStateGoal: (feelingId: QuickFeelingId, targetState: TargetState) => void;
  onStartCustomize: () => void;
  onOpenStudyLab: () => void;
  onOpenIdentityModal: () => void;
}

const GOAL_CARDS: Array<{
  target: TargetState;
  title: string;
  tag: string;
  sub: string;
}> = [
  {
    target: 'energy_lift',
    title: 'Energy Lift',
    tag: 'WAKE UP',
    sub: 'Clear brain fog & afternoon fatigue',
  },
  {
    target: 'alert_focus',
    title: 'Sharp Focus',
    tag: 'LOCK IN',
    sub: 'Sustained attention & zero drift',
  },
  {
    target: 'deep_flow',
    title: 'Deep Flow',
    tag: 'DEEP WORK',
    sub: 'Uninterrupted coding, writing, study',
  },
  {
    target: 'calm_reset',
    title: 'Calm Reset',
    tag: 'UNWIND',
    sub: 'Drop tension & slow racing thoughts',
  },
  {
    target: 'sleep_winddown',
    title: 'Sleep Wind-Down',
    tag: 'DRIFT OFF',
    sub: 'Quiet mind gently before sleep',
  },
];

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
      const h = Math.max(76, Math.floor(rect.height));
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = '#030706';
      ctx.fillRect(0, 0, w, h);

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
        const env = 0.62 + 0.38 * Math.sin(norm * Math.PI * 8 - phase * 0.9);
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

      const divY = Math.round(h * 0.55) + 0.5;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, divY);
      ctx.lineTo(w, divY);
      ctx.stroke();
      ctx.restore();

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

      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#34D399';
      ctx.fillText('CH1 LAYER 1 + 2 MIX', 8, 5);
      ctx.fillStyle = '#FBBF24';
      ctx.fillText('CH2 NEURAL ENVELOPE', 8, divY + 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(243, 241, 236, 0.78)';
      ctx.fillText('CLICK TO LAUNCH', w - 8, 5);

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
      className="group w-full max-w-3xl rounded-2xl border border-emerald-400/25 bg-[#080B0A] px-4 py-3 text-left transition hover:border-emerald-400/50 shadow-[0_0_24px_rgba(16,185,129,0.06)]"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px]">
        <div className="flex flex-wrap items-center gap-3 text-[#A3A39E]">
          <span className="inline-flex items-center gap-1.5 text-[#34D399]">
            <Activity className="h-3 w-3" />
            48.0 KHZ 3-BAND LR4 ENGINE
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#FBBF24]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#FBBF24]" />
            REAL-TIME OSCILLOSCOPE PROOF
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
        height={88}
        className="h-20 w-full rounded-xl border border-emerald-400/25 bg-[#030706]"
      />
    </button>
  );
}

export function HeroLandingView({
  isPro = false,
  hasProfile = false,
  profile = null,
  onLaunchStateGoal,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  const [selectedFeeling, setSelectedFeeling] = useState<QuickFeelingId>('tired_fog');
  const [selectedGoal, setSelectedGoal] = useState<TargetState>('energy_lift');

  const activeFeelingMeta =
    QUICK_FEELINGS.find((f) => f.id === selectedFeeling) ?? QUICK_FEELINGS[0];
  const activeGoalMeta =
    GOAL_CARDS.find((g) => g.target === selectedGoal) ?? GOAL_CARDS[0];

  const preview = previewStateGoalTrajectory(selectedFeeling, selectedGoal, profile);

  const handleSelectFeeling = (id: QuickFeelingId) => {
    setSelectedFeeling(id);
    const found = QUICK_FEELINGS.find((f) => f.id === id);
    if (found) {
      setSelectedGoal(found.recommendedTarget);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center space-y-6 py-2 sm:space-y-8 sm:py-6">
      {/* Precision Studio Header */}
      <section className="animate-rise flex w-full flex-col items-center text-center space-y-3.5 px-1">
        <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/[0.07] px-3.5 py-1 font-mono-tech text-[10px] font-medium uppercase tracking-[0.16em] text-[#A3A39E] sm:text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" />
          <span className="font-semibold text-[#34D399]">State-Adaptive Psychoacoustics</span>
          <span className="text-white/25">·</span>
          <span>Iso-Principle Neural Calibration</span>
        </div>

        <h1 className="max-w-3xl font-display text-[1.9rem] font-semibold tracking-tight text-[#F3F1EC] sm:text-5xl leading-[1.07]">
          Start from how you feel right now.{' '}
          <span className="text-[#34D399]">Tune where your mind goes next.</span>
        </h1>

        <p className="max-w-2xl text-sm leading-relaxed text-[#A3A39E] sm:text-base">
          Select your current state and target goal below — the engine automatically calibrates your
          starting frequency, effect intensity (36%–94%), and musical key in 1 second.
        </p>
      </section>

      {/* 2-CLICK STATE-TO-TARGET CONSOLE */}
      <section className="animate-step w-full rounded-2xl border border-white/12 bg-[#101216] p-4 sm:p-6 space-y-5 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        {/* STEP 1: HOW DO YOU FEEL RIGHT NOW? */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono-tech text-[11px] font-semibold uppercase tracking-[0.14em] text-[#34D399]">
              Step 1 · How do you feel right now?
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

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {QUICK_FEELINGS.map((feel) => {
              const active = feel.id === selectedFeeling;
              return (
                <button
                  key={feel.id}
                  type="button"
                  onClick={() => handleSelectFeeling(feel.id)}
                  className={`flex flex-col items-start justify-between rounded-xl border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-emerald-400/65 bg-emerald-500/[0.12] text-[#F3F1EC] ring-1 ring-emerald-400/25'
                      : 'border-white/[0.08] bg-[#15181D] text-[#A3A39E] hover:border-white/25 hover:text-[#F3F1EC]'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-1">
                    <span className="font-mono-tech text-[9px] uppercase tracking-wider text-[#7E7E78]">
                      {feel.tag}
                    </span>
                    {active && <Check className="h-3 w-3 shrink-0 text-[#34D399]" />}
                  </div>
                  <span className="mt-1 text-xs font-semibold leading-snug">{feel.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* STEP 2: WHERE DO YOU WANT TO GO? (1-CLICK PLAY OR SELECT) */}
        <div className="space-y-2.5 border-t border-white/[0.07] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono-tech text-[11px] font-semibold uppercase tracking-[0.14em] text-[#F3F1EC]">
              Step 2 · Tap where you want to go{' '}
              <span className="text-[#8E8E88]">(starts immediately)</span>
            </span>
            <span className="font-mono-tech text-[10px] text-[#8E8E88]">
              Recommended for {activeFeelingMeta.label}:{' '}
              <strong className="text-[#34D399]">
                {GOAL_CARDS.find((g) => g.target === activeFeelingMeta.recommendedTarget)?.title}
              </strong>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {GOAL_CARDS.map((goal) => {
              const active = goal.target === selectedGoal;
              const isRec = goal.target === activeFeelingMeta.recommendedTarget;
              return (
                <button
                  key={goal.target}
                  type="button"
                  onClick={() => {
                    setSelectedGoal(goal.target);
                    onLaunchStateGoal(selectedFeeling, goal.target);
                  }}
                  className={`group flex flex-col justify-between rounded-xl border p-3 text-left transition-all ${
                    active
                      ? 'border-emerald-400/60 bg-[#18211E] text-[#F3F1EC]'
                      : 'border-white/[0.08] bg-[#14161B] text-[#D4D4CE] hover:border-emerald-400/45 hover:bg-[#181B21]'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <span className="font-mono-tech text-[9.5px] font-semibold uppercase tracking-wider text-[#34D399]">
                      {isRec ? '★ BEST MATCH' : goal.tag}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 font-mono-tech text-[9px] font-bold text-[#34D399] transition group-hover:bg-[#34D399] group-hover:text-[#0A0B0C]">
                      <Play className="h-2.5 w-2.5 fill-current" />
                      Play
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <div className="text-sm font-semibold text-[#F3F1EC]">{goal.title}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[#8E8E88]">{goal.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* LIVE CALIBRATED TRAJECTORY BAR + PRIMARY PLAY CTA */}
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-emerald-400/25 bg-[#0B0E0D] p-3.5 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#F3F1EC]">
              <span>{activeFeelingMeta.label}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#34D399]" />
              <span className="text-[#34D399]">{activeGoalMeta.title}</span>
              {preview.isIsoBridge && (
                <span className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-400/12 px-2 py-0.5 font-mono-tech text-[9.5px] font-semibold text-amber-200">
                  <ShieldCheck className="h-3 w-3" />
                  Gentle 2-Stage Iso-Bridge Active
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-tech text-[11px] text-[#A3A39E]">
              <span className="text-[#34D399]">{preview.hzSummary}</span>
              <span className="text-white/20">·</span>
              <span className="text-[#F3F1EC]">{preview.effectLabel}</span>
              <span className="text-white/20">·</span>
              <span>{preview.genreLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onLaunchStateGoal(selectedFeeling, selectedGoal)}
            className="btn-aurora inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold"
          >
            <Play className="h-4 w-4 shrink-0 fill-[#0A0B0C]" />
            <span>Listen Live · Start Session</span>
          </button>
        </div>

        {/* Advanced Options Footer inside Console */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-xs text-[#8E8E88]">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#34D399]" />
            {isPro
              ? 'nootropic.fm Pro Active · Unlimited full sessions & all 10 music styles'
              : '5-min free calibration · Share for +30 min free · No signup required · 18+'}
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onStartCustomize}
              className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] transition hover:text-[#34D399]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#34D399]" />
              <span>2D Compass &amp; All 10 Styles</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenStudyLab}
              className="inline-flex items-center gap-1 font-medium text-[#34D399] transition hover:text-emerald-300"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Browse Published Studies</span>
            </button>
          </div>
        </div>
      </section>

      {/* Interactive Oscilloscope Preview Strip */}
      <HeroScopeStrip onStart={() => onLaunchStateGoal(selectedFeeling, selectedGoal)} />

      {/* 3-Column Instrument Spec Grid */}
      <section className="animate-rise delay-150 grid w-full grid-cols-1 divide-y divide-white/[0.08] rounded-2xl border border-white/10 bg-[#0E0F12] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            01 / State-Adaptive Start
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Calibrated From Second 1</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Tired or distracted states launch at Max Effect (94%) for immediate lock-in, while
            anxious or depleted minds receive a 3-minute 10 Hz stabilization bridge first.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            02 / Measurable Signal
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">3-Way Layer Monitor &amp; Scope</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Compare Nootropic Mix, isolated Science Only, and Plain Music in real time on our
            built-in Y(t) and X/Y Lissajous oscilloscope.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            03 / 10 Styles + Endless
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Key-Locked With Real Music</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Every neural carrier automatically tunes to the musical root of Lo-Fi, Deep Electronic,
            Solo Piano, Jazz, Dub Reggae, Bossa Nova, Strings, or Soft Rain.
          </p>
        </div>
      </section>

      {/* B2B Cohort Intelligence Showcase */}
      <CohortIntelligenceShowcase mode="compact" />
    </div>
  );
}
