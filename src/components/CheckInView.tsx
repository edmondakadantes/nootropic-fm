import { useState } from 'react';
import {
  AlertTriangle,
  Car,
  Clock,
  Cpu,
  Mic,
  MicOff,
  Play,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { parseNaturalCheckIn } from '../../shared/parser';
import {
  DEVICE_LABELS,
  ENV_LABELS,
  STATE_LABELS,
  TARGET_LABELS,
  type CurrentState,
  type OutputDevice,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserProfile,
} from '../../shared/types';
import { api } from '../lib/api';

interface CheckInViewProps {
  profile: UserProfile;
  pendingDebrief: SessionRecord | null;
  onOpenPendingDebrief: () => void;
  onDismissPending: () => void;
  onStartSession: (payload: {
    rawInputText: string;
    currentState: CurrentState;
    baselineScore: number;
    targetState: TargetState;
    environment: SessionEnvironment;
    device: OutputDevice;
    durationMin: number;
    ageOverride?: number;
  }) => Promise<void>;
}

const EXAMPLE_PROMPTS = [
  {
    label: 'Minibus Driver · Age 40 · Focus 40m',
    text: "I'm a 40-year-old minibus driver, feeling distracted right now and want to stay focused for the next 40 minutes",
  },
  {
    label: 'Office · Tired · Deep Flow 50m',
    text: 'Working at my desk with headphones, feeling fatigued this afternoon and need deep flow for 50 minutes',
  },
  {
    label: 'Home · Stressed · Calm Reset 20m',
    text: 'Feeling stressed and anxious at home, I want to calm down over the next 20 minutes',
  },
];

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function CheckInView({
  profile,
  pendingDebrief,
  onOpenPendingDebrief,
  onDismissPending,
  onStartSession,
}: CheckInViewProps) {
  const [rawText, setRawText] = useState('');
  const [currentState, setCurrentState] = useState<CurrentState>('distracted');
  const [baselineScore, setBaselineScore] = useState<number>(2);
  const [targetState, setTargetState] = useState<TargetState>('alert_focus');
  const [environment, setEnvironment] = useState<SessionEnvironment>(
    profile.role === 'driver' ? 'driving' : 'office'
  );
  const [device, setDevice] = useState<OutputDevice>(
    profile.role === 'driver' ? 'car_audio' : profile.defaultDevice
  );
  const [durationMin, setDurationMin] = useState<number>(40);
  const [ageOverride, setAgeOverride] = useState<number | undefined>(undefined);
  const [detectedChips, setDetectedChips] = useState<string[]>([]);
  const [usedGemini, setUsedGemini] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);

  const isDriving = environment === 'driving';

  const applyParsed = async (text: string) => {
    setRawText(text);
    if (!text.trim()) {
      setDetectedChips([]);
      return;
    }

    const instant = parseNaturalCheckIn(text, profile);
    setCurrentState(instant.currentState);
    setTargetState(instant.targetState);
    setEnvironment(instant.environment);
    setDevice(instant.device);
    setDurationMin(instant.durationMin);
    setAgeOverride(instant.extractedAge);
    setDetectedChips(instant.detectedKeywords);

    setParsing(true);
    try {
      const { parsed } = await api.parseCheckIn(text, profile);
      setCurrentState(parsed.currentState);
      setTargetState(parsed.targetState);
      setEnvironment(parsed.environment);
      setDevice(parsed.device);
      setDurationMin(parsed.durationMin);
      setAgeOverride(parsed.extractedAge);
      setDetectedChips(parsed.detectedKeywords);
      setUsedGemini(parsed.usedGemini);
    } catch {
      // Keep local parse result cleanly
    } finally {
      setParsing(false);
    }
  };

  const toggleVoiceInput = () => {
    const Win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Rec = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!Rec) {
      alert('Voice dictation is not supported in this browser. Type below or use the quick presets.');
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const recognition = new Rec();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript) {
        void applyParsed(transcript);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const handleLaunch = async () => {
    setStarting(true);
    try {
      await onStartSession({
        rawInputText: rawText,
        currentState,
        baselineScore,
        targetState:
          isDriving && (targetState === 'sleep_winddown' || targetState === 'calm_reset')
            ? 'alert_focus'
            : targetState,
        environment,
        device: isDriving ? 'car_audio' : device,
        durationMin,
        ageOverride,
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {pendingDebrief && (
        <div className="flex flex-col justify-between gap-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <div className="text-sm font-semibold text-amber-100">
                Unrated previous session ({pendingDebrief.armName})
              </div>
              <p className="text-xs text-amber-200/80">
                Take 10 seconds to rate how your {pendingDebrief.plannedDurationMin}-min session
                worked so the engine learns from it.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenPendingDebrief}
              className="rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-300"
            >
              Rate now (10s)
            </button>
            <button
              type="button"
              onClick={onDismissPending}
              title="Dismiss"
              className="rounded-lg p-2 text-amber-200/70 hover:bg-amber-400/15"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Natural Language + Voice Input Card */}
      <div className="glass-card rounded-2xl p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">
              How do you feel right now, and what state do you want?
            </h1>
            <p className="mt-1 text-xs text-slate-400 sm:text-sm">
              Speak or type naturally — the platform extracts your context, applies safety rules, and
              builds a science-backed audio protocol.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleVoiceInput}
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition-all ${
              listening
                ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                : 'border-cyan-400/40 bg-cyan-400/12 text-cyan-300 hover:bg-cyan-400/20'
            }`}
            title="Voice input (Web Speech API)"
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        </div>

        <div className="mt-4">
          <textarea
            rows={2}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onBlur={() => {
              if (rawText.trim()) void applyParsed(rawText);
            }}
            placeholder="e.g., I'm a 40-year-old minibus driver, feeling distracted right now and need to stay focused for 40 minutes..."
            className="w-full resize-none rounded-xl border border-slate-700/80 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-400/70 focus:outline-none"
          />

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void applyParsed(rawText)}
              disabled={!rawText.trim() || parsing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-400/20 disabled:opacity-40"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {parsing ? 'Analyzing...' : 'Analyze context'}
            </button>

            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => void applyParsed(ex.text)}
                className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-600 hover:text-white"
              >
                {ex.label}
              </button>
            ))}
          </div>

          {detectedChips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Cpu className="h-3 w-3 text-cyan-400" />
                {usedGemini ? 'Gemini NLU:' : 'Detected context:'}
              </span>
              {detectedChips.map((chip) => (
                <span
                  key={chip}
                  className="font-mono-tech rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Structured Calibration Card */}
      <div className="glass-card rounded-2xl p-5 sm:p-7 space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Current state
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STATE_LABELS) as CurrentState[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setCurrentState(st)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
                    currentState === st
                      ? 'border-cyan-400/70 bg-cyan-400/12 text-white'
                      : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {STATE_LABELS[st]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Target state
            </label>
            <div className="grid grid-cols-1 gap-2">
              {(Object.keys(TARGET_LABELS) as TargetState[]).map((tg) => {
                const blockedForDriving =
                  isDriving && (tg === 'sleep_winddown' || tg === 'calm_reset');
                return (
                  <button
                    key={tg}
                    type="button"
                    disabled={blockedForDriving}
                    onClick={() => setTargetState(tg)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
                      targetState === tg
                        ? 'border-indigo-400/80 bg-indigo-500/18 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                    } ${blockedForDriving ? 'cursor-not-allowed opacity-35' : ''}`}
                  >
                    <span>{TARGET_LABELS[tg]}</span>
                    {blockedForDriving && (
                      <span className="text-[10px] text-amber-300">Blocked while driving</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Baseline 1-5 measurement */}
        <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Baseline rating before listening (so we measure true Δ improvement)
            </span>
            <span className="font-mono-tech text-sm font-bold text-cyan-300">{baselineScore} / 5</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[
              [1, '1 · Very low'],
              [2, '2 · Low'],
              [3, '3 · Moderate'],
              [4, '4 · Good'],
              [5, '5 · Peak'],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setBaselineScore(Number(val))}
                className={`rounded-lg border py-2 text-center text-xs font-medium transition ${
                  baselineScore === val
                    ? 'border-cyan-400 bg-cyan-400/20 text-white'
                    : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Environment, Device, Duration */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Environment
            </label>
            <select
              value={environment}
              onChange={(e) => {
                const env = e.target.value as SessionEnvironment;
                setEnvironment(env);
                if (env === 'driving') {
                  setDevice('car_audio');
                  if (targetState === 'sleep_winddown' || targetState === 'calm_reset') {
                    setTargetState('alert_focus');
                  }
                }
              }}
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none"
            >
              {(Object.keys(ENV_LABELS) as SessionEnvironment[]).map((env) => (
                <option key={env} value={env}>
                  {ENV_LABELS[env]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Audio output
            </label>
            <select
              value={isDriving ? 'car_audio' : device}
              disabled={isDriving}
              onChange={(e) => setDevice(e.target.value as OutputDevice)}
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none disabled:opacity-70"
            >
              {(Object.keys(DEVICE_LABELS) as OutputDevice[]).map((d) => (
                <option key={d} value={d}>
                  {DEVICE_LABELS[d]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Duration
              </span>
              <span className="font-mono-tech text-cyan-300">{durationMin} min</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[15, 25, 40, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDurationMin(m)}
                  className={`rounded-lg border py-2 text-xs font-mono-tech transition ${
                    durationMin === m
                      ? 'border-cyan-400 bg-cyan-400/18 text-white'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {isDriving && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/35 bg-amber-500/10 p-3.5 text-xs text-amber-100">
            <Car className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div>
              <strong className="font-semibold text-amber-200">Driving Safety Mode auto-enabled:</strong>{' '}
              vehicle speakers only (never wear headphones, binaural disabled), traffic siren/horn
              frequencies stay unobstructed, and anti-monotony variations are active.
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={starting}
          onClick={handleLaunch}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400 px-6 py-4 text-base font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-60"
        >
          <Play className="h-5 w-5 fill-slate-950" />
          {starting
            ? 'Generating scientific protocol...'
            : `Generate Protocol & Start (${durationMin} min)`}
        </button>

        {isDriving && (
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400/70" />
            Start your session before driving. Audio never replaces proper sleep or rest stops.
          </p>
        )}
      </div>
    </div>
  );
}
