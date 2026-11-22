import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Car,
  Clock,
  Cpu,
  Headphones,
  Mic,
  MicOff,
  Music2,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { parseNaturalCheckIn, parseOnboardingAnswers } from '../../shared/parser';
import {
  DEVICE_LABELS,
  ENV_LABELS,
  GENRE_META,
  ROLE_LABELS,
  STATE_LABELS,
  TARGET_LABELS,
  type CurrentState,
  type MusicGenreChoice,
  type NoiseSensitivity,
  type OutputDevice,
  type ResolvedGenre,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserProfile,
  type UserRole,
} from '../../shared/types';
import { api } from '../lib/api';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';

interface CheckInViewProps {
  profile: UserProfile | null;
  pendingDebrief: SessionRecord | null;
  onOpenPendingDebrief: () => void;
  onDismissPending: () => void;
  onMoodChange?: (mood: FieldMood) => void;
  onLaunchUnifiedSession: (payload: {
    profileUpdate?: Partial<UserProfile>;
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

interface QuickStatePreset {
  id: string;
  label: string;
  sub: string;
  currentState: CurrentState;
  targetState: TargetState;
  environment: SessionEnvironment;
  device?: OutputDevice;
  durationMin: number;
  promptText: string;
}

const QUICK_STATE_PRESETS: QuickStatePreset[] = [
  {
    id: 'distracted_focus',
    label: 'Distracted · Focus',
    sub: '35 min · Sharp clarity',
    currentState: 'distracted',
    targetState: 'alert_focus',
    environment: 'office',
    durationMin: 35,
    promptText: 'Distracted right now — need sharp sustained focus for 35 minutes',
  },
  {
    id: 'driving_alert',
    label: 'Driving · Stay Alert',
    sub: '40 min · Safety Mode',
    currentState: 'distracted',
    targetState: 'alert_focus',
    environment: 'driving',
    device: 'car_audio',
    durationMin: 40,
    promptText: 'Driving right now — distracted & need 40 min of alert road focus on car speakers',
  },
  {
    id: 'deep_flow',
    label: 'Deep Flow · Work',
    sub: '50 min · Study / Code',
    currentState: 'calm_neutral',
    targetState: 'deep_flow',
    environment: 'study',
    durationMin: 50,
    promptText: 'Need 50 minutes of uninterrupted deep flow for desk work / studying',
  },
  {
    id: 'stressed_calm',
    label: 'Stressed · Calm Reset',
    sub: '20 min · Decompress',
    currentState: 'stressed',
    targetState: 'calm_reset',
    environment: 'home_relax',
    durationMin: 20,
    promptText: 'Stressed & tense — help me calm down and reset in 20 minutes',
  },
  {
    id: 'tired_lift',
    label: 'Tired · Energy Lift',
    sub: '25 min · Afternoon boost',
    currentState: 'fatigued',
    targetState: 'energy_lift',
    environment: 'office',
    durationMin: 25,
    promptText: 'Low energy & foggy afternoon — need a 25 min clarity lift',
  },
  {
    id: 'sleep_winddown',
    label: 'Racing Mind · Sleep',
    sub: '30 min · Wind-down',
    currentState: 'anxious',
    targetState: 'sleep_winddown',
    environment: 'home_relax',
    durationMin: 30,
    promptText: 'Racing thoughts before bed — gentle 30 min wind-down to sleep',
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
  onMoodChange,
  onLaunchUnifiedSession,
}: CheckInViewProps) {
  const isFirstVisit = !profile;
  const [step, setStep] = useState<1 | 2>(1);
  const [rawText, setRawText] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const [currentState, setCurrentState] = useState<CurrentState>('distracted');
  const [baselineScore, setBaselineScore] = useState<number>(2);
  const [targetState, setTargetState] = useState<TargetState>('alert_focus');
  const [environment, setEnvironment] = useState<SessionEnvironment>(
    profile?.role === 'driver' ? 'driving' : 'office'
  );
  const [device, setDevice] = useState<OutputDevice>(
    profile?.role === 'driver' ? 'car_audio' : (profile?.defaultDevice ?? 'headphones')
  );
  const [durationMin, setDurationMin] = useState<number>(35);
  const [genreChoice, setGenreChoice] = useState<MusicGenreChoice>('auto');

  // First-visit profile anchors (auto-prefilled if mentioned in Step 1 text!)
  const [age, setAge] = useState<number>(profile?.age ?? 32);
  const [role, setRole] = useState<UserRole>(profile?.role ?? 'knowledge_worker');
  const [noiseSensitivity, setNoiseSensitivity] = useState<NoiseSensitivity>(
    profile?.noiseSensitivity ?? 'medium'
  );
  const [researchConsent, setResearchConsent] = useState<boolean>(profile?.researchConsent ?? true);
  const [ageOverride, setAgeOverride] = useState<number | undefined>(undefined);

  const [detectedChips, setDetectedChips] = useState<string[]>([]);
  const [usedGemini, setUsedGemini] = useState(false);
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
    setActivePresetId(null);
    if (!text.trim()) {
      setDetectedChips([]);
      return;
    }
    const instant = parseNaturalCheckIn(text, profile ?? { age, role, defaultDevice: device });
    setCurrentState(instant.currentState);
    setTargetState(instant.targetState);
    setEnvironment(instant.environment);
    setDevice(instant.device);
    setDurationMin(instant.durationMin);
    if (instant.extractedAge) {
      setAge(instant.extractedAge);
      setAgeOverride(instant.extractedAge);
    }
    if (instant.extractedRole) {
      setRole(instant.extractedRole);
    }
    if (instant.extractedGenre) {
      setGenreChoice(instant.extractedGenre);
    }
    setDetectedChips(instant.detectedKeywords);
  };

  const serverEnhance = async (text: string) => {
    if (!text.trim()) return;
    try {
      const { parsed } = await api.parseCheckIn(text, profile ?? { age, role, defaultDevice: device });
      setCurrentState(parsed.currentState);
      setTargetState(parsed.targetState);
      setEnvironment(parsed.environment);
      setDevice(parsed.device);
      setDurationMin(parsed.durationMin);
      if (parsed.extractedAge) {
        setAge(parsed.extractedAge);
        setAgeOverride(parsed.extractedAge);
      }
      if (parsed.extractedRole) setRole(parsed.extractedRole);
      setDetectedChips(parsed.detectedKeywords);
      setUsedGemini(parsed.usedGemini);
    } catch {
      // Deterministic local parse already applied
    }
  };

  const applyPreset = (preset: QuickStatePreset) => {
    setActivePresetId(preset.id);
    setRawText(preset.promptText);
    setCurrentState(preset.currentState);
    setTargetState(preset.targetState);
    setEnvironment(preset.environment);
    if (preset.device) {
      setDevice(preset.device);
    } else if (preset.environment === 'driving') {
      setDevice('car_audio');
    } else if (device === 'car_audio') {
      setDevice('headphones');
    }
    setDurationMin(preset.durationMin);
    setDetectedChips([
      STATE_LABELS[preset.currentState].split(' ')[0],
      TARGET_LABELS[preset.targetState],
      `${preset.durationMin} min`,
      ...(preset.environment === 'driving' ? ['Driving Safety Mode'] : []),
    ]);
    // Immediately glide to Step 2 micro-calibration!
    setStep(2);
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

  const handleSelectDevice = (nextDevice: OutputDevice) => {
    setDevice(nextDevice);
    if (nextDevice === 'car_audio') {
      setEnvironment('driving');
      if (targetState === 'sleep_winddown' || targetState === 'calm_reset') {
        setTargetState('alert_focus');
      }
    } else if (environment === 'driving') {
      setEnvironment('office');
    }
  };

  const handleLaunch = async () => {
    setStarting(true);
    try {
      const effectiveTarget: TargetState =
        isDriving && (targetState === 'sleep_winddown' || targetState === 'calm_reset')
          ? 'alert_focus'
          : targetState;
      const effectiveDevice: OutputDevice = isDriving ? 'car_audio' : device;

      let profileUpdate: Partial<UserProfile> | undefined = undefined;
      if (isFirstVisit) {
        const parsedBase = parseOnboardingAnswers(rawText, '');
        profileUpdate = {
          age: Math.max(16, Math.min(95, age || parsedBase.age)),
          role: isDriving && role === 'knowledge_worker' ? 'driver' : role,
          texturePref: parsedBase.texturePref,
          noiseSensitivity,
          defaultDevice: effectiveDevice,
          primaryChallenge:
            currentState === 'fatigued'
              ? 'fatigue'
              : currentState === 'stressed' || currentState === 'anxious'
                ? 'stress'
                : effectiveTarget === 'sleep_winddown'
                  ? 'sleep'
                  : 'distraction',
          researchConsent,
        };
      }

      await onLaunchUnifiedSession({
        profileUpdate,
        rawInputText: rawText,
        currentState,
        baselineScore,
        targetState: effectiveTarget,
        environment,
        device: effectiveDevice,
        durationMin,
        ageOverride: isFirstVisit ? age : ageOverride,
        requestedGenre: genreChoice,
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center space-y-6">
      {/* Deferred Debrief Banner (returning users) */}
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

      {/* Centerpiece Sonic Orb + Brand Motto */}
      <div className="animate-rise flex flex-col items-center text-center">
        <SonicOrb mood={activeMood} size={step === 1 ? 'lg' : 'sm'} label="Tune your mind" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-4xl leading-[1.1]">
          {step === 1 ? (
            <>
              Where do you want your <span className="text-aurora">mind to go?</span>
            </>
          ) : (
            <>
              Quick <span className="text-aurora">formula calibration</span>
            </>
          )}
        </h1>
        <p className="mt-2 max-w-lg text-xs text-slate-400 sm:text-sm">
          {step === 1
            ? 'Tap a state or describe how you feel — we match peer-reviewed neuroscience (Layer 1) with studio music you love (Layer 2).'
            : '5 seconds so our engine measures your real before → after shift and adapts every session.'}
        </p>
      </div>

      {/* Minimal 2-Step Progress Indicator */}
      <div className="flex items-center gap-2">
        {[1, 2].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s as 1 | 2)}
            aria-label={`Step ${s}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s === step
                ? 'w-12 bg-gradient-to-r from-cyan-400 to-indigo-400 shadow-[0_0_12px_rgba(34,211,238,0.6)]'
                : 'w-6 bg-cyan-400/30 hover:bg-cyan-400/50'
            }`}
          />
        ))}
      </div>

      {/* STEP 1: STATE-FIRST HERO (1-Tap Quick Pills + Conversational Free Text/Voice) */}
      {step === 1 && (
        <div key="step-1" className="animate-step glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
          {/* 1-Tap Instant Mood & Intent Grid */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.16em] text-cyan-300/85">
                01 / 02 · Tap a state (instant)
              </span>
              <span className="text-[11px] text-slate-500">or describe freely below</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUICK_STATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`group rounded-2xl border p-3 text-left transition-all ${
                    activePresetId === preset.id
                      ? 'border-cyan-400 bg-cyan-400/15 shadow-[0_0_20px_rgba(34,211,238,0.2)]'
                      : 'border-slate-800/90 bg-slate-950/65 hover:border-cyan-400/45 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="text-xs font-semibold text-white group-hover:text-cyan-200">
                    {preset.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{preset.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Free-Response Conversational + Voice Box */}
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
                    setStep(2);
                  }
                }}
                placeholder="Or write/speak in your own words — e.g. I'm a 40yo minibus driver, distracted right now, need 40 min of focus..."
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

          <button
            type="button"
            onClick={() => setStep(2)}
            className="btn-aurora flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 sm:text-base"
          >
            Continue to Calibration
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* STEP 2: MICRO-CALIBRATION (Baseline + Layer 2 Music + Output + First-visit Profile) */}
      {step === 2 && (
        <div key="step-2" className="animate-step glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
          {/* Compact Step 1 Summary Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-2.5">
            <div className="text-xs text-slate-200">
              <span className="text-slate-400">Trajectory: </span>
              <strong className="text-white">{STATE_LABELS[currentState].split(' ')[0]}</strong>
              <span className="mx-1.5 text-cyan-400">→</span>
              <strong className="text-cyan-200">{TARGET_LABELS[targetState]}</strong>
              <span className="ml-2 font-mono-tech text-[11px] text-slate-400">
                · {ENV_LABELS[environment].split(' ')[0]}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>

          {/* 1. Baseline 1-5 (Essential for measuring real Δ!) */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/55 px-4 py-3.5 sm:flex-row sm:items-center">
            <div>
              <div className="text-xs font-semibold text-white">
                How sharp / steady right now?
              </div>
              <div className="text-[11px] text-slate-400">
                Baseline 1–5 · lets us measure your real before → after Δ
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBaselineScore(n)}
                  className={`h-9 w-9 rounded-xl border font-mono-tech text-xs font-bold transition-all ${
                    baselineScore === n
                      ? 'scale-105 border-cyan-400 bg-cyan-400/20 text-white shadow-[0_0_16px_rgba(34,211,238,0.35)]'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Layer 2 · Music Carrier */}
          <div className="space-y-2.5 rounded-2xl border border-indigo-400/20 bg-indigo-500/[0.05] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-200">
                <Music2 className="h-4 w-4 text-indigo-300" />
                <span>Layer 2 · Music Carrier</span>
              </div>
              <span className="text-[11px] text-slate-400">100% lyric-free</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setGenreChoice('auto')}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  genreChoice === 'auto'
                    ? 'border-cyan-400/80 bg-cyan-400/20 text-white shadow-[0_0_14px_rgba(34,211,238,0.2)]'
                    : 'subtle-chip'
                }`}
              >
                <Sparkles className="h-3 w-3 text-cyan-300" />
                Auto (Bandit learns)
              </button>
              {(Object.keys(GENRE_META) as ResolvedGenre[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenreChoice(g)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    genreChoice === g
                      ? 'border-indigo-400/80 bg-indigo-500/25 text-white'
                      : 'subtle-chip'
                  }`}
                >
                  {GENRE_META[g].label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Output Device + Duration Row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Listening Output
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'headphones', label: 'Headphones', icon: Headphones },
                    { id: 'speakers', label: 'Speakers', icon: Volume2 },
                    { id: 'car_audio', label: 'Car Audio', icon: Car },
                  ] as const
                ).map(({ id, label, icon: Icon }) => {
                  const active = (isDriving ? 'car_audio' : device) === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSelectDevice(id)}
                      className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition ${
                        active
                          ? id === 'car_audio'
                            ? 'border-amber-400/80 bg-amber-500/15 text-amber-200'
                            : 'border-cyan-400/80 bg-cyan-400/15 text-white'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-3.5">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Duration
                </span>
                <span className="font-mono-tech text-cyan-300">{durationMin} min</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[15, 25, 40, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMin(m)}
                    className={`rounded-xl border py-2 font-mono-tech text-xs font-semibold transition ${
                      durationMin === m
                        ? 'border-cyan-400 bg-cyan-400/20 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. First-Visit Only: Saved 1x Personal Anchors + Open Research Consent */}
          {isFirstVisit && (
            <div className="space-y-3 rounded-2xl border border-slate-800/90 bg-slate-950/65 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono-tech text-[10px] uppercase tracking-[0.16em] text-cyan-300/85">
                  Saved once · Used for cohort learning
                </span>
                <span className="text-[11px] text-slate-500">No login required</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Age</label>
                  <input
                    type="number"
                    min={16}
                    max={95}
                    value={age}
                    onChange={(e) => setAge(Number(e.target.value) || 32)}
                    className="w-full rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 font-mono-tech text-xs text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Role / Field</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Sound Sensitivity</label>
                  <select
                    value={noiseSensitivity}
                    onChange={(e) => setNoiseSensitivity(e.target.value as NoiseSensitivity)}
                    className="w-full rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="low">Low (loves rich pulse)</option>
                    <option value="medium">Balanced</option>
                    <option value="high">Sensitive (keep soft)</option>
                  </select>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-slate-300">
                <input
                  type="checkbox"
                  checked={researchConsent}
                  onChange={(e) => setResearchConsent(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded accent-cyan-400"
                />
                <span>
                  <strong className="inline-flex items-center gap-1 text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5" /> Open Research Beta (Free Year 1):
                  </strong>{' '}
                  Share anonymized outcomes &amp; occasional (~12%) blind pure-music control trials so we can
                  scientifically validate AM lift vs. music alone.
                </span>
              </label>
            </div>
          )}

          {isDriving && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/8 p-3 text-xs text-amber-100/90">
              <Car className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>
                <strong className="text-amber-200">Driving Safety Mode active:</strong>{' '}
                {DEVICE_LABELS.car_audio} only, traffic sirens/horns (`800–3500 Hz`) stay unobstructed,
                and anti-monotony pulse is enabled.
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={starting}
            onClick={() => void handleLaunch()}
            className="btn-aurora flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-base font-bold text-slate-950 disabled:opacity-60"
          >
            <Sparkles className="h-5 w-5" />
            {starting
              ? 'Matching peer-reviewed science...'
              : `Build My 2-Layer Formula · ${durationMin} min`}
          </button>

          {isDriving && (
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400/70" />
              Start before driving. Audio supports focus but never replaces rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
