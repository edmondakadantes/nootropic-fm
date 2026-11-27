import {
  Activity,
  Maximize2,
  Pause,
  Play,
  Square,
} from 'lucide-react';

interface MiniPlayerBarProps {
  title: string;
  genreLabel: string;
  modulationHz: number;
  elapsedSec: number;
  plannedDurationMin: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onExpand: () => void;
  onEndSession: () => void;
}

function formatCompactTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MiniPlayerBar({
  title,
  genreLabel,
  modulationHz,
  elapsedSec,
  plannedDurationMin,
  isPlaying,
  onTogglePlay,
  onExpand,
  onEndSession,
}: MiniPlayerBarProps) {
  return (
    <div
      data-testid="mini-player-bar"
      role="region"
      aria-label="Active Audio Session Mini Player"
      className="glass-stage fixed inset-x-3 bottom-[66px] z-30 mx-auto max-w-2xl rounded-2xl border border-emerald-400/45 bg-[#101114] px-3 py-2 shadow-2xl backdrop-blur-xl lg:bottom-4 lg:left-[248px] lg:right-6"
    >
      <div className="flex items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Return to full player"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/12 text-[#34D399]">
            <Activity className={`h-4 w-4 ${isPlaying ? 'animate-pulse' : ''}`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-[#F3F1EC]">
              <span className="truncate">{title}</span>
              {modulationHz > 0 && (
                <span className="shrink-0 rounded border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 font-mono-tech text-[9.5px] font-bold text-[#34D399]">
                  {modulationHz} Hz
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 truncate font-mono-tech text-[10.5px] text-[#A3A39E]">
              <span className="truncate">{genreLabel}</span>
              <span>·</span>
              <span className="shrink-0 text-[#34D399]">
                {formatCompactTimer(elapsedSec)} / {plannedDurationMin}:00
              </span>
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause mini player' : 'Play mini player'}
            className="btn-aurora inline-flex h-10 w-10 items-center justify-center rounded-full text-[#0A0B0C]"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 fill-[#0A0B0C]" />
            ) : (
              <Play className="h-4 w-4 translate-x-0.5 fill-[#0A0B0C]" />
            )}
          </button>
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand player"
            title="Expand Zen Focus Player"
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-white/15 bg-[#16181C] px-2.5 text-xs font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50"
          >
            <Maximize2 className="h-3.5 w-3.5 text-[#34D399]" />
            <span className="hidden sm:inline">Expand</span>
          </button>
          <button
            type="button"
            onClick={onEndSession}
            aria-label="End minimized session"
            title="End session & open debrief"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-500/35 bg-rose-500/12 text-rose-200 transition hover:bg-rose-500/20"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
