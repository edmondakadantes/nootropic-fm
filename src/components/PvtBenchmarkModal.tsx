import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Timer, X, Zap } from 'lucide-react';

interface PvtBenchmarkModalProps {
  phase: 'pre' | 'post';
  baselineMs?: number | null;
  onComplete: (result: { medianMs: number; lapses: number; trials: number[] }) => void;
  onClose: () => void;
}

const TOTAL_TRIALS = 5;

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return Math.round(sorted[mid]);
}

/**
 * 15-Second Objective Cognitive Benchmark (Brief Psychomotor Vigilance Task — PVT).
 * Measures real visual-motor reaction time in milliseconds (performance.now()) + attention lapses (>500 ms).
 */
export function PvtBenchmarkModal({
  phase,
  baselineMs,
  onComplete,
  onClose,
}: PvtBenchmarkModalProps) {
  const [stage, setStage] = useState<'ready' | 'waiting' | 'go' | 'false_start' | 'done'>('ready');
  const [trials, setTrials] = useState<number[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const goAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const clearWait = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNextTrial = useCallback(() => {
    clearWait();
    setStage('waiting');
    const delay = 1050 + Math.round(Math.random() * 1450);
    timerRef.current = window.setTimeout(() => {
      goAtRef.current = performance.now();
      setStage('go');
    }, delay);
  }, []);

  useEffect(() => () => clearWait(), []);

  const handleTap = useCallback(() => {
    if (stage === 'ready' || stage === 'false_start') {
      scheduleNextTrial();
      return;
    }
    if (stage === 'waiting') {
      clearWait();
      setStage('false_start');
      return;
    }
    if (stage === 'go') {
      const rt = Math.round(performance.now() - goAtRef.current);
      if (rt < 110) {
        setStage('false_start');
        return;
      }
      setLastMs(rt);
      setTrials((prev) => {
        const next = [...prev, rt];
        if (next.length >= TOTAL_TRIALS) {
          setStage('done');
        } else {
          scheduleNextTrial();
        }
        return next;
      });
    }
  }, [stage, scheduleNextTrial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleTap();
      } else if (e.code === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleTap, onClose]);

  const medianMs = trials.length > 0 ? computeMedian(trials) : 0;
  const lapses = trials.filter((t) => t > 500).length;
  const deltaMs =
    phase === 'post' && typeof baselineMs === 'number' && medianMs > 0
      ? medianMs - baselineMs
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage w-full max-w-md rounded-2xl border border-white/15 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#34D399]">
            <Zap className="h-4 w-4" />
            <h3 className="text-sm font-bold text-[#F3F1EC]">
              15s Objective Brain Benchmark ({phase === 'pre' ? 'Pre-Session' : 'Post-Session'} PVT)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/10 hover:text-[#F3F1EC]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress Dots */}
        <div className="flex items-center justify-between text-[11px] text-[#8E8E88]">
          <span>
            Trial {Math.min(TOTAL_TRIALS, trials.length + (stage === 'done' ? 0 : 1))} / {TOTAL_TRIALS}
          </span>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: TOTAL_TRIALS }).map((_, i) => (
              <span
                key={i}
                className={`h-2 w-6 rounded-full transition ${
                  i < trials.length ? 'bg-[#34D399]' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Interactive Stimulus Target */}
        {stage !== 'done' ? (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              handleTap();
            }}
            className={`flex h-52 w-full select-none flex-col items-center justify-center rounded-2xl border-2 transition-all ${
              stage === 'go'
                ? 'border-emerald-300 bg-emerald-400/25 shadow-[0_0_48px_rgba(52,211,153,0.45)]'
                : stage === 'false_start'
                  ? 'border-amber-400/70 bg-amber-500/15'
                  : stage === 'waiting'
                    ? 'border-white/15 bg-[#0B0C0E]'
                    : 'border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/16'
            }`}
          >
            {stage === 'ready' && (
              <div className="space-y-2 px-4 text-center">
                <Timer className="mx-auto h-9 w-9 text-[#34D399]" />
                <div className="text-base font-bold text-[#F3F1EC]">Tap Anywhere (or Space) to Start</div>
                <p className="text-xs text-[#D4D4CE]">
                  Wait for the box to flash <strong className="text-[#34D399]">GREEN</strong>, then tap as fast as you can (5 quick flashes).
                </p>
              </div>
            )}
            {stage === 'waiting' && (
              <div className="space-y-2 text-center">
                <div className="h-5 w-5 mx-auto rounded-full bg-white/20 animate-pulse" />
                <div className="text-sm font-semibold text-[#D4D4CE]">Hold steady… wait for GREEN</div>
                {lastMs !== null && (
                  <div className="font-mono-tech text-xs text-[#34D399]">Last: {lastMs} ms</div>
                )}
              </div>
            )}
            {stage === 'go' && (
              <div className="space-y-1 text-center">
                <div className="text-3xl font-black tracking-wide text-emerald-200">TAP NOW!</div>
                <div className="text-xs text-emerald-100/80">Click / Tap / Space</div>
              </div>
            )}
            {stage === 'false_start' && (
              <div className="space-y-1.5 px-4 text-center">
                <div className="text-base font-bold text-amber-200">Too early!</div>
                <p className="text-xs text-amber-100/80">Tap to retry this flash. Wait until it turns GREEN.</p>
              </div>
            )}
          </button>
        ) : (
          <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-5 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-9 w-9 text-[#34D399]" />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-emerald-200/80">
                Objective Median Reaction Time
              </div>
              <div className="font-mono-tech mt-1 text-4xl font-bold text-[#F3F1EC]">
                {medianMs} <span className="text-lg text-[#34D399]">ms</span>
              </div>
              <div className="mt-1 font-mono-tech text-xs text-[#D4D4CE]">
                Trials: {trials.map((t) => `${t}ms`).join(' · ')} · Lapses (&gt;500ms): {lapses}
              </div>
            </div>

            {deltaMs !== null && (
              <div
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono-tech text-xs font-bold ${
                  deltaMs < 0
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : deltaMs === 0
                      ? 'border-white/15 bg-[#14161A] text-[#D4D4CE]'
                      : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                }`}
              >
                {deltaMs < 0
                  ? `${Math.abs(deltaMs)} ms FASTER than pre-session (${baselineMs} ms → ${medianMs} ms)`
                  : deltaMs === 0
                    ? `Steady reaction time (${medianMs} ms)`
                    : `+${deltaMs} ms slower (${baselineMs} ms → ${medianMs} ms)`}
              </div>
            )}

            <button
              type="button"
              onClick={() => onComplete({ medianMs, lapses, trials })}
              className="btn-aurora w-full rounded-xl px-5 py-3 text-sm font-bold text-[#0A0B0C]"
            >
              Save Objective Benchmark
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
