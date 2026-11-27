import { useRef, useState } from 'react';
import { Compass, Crosshair } from 'lucide-react';
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
  themeMode?: 'daylight' | 'night';
  onChangeCoords: (next: NeuralCoords) => void;
  onSelectMicroState: (state: NeuralMicroState) => void;
  onChangeBaseline: (score: number) => void;
}

export function NeuralCompassSelector({
  coords,
  selectedState,
  baselineScore,
  themeMode = 'night',
  onChangeCoords,
  onSelectMicroState,
  onChangeBaseline,
}: NeuralCompassSelectorProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showAllStates, setShowAllStates] = useState(true);

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

  const isDay = themeMode === 'daylight';
  // Dynamic studio crosshair accent (Cobalt Blue for stressed/high-tension quadrant in Daylight / Amber in Night, Emerald otherwise)
  const cursorColor = !coords
    ? isDay
      ? '#047857'
      : '#34D399'
    : coords.clarity < 48 && coords.energy >= 55
      ? isDay
        ? '#1D4ED8'
        : '#F59E0B'
      : isDay
        ? '#047857'
        : '#34D399';

  return (
    <div className="space-y-3">
      {/* Header label */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-mono-tech uppercase tracking-[0.14em] text-[#34D399]">
          <Compass className="h-3.5 w-3.5" />
          2D Neural State Map · Touch or Drag Anywhere
        </span>
        <span className="text-[10px] text-[#7E7E78]">Russell Circumplex (Arousal × Clarity)</span>
      </div>

      {/* Interactive 2D Studio Vector Grid */}
      <div
        ref={padRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="application"
        aria-label="Interactive 2D Neural State Compass"
        className="relative h-[400px] w-full touch-none select-none overflow-hidden rounded-xl border border-white/12 bg-[#08090B] cursor-crosshair sm:h-[460px]"
      >
        {/* Subtle studio X-Y Grid & Concentric Rings */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <line x1="25" y1="0" x2="25" y2="100" className="studio-grid-faint" strokeWidth="0.25" />
          <line x1="75" y1="0" x2="75" y2="100" className="studio-grid-faint" strokeWidth="0.25" />
          <line x1="0" y1="25" x2="100" y2="25" className="studio-grid-faint" strokeWidth="0.25" />
          <line x1="0" y1="75" x2="100" y2="75" className="studio-grid-faint" strokeWidth="0.25" />
          <line x1="50" y1="0" x2="50" y2="100" className="studio-grid-strong" strokeWidth="0.35" strokeDasharray="1.5 1.5" />
          <line x1="0" y1="50" x2="100" y2="50" className="studio-grid-strong" strokeWidth="0.35" strokeDasharray="1.5 1.5" />
          <circle cx="50" cy="50" r="18" fill="none" className="studio-grid-strong" strokeWidth="0.3" />
          <circle cx="50" cy="50" r="36" fill="none" className="studio-grid-faint" strokeWidth="0.3" />
          {/* Live Crosshair projection lines */}
          {coords && (
            <>
              <line
                x1={coords.clarity}
                y1="0"
                x2={coords.clarity}
                y2="100"
                stroke={cursorColor}
                strokeOpacity="0.32"
                strokeWidth="0.35"
              />
              <line
                x1="0"
                y1={100 - coords.energy}
                x2="100"
                y2={100 - coords.energy}
                stroke={cursorColor}
                strokeOpacity="0.32"
                strokeWidth="0.35"
              />
            </>
          )}
        </svg>

        {/* Biological Axis Edge Labels */}
        <div className="pointer-events-none absolute left-1/2 top-2 z-0 -translate-x-1/2 rounded bg-[#0F1013]/90 px-2.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#A3A39E]">
          ▲ High Energy · Wired
        </div>
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-0 -translate-x-1/2 rounded bg-[#0F1013]/90 px-2.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#A3A39E]">
          ▼ Low Energy · Drained
        </div>
        <div className="pointer-events-none absolute left-2 top-1/2 z-0 -translate-y-1/2 rounded bg-[#0F1013]/85 px-2 py-0.5 font-mono-tech text-[9px] uppercase tracking-wider text-[#7E7E78]">
          Tense / Fog
        </div>
        <div className="pointer-events-none absolute right-2 top-1/2 z-0 -translate-y-1/2 rounded bg-[#0F1013]/85 px-2 py-0.5 font-mono-tech text-[9px] uppercase tracking-wider text-[#7E7E78]">
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
                className={`h-2 w-2 rounded-full transition-all ${
                  isSelected
                    ? 'opacity-0'
                    : 'bg-[#8E8E88] group-hover:scale-125 group-hover:bg-[#34D399]'
                }`}
              />
              <span
                className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium transition ${
                  isSelected
                    ? 'translate-y-4 bg-[#141518] text-[#F3F1EC] ring-1 ring-white/25'
                    : 'text-[#A3A39E] group-hover:bg-[#141518] group-hover:text-[#F3F1EC]'
                }`}
              >
                {st.shortLabel}
              </span>
            </button>
          );
        })}

        {/* Active Draggable Crosshair */}
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
              className={`relative flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                isDay ? 'border-white shadow-md' : 'border-[#F3F1EC]'
              }`}
              style={{ backgroundColor: cursorColor }}
            >
              <Crosshair className={`h-3.5 w-3.5 ${isDay ? 'text-white' : 'text-[#0A0B0C]'}`} />
            </span>
          </div>
        ) : (
          <div className="pointer-events-none absolute left-1/2 top-9 z-10 -translate-x-1/2 rounded-md border border-white/15 bg-[#121417]/95 px-3 py-1 text-[11px] font-medium text-[#D4D4CE]">
            Tap or drag anywhere on the map
          </div>
        )}
      </div>

      {/* Live Neural Readout Card + Nearby Nuanced Micro-States */}
      <div className="rounded-xl border border-white/10 bg-[#0D0E10] p-3.5 space-y-3">
        {selectedState && coords ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: cursorColor }}
                  />
                  <span className="text-sm font-semibold text-[#F3F1EC]">{selectedState.label}</span>
                </div>
                <div className="font-mono-tech text-[10px] text-[#8E8E88]">
                  Energy <span className="text-[#34D399]">{coords.energy}%</span> · Clarity{' '}
                  <span className="text-[#F3F1EC]">{coords.clarity}%</span>
                </div>
              </div>

              {/* Compact Auto-Calibrated Baseline 1-5 */}
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[10px] text-[#8E8E88]">Baseline:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChangeBaseline(n)}
                    className={`h-7 w-7 rounded-lg border font-mono-tech text-[11px] font-bold transition ${
                      baselineScore === n
                        ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                        : 'border-white/[0.08] bg-[#141518] text-[#8E8E88] hover:border-white/25 hover:text-[#D4D4CE]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Subtle DSP preview */}
            <p className="font-mono-tech text-[11px] leading-relaxed text-[#A3A39E]">
              {selectedState.dspNote}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-[#F3F1EC]">No state selected yet</div>
              <div className="text-[11px] text-[#8E8E88]">
                Tap any point on the 2D map above, describe how you feel, or choose a state below.
              </div>
            </div>
          </div>
        )}

        {/* Quick / Nearby Micro-States + Expand All 19 States */}
        <div className="space-y-1.5 border-t border-white/[0.08] pt-2.5">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="font-medium text-[#7E7E78]">
              {showAllStates
                ? `All ${NEURAL_MICRO_STATES.length} neural states (tap any):`
                : selectedState
                  ? 'Or refine to a nearby nuance:'
                  : 'Quick states (tap to select):'}
            </span>
            <button
              type="button"
              onClick={() => setShowAllStates((v) => !v)}
              className="font-medium text-[#34D399] hover:text-emerald-300"
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
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                      : 'border-white/[0.08] bg-[#141518] text-[#A3A39E] hover:border-white/25 hover:text-[#F3F1EC]'
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
  targetState: TargetState | null;
  customDestCoords?: NeuralCoords | null;
  customDestLabel?: string | null;
  durationMin: number;
  effectTierLabel?: string | null;
  isoBridgeLabel?: string | null;
  themeMode?: 'daylight' | 'night';
}

/**
 * Compact Beat 3 Iso-Principle Vector Map visualizing the live trajectory
 * from the listener's current 2D state coordinate -> chosen target state coordinate.
 * Draws the trajectory bar ONLY after the listener explicitly picks or types their target state.
 */
export function NeuralTrajectoryPreview({
  fromCoords,
  fromLabel,
  targetState,
  customDestCoords = null,
  customDestLabel = null,
  durationMin,
  effectTierLabel = null,
  isoBridgeLabel = null,
  themeMode = 'night',
}: NeuralTrajectoryPreviewProps) {
  const isDay = themeMode === 'daylight';
  const baseDest = targetState ? TARGET_COORDS[targetState] : null;
  const dest =
    customDestCoords && customDestLabel
      ? { energy: customDestCoords.energy, clarity: customDestCoords.clarity, label: customDestLabel }
      : baseDest;
  const x1 = fromCoords.clarity;
  const y1 = 100 - fromCoords.energy;
  const x2 = dest ? dest.clarity : x1;
  const y2 = dest ? 100 - dest.energy : y1;
  const hasIsoWaypoint = Boolean(dest && isoBridgeLabel);
  const mx = hasIsoWaypoint ? 74 : (x1 + x2) / 2;
  const my = hasIsoWaypoint ? 60 : Math.max(8, Math.min(92, (y1 + y2) / 2 - 10));

  return (
    <div className="rounded-xl border border-white/12 bg-[#0B0C0E] p-3.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px] text-[#8E8E88]">
        <span className="uppercase tracking-[0.14em] text-[#34D399]">
          State Vector (Iso-Principle)
        </span>
        <span>
          {dest
            ? `(${fromCoords.energy}%, ${fromCoords.clarity}%) → (${dest.energy}%, ${dest.clarity}%)`
            : `Start: (${fromCoords.energy}% Energy, ${fromCoords.clarity}% Clarity)`}
        </span>
      </div>

      <div className="relative h-28 w-full overflow-hidden rounded-lg border border-white/[0.08] bg-[#08090B]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="nfmVectorGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={isDay ? '#475569' : '#A3A39E'} />
              <stop offset="100%" stopColor={isDay ? '#047857' : '#34D399'} />
            </linearGradient>
          </defs>
          <line x1="50" y1="0" x2="50" y2="100" className="studio-grid-strong" strokeWidth="0.4" />
          <line x1="0" y1="50" x2="100" y2="50" className="studio-grid-strong" strokeWidth="0.4" />
          {dest && (
            <>
              <path
                d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                fill="none"
                stroke="url(#nfmVectorGrad)"
                strokeWidth="1.2"
                strokeDasharray="2.5 1.8"
              />
              {hasIsoWaypoint && (
                <circle
                  cx={mx}
                  cy={my}
                  r="1.6"
                  fill={isDay ? '#1D4ED8' : '#FBBF24'}
                  stroke={isDay ? '#FFFFFF' : '#0A0B0C'}
                  strokeWidth="0.45"
                />
              )}
            </>
          )}
        </svg>

        {/* Start Point */}
        <div
          style={{ left: `${x1}%`, top: `${y1}%` }}
          className={`absolute -translate-y-1/2 flex items-center gap-1 ${
            x1 > 60 ? '-translate-x-[calc(100%-6px)] flex-row-reverse' : '-translate-x-1.5'
          }`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[#F3F1EC] bg-[#A3A39E]" />
          <span className="whitespace-nowrap rounded bg-[#121316]/95 px-1.5 py-0.5 text-[9px] font-medium text-[#D4D4CE]">
            Now: {fromLabel}
          </span>
        </div>

        {/* Target Destination ONLY after user chooses where to go */}
        {dest ? (
          <div
            style={{ left: `${x2}%`, top: `${y2}%` }}
            className={`absolute -translate-y-1/2 flex items-center gap-1 ${
              x2 > 58 ? '-translate-x-[calc(100%-6px)] flex-row-reverse' : '-translate-x-1.5'
            }`}
          >
            <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[#F3F1EC] bg-[#34D399]" />
            <span className="whitespace-nowrap rounded bg-[#121316]/95 px-1.5 py-0.5 text-[9px] font-semibold text-[#34D399]">
              Goal: {dest.label}
            </span>
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-white/12 bg-[#121417]/95 px-2.5 py-0.5 text-[10px] text-[#A3A39E]">
            Choose your target state below to draw trajectory
          </div>
        )}
      </div>

      {dest && targetState ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-[#A3A39E]">
            {describeIsoVector(fromCoords, targetState, durationMin)}
          </p>
          {(effectTierLabel || isoBridgeLabel) && (
            <div className="flex flex-wrap items-center gap-1.5 font-mono-tech text-[10px]">
              {effectTierLabel && (
                <span className="rounded border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[#34D399]">
                  {effectTierLabel}
                </span>
              )}
              {isoBridgeLabel && (
                <span className="rounded border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                  {isoBridgeLabel}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[#8E8E88]">
          Select where you want your mind to go next so we can plot your Iso-Principle curve and
          search matching peer-reviewed studies.
        </p>
      )}
    </div>
  );
}
