import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Headphones, RotateCcw, ShieldAlert, Volume2, X } from 'lucide-react';
import { ensureDspWorkletsLoaded } from '../audio/dspWorklets';

interface HugginsCheckModalProps {
  onComplete: (result: { passed: boolean; score: number; total: number }) => void;
  onClose: () => void;
}

const TOTAL_TRIALS = 6;
const PASS_THRESHOLD = 5;

function pickRandomSlot(): 1 | 2 | 3 {
  const n = Math.floor(Math.random() * 3) + 1;
  return (n === 1 ? 1 : n === 2 ? 2 : 3) as 1 | 2 | 3;
}

/**
 * 6-Trial 3-AFC Huggins Pitch Dichotic Verification (Milne et al., 2021).
 * Injects correlated broadband noise L/R with a narrowband 180 deg all-pass transition at 600 Hz
 * in only 1 of 3 intervals — audible ONLY when true stereo phase separation reaches the listener's ears.
 */
export function HugginsCheckModal({ onComplete, onClose }: HugginsCheckModalProps) {
  const [stage, setStage] = useState<'intro' | 'playing' | 'choose' | 'result'>('intro');
  const [trialIndex, setTrialIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [targetSlot, setTargetSlot] = useState<1 | 2 | 3>(() => pickRandomSlot());
  const [activeSlot, setActiveSlot] = useState<0 | 1 | 2 | 3>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const teardownAudio = useCallback(() => {
    clearTimers();
    try {
      workletRef.current?.port.postMessage({ type: 'stop' });
      workletRef.current?.disconnect();
    } catch {
      // ignore
    }
    workletRef.current = null;
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
  }, [clearTimers]);

  useEffect(() => () => teardownAudio(), [teardownAudio]);

  const ensureAudioReady = useCallback(async (): Promise<AudioWorkletNode | null> => {
    if (workletRef.current && ctxRef.current) {
      if (ctxRef.current.state === 'suspended') {
        await ctxRef.current.resume().catch(() => {});
      }
      return workletRef.current;
    }
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ latencyHint: 'playback' });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const ready = await ensureDspWorkletsLoaded(ctx);
      if (!ready) {
        setErrorMsg('AudioWorklet dichotic screening is not supported by this browser context.');
        return null;
      }
      const node = new AudioWorkletNode(ctx, 'nootropic-huggins-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const gain = ctx.createGain();
      gain.gain.value = 0.65;
      node.connect(gain);
      gain.connect(ctx.destination);
      workletRef.current = node;
      return node;
    } catch {
      setErrorMsg('Unable to initialize headphone screening audio output.');
      return null;
    }
  }, []);

  const playSequence = useCallback(
    async (slotWithTone: 1 | 2 | 3) => {
      clearTimers();
      setErrorMsg(null);
      const node = await ensureAudioReady();
      if (!node) return;
      setStage('playing');
      setActiveSlot(1);

      const slots: Array<{ slot: 1 | 2 | 3; delayMs: number }> = [
        { slot: 1, delayMs: 0 },
        { slot: 2, delayMs: 850 },
        { slot: 3, delayMs: 1700 },
      ];

      for (const item of slots) {
        const tId = window.setTimeout(() => {
          setActiveSlot(item.slot);
          workletRef.current?.port.postMessage({
            type: 'play',
            isTarget: item.slot === slotWithTone,
            durationMs: 600,
          });
        }, item.delayMs);
        timersRef.current.push(tId);
      }

      const doneId = window.setTimeout(() => {
        setActiveSlot(0);
        setStage('choose');
      }, 2350);
      timersRef.current.push(doneId);
    },
    [clearTimers, ensureAudioReady]
  );

  const handleStart = () => {
    const firstTarget = pickRandomSlot();
    setTrialIndex(0);
    setScore(0);
    setTargetSlot(firstTarget);
    void playSequence(firstTarget);
  };

  const handleChoice = (choice: 1 | 2 | 3) => {
    if (stage !== 'choose') return;
    const isHit = choice === targetSlot;
    const nextScore = score + (isHit ? 1 : 0);
    const nextIdx = trialIndex + 1;

    if (nextIdx >= TOTAL_TRIALS) {
      const passed = nextScore >= PASS_THRESHOLD;
      try {
        localStorage.setItem(
          'nootropic_fm_huggins_v1',
          JSON.stringify({ passed, score: nextScore, total: TOTAL_TRIALS, ts: Date.now() })
        );
      } catch {
        // ignore storage errors
      }
      setScore(nextScore);
      setStage('result');
      teardownAudio();
      return;
    }

    const nextTarget = pickRandomSlot();
    setScore(nextScore);
    setTrialIndex(nextIdx);
    setTargetSlot(nextTarget);
    void playSequence(nextTarget);
  };

  const passed = score >= PASS_THRESHOLD;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage w-full max-w-md rounded-2xl border border-white/15 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#34D399]">
            <Headphones className="h-4 w-4" />
            <h3 className="text-sm font-bold text-[#F3F1EC]">
              35s Dichotic Headphone Check (Huggins Pitch)
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              teardownAudio();
              onClose();
            }}
            className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/10 hover:text-[#F3F1EC]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {(stage === 'playing' || stage === 'choose') && (
          <div className="flex items-center justify-between text-[11px] text-[#8E8E88]">
            <span>
              Trial {trialIndex + 1} / {TOTAL_TRIALS}
            </span>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: TOTAL_TRIALS }).map((_, i) => (
                <span
                  key={i}
                  className={`h-2 w-6 rounded-full transition ${
                    i < trialIndex
                      ? 'bg-[#34D399]'
                      : i === trialIndex
                        ? 'bg-emerald-300/60'
                        : 'bg-white/10'
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        {stage === 'intro' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-4 space-y-2 text-xs leading-relaxed text-[#D4D4CE]">
              <p>
                We play <strong className="text-[#F3F1EC]">3 short soft noise bursts</strong> per round.
                Exactly 1 hides a faint <strong className="text-[#34D399]">600 Hz tone</strong> created
                by a phase difference between Left and Right ears.
              </p>
              <p className="text-[#8E8E88]">
                If OS Spatial Audio, mono summing, or speakers collapse L/R isolation, we automatically
                switch to <strong className="text-[#D4D4CE]">Monaural-Safe + 0° AM</strong> so nothing cancels.
              </p>
            </div>
            <button
              type="button"
              onClick={handleStart}
              className="btn-aurora w-full rounded-xl px-5 py-3 text-sm font-bold text-[#0A0B0C]"
            >
              Start 6-Round Check (~35s)
            </button>
          </div>
        )}

        {(stage === 'playing' || stage === 'choose') && (
          <div className="space-y-4">
            <div className="text-center text-xs text-[#D4D4CE]">
              {stage === 'playing'
                ? 'Listen closely — which noise burst contains a faint ringing pitch?'
                : 'Pick the sound that contained the faint 600 Hz tone:'}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {([1, 2, 3] as const).map((slot) => {
                const isLit = activeSlot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={stage !== 'choose'}
                    onClick={() => handleChoice(slot)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border py-5 transition-all ${
                      isLit
                        ? 'border-[#34D399] bg-emerald-400/20 text-[#F3F1EC] shadow-[0_0_24px_rgba(52,211,153,0.3)]'
                        : stage === 'choose'
                          ? 'border-white/15 bg-[#121418] text-[#F3F1EC] hover:border-emerald-400/60 hover:bg-emerald-500/10'
                          : 'border-white/10 bg-[#0B0C0E] text-[#7E7E78]'
                    }`}
                  >
                    <Volume2 className={`h-5 w-5 ${isLit ? 'text-[#34D399]' : 'text-[#8E8E88]'}`} />
                    <span className="font-mono-tech text-xs font-bold">Sound {slot}</span>
                  </button>
                );
              })}
            </div>

            {stage === 'choose' && (
              <button
                type="button"
                onClick={() => void playSequence(targetSlot)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#121418] py-2 text-[11px] font-medium text-[#A3A39E] hover:border-white/25 hover:text-[#F3F1EC]"
              >
                <RotateCcw className="h-3 w-3" />
                Replay This Round
              </button>
            )}
          </div>
        )}

        {stage === 'result' && (
          <div
            className={`rounded-2xl border p-5 text-center space-y-3 ${
              passed
                ? 'border-emerald-400/35 bg-emerald-500/10'
                : 'border-amber-400/35 bg-amber-500/10'
            }`}
          >
            {passed ? (
              <CheckCircle2 className="mx-auto h-9 w-9 text-[#34D399]" />
            ) : (
              <ShieldAlert className="mx-auto h-9 w-9 text-amber-300" />
            )}
            <div>
              <div className="font-mono-tech text-xs uppercase tracking-wider text-[#D4D4CE]">
                Score: {score} / {TOTAL_TRIALS}
              </div>
              <div className="mt-1 text-base font-bold text-[#F3F1EC]">
                {passed
                  ? 'Dichotic Stereo Verified'
                  : 'Spatial Audio / Mono Crosstalk Detected'}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[#D4D4CE]">
                {passed
                  ? 'Full L/R phase separation confirmed. Binaural beats and 32° stereo AM stay active.'
                  : 'Tip: Disable Apple Spatial Audio / Head Tracking or OS Mono Audio for binaural headphones. Auto-adapting to Monaural + 0° AM for clean phase coherence.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onComplete({ passed, score, total: TOTAL_TRIALS })}
              className="btn-aurora w-full rounded-xl px-5 py-3 text-sm font-bold text-[#0A0B0C]"
            >
              Apply Profile &amp; Resume
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
