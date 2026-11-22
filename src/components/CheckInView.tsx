import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Car,
  ChevronDown,
  Clock,
  Cpu,
  Mic,
  MicOff,
  Music2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { parseNaturalCheckIn } from '../../shared/parser';
import {
  DEVICE_LABELS,
  ENV_LABELS,
  GENRE_META,
  STATE_LABELS,
  TARGET_LABELS,
  type CurrentState,
  type MusicGenreChoice,
  type OutputDevice,
  type ResolvedGenre,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserProfile,
} from '../../shared/types';
import { api } from '../lib/api';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';

interface CheckInViewProps {
  profile: UserProfile;
  pendingDebrief: SessionRecord | null;
  onOpenPendingDebrief: () => void;
  onDismissPending: () => void;
  onMoodChange?: (mood: FieldMood) => void;
  onStartSession: (payload: {
    rawInputText: string;
    currentState: CurrentState;
    baselineScore: number;
    targetState: TargetState;
    environment: SessionEnvironment;
    device: OutputDevice;
    durationMin: number;
    ageOverride?: number;
    requestedGenre?: MusicGenreChoice;
  }) => Promise<void>;
}

const SUBTLE_WHISPERS = [
  "I'm a 40yo minibus driver, distracted right now — need 40 min of focus",
  'Tired at my desk — need 50 min of deep flow on headphones',
  'Stressed & racing thoughts — help me calm down in 20 min',
  'Low energy afternoon — give me a 25 min clarity lift',
  'Ready for bed — gentle 30 min wind-down to sleep',
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
  onMoodChange,
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
  const [genreChoice, setGenreChoice] = useState<MusicGenreChoice>('auto');
  const [ageOverride, setAgeOverride] = useState<number | undefined>(undefined);
  const [detectedChips, setDetectedChips] = useState<string[]>([]);
  const [usedGemini, setUsedGemini] = useState(false);
  const [showFineTune, setShowFineTune] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);

  const isDriving = environment === 'driving';

  const activeMood: FieldMood = isDriving
    ? 'driving'
    : targetState === 'calm_reset'
      ? 'calm'
      : targetState === 'deep_flow'
        ? 'flow'
        : targetState === 'sleep_winddown'
          ? 'sleep'
          : 'focus';

  useEffect(() => {
    onMoodChange?.(activeMood);
  }, [activeMood, onMoodChange]);

  const liveAnalyze = (text: string) => {
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
    if (instant.extractedGenre) setGenreChoice(instant.extractedGenre);
    setDetectedChips(instant.detectedKeywords);
  };

  const serverEnhance = async (text: string) => {
    if (!text.trim()) return;
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
      // Deterministic local parse already applied
    }
  };

  const toggleVoiceInput = () => {
    const Win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Rec = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!Rec) return;
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
        liveAnalyze(transcript);
        void serverEnhance(transcript);
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
        requestedGenre: genreChoice,
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center space-y-6">
      {/* Deferred Debrief Banner */}
      {pendingDebrief && (
        <div className="animate-rise w-full flex flex-col justify-between gap-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 backdrop-blur-md sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <div className="text-sm font-semibold text-amber-100">
                Unrated previous session ({pendingDebrief.armName})
              </div>
              <p className="text-xs text-amber-200/80">
                10 seconds: tell us how your {pendingDebrief.plannedDurationMin}-min session worked
                so the engine keeps getting smarter.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenPendingDebrief}
              className="rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-300"
            >
              Rate now
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

      {/* Centerpiece Sonic Orb + Conversational Hero */}
      <div className="animate-rise flex flex-col items-center text-center">
        <SonicOrb
          mood={activeMood}
          size="md"
          label={
            isDriving
              ? 'Driving Safety Mode'
              : `${TARGET_LABELS[targetState]} · ${durationMin} min`
          }
        />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-4xl">
          Where do you want your <span className="text-aurora">mind to go?</span>
        </h1>
        <p className="mt-2 max-w-md text-xs text-slate-400 sm:text-sm">
          Describe how you feel and what you’re about to do — in your own words.
        </p>
      </div>

      {/* Main Conversational Stage */}
      <div className="animate-rise delay-150 glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
        <div className="glow-input-wrap">
          <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
            <textarea
              rows={2}
              value={rawText}
              onChange={(e) => liveAnalyze(e.target.value)}
              onBlur={() => void serverEnhance(rawText)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleLaunch();
                }
              }}
              placeholder="Write or speak freely — e.g. I feel distracted driving right now, need 40 min of calm focus..."
              className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
            />
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                listening
                  ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                  : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
              }`}
              title="Speak freely (Voice input)"
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Subtle whisper suggestions */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-slate-500">Subtle prompts (optional):</div>
          <div className="flex flex-wrap gap-2">
            {SUBTLE_WHISPERS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  liveAnalyze(w);
                  void serverEnhance(w);
                }}
                className="subtle-chip rounded-full px-3 py-1.5 text-xs text-left"
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Live extracted telemetry chips */}
        {detectedChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Cpu className="h-3 w-3 text-cyan-400" />
              {usedGemini ? 'AI Context:' : 'Understood:'}
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

        {/* Optional Music Layer (Taste Carrier) selector */}
        <div className="space-y-2 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
            <Music2 className="h-3.5 w-3.5 text-cyan-400" />
            <span>Music Layer (leave on Auto or pick the vibe that pulls you in):</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setGenreChoice('auto')}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
                genreChoice === 'auto'
                  ? 'border-cyan-400/80 bg-cyan-400/20 text-white'
                  : 'subtle-chip'
              }`}
            >
              <Sparkles className="h-3 w-3 text-cyan-300" />
              Auto (Science)
            </button>
            {(Object.keys(GENRE_META) as ResolvedGenre[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGenreChoice(g)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  genreChoice === g
                    ? 'border-indigo-400/80 bg-indigo-500/22 text-white'
                    : 'subtle-chip'
                }`}
              >
                {GENRE_META[g].label}
              </button>
            ))}
          </div>
        </div>

        {/* Compact tactile Baseline 1–5 selector */}
        <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/55 px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <div className="text-xs font-medium text-slate-200">How sharp / steady right now?</div>
            <div className="text-[11px] text-slate-500">Baseline 1–5 · lets us track your Δ shift</div>
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setBaselineScore(n)}
                className={`h-9 w-9 rounded-xl border font-mono-tech text-xs font-bold transition-all ${
                  baselineScore === n
                    ? 'scale-105 border-cyan-400 bg-cyan-400/20 text-white shadow-[0_0_18px_rgba(34,211,238,0.35)]'
                    : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Optional collapsible Fine-Tune Drawer (keeps hero clean & cinematic!) */}
        <div>
          <button
            type="button"
            onClick={() => setShowFineTune((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-cyan-300"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>
              Fine-tune manually ({ENV_LABELS[environment].split(' ')[0]} · {DEVICE_LABELS[isDriving ? 'car_audio' : device]} · {durationMin}m)
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-300 ${showFineTune ? 'rotate-180' : ''}`}
            />
          </button>

          {showFineTune && (
            <div className="animate-step mt-4 grid grid-cols-1 gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Current State
                </label>
                <select
                  value={currentState}
                  onChange={(e) => setCurrentState(e.target.value as CurrentState)}
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                >
                  {(Object.keys(STATE_LABELS) as CurrentState[]).map((st) => (
                    <option key={st} value={st}>
                      {STATE_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Target State
                </label>
                <select
                  value={targetState}
                  onChange={(e) => setTargetState(e.target.value as TargetState)}
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                >
                  {(Object.keys(TARGET_LABELS) as TargetState[]).map((tg) => {
                    const blocked = isDriving && (tg === 'sleep_winddown' || tg === 'calm_reset');
                    return (
                      <option key={tg} value={tg} disabled={blocked}>
                        {TARGET_LABELS[tg]} {blocked ? '(blocked while driving)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                >
                  {(Object.keys(ENV_LABELS) as SessionEnvironment[]).map((env) => (
                    <option key={env} value={env}>
                      {ENV_LABELS[env]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Duration
                  </span>
                  <span className="font-mono-tech text-cyan-300">{durationMin} min</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[15, 25, 40, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDurationMin(m)}
                      className={`rounded-lg border py-1.5 text-xs font-mono-tech transition ${
                        durationMin === m
                          ? 'border-cyan-400 bg-cyan-400/20 text-white'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {isDriving && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/8 p-3 text-xs text-amber-100/90">
            <Car className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>
              <strong className="text-amber-200">Driving Safety Mode active:</strong> vehicle
              speakers only, traffic sirens/horns stay unobstructed, anti-monotony pulse enabled.
            </span>
          </div>
        )}

        <button
          type="button"
          disabled={starting}
          onClick={handleLaunch}
          className="btn-aurora flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-base font-bold text-slate-950 disabled:opacity-60"
        >
          <Sparkles className="h-5 w-5" />
          {starting ? 'Searching scientific literature...' : `Search Science & Build Protocol · ${durationMin} min`}
        </button>

        {isDriving && (
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400/70" />
            Start before driving. Audio supports focus but never replaces rest.
          </p>
        )}
      </div>
    </div>
  );
}
