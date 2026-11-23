import { useRef, useState } from 'react';
import { Compass, Crosshair, Sparkles } from 'lucide-react';
import {
  NEURAL_MICRO_STATES,
  TARGET_COORDS,
  describeIsoVector,
  findNearbyMicroStates,
  type NeuralCoords,
  type NeuralMicroState,
} from '../../shared/neuralStates';
import type { TargetState } from '../../shared/types';

interface NeuralCompassSelectorProps {
  coords: NeuralCoords | null;
  selectedState: NeuralMicroState | null;
  baselineScore: number;
  onChangeCoords: (next: NeuralCoords) => void;
  onSelectMicroState: (state: NeuralMicroState) => void;
  onChangeBaseline: (score: number) => void;
}

export function NeuralCompassSelector({
  coords,
  selectedState,
  baselineScore,
  onChangeCoords,
  onSelectMicroState,
  onChangeBaseline,
}: NeuralCompassSelectorProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showAllStates, setShowAllStates] = useState(false);

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = (1 - (clientY - rect.top) / rect.height) * 100;
    const clarity = Math.round(Math.max(4, Math.min(96, rawX)));
    const energy = Math.round(Math.max(4, Math.min(96, rawY)));
    onChangeCoords({ energy, clarity });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Allow landmark buttons inside the pad to handle their own click cleanly
    if ((e.target as HTMLElement).closest('button[data-landmark="true"]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromClientPoint(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updateFromClientPoint(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const landmarks = NEURAL_MICRO_STATES.filter((s) => s.landmark);
  const quickStarterStates = NEURAL_MICRO_STATES.filter((s) =>
    ['stressed', 'tired_sluggish', 'brain_fog', 'distracted_scattered', 'anxious_racing', 'calm_balanced'].includes(
      s.id
    )
  );
  const nearbyOther =
    coords && selectedState
      ? findNearbyMicroStates(coords.energy, coords.clarity, 6).filter((s) => s.id !== selectedState.id).slice(0, 4)
      : quickStarterStates;

  const cursorLeft = coords ? `${coords.clarity}%` : '50%';
  const cursorTop = coords ? `${100 - coords.energy}%` : '50%';

  // Dynamic quadrant aura color
  const cursorColor = !coords
    ? '#22d3ee'
    : coords.clarity < 48 && coords.energy >= 55
      ? '#fb7185' // Top-Left: rose/amber tension
      : coords.clarity < 48 && coords.energy < 55
        ? '#818cf8' // Bottom-Left: indigo depleted/fog
        : coords.energy >= 52
          ? '#22d3ee' // Top-Right: cyan activated/clear
          : '#34d399'; // Bottom-Right: emerald calm/grounded

  return (
    <div className="space-y-3">
      {/* Header label */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-mono-tech uppercase tracking-[0.14em] text-cyan-300/90">
          <Compass className="h-3.5 w-3.5" />
          2D Neural State Map · Touch or Drag Anywhere
        </span>
        <span className="text-[10px] text-slate-500">Russell Circumplex (Arousal × Clarity)</span>
      </div>

      {/* Interactive 2D Bioluminescent Radar Field (Spacious & Easy to Tap) */}
      <div
        ref={padRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="application"
        aria-label="Interactive 2D Neural State Compass"
        className="relative h-[400px] w-full touch-none select-none overflow-hidden rounded-2xl border border-slate-700/80 bg-[#040711] cursor-crosshair sm:h-[460px]"
      >
        {/* 4 Subtle Quadrant Ambiance Gradients */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 12% 14%, rgba(251,113,133,0.16), transparent 46%), ' +
              'radial-gradient(circle at 14% 88%, rgba(99,102,241,0.18), transparent 48%), ' +
              'radial-gradient(circle at 88% 14%, rgba(34,211,238,0.16), transparent 46%), ' +
              'radial-gradient(circle at 86% 86%, rgba(52,211,153,0.15), transparent 48%)',
          }}
        />

        {/* Concentric Radar Rings & Axes SVG */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(148,163,184,0.15)" strokeWidth="0.35" strokeDasharray="1.5 1.5" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(148,163,184,0.15)" strokeWidth="0.35" strokeDasharray="1.5 1.5" />
          <circle cx="50" cy="50" r="18" fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="0.3" />
          {/* Live Crosshair projection lines (only once user selects a point!) */}
          {coords && (
            <>
              <line
                x1={coords.clarity}
                y1="0"
                x2={coords.clarity}
                y2="100"
                stroke={cursorColor}
                strokeOpacity="0.24"
                strokeWidth="0.3"
              />
              <line
                x1="0"
                y1={100 - coords.energy}
                x2="100"
                y2={100 - coords.energy}
                stroke={cursorColor}
                strokeOpacity="0.24"
                strokeWidth="0.3"
              />
            </>
          )}
        </svg>

        {/* Biological Axis Edge Labels (kept flush to edges so cursor never collides) */}
        <div className="pointer-events-none absolute left-1/2 top-2 z-0 -translate-x-1/2 rounded-full bg-slate-950/75 px-3 py-0.5 font-mono-tech text-[10px] uppercase tracking-[0.14em] text-slate-300/85">
          ▲ High Energy · Wired
        </div>
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-0 -translate-x-1/2 rounded-full bg-slate-950/75 px-3 py-0.5 font-mono-tech text-[10px] uppercase tracking-[0.14em] text-slate-300/85">
          ▼ Low Energy · Drained
        </div>
        <div className="pointer-events-none absolute left-2 top-1/2 z-0 -translate-y-1/2 rounded bg-slate-950/65 px-2 py-0.5 font-mono-tech text-[9px] uppercase tracking-wider text-slate-400">
          Tense / Fog
        </div>
        <div className="pointer-events-none absolute right-2 top-1/2 z-0 -translate-y-1/2 rounded bg-slate-950/65 px-2 py-0.5 font-mono-tech text-[9px] uppercase tracking-wider text-slate-400">
          Clear / Open
        </div>

        {/* Interactive Landmark Constellation Points */}
        {landmarks.map((st) => {
          const isSelected = selectedState?.id === st.id;
          return (
            <button
              key={st.id}
              type="button"
              data-landmark="true"
              onClick={() => onSelectMicroState(st)}
              style={{
                left: `${st.clarity}%`,
                top: `${100 - st.energy}%`,
              }}
              className="group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 p-2 focus:outline-none"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full transition-all ${
                  isSelected
                    ? 'opacity-0'
                    : 'bg-slate-300/80 group-hover:scale-125 group-hover:bg-cyan-300'
                }`}
              />
              <span
                className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium transition ${
                  isSelected
                    ? 'translate-y-4 bg-slate-950/95 text-white ring-1 ring-white/25'
                    : 'text-slate-300/90 group-hover:bg-slate-950/90 group-hover:text-cyan-200'
                }`}
              >
                {st.shortLabel}
              </span>
            </button>
          );
        })}

        {/* Active Draggable Bioluminescent Orb (only shown after user taps/drags!) */}
        {coords ? (
          <div
            style={{
              left: cursorLeft,
              top: cursorTop,
              transition: dragging ? 'none' : 'left 220ms ease-out, top 220ms ease-out',
            }}
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
          >
            <span
              className="absolute -inset-4 rounded-full opacity-35 blur-md"
              style={{ backgroundColor: cursorColor }}
            />
            <span
              className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-lg"
              style={{
                backgroundColor: cursorColor,
                boxShadow: `0 0 22px ${cursorColor}`,
              }}
            >
              <Crosshair className="h-3.5 w-3.5 text-slate-950" />
            </span>
          </div>
        ) : (
          <div className="pointer-events-none absolute left-1/2 top-9 z-10 -translate-x-1/2 rounded-full border border-cyan-400/35 bg-slate-950/85 px-3.5 py-1 text-[11px] font-medium text-cyan-200/95 backdrop-blur-sm">
            Tap or drag anywhere on the map
          </div>
        )}
      </div>

      {/* Live Neural Readout Card + Nearby Nuanced Micro-States */}
      <div className="rounded-2xl border border-cyan-400/25 bg-slate-950/75 p-3.5 space-y-3">
        {selectedState && coords ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: cursorColor, boxShadow: `0 0 10px ${cursorColor}` }}
                  />
                  <span className="text-sm font-bold text-white">{selectedState.label}</span>
                </div>
                <div className="font-mono-tech text-[10px] text-slate-400">
                  Energy <span className="text-cyan-300">{coords.energy}%</span> · Clarity{' '}
                  <span className="text-indigo-300">{coords.clarity}%</span>
                </div>
              </div>

              {/* Compact Auto-Calibrated Baseline 1-5 (editable with 1 tap) */}
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[10px] text-slate-400">Baseline:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChangeBaseline(n)}
                    className={`h-7 w-7 rounded-lg border font-mono-tech text-[11px] font-bold transition ${
                      baselineScore === n
                        ? 'border-cyan-400 bg-cyan-400/20 text-white'
                        : 'border-slate-800 bg-slate-900/70 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Subtle DSP preview for this exact state */}
            <p className="text-[11px] leading-relaxed text-cyan-200/85">
              <Sparkles className="mr-1 inline h-3 w-3 text-cyan-300" />
              {selectedState.dspNote}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-white">No state selected yet</div>
              <div className="text-[11px] text-slate-400">
                Tap any point on the 2D map above, describe how you feel, or choose a state below.
              </div>
            </div>
          </div>
        )}

        {/* Quick / Nearby Micro-States + 1-Tap Expand All 19 States */}
        <div className="space-y-1.5 border-t border-slate-800/80 pt-2.5">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="font-medium text-slate-500">
              {showAllStates
                ? `All ${NEURAL_MICRO_STATES.length} neural states (tap any):`
                : selectedState
                  ? 'Or refine to a nearby nuance:'
                  : 'Quick states (tap to select):'}
            </span>
            <button
              type="button"
              onClick={() => setShowAllStates((v) => !v)}
              className="font-medium text-cyan-300 hover:text-cyan-200"
            >
              {showAllStates
                ? selectedState
                  ? 'Show nearby only'
                  : 'Show quick states'
                : `Browse all ${NEURAL_MICRO_STATES.length} states`}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(showAllStates ? NEURAL_MICRO_STATES : nearbyOther).map((st) => {
              const active = selectedState?.id === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectMicroState(st)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? 'border-cyan-400/80 bg-cyan-400/18 text-white'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface NeuralTrajectoryPreviewProps {
  fromCoords: NeuralCoords;
  fromLabel: string;
  targetState: TargetState;
  durationMin: number;
}

/**
 * Compact Beat 3 Iso-Principle Vector Map visualizing the live trajectory
 * from the listener's current 2D state coordinate -> chosen target state coordinate.
 */
export function NeuralTrajectoryPreview({
  fromCoords,
  fromLabel,
  targetState,
  durationMin,
}: NeuralTrajectoryPreviewProps) {
  const dest = TARGET_COORDS[targetState];
  const x1 = fromCoords.clarity;
  const y1 = 100 - fromCoords.energy;
  const x2 = dest.clarity;
  const y2 = 100 - dest.energy;
  // Gentle quadratic arc midpoint
  const mx = (x1 + x2) / 2;
  const my = Math.max(8, Math.min(92, (y1 + y2) / 2 - 10));

  return (
    <div className="rounded-2xl border border-cyan-400/25 bg-[#050814]/90 p-3.5 space-y-2">
      <div className="flex items-center justify-between font-mono-tech text-[10px] text-slate-400">
        <span className="uppercase tracking-[0.14em] text-cyan-300">
          Neural Trajectory Vector (Iso-Principle)
        </span>
        <span>
          ({fromCoords.energy}%, {fromCoords.clarity}%) → ({dest.energy}%, {dest.clarity}%)
        </span>
      </div>

      <div className="relative h-28 w-full overflow-hidden rounded-xl border border-slate-800/80 bg-[#03060e]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="nfmVectorGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(148,163,184,0.12)" strokeWidth="0.4" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(148,163,184,0.12)" strokeWidth="0.4" />
          <path
            d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
            fill="none"
            stroke="url(#nfmVectorGrad)"
            strokeWidth="1.2"
            strokeDasharray="2.5 1.8"
          />
        </svg>

        {/* Start Point */}
        <div
          style={{ left: `${x1}%`, top: `${y1}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1"
        >
          <span className="h-3 w-3 rounded-full border border-white bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.9)]" />
          <span className="whitespace-nowrap rounded bg-slate-950/90 px-1.5 py-0.5 text-[9px] font-medium text-indigo-200">
            Now: {fromLabel}
          </span>
        </div>

        {/* Target Destination */}
        <div
          style={{ left: `${x2}%`, top: `${y2}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1"
        >
          <span className="h-3.5 w-3.5 rounded-full border-2 border-white bg-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.95)] animate-pulse" />
          <span className="whitespace-nowrap rounded bg-slate-950/90 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">
            Goal: {dest.label}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-300">
        {describeIsoVector(fromCoords, targetState, durationMin)}
      </p>
    </div>
  );
}
