import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Timer, X, Zap } from 'lucide-react';
import { computePvtMetrics } from '../../shared/psychometrics';

export interface PvtResultPayload {
  medianMs: number;
  meanInvRt: number;
  lapses: number;
  trialCount: number;
  refreshHz: number;
  decileSpreadMs: number;
  trials: number[];
}

interface PvtBenchmarkModalProps {
  phase: 'pre' | 'post';
  baselineMs?: number | null;
  baselineInvRt?: number | null;
  onComplete: (result: PvtResultPayload) => void;
  onClose: () => void;
}

/**
 * 20-Trial (~75s) Visual-Only 1/RT Psychomotor Vigilance Task (with 60-Trial Lab Benchmark option).
 * Strictly frame-synchronized via requestAnimationFrame + performance.now() with 1.5–4.0 s randomized ISIs,
 * eliminating audio/Bluetooth codec latency bias and suppressing Ex-Gaussian right-tail noise via 1/RT scoring.
 */
export function PvtBenchmarkModal({
  phase,
  baselineMs,
  baselineInvRt,
  onComplete,
  onClose,
}: PvtBenchmarkModalProps) {
  const [totalTrials, setTotalTrials] = useState<20 | 60>(20);
  const [stage, setStage] = useState<'ready' | 'waiting' | 'go' | 'false_start' | 'done'>('ready');
  const [trials, setTrials] = useState<number[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [refreshHz, setRefreshHz] = useState<number>(60);
  const goAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const totalTrialsRef = useRef(totalTrials);
  totalTrialsRef.current = totalTrials;

  const clearPendingTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Measure actual display refresh rate over 10 rAF ticks cleanly on mount
  useEffect(() => {
    let active = true;
    const deltas: number[] = [];
    let prevTs = 0;
    let frameId = 0;
    const step = (ts: number) => {
      if (!active) return;
      if (prevTs > 0) {
        const dt = ts - prevTs;
        if (dt >= 2 && dt <= 45) deltas.push(dt);
      }
      prevTs = ts;
      if (deltas.length < 10) {
        frameId = window.requestAnimationFrame(step);
      } else {
        deltas.sort((a, b) => a - b);
        const medianDt = deltas[Math.floor(deltas.length / 2)];
        const estHz = Math.max(30, Math.min(360, Math.round(1000 / medianDt)));
        setRefreshHz(estHz);
      }
    };
    frameId = window.requestAnimationFrame(step);
    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => () => clearPendingTimers(), [clearPendingTimers]);

  const scheduleNextTrial = useCallback(() => {
    clearPendingTimers();
    setStage('waiting');
    // Validated randomized ISI: 1500 ms to 4000 ms
    const delayMs = 1500 + Math.round(Math.random() * 2500);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        goAtRef.current = performance.now();
        setStage('go');
      });
    }, delayMs);
  }, [clearPendingTimers]);

  const handleTap = useCallback(() => {
    if (stage === 'ready' || stage === 'false_start') {
      scheduleNextTrial();
      return;
    }
    if (stage === 'waiting') {
      clearPendingTimers();
      setStage('false_start');
      return;
    }
    if (stage === 'go') {
      const rt = Math.round(performance.now() - goAtRef.current);
      // Reject anticipations < 100 ms strictly (never ingest into 1/RT average)
      if (rt < 100) {
        setStage('false_start');
        return;
      }
      setLastMs(rt);
      setTrials((prev) => {
        const next = [...prev, rt];
        if (next.length >= totalTrialsRef.current) {
          setStage('done');
        } else {
          scheduleNextTrial();
        }
        return next;
      });
    }
  }, [stage, scheduleNextTrial, clearPendingTimers]);

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

  const metrics = computePvtMetrics(trials);
  const deltaInvRt =
    phase === 'post' && typeof baselineInvRt === 'number' && metrics.meanInvRt > 0
      ? Number((metrics.meanInvRt - baselineInvRt).toFixed(3))
      : null;
  const deltaMs =
    phase === 'post' && typeof baselineMs === 'number' && metrics.medianMs > 0
      ? metrics.medianMs - baselineMs
      : null;

  const progressPct = Math.min(100, Math.round((trials.length / totalTrials) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage my-auto w-full max-w-md rounded-2xl border border-white/15 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#34D399]">
            <Zap className="h-4 w-4" />
            <h3 className="text-sm font-bold text-[#F3F1EC]">
              Visual 1/RT Vigilance Check ({phase === 'pre' ? 'Pre-Session' : 'Post-Session'})
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

        {/* Mode Switcher before starting (Standard 20-trial ~75s vs Lab 60-trial ~3m) */}
        {stage === 'ready' && trials.length === 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B0C0E] p-1.5">
            {([
              { count: 20 as const, label: 'Standard (20 trials · ~75s)' },
              { count: 60 as const, label: 'Lab (60 trials · ~3m)' },
            ]).map((opt) => (
              <button
                key={opt.count}
                type="button"
                onClick={() => setTotalTrials(opt.count)}
                className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  totalTrials === opt.count
                    ? 'bg-[#22252A] text-[#34D399] ring-1 ring-emerald-400/30'
                    : 'text-[#8E8E88] hover:text-[#D4D4CE]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Progress Rail + Refresh Rate Badge */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono-tech text-[11px] text-[#8E8E88]">
            <span>
              Trial {Math.min(totalTrials, trials.length + (stage === 'done' ? 0 : 1))} / {totalTrials}
            </span>
            <span>Visual rAF · {refreshHz} Hz</span>
          </div>
          {totalTrials <= 20 ? (
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(20, minmax(0, 1fr))' }}>
              {Array.from({ length: 20 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition ${
                    i < trials.length ? 'bg-[#34D399]' : 'bg-white/10'
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#34D399] transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>

        {/* Interactive Visual Stimulus Target */}
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
                  Wait for the visual flash <strong className="text-[#34D399]">GREEN</strong>, then tap cleanly ({totalTrials} visual trials · 1.5–4s ISIs).
                </p>
              </div>
            )}
            {stage === 'waiting' && (
              <div className="space-y-2 text-center">
                <div className="h-5 w-5 mx-auto rounded-full bg-white/20 animate-pulse" />
                <div className="text-sm font-semibold text-[#D4D4CE]">Hold steady… wait for GREEN</div>
                {lastMs !== null && (
                  <div className="font-mono-tech text-xs text-[#34D399]">
                    Last: {lastMs} ms ({(1000 / lastMs).toFixed(2)} s⁻¹)
                  </div>
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
                <div className="text-base font-bold text-amber-200">Too early (&lt; 100 ms)!</div>
                <p className="text-xs text-amber-100/80">Tap to retry this trial. Wait until GREEN appears.</p>
              </div>
            )}
          </button>
        ) : (
          <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-5 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-9 w-9 text-[#34D399]" />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-emerald-200/80">
                Mean Inverse Speed (1/RT) · {metrics.trialCount} Visual Trials
              </div>
              <div className="font-mono-tech mt-1 text-4xl font-bold text-[#F3F1EC]">
                {metrics.meanInvRt.toFixed(2)} <span className="text-lg text-[#34D399]">s⁻¹</span>
              </div>
              <div className="mt-1 font-mono-tech text-xs text-[#D4D4CE]">
                Median: {metrics.medianMs} ms · 10% Spread: {metrics.fastest10PctMs}–{metrics.slowest10PctMs} ms · Lapses (&gt;500ms): {metrics.lapses}
              </div>
            </div>

            {(deltaInvRt !== null || deltaMs !== null) && (
              <div
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono-tech text-xs font-bold ${
                  (deltaInvRt ?? -(deltaMs ?? 0)) > 0
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : deltaInvRt === 0
                      ? 'border-white/15 bg-[#14161A] text-[#D4D4CE]'
                      : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                }`}
              >
                {deltaInvRt !== null
                  ? `${deltaInvRt >= 0 ? '+' : ''}${deltaInvRt.toFixed(2)} s⁻¹ speed shift${deltaMs !== null ? ` (${deltaMs < 0 ? `${Math.abs(deltaMs)}ms faster` : `+${deltaMs}ms`})` : ''}`
                  : deltaMs !== null && deltaMs < 0
                    ? `${Math.abs(deltaMs)} ms FASTER than pre-session`
                    : `Steady (${metrics.medianMs} ms)`}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                onComplete({
                  medianMs: metrics.medianMs,
                  meanInvRt: metrics.meanInvRt,
                  lapses: metrics.lapses,
                  trialCount: metrics.trialCount,
                  refreshHz,
                  decileSpreadMs: metrics.decileSpreadMs,
                  trials,
                })
              }
              className="btn-aurora w-full rounded-xl px-5 py-3 text-sm font-bold text-[#0A0B0C]"
            >
              Save {metrics.trialCount}-Trial 1/RT Benchmark
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
