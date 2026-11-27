import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Compass,
  Crosshair,
  FlaskConical,
  KeyRound,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import {
  NEURAL_MICRO_STATES,
  TARGET_COORDS,
  findClosestMicroState,
  findNearbyMicroStates,
  type NeuralCoords,
  type NeuralMicroState,
} from '../../shared/neuralStates';
import type { TargetState, UserProfile } from '../../shared/types';
import {
  previewMicroStateTrajectory,
  type QuickFeelingId,
  type QuickTryId,
} from '../lib/quickTryProtocols';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';

interface HeroLandingViewProps {
  isPro?: boolean;
  hasProfile?: boolean;
  profile?: UserProfile | null;
  themeMode?: 'daylight' | 'night';
  onInstantPlay: (id: QuickTryId) => void;
  onLaunchStateGoal: (feelingId: QuickFeelingId, targetState: TargetState) => void;
  onDiscoverProtocol?: (
    microState: NeuralMicroState,
    coords: NeuralCoords,
    targetState: TargetState,
    durationMin: number
  ) => void;
  onStartCustomize: () => void;
  onOpenStudyLab: () => void;
  onOpenIdentityModal: () => void;
}

const GOAL_CARDS: Array<{
  target: TargetState;
  title: string;
  sub: string;
  defaultMin: number;
}> = [
  {
    target: 'energy_lift',
    title: 'Energy Lift',
    sub: 'Clear brain fog & afternoon slump',
    defaultMin: 20,
  },
  {
    target: 'alert_focus',
    title: 'Sharp Focus',
    sub: 'Sustained attention & zero drift',
    defaultMin: 25,
  },
  {
    target: 'deep_flow',
    title: 'Deep Flow',
    sub: 'Uninterrupted coding, writing, study',
    defaultMin: 45,
  },
  {
    target: 'calm_reset',
    title: 'Calm Reset',
    sub: 'Drop tension & slow racing thoughts',
    defaultMin: 20,
  },
  {
    target: 'sleep_winddown',
    title: 'Sleep Wind-Down',
    sub: 'Quiet mind gently before sleep',
    defaultMin: 30,
  },
];

const DURATION_CHOICES = [15, 25, 45, 60];

function HeroScopeStrip({
  onStart,
  themeMode = 'night',
}: {
  onStart: () => void;
  themeMode?: 'daylight' | 'night';
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDay = themeMode === 'daylight';

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
      const w = Math.max(260, Math.floor(rect.width));
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

      ctx.fillStyle = isDay ? '#E8EFF7' : '#030706';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.13)' : 'rgba(52, 211, 153, 0.13)';
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
      ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.20)' : 'rgba(52, 211, 153, 0.2)';
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
      ctx.strokeStyle = isDay ? 'rgba(4, 120, 87, 0.18)' : 'rgba(52, 211, 153, 0.24)';
      ctx.lineWidth = 4.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.strokeStyle = isDay ? '#047857' : '#34D399';
      ctx.lineWidth = 1.9;
      ctx.stroke();

      const divY = Math.round(h * 0.55) + 0.5;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, divY);
      ctx.lineTo(w, divY);
      ctx.stroke();
      ctx.restore();

      const ch2BaseY = h - 6;
      const ch2SpanH = h * 0.34;
      const grad = ctx.createLinearGradient(0, ch2BaseY - ch2SpanH, 0, ch2BaseY);
      grad.addColorStop(0, isDay ? 'rgba(3, 105, 161, 0.16)' : 'rgba(245, 158, 11, 0.18)');
      grad.addColorStop(1, isDay ? 'rgba(3, 105, 161, 0.01)' : 'rgba(245, 158, 11, 0.01)');

      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const norm = i / 180;
        const x = norm * w;
        const pulse = 0.5 + 0.44 * Math.sin(norm * Math.PI * 8 - phase * 0.9);
        const y = ch2BaseY - pulse * ch2SpanH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = isDay ? 'rgba(3, 105, 161, 0.18)' : 'rgba(251, 191, 36, 0.24)';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.strokeStyle = isDay ? '#0369A1' : '#FBBF24';
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
      ctx.fillStyle = isDay ? '#047857' : '#34D399';
      ctx.fillText('CH1 LAYER 1 + 2 MIX', 8, 5);
      ctx.fillStyle = isDay ? '#0369A1' : '#FBBF24';
      ctx.fillText('CH2 NEURAL ENVELOPE', 8, divY + 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = isDay ? '#334155' : 'rgba(243, 241, 236, 0.78)';
      ctx.fillText('DEMO ENGINE', w - 8, 5);

      ctx.restore();

      if (!prefersReduced) {
        phase += 0.04;
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [isDay]);

  return (
    <button
      type="button"
      onClick={onStart}
      className={`group w-full rounded-2xl border px-4 py-3 text-left transition ${
        isDay
          ? 'border-slate-300 bg-[#DDE5EE] hover:border-emerald-700/60 shadow-sm'
          : 'border-emerald-400/25 bg-[#080B0A] hover:border-emerald-400/50 shadow-[0_0_24px_rgba(16,185,129,0.06)]'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px]">
        <div className="flex flex-wrap items-center gap-3 text-[#A3A39E]">
          <span className="inline-flex items-center gap-1.5 text-[#34D399]">
            <Activity className="h-3 w-3" />
            48.0 KHZ 3-BAND LR4 ENGINE
          </span>
          <span className={`inline-flex items-center gap-1.5 ${isDay ? 'text-[#0369A1]' : 'text-[#FBBF24]'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isDay ? 'bg-[#0369A1]' : 'bg-[#FBBF24]'}`} />
            REAL-TIME OSCILLOSCOPE PROOF
          </span>
        </div>
        <span className="inline-flex items-center gap-1 font-semibold text-[#F3F1EC] group-hover:text-[#34D399]">
          Listen Live Demo
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={620}
        height={88}
        className={`h-20 w-full rounded-xl border ${
          isDay ? 'border-slate-300 bg-[#E8EFF7]' : 'border-emerald-400/25 bg-[#030706]'
        }`}
      />
    </button>
  );
}

export function HeroLandingView({
  isPro = false,
  hasProfile = false,
  profile = null,
  themeMode = 'night',
  onInstantPlay,
  onDiscoverProtocol,
  onStartCustomize,
  onOpenStudyLab,
  onOpenIdentityModal,
}: HeroLandingViewProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showAllStates, setShowAllStates] = useState(false);

  // Clean zero-assumption initial state: NO auto-selected state and NO auto-drawn trajectory bar!
  const [coords, setCoords] = useState<NeuralCoords | null>(null);
  const [selectedState, setSelectedState] = useState<NeuralMicroState | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<TargetState | null>(null);
  const [durationMin, setDurationMin] = useState<number>(25);
  const [durationTouched, setDurationTouched] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const landmarks = NEURAL_MICRO_STATES.filter((s) => s.landmark);
  const quickStarterStates = NEURAL_MICRO_STATES.filter((s) =>
    [
      'stressed',
      'tired_sluggish',
      'brain_fog',
      'distracted_scattered',
      'anxious_racing',
      'calm_balanced',
    ].includes(s.id)
  );
  const nearbyStates =
    coords && selectedState
      ? findNearbyMicroStates(coords.energy, coords.clarity, 6)
          .filter((s) => s.id !== selectedState.id)
          .slice(0, 5)
      : quickStarterStates;

  const preview =
    selectedState && coords && selectedGoal
      ? previewMicroStateTrajectory(selectedState, coords, selectedGoal, profile)
      : null;
  const activeGoalMeta = selectedGoal
    ? GOAL_CARDS.find((g) => g.target === selectedGoal) ?? null
    : null;
  const destCoords = selectedGoal ? TARGET_COORDS[selectedGoal] : null;

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = (1 - (clientY - rect.top) / rect.height) * 100;
    const clarity = Math.round(Math.max(5, Math.min(95, rawX)));
    const energy = Math.round(Math.max(5, Math.min(95, rawY)));
    const nextCoords = { energy, clarity };
    const closest = findClosestMicroState(energy, clarity);
    setCoords(nextCoords);
    setSelectedState(closest);
    setStepError(null);
    // IMPORTANT: Never auto-select selectedGoal here so no trajectory bar draws on its own!
  };

  const handleSelectMicro = (st: NeuralMicroState) => {
    setSelectedState(st);
    setCoords({ energy: st.energy, clarity: st.clarity });
    setStepError(null);
    // IMPORTANT: Never auto-select selectedGoal here — wait for user's explicit Step 2 choice!
  };

  const handleSelectGoal = (goal: TargetState, defaultMin: number) => {
    setSelectedGoal(goal);
    if (!durationTouched) {
      setDurationMin(defaultMin);
    }
    setStepError(null);
  };

  const handleDiscoverStudies = () => {
    if (!selectedState || !coords) {
      setStepError('Step 1: Tap or drag how you feel right now on the 2D Brain Map.');
      return;
    }
    if (!selectedGoal) {
      setStepError('Step 2: Choose where you want your mind to go next.');
      return;
    }
    setStepError(null);
    if (onDiscoverProtocol) {
      onDiscoverProtocol(selectedState, coords, selectedGoal, durationMin);
    }
  };

  // SVG coordinates (trajectory vector ONLY renders when BOTH Step 1 & Step 2 are explicitly chosen!)
  const hasBothSteps = Boolean(coords && destCoords && selectedState && selectedGoal);
  const x1 = coords ? coords.clarity : 50;
  const y1 = coords ? 100 - coords.energy : 50;
  const x2 = destCoords ? destCoords.clarity : 50;
  const y2 = destCoords ? 100 - destCoords.energy : 50;
  const wp = preview?.isoWaypointCoords;
  const mx = wp ? wp.clarity : (x1 + x2) / 2;
  const my = wp ? 100 - wp.energy : Math.max(10, Math.min(90, (y1 + y2) / 2 - 12));

  const isDay = themeMode === 'daylight';
  const cursorColor =
    coords && coords.clarity < 48 && coords.energy >= 55
      ? isDay
        ? '#1D4ED8'
        : '#F59E0B'
      : isDay
        ? '#047857'
        : '#34D399';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center space-y-6 py-2 sm:space-y-8 sm:py-5">
      {/* Precision Studio Hero Header */}
      <section className="animate-rise flex w-full flex-col items-center text-center space-y-3 px-2">
        <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/[0.07] px-3 py-1 font-mono-tech text-[9.5px] font-medium uppercase tracking-[0.14em] text-[#A3A39E] sm:px-3.5 sm:text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" />
          <span className="font-semibold text-[#34D399]">2D Neural Brain Map</span>
          <span className="text-white/25">·</span>
          <span>Peer-Reviewed Study Matching (PubMed &amp; DOI)</span>
        </div>

        <h1 className="max-w-3xl font-display text-2xl font-semibold tracking-tight text-[#F3F1EC] sm:text-5xl leading-[1.1]">
          Map how you feel now.{' '}
          <span className="text-[#34D399]">Match the science to get where you want.</span>
        </h1>

        <p className="max-w-2xl text-xs leading-relaxed text-[#A3A39E] sm:text-base">
          1. Mark your current state on the 2D Brain Map. 2. Pick your target state — we search
          verified peer-reviewed studies and build your exact 2-layer psychoacoustic session.
        </p>
      </section>

      {/* UNIFIED 2D BRAIN MAP + STUDY MATCHER CONSOLE */}
      <section className="animate-step w-full rounded-2xl border border-white/12 bg-[#101216] p-3.5 sm:p-6 space-y-5 shadow-[0_14px_44px_rgba(0,0,0,0.5)]">
        {/* Top Instrument Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono-tech text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#34D399]">
            <Compass className="h-3.5 w-3.5 shrink-0" />
            Step 1 · Tap or Drag How You Feel Right Now
          </span>
          <button
            type="button"
            onClick={onOpenIdentityModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#15181E] px-2.5 py-1 text-[11px] font-medium text-[#D4D4CE] transition hover:border-emerald-400/40 hover:text-[#F3F1EC]"
          >
            <KeyRound className="h-3 w-3 text-[#34D399]" />
            {hasProfile ? 'Your Neural Pass' : 'Restore Sync Key'}
          </button>
        </div>

        {/* Main 2-Column Studio Split on Desktop */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          {/* LEFT (7 cols): Interactive 2D Russell Circumplex Brain Map */}
          <div className="min-w-0 space-y-3 lg:col-span-7">
            <div
              ref={padRef}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button[data-landmark="true"]')) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
                updateFromClientPoint(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (!dragging) return;
                updateFromClientPoint(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                if (!dragging) return;
                setDragging(false);
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                } catch {
                  // ignore
                }
              }}
              onPointerCancel={() => setDragging(false)}
              role="application"
              aria-label="Interactive 2D Neural Brain Map"
              className="relative h-[340px] w-full touch-none select-none overflow-hidden rounded-xl border border-emerald-400/20 bg-[#07090B] cursor-crosshair sm:h-[395px]"
            >
              {/* Radar Grid, Concentric Rings, Crosshair Lines & Explicit Trajectory Vector */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <defs>
                  <linearGradient id="heroBrainVec" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={cursorColor} stopOpacity="0.95" />
                    <stop offset="100%" stopColor={themeMode === 'daylight' ? '#047857' : '#34D399'} stopOpacity="1" />
                  </linearGradient>
                  <radialGradient id="heroBrainGlow" cx="50%" cy="50%" r="55%">
                    <stop offset="0%" stopColor={themeMode === 'daylight' ? 'rgba(4,120,87,0.05)' : 'rgba(52,211,153,0.07)'} />
                    <stop offset="100%" stopColor={themeMode === 'daylight' ? 'rgba(228,234,241,0)' : 'rgba(7,9,11,0)'} />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width="100" height="100" fill="url(#heroBrainGlow)" />
                <line x1="25" y1="0" x2="25" y2="100" className="studio-grid-faint" strokeWidth="0.25" />
                <line x1="75" y1="0" x2="75" y2="100" className="studio-grid-faint" strokeWidth="0.25" />
                <line x1="0" y1="25" x2="100" y2="25" className="studio-grid-faint" strokeWidth="0.25" />
                <line x1="0" y1="75" x2="100" y2="75" className="studio-grid-faint" strokeWidth="0.25" />
                <line x1="50" y1="0" x2="50" y2="100" className="studio-grid-strong" strokeWidth="0.35" strokeDasharray="1.5 1.5" />
                <line x1="0" y1="50" x2="100" y2="50" className="studio-grid-strong" strokeWidth="0.35" strokeDasharray="1.5 1.5" />
                <circle cx="50" cy="50" r="18" fill="none" className="studio-grid-strong" strokeWidth="0.3" />
                <circle cx="50" cy="50" r="36" fill="none" className="studio-grid-faint" strokeWidth="0.3" />

                {/* Crosshair projection ONLY after Step 1 is selected */}
                {coords && (
                  <>
                    <line x1={x1} y1="0" x2={x1} y2="100" stroke={cursorColor} strokeOpacity="0.26" strokeWidth="0.3" />
                    <line x1="0" y1={y1} x2="100" y2={y1} stroke={cursorColor} strokeOpacity="0.26" strokeWidth="0.3" />
                  </>
                )}

                {/* Trajectory Bar ONLY drawn after user explicitly selects BOTH Step 1 & Step 2 */}
                {hasBothSteps && (
                  <>
                    <path
                      d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                      fill="none"
                      stroke="url(#heroBrainVec)"
                      strokeWidth="0.95"
                      strokeDasharray="2.2 1.4"
                    />
                    {wp && (
                      <circle
                        cx={wp.clarity}
                        cy={100 - wp.energy}
                        r="1.3"
                        fill={isDay ? '#1D4ED8' : '#FBBF24'}
                        stroke={isDay ? '#FFFFFF' : '#0A0B0C'}
                        strokeWidth="0.4"
                      />
                    )}
                  </>
                )}
              </svg>

              {/* Axis Labels */}
              <div className="pointer-events-none absolute left-1/2 top-2 z-0 -translate-x-1/2 rounded bg-[#0E1014]/90 px-2 py-0.5 font-mono-tech text-[9px] uppercase tracking-[0.12em] text-[#A3A39E]">
                ▲ High Energy · Wired
              </div>
              <div className="pointer-events-none absolute bottom-2 left-1/2 z-0 -translate-x-1/2 rounded bg-[#0E1014]/90 px-2 py-0.5 font-mono-tech text-[9px] uppercase tracking-[0.12em] text-[#A3A39E]">
                ▼ Low Energy · Drained
              </div>
              <div className="pointer-events-none absolute left-1.5 top-1/2 z-0 -translate-y-1/2 rounded bg-[#0E1014]/85 px-1.5 py-0.5 font-mono-tech text-[8.5px] uppercase tracking-wider text-[#7E7E78]">
                Tense / Fog
              </div>
              <div className="pointer-events-none absolute right-1.5 top-1/2 z-0 -translate-y-1/2 rounded bg-[#0E1014]/85 px-1.5 py-0.5 font-mono-tech text-[8.5px] uppercase tracking-wider text-[#7E7E78]">
                Clear / Calm
              </div>

              {/* Prompt pill before Step 1 is selected */}
              {!coords && (
                <div className="pointer-events-none absolute left-1/2 top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-emerald-400/30 bg-[#101417]/95 px-3 py-1 text-[11px] font-medium text-[#F3F1EC]">
                  Tap or drag anywhere on the map
                </div>
              )}

              {/* Constellation Landmarks */}
              {landmarks.map((st) => {
                const isSelected = selectedState?.id === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    data-landmark="true"
                    onClick={() => handleSelectMicro(st)}
                    style={{
                      left: `${st.clarity}%`,
                      top: `${100 - st.energy}%`,
                    }}
                    className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 p-1.5 focus:outline-none"
                  >
                    <span
                      className={`h-2 w-2 rounded-full transition-all ${
                        isSelected
                          ? 'opacity-0'
                          : 'bg-[#8E8E88] group-hover:scale-125 group-hover:bg-[#34D399]'
                      }`}
                    />
                    <span
                      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[9.5px] sm:text-[10.5px] font-medium transition ${
                        isSelected
                          ? 'translate-y-4 bg-[#14171C] text-[#F3F1EC] ring-1 ring-emerald-400/45'
                          : 'text-[#A3A39E] group-hover:bg-[#14171C] group-hover:text-[#F3F1EC]'
                      }`}
                    >
                      {st.shortLabel}
                    </span>
                  </button>
                );
              })}

              {/* Destination Beacon ONLY when user explicitly chose Step 2 */}
              {destCoords && activeGoalMeta && (
                <div
                  style={{ left: `${x2}%`, top: `${y2}%` }}
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                >
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-[#F3F1EC] bg-[#34D399] shadow-[0_0_12px_rgba(52,211,153,0.85)]" />
                  <span className="-mt-6 whitespace-nowrap rounded border border-emerald-400/40 bg-[#0B1210]/95 px-1.5 py-0.5 font-mono-tech text-[8.5px] font-bold uppercase tracking-wider text-[#34D399]">
                    ★ {activeGoalMeta.title}
                  </span>
                </div>
              )}

              {/* Active Draggable Reticle ("NOW") ONLY after Step 1 is selected */}
              {coords && (
                <div
                  style={{
                    left: `${x1}%`,
                    top: `${y1}%`,
                    transition: dragging ? 'none' : 'left 180ms ease-out, top 180ms ease-out',
                  }}
                  className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-[0_0_14px_rgba(0,0,0,0.45)] ${
                      isDay ? 'border-white' : 'border-[#F3F1EC]'
                    }`}
                    style={{ backgroundColor: cursorColor }}
                  >
                    <Crosshair className={`h-3.5 w-3.5 ${isDay ? 'text-white' : 'text-[#0A0B0C]'}`} />
                  </span>
                </div>
              )}
            </div>

            {/* Pinpointed Micro-State Readout + Expandable All-19 Nuances */}
            <div className="rounded-xl border border-white/10 bg-[#0C0E11] p-3 space-y-2.5">
              {selectedState && coords ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cursorColor }}
                    />
                    <span className="text-xs font-semibold text-[#F3F1EC] sm:text-sm">
                      Current State: {selectedState.label}
                    </span>
                  </div>
                  <span className="font-mono-tech text-[10px] text-[#8E8E88]">
                    Energy <strong className="text-[#34D399]">{coords.energy}%</strong> · Clarity{' '}
                    <strong className="text-[#F3F1EC]">{coords.clarity}%</strong>
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#A3A39E]">
                    No current state selected yet — tap the map above or pick a state below:
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2 text-[10px]">
                <span className="text-[#7E7E78]">
                  {showAllStates
                    ? `All ${NEURAL_MICRO_STATES.length} states:`
                    : selectedState
                      ? 'Refine to a nearby nuance:'
                      : 'Quick states:'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllStates((v) => !v)}
                  className="font-medium text-[#34D399] hover:text-emerald-300"
                >
                  {showAllStates ? 'Show fewer' : `All ${NEURAL_MICRO_STATES.length} states`}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(showAllStates ? NEURAL_MICRO_STATES : nearbyStates).map((st) => {
                  const active = selectedState?.id === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => handleSelectMicro(st)}
                      className={`rounded-lg border px-2 py-1 text-[10.5px] font-medium transition ${
                        active
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-[#F3F1EC]'
                          : 'border-white/[0.08] bg-[#14161B] text-[#A3A39E] hover:border-white/25 hover:text-[#F3F1EC]'
                      }`}
                    >
                      {st.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT (5 cols): Step 2 Destination + Session Duration + Find Scientific Studies CTA */}
          <div className="flex min-w-0 flex-col justify-between space-y-3.5 lg:col-span-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-tech text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#F3F1EC]">
                  Step 2 · Where Do You Want to Go?
                </span>
                {selectedGoal && (
                  <span className="font-mono-tech text-[9.5px] text-[#34D399]">Selected ✓</span>
                )}
              </div>

              <div className="space-y-2">
                {GOAL_CARDS.map((goal) => {
                  const active = goal.target === selectedGoal;
                  return (
                    <button
                      key={goal.target}
                      type="button"
                      onClick={() => handleSelectGoal(goal.target, goal.defaultMin)}
                      className={`group flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                        active
                          ? 'border-emerald-400/70 bg-[#16231E] text-[#F3F1EC] shadow-[0_0_18px_rgba(52,211,153,0.12)]'
                          : 'border-white/[0.08] bg-[#14161B] text-[#D4D4CE] hover:border-emerald-400/40 hover:bg-[#171B20]'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-semibold text-[#F3F1EC] sm:text-sm">
                          {goal.title}
                        </div>
                        <div className="truncate text-[11px] text-[#8E8E88]">{goal.sub}</div>
                      </div>

                      <span
                        className={`inline-flex shrink-0 items-center rounded-lg border px-2.5 py-1 font-mono-tech text-[10px] font-semibold transition ${
                          active
                            ? 'border-emerald-400 bg-[#34D399] text-[#0A0B0C]'
                            : 'border-white/12 bg-[#0E1014] text-[#A3A39E] group-hover:border-emerald-400/40 group-hover:text-[#34D399]'
                        }`}
                      >
                        {active ? 'Target ✓' : 'Select'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Compact Session Duration Selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#8E8E88]">
                  Session length:
                </span>
                <div className="flex items-center gap-1.5">
                  {DURATION_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setDurationTouched(true);
                        setDurationMin(m);
                      }}
                      className={`rounded-lg border px-2.5 py-1 font-mono-tech text-[10.5px] font-semibold transition ${
                        durationMin === m
                          ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                          : 'border-white/[0.08] bg-[#14161B] text-[#8E8E88] hover:border-white/25 hover:text-[#D4D4CE]'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 3: Live Trajectory Summary + Find Peer-Reviewed Studies CTA */}
            <div className="rounded-xl border border-emerald-400/30 bg-[#0B0E0D] p-3.5 space-y-3">
              {preview && selectedState && activeGoalMeta ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-1 font-mono-tech text-[9.5px] uppercase tracking-wider text-[#34D399]">
                      <BookOpen className="h-3 w-3" />
                      Ready to Match Peer-Reviewed Studies
                    </span>
                    {preview.isIsoBridge && (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-400/12 px-1.5 py-0.5 font-mono-tech text-[9px] font-semibold text-amber-200">
                        <ShieldCheck className="h-2.5 w-2.5" />
                        2-Stage Iso-Bridge
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                    <span>{selectedState.shortLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#34D399]" />
                    <span className="text-[#34D399]">{activeGoalMeta.title}</span>
                    <span className="font-mono-tech text-[10.5px] font-normal text-[#8E8E88]">
                      ({durationMin} min)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono-tech text-[10.5px] text-[#A3A39E]">
                    <span className="text-[#34D399]">{preview.hzSummary}</span>
                    <span className="text-white/20">·</span>
                    <span className="text-[#F3F1EC]">{preview.effectLabel}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 text-xs text-[#A3A39E]">
                  <div className="font-mono-tech text-[9.5px] uppercase tracking-wider text-[#8E8E88]">
                    Scientific Study Matcher (PubMed + OpenAlex + DOI)
                  </div>
                  <p className="leading-relaxed">
                    {!selectedState
                      ? 'Select how you feel on the 2D Brain Map (Step 1), then pick where you want to go (Step 2).'
                      : `Current state: ${selectedState.label}. Now choose your target destination in Step 2 above to plot your trajectory and find matching studies.`}
                  </p>
                </div>
              )}

              {stepError && (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200">
                  {stepError}
                </div>
              )}

              <button
                type="button"
                onClick={handleDiscoverStudies}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold transition ${
                  hasBothSteps
                    ? 'btn-aurora'
                    : 'border border-emerald-400/35 bg-emerald-500/12 text-[#F3F1EC] hover:border-emerald-400/60 hover:bg-emerald-500/20'
                }`}
              >
                <Search className="h-4 w-4 shrink-0" />
                <span>Find Scientific Studies &amp; Build Sound</span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Studio Links Footer */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-xs text-[#8E8E88]">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
            {isPro
              ? 'nootropic.fm Pro Active · Unlimited full sessions & all 10 music styles'
              : '5-min free calibration · Share for +30 min free · No signup required · 18+'}
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="mailto:founders@nootropic.fm"
              className="font-mono-tech text-[11px] text-[#A3A39E] transition hover:text-[#34D399]"
            >
              founders@nootropic.fm
            </a>
            <button
              type="button"
              onClick={onStartCustomize}
              className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] transition hover:text-[#34D399]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#34D399]" />
              <span>Full 4-Step Studio Setup</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenStudyLab}
              className="inline-flex items-center gap-1 font-medium text-[#34D399] transition hover:text-emerald-300"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Browse Study Lab Directly</span>
            </button>
          </div>
        </div>
      </section>

      {/* Live Dual-Trace Oscilloscope Demo Strip */}
      <HeroScopeStrip onStart={() => onInstantPlay('focus_lofi')} themeMode={themeMode} />

      {/* 3-Column Instrument Spec Grid */}
      <section className="animate-rise delay-150 grid w-full grid-cols-1 divide-y divide-white/[0.08] rounded-2xl border border-white/10 bg-[#0E0F12] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            01 / Peer-Reviewed Studies First
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Matched From PubMed &amp; DOIs</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Before a single note plays, you inspect the exact peer-reviewed acoustic studies matched
            to shift your brain from your current coordinates to your chosen goal.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            02 / Iso-Principle Calibration
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">36%–94% Effect &amp; Iso-Bridge</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Tired or distracted states launch at Max Effect (94%), while stressed or anxious states
            stabilize for 3 minutes at 10 Hz Alpha before gliding into Focus.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
            03 / 2-Layer Fusion
          </div>
          <h2 className="text-sm font-semibold text-[#F3F1EC]">Science + Your Preferred Music</h2>
          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Swap freely between Lo-Fi, Deep Electronic, Solo Piano, Jazz, Dub Reggae, Acoustic, or
            Soft Rain, and isolate Layer 1 vs Layer 2 anytime on the live oscilloscope.
          </p>
        </div>
      </section>

      {/* B2B Cohort Intelligence Showcase */}
      <CohortIntelligenceShowcase mode="compact" />
    </div>
  );
}
