import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, RotateCcw, X } from 'lucide-react';
import {
  scoreContinuationTapping,
  type TappingBiomarkerResult,
} from '../../shared/psychometrics';

interface TappingTestModalProps {
  targetBpm?: number;
  onComplete: (result: TappingBiomarkerResult) => void;
  onClose: () => void;
}

const PACING_MS = 5000;
const CONTINUATION_MS = 10000;
const TOTAL_MS = PACING_MS + CONTINUATION_MS;

/**
 * 15-Second Synchronization-Continuation Motor Tapping Biomarker (v7.1):
 *   - Phase 1 (0–5s): Audio + visual metronome beat at target BPM (default 100 BPM = 600 ms ITI)
 *   - Phase 2 (5–15s): Metronome fades out; listener continues steady tapping from memory
 * Computes clean inter-tap interval Coefficient of Variation (CV%) & stability score.
 */
export function TappingTestModal({ targetBpm = 100, onComplete, onClose }: TappingTestModalProps) {
  const bpm = targetBpm > 45 && targetBpm < 180 ? Math.round(targetBpm) : 100;
  const beatMs = 60000 / bpm;

  const [phase, setPhase] = useState<'intro' | 'running' | 'result'>('intro');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tapCount, setTapCount] = useState(0);
  const [beatFlash, setBeatFlash] = useState(false);
  const [tapPulse, setTapPulse] = useState(false);
  const [result, setResult] = useState<TappingBiomarkerResult | null>(null);

  const continuationTapsRef = useRef<number[]>([]);
  const pacingTapsRef = useRef<number[]>([]);
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastBeatIdxRef = useRef(-1);
  const clickCtxRef = useRef<AudioContext | null>(null);
  const beatFlashTimerRef = useRef<number | null>(null);
  const tapPulseTimerRef = useRef<number | null>(null);

  const playSoftTick = () => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!clickCtxRef.current || clickCtxRef.current.state === 'closed') {
        clickCtxRef.current = new Ctx();
      }
      const ctx = clickCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.08, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.065);
    } catch {
      // visual pacing continues cleanly if audio cue blocked
    }
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (beatFlashTimerRef.current !== null) window.clearTimeout(beatFlashTimerRef.current);
      if (tapPulseTimerRef.current !== null) window.clearTimeout(tapPulseTimerRef.current);
      try {
        void clickCtxRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  const finishRun = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const primary = scoreContinuationTapping(continuationTapsRef.current, bpm);
    const fallbackAll =
      primary ??
      scoreContinuationTapping(
        [...pacingTapsRef.current, ...continuationTapsRef.current],
        bpm
      );
    setResult(fallbackAll);
    setPhase('result');
    if (fallbackAll) {
      onComplete(fallbackAll);
    }
  };

  const startTest = () => {
    continuationTapsRef.current = [];
    pacingTapsRef.current = [];
    lastBeatIdxRef.current = -1;
    startTimeRef.current = performance.now();
    setTapCount(0);
    setElapsedMs(0);
    setResult(null);
    setPhase('running');

    const loop = (now: number) => {
      const elapsed = now - startTimeRef.current;
      setElapsedMs(Math.min(TOTAL_MS, elapsed));
      if (elapsed < PACING_MS) {
        const beatIdx = Math.floor(elapsed / beatMs);
        if (beatIdx !== lastBeatIdxRef.current) {
          lastBeatIdxRef.current = beatIdx;
          playSoftTick();
          setBeatFlash(true);
          if (beatFlashTimerRef.current !== null) window.clearTimeout(beatFlashTimerRef.current);
          beatFlashTimerRef.current = window.setTimeout(() => {
            beatFlashTimerRef.current = null;
            setBeatFlash(false);
          }, 110);
        }
      }
      if (elapsed >= TOTAL_MS) {
        finishRun();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const recordTap = () => {
    if (phase !== 'running') return;
    const now = performance.now();
    const elapsed = now - startTimeRef.current;
    if (elapsed < PACING_MS) {
      pacingTapsRef.current.push(now);
    } else {
      continuationTapsRef.current.push(now);
      setTapCount(continuationTapsRef.current.length);
    }
    setTapPulse(true);
    if (tapPulseTimerRef.current !== null) window.clearTimeout(tapPulseTimerRef.current);
    tapPulseTimerRef.current = window.setTimeout(() => {
      tapPulseTimerRef.current = null;
      setTapPulse(false);
    }, 90);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        onClose();
        return;
      }
      if (phase === 'running' && e.code === 'Space') {
        e.preventDefault();
        recordTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const inContinuation = elapsedMs >= PACING_MS;
  const remainingSec = Math.max(0, Math.ceil((TOTAL_MS - elapsedMs) / 1000));
  const progressPct = Math.min(100, Math.round((elapsedMs / TOTAL_MS) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div className="glass-stage my-auto w-full max-w-md rounded-2xl border border-white/15 p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
              <Activity className="h-3.5 w-3.5" />
              15s Sensorimotor Tapping CV
            </div>
            <h3 className="font-display text-lg font-semibold text-[#F3F1EC]">
              Intrinsic Motor Rhythm Check
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-[#14161A] p-1.5 text-[#8E8E88] hover:text-[#F3F1EC]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === 'intro' && (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-[#A3A39E]">
              Synchronize your taps to a gentle <strong className="text-[#F3F1EC]">{bpm} BPM</strong> pulse
              for <strong className="text-[#F3F1EC]">5 seconds</strong>, then keep the exact same tempo silently
              for <strong className="text-[#F3F1EC]">10 seconds</strong> after the guide stops. Measures
              inter-tap stability (<code className="text-[#34D399]">CV%</code>) linked to attentional steadiness.
            </p>
            <button
              type="button"
              onClick={startTest}
              className="btn-aurora w-full rounded-xl py-2.5 text-sm font-semibold text-[#0A0B0C]"
            >
              Start 15s Tapping Check
            </button>
          </div>
        )}

        {phase === 'running' && (
          <div className="space-y-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#34D399] transition-all duration-100"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between font-mono-tech text-xs">
              <span className={inContinuation ? 'text-[#34D399] font-semibold' : 'text-amber-300 font-semibold'}>
                {inContinuation ? 'Keep Tapping (Silent Continuation)' : `Sync to Pulse (${bpm} BPM)`}
              </span>
              <span className="text-[#8E8E88]">{remainingSec}s left</span>
            </div>

            <button
              type="button"
              onPointerDown={() => recordTap()}
              className={`flex h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border transition-all select-none ${
                tapPulse
                  ? 'scale-[0.98] border-emerald-400 bg-emerald-500/25 text-[#F3F1EC]'
                  : beatFlash && !inContinuation
                    ? 'border-amber-400/70 bg-amber-400/15 text-amber-100'
                    : 'border-white/15 bg-[#121417] text-[#D4D4CE] hover:border-emerald-400/45'
              }`}
            >
              <span className="font-display text-lg font-semibold">
                {inContinuation ? 'Tap Steadily' : 'Tap With Beat'}
              </span>
              <span className="font-mono-tech text-[11px] text-[#8E8E88]">
                Click / Tap here or press Spacebar · {tapCount} continuation taps
              </span>
            </button>
          </div>
        )}

        {phase === 'result' && (
          <div className="space-y-4">
            {result ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/10 bg-[#121417] p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Stability</div>
                  <div className="font-mono-tech mt-1 text-lg font-bold text-[#34D399]">
                    {result.stabilityScore}/100
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#121417] p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">ITI CV%</div>
                  <div className="font-mono-tech mt-1 text-lg font-bold text-[#F3F1EC]">
                    {result.cvPct.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#121417] p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Mean ITI</div>
                  <div className="font-mono-tech mt-1 text-lg font-bold text-[#D4D4CE]">
                    {Math.round(result.meanItiMs)} ms
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Too few continuation taps recorded (need at least 4 steady taps during phase 2).
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={startTest}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#14161A] py-2 text-xs font-semibold text-[#D4D4CE] hover:text-[#F3F1EC]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-aurora inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-[#0A0B0C]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
