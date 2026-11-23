import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Car,
  Clock,
  Cpu,
  Headphones,
  KeyRound,
  Mic,
  MicOff,
  Music2,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import {
  NEURAL_MICRO_STATES,
  coordsToBaselineScore,
  findClosestMicroState,
  matchMicroStateFromText,
  type NeuralCoords,
  type NeuralMicroState,
} from '../../shared/neuralStates';
import {
  parseNaturalCheckIn,
  parseOnboardingAnswers,
  parseProfileSentence,
} from '../../shared/parser';
import { matchCoreGenreAlias, sanitizeCustomVibe } from '../../shared/promptComposer';
import {
  DEVICE_LABELS,
  GENDER_LABELS,
  GENRE_META,
  ROLE_SHORT_LABELS,
  TARGET_LABELS,
  formatProfileSummary,
  type AppRuntimeConfig,
  type CurrentState,
  type MusicGenreChoice,
  type NoiseSensitivity,
  type OutputDevice,
  type ResolvedGenre,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserGender,
  type UserProfile,
  type UserRole,
} from '../../shared/types';
import type { FieldMood } from './AmbientField';
import { NeuralCompassSelector, NeuralTrajectoryPreview } from './NeuralCompass';
import { NeuralFingerprintSigil } from './NeuralFingerprintPass';
import { SonicOrb } from './SonicOrb';

export interface MoodPresetSelection {
  id: string;
  label: string;
  microStateId: string;
  targetState: TargetState;
  requestedGenre: MusicGenreChoice;
  durationMin: number;
}

interface CheckInViewProps {
  profile: UserProfile | null;
  syncCode: string | null;
  runtimeConfig: AppRuntimeConfig | null;
  pendingDebrief: SessionRecord | null;
  initialPreset?: MoodPresetSelection | null;
  onClearPreset?: () => void;
  onOpenPendingDebrief: () => void;
  onDismissPending: () => void;
  onOpenIdentityModal: () => void;
  onMoodChange?: (mood: FieldMood) => void;
  onLaunchUnifiedSession: (payload: {
    profileUpdate?: Partial<UserProfile>;
    ephemeralMode: boolean;
    rawInputText: string;
    currentState: CurrentState;
    microStateId?: string;
    microStateLabel?: string;
    arousalPct?: number;
    clarityPct?: number;
    baselineScore: number;
    targetState: TargetState;
    environment: SessionEnvironment;
    device: OutputDevice;
    durationMin: number;
    ageOverride?: number;
    requestedGenre?: MusicGenreChoice;
    customGenreInput?: string;
  }) => Promise<void>;
}

const DEFAULT_MICRO_STATE =
  NEURAL_MICRO_STATES.find((s) => s.id === 'brain_fog') ?? NEURAL_MICRO_STATES[0];

const TARGET_CARDS: Array<{
  target: TargetState;
  label: string;
  sub: string;
  defaultMin: number;
}> = [
  {
    target: 'energy_lift',
    label: 'Stop Feeling Tired · Energy Lift',
    sub: 'Shake off fatigue & feel awake',
    defaultMin: 20,
  },
  {
    target: 'alert_focus',
    label: 'Sharp Alert Focus',
    sub: 'Clear attention & zero drift',
    defaultMin: 35,
  },
  {
    target: 'deep_flow',
    label: 'Deep Uninterrupted Flow',
    sub: 'Coding, writing, studying',
    defaultMin: 45,
  },
  {
    target: 'calm_reset',
    label: 'Calm Down & Reset',
    sub: 'Lower tension & steady breathing',
    defaultMin: 20,
  },
  {
    target: 'sleep_winddown',
    label: 'Wind Down for Sleep',
    sub: 'Quiet thoughts gently before bed',
    defaultMin: 30,
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

function browserHasGpc(): boolean {
  try {
    return (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  } catch {
    return false;
  }
}

export function CheckInView({
  profile,
  syncCode,
  runtimeConfig,
  pendingDebrief,
  initialPreset = null,
  onClearPreset,
  onOpenPendingDebrief,
  onDismissPending,
  onOpenIdentityModal,
  onMoodChange,
  onLaunchUnifiedSession,
}: CheckInViewProps) {
  const isFirstVisit = !profile;
  const presetMicro = initialPreset
    ? NEURAL_MICRO_STATES.find((s) => s.id === initialPreset.microStateId) ?? null
    : null;
  const [beat, setBeat] = useState<1 | 2 | 3 | 4>(
    profile ? (initialPreset ? 4 : 2) : 1
  );

  // Beat 1: Neural Identity & Demographics (ZERO pre-filled or pre-selected fields on first visit!)
  const [introText, setIntroText] = useState('');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [ageInput, setAgeInput] = useState<string>(profile ? String(Math.max(18, profile.age)) : '');
  const [ageError, setAgeError] = useState<string | null>(null);
  const [gender, setGender] = useState<UserGender | null>(profile?.gender ?? null);
  const [role, setRole] = useState<UserRole | null>(profile?.role ?? null);
  const [occupationLabel, setOccupationLabel] = useState(profile?.occupationLabel ?? '');
  const [noiseSensitivity] = useState<NoiseSensitivity>(profile?.noiseSensitivity ?? 'medium');

  // Privacy opt-in default (unchecked in EEA/UK/CH or GPC browsers)
  const defaultConsent = profile
    ? profile.researchConsent
    : !browserHasGpc() && !(runtimeConfig?.regionRequiresOptIn ?? true);
  const [researchConsent, setResearchConsent] = useState<boolean>(defaultConsent);
  const [consentTouched, setConsentTouched] = useState(false);

  // Beat 2: Continuous 2D Neural Compass (pre-filled if user tapped a quick goal on Hero)
  const [feelingText, setFeelingText] = useState('');
  const [neuralCoords, setNeuralCoords] = useState<NeuralCoords | null>(
    presetMicro ? { energy: presetMicro.energy, clarity: presetMicro.clarity } : null
  );
  const [selectedMicroState, setSelectedMicroState] = useState<NeuralMicroState | null>(presetMicro);
  const [currentState, setCurrentState] = useState<CurrentState>(
    presetMicro?.coreState ?? 'calm_neutral'
  );
  const [baselineScore, setBaselineScore] = useState<number>(presetMicro?.defaultBaseline ?? 3);
  const [stateError, setStateError] = useState<string | null>(null);

  // Beat 3: Target state, duration & output
  const [goalText, setGoalText] = useState('');
  const [targetState, setTargetState] = useState<TargetState>(
    initialPreset?.targetState ?? 'energy_lift'
  );
  const [durationMin, setDurationMin] = useState<number>(initialPreset?.durationMin ?? 20);
  const [environment, setEnvironment] = useState<SessionEnvironment>(
    profile?.role === 'driver' ? 'driving' : 'office'
  );
  const [device, setDevice] = useState<OutputDevice>(
    profile?.role === 'driver' ? 'car_audio' : (profile?.defaultDevice ?? 'headphones')
  );

  // Beat 4: Preferred Music Layer (6 studio + Auto + Custom Vibe)
  const [genreChoice, setGenreChoice] = useState<MusicGenreChoice>(
    initialPreset?.requestedGenre ?? 'auto'
  );
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customVibeText, setCustomVibeText] = useState('');
  const [customVibeError, setCustomVibeError] = useState<string | null>(null);

  const [listeningBeat, setListeningBeat] = useState<1 | 2 | 3 | null>(null);
  const [starting, setStarting] = useState(false);

  // Sync beat when user logs out / switches identity or restores identity
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    const raf = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(raf);
  }, [beat]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? '');
      setAgeInput(String(Math.max(18, profile.age)));
      setGender(profile.gender ?? null);
      setRole(profile.role);
      setOccupationLabel(profile.occupationLabel ?? '');
      setResearchConsent(profile.researchConsent);
      if (profile.role === 'driver') {
        setEnvironment('driving');
        setDevice('car_audio');
      } else {
        setDevice(profile.defaultDevice);
      }
      setBeat((prev) => (prev === 1 ? 2 : prev));
    } else {
      setAgeInput('');
      setGender(null);
      setRole(null);
      setBeat(1);
    }
  }, [profile?.id]);

  // Sync regional opt-in once /api/config returns
  useEffect(() => {
    if (!profile && !consentTouched && runtimeConfig) {
      setResearchConsent(!browserHasGpc() && !runtimeConfig.regionRequiresOptIn);
    }
  }, [profile, consentTouched, runtimeConfig]);

  const parsedAge = ageInput.trim() === '' ? NaN : Number(ageInput);
  const effectiveAge = Number.isFinite(parsedAge) && parsedAge >= 18 && parsedAge <= 95 ? Math.round(parsedAge) : 30;
  const effectiveGender: UserGender = gender ?? 'prefer_not_to_say';
  const effectiveRole: UserRole = role ?? 'other';

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

  const liveProfileSummary = Number.isFinite(parsedAge) && parsedAge >= 18
    ? formatProfileSummary({
        age: Math.round(parsedAge),
        gender: effectiveGender,
        role: effectiveRole,
        occupationLabel,
      })
    : [
        gender && gender !== 'prefer_not_to_say' ? GENDER_LABELS[gender] : null,
        occupationLabel.trim() || (role ? ROLE_SHORT_LABELS[role] : null),
      ]
        .filter(Boolean)
        .join(' · ') || 'Anonymous Listener';

  const handleIntroChange = (text: string) => {
    setIntroText(text);
    if (!text.trim()) return;
    const parsed = parseProfileSentence(text);
    if (parsed.displayName) setDisplayName(parsed.displayName);
    if (parsed.age && parsed.age >= 18) {
      setAgeInput(String(parsed.age));
      setAgeError(null);
    }
    if (parsed.gender) setGender(parsed.gender);
    if (parsed.role) {
      setRole(parsed.role);
      if (parsed.role === 'driver') {
        setEnvironment('driving');
        setDevice('car_audio');
      }
    }
    if (parsed.occupationLabel) setOccupationLabel(parsed.occupationLabel);
  };

  const applyMicroState = (st: NeuralMicroState, syncCoords = true) => {
    setSelectedMicroState(st);
    setCurrentState(st.coreState);
    setStateError(null);
    if (syncCoords) {
      setNeuralCoords({ energy: st.energy, clarity: st.clarity });
    }
    setBaselineScore(st.defaultBaseline);
    setTargetState(
      isDriving && (st.suggestedTarget === 'calm_reset' || st.suggestedTarget === 'sleep_winddown')
        ? 'alert_focus'
        : st.suggestedTarget
    );
  };

  const handleCompassCoordsChange = (next: NeuralCoords) => {
    setNeuralCoords(next);
    setStateError(null);
    const closest = findClosestMicroState(next.energy, next.clarity);
    setSelectedMicroState(closest);
    setCurrentState(closest.coreState);
    setBaselineScore(coordsToBaselineScore(next.energy, next.clarity));
    setTargetState(
      isDriving && (closest.suggestedTarget === 'calm_reset' || closest.suggestedTarget === 'sleep_winddown')
        ? 'alert_focus'
        : closest.suggestedTarget
    );
  };

  const handleFeelingChange = (text: string) => {
    setFeelingText(text);
    if (!text.trim()) return;
    const microMatch = matchMicroStateFromText(text);
    const parsed = parseNaturalCheckIn(text, { age: effectiveAge, role: effectiveRole, defaultDevice: device });

    if (microMatch) {
      applyMicroState(microMatch, true);
    } else {
      setCurrentState(parsed.currentState);
      const fallbackMicro =
        NEURAL_MICRO_STATES.find((s) => s.coreState === parsed.currentState) ?? DEFAULT_MICRO_STATE;
      setSelectedMicroState(fallbackMicro);
      setNeuralCoords({ energy: fallbackMicro.energy, clarity: fallbackMicro.clarity });
      setBaselineScore(fallbackMicro.defaultBaseline);
      setStateError(null);
      setTargetState(
        isDriving && (fallbackMicro.suggestedTarget === 'calm_reset' || fallbackMicro.suggestedTarget === 'sleep_winddown')
          ? 'alert_focus'
          : fallbackMicro.suggestedTarget
      );
    }

    if (parsed.environment === 'driving') {
      setEnvironment('driving');
      setDevice('car_audio');
    }
    if (parsed.extractedCustomGenre) {
      setShowCustomInput(true);
      setCustomVibeText(parsed.extractedCustomGenre);
    } else if (parsed.extractedGenre) {
      setShowCustomInput(false);
      setGenreChoice(parsed.extractedGenre);
    }
  };

  const handleGoalChange = (text: string) => {
    setGoalText(text);
    if (!text.trim()) return;
    const parsed = parseNaturalCheckIn(text, { age: effectiveAge, role: effectiveRole, defaultDevice: device });
    setTargetState(parsed.targetState);
    setDurationMin(parsed.durationMin);
    if (parsed.environment === 'driving') {
      setEnvironment('driving');
      setDevice('car_audio');
    } else if (parsed.device !== device && /\b(headphones|earbuds|speakers|car)\b/i.test(text)) {
      setDevice(parsed.device);
    }
    if (parsed.extractedCustomGenre) {
      setShowCustomInput(true);
      setCustomVibeText(parsed.extractedCustomGenre);
    } else if (parsed.extractedGenre) {
      setShowCustomInput(false);
      setGenreChoice(parsed.extractedGenre);
    }
  };

  const toggleVoiceForBeat = (targetBeat: 1 | 2 | 3) => {
    const Win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Rec = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!Rec) return;
    if (listeningBeat === targetBeat) {
      setListeningBeat(null);
      return;
    }
    const recognition = new Rec();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListeningBeat(targetBeat);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (!transcript) return;
      if (targetBeat === 1) handleIntroChange(transcript);
      else if (targetBeat === 2) handleFeelingChange(transcript);
      else if (targetBeat === 3) handleGoalChange(transcript);
    };
    recognition.onerror = () => setListeningBeat(null);
    recognition.onend = () => setListeningBeat(null);
    recognition.start();
  };

  const validateBeat1 = (): string | null => {
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 95) {
      return 'Please enter your age (18–95 required to continue).';
    }
    if (!gender) {
      return 'Please select your gender (you can pick "Prefer not to say").';
    }
    if (!role) {
      return 'Please choose what best describes your day.';
    }
    if (role === 'other' && occupationLabel.trim().length < 2) {
      return 'Please type your profession or craft to continue.';
    }
    if (!researchConsent) {
      return 'Please check "Save my anonymous profile & QR Sync Code" to continue.';
    }
    return null;
  };

  const handleAdvanceFromBeat1 = () => {
    const err = validateBeat1();
    if (err) {
      setAgeError(err);
      return;
    }
    setAgeError(null);
    setBeat(initialPreset && selectedMicroState && neuralCoords ? 4 : 2);
  };

  const handleAdvanceFromBeat2 = () => {
    if (!selectedMicroState || !neuralCoords) {
      setStateError('Tap anywhere on the 2D map or choose a quick state below to continue.');
      return;
    }
    setStateError(null);
    setBeat(3);
  };

  const handleSelectDevice = (nextDevice: OutputDevice) => {
    setDevice(nextDevice);
    if (nextDevice === 'car_audio') {
      setEnvironment('driving');
      if (targetState === 'sleep_winddown' || targetState === 'calm_reset') {
        setTargetState('alert_focus');
      }
    } else if (environment === 'driving') {
      setEnvironment(role === 'student' ? 'study' : 'office');
    }
  };

  const handleLaunch = async () => {
    if (isFirstVisit) {
      const err = validateBeat1();
      if (err) {
        setBeat(1);
        setAgeError(err);
        return;
      }
    } else if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 95) {
      setBeat(1);
      setAgeError('Please enter your age (18+ required to continue).');
      return;
    }

    const activeMicro = selectedMicroState ?? DEFAULT_MICRO_STATE;
    const activeCoords = neuralCoords ?? { energy: activeMicro.energy, clarity: activeMicro.clarity };

    let validatedCustom: string | undefined = undefined;
    let resolvedRequestedGenre: MusicGenreChoice = genreChoice;
    if (customVibeText.trim()) {
      const coreAlias = matchCoreGenreAlias(customVibeText);
      if (coreAlias) {
        resolvedRequestedGenre = coreAlias;
      } else {
        const check = sanitizeCustomVibe(customVibeText);
        if (check?.rejectedReason) {
          setShowCustomInput(true);
          setCustomVibeError(check.rejectedReason);
          return;
        }
        validatedCustom = check?.displayLabel;
      }
    }
    setCustomVibeError(null);

    setStarting(true);
    try {
      const effectiveTarget: TargetState =
        isDriving && (targetState === 'sleep_winddown' || targetState === 'calm_reset')
          ? 'alert_focus'
          : targetState;
      const effectiveDevice: OutputDevice = isDriving ? 'car_audio' : device;
      const effectiveEnv: SessionEnvironment =
        isDriving
          ? 'driving'
          : effectiveTarget === 'sleep_winddown' || effectiveTarget === 'calm_reset'
            ? 'home_relax'
            : effectiveRole === 'student'
              ? 'study'
              : 'office';
      const ephemeralMode = !researchConsent;

      const combinedRaw = [
        introText.trim(),
        feelingText.trim() ||
          `Feeling ${activeMicro.label} (Energy ${activeCoords.energy}%, Clarity ${activeCoords.clarity}%)`,
        goalText.trim() || `Want ${TARGET_LABELS[effectiveTarget]} for ${durationMin} min`,
        validatedCustom ? `Music: ${validatedCustom}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      let profileUpdate: Partial<UserProfile> | undefined = undefined;
      if (isFirstVisit) {
        const parsedBase = parseOnboardingAnswers(introText, '');
        profileUpdate = {
          displayName: displayName.trim() || undefined,
          age: Math.max(18, Math.min(95, effectiveAge || parsedBase.age)),
          gender: effectiveGender,
          role: isDriving && effectiveRole === 'knowledge_worker' ? 'driver' : effectiveRole,
          occupationLabel: occupationLabel.trim() || undefined,
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
        ephemeralMode,
        rawInputText: combinedRaw,
        currentState,
        microStateId: activeMicro.id,
        microStateLabel: activeMicro.label,
        arousalPct: activeCoords.energy,
        clarityPct: activeCoords.clarity,
        baselineScore,
        targetState: effectiveTarget,
        environment: effectiveEnv,
        device: effectiveDevice,
        durationMin,
        ageOverride: effectiveAge,
        requestedGenre: validatedCustom ? 'auto' : resolvedRequestedGenre,
        customGenreInput: validatedCustom,
      });
    } finally {
      setStarting(false);
    }
  };

  const popularCustom = runtimeConfig?.popularCustomVibes ?? [];
  const totalBeats = isFirstVisit ? 4 : 3;
  const visibleStepNum = isFirstVisit ? beat : Math.max(1, beat - 1);
  const presetDurations = [15, 20, 30, 40, 60];
  const durationOptions = presetDurations.includes(durationMin)
    ? presetDurations
    : [...presetDurations, durationMin].sort((a, b) => a - b);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center space-y-5">
      {/* Selected Mood Goal Pill (when arriving from one of the 4 Hero quick shifts) */}
      {initialPreset && (
        <div className="animate-rise w-full flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-400/35 bg-emerald-500/[0.08] px-4 py-2.5 text-xs text-emerald-100 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
            <span>
              Selected shift: <strong className="text-white">{initialPreset.label}</strong>
              {beat === 1
                ? ' · Quick profile, then pick your music'
                : ' · Pick or type your favorite music below'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClearPreset?.();
              setBeat(2);
            }}
            className="text-[11px] font-semibold text-emerald-300 underline-offset-2 hover:text-white hover:underline"
          >
            Edit mood
          </button>
        </div>
      )}

      {/* Returning Listener Neural Fingerprint Identity Bar */}
      {profile && (
        <div className="animate-rise w-full flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-2.5 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <NeuralFingerprintSigil
              seed={syncCode || profile.id}
              size={38}
              className="rounded-xl border border-cyan-400/25 bg-slate-950/80 p-0.5"
            />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-white">
                {profile.displayName ? `Welcome back, ${profile.displayName}` : 'Welcome back'}
                <span className="ml-2 font-mono-tech text-[10px] font-normal text-cyan-300">
                  {liveProfileSummary}
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                Neural Fingerprint active · {profile.sessionCount ?? 0} sessions tuned
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenIdentityModal}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-slate-900/90 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-400/15"
          >
            <QrCode className="h-3.5 w-3.5 text-cyan-300" />
            Neural Pass &amp; QR
          </button>
        </div>
      )}

      {/* Deferred Debrief Banner (returning users — ONLY shown for sessions listened >= 60s!) */}
      {pendingDebrief && (
        <div className="animate-rise w-full flex flex-col justify-between gap-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 backdrop-blur-md sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <div className="text-sm font-semibold text-amber-100">
                Unrated previous session ({pendingDebrief.armName})
              </div>
              <p className="text-xs text-amber-200/80">
                10 seconds: tell us how your {Math.max(1, Math.round(pendingDebrief.actualDurationSec / 60))}-min
                session worked so your Neural Identity keeps getting smarter.
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

      {/* Centerpiece Sonic Orb + Live Guide Question */}
      <div className="animate-rise flex flex-col items-center text-center">
        <SonicOrb
          mood={activeMood}
          size={beat === 1 || (!isFirstVisit && beat === 2) ? 'lg' : 'sm'}
          label="Tune your mind"
        />

        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.07] px-3 py-1 text-[11px] font-medium text-cyan-200">
          <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)] animate-pulse" />
          nootropic.fm · Step {visibleStepNum} of {totalBeats}
        </div>

        {beat === 1 && (
          <>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-4xl leading-[1.12]">
              Welcome to <span className="text-aurora">nootropic.fm.</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Before we start — tell me a little about you (age, gender, what you do) so I can build
              your personal Neural Identity and match the right neuroscience.
            </p>
          </>
        )}

        {beat === 2 && (
          <>
            <p className="mt-3 text-xs font-medium text-cyan-300/90">
              {isFirstVisit
                ? `Nice to meet you${displayName.trim() ? `, ${displayName.trim()}` : ''} — ${liveProfileSummary}.`
                : `Ready to tune your mind${displayName.trim() ? `, ${displayName.trim()}` : ''}?`}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-4xl leading-[1.12]">
              How are you <span className="text-aurora">feeling right now?</span>
            </h1>
          </>
        )}

        {beat === 3 && (
          <>
            <p className="mt-3 text-xs font-medium text-cyan-300/90">
              Got it — {(selectedMicroState ?? DEFAULT_MICRO_STATE).label} (Energy{' '}
              {(neuralCoords ?? DEFAULT_MICRO_STATE).energy}% · Clarity{' '}
              {(neuralCoords ?? DEFAULT_MICRO_STATE).clarity}%).
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl leading-[1.12]">
              What state do you want to reach, <span className="text-aurora">and for how long?</span>
            </h1>
          </>
        )}

        {beat === 4 && (
          <>
            <p className="mt-3 text-xs font-medium text-cyan-300/90">
              Target locked: {TARGET_LABELS[targetState]} · {durationMin} min · {DEVICE_LABELS[device]}.
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl leading-[1.12]">
              What is your favorite <span className="text-aurora">music vibe right now?</span>
            </h1>
          </>
        )}
      </div>

      {/* Progress Bars + Clickable Conversation Breadcrumbs */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        <div className="flex items-center gap-2">
          {(isFirstVisit ? ([1, 2, 3, 4] as const) : ([2, 3, 4] as const)).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                if (b <= beat || !isFirstVisit) setBeat(b);
              }}
              aria-label={`Beat ${b}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                b === beat
                  ? 'w-12 bg-gradient-to-r from-cyan-400 to-indigo-400 shadow-[0_0_12px_rgba(34,211,238,0.6)]'
                  : b < beat
                    ? 'w-7 bg-emerald-400/55 hover:bg-emerald-400/80'
                    : 'w-5 bg-slate-700/70'
              }`}
            />
          ))}
        </div>

        {/* Soft conversation breadcrumb strip showing collected answers */}
        {beat > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => (isFirstVisit ? setBeat(1) : onOpenIdentityModal())}
              className="rounded-full border border-slate-700/80 bg-slate-900/70 px-2.5 py-0.5 text-slate-300 transition hover:border-cyan-400/50 hover:text-white"
            >
              {displayName.trim() ? `${displayName.trim()} · ` : ''}
              {liveProfileSummary}
            </button>
            {beat > 2 && selectedMicroState && neuralCoords && (
              <button
                type="button"
                onClick={() => setBeat(2)}
                className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-cyan-200 transition hover:bg-cyan-400/20"
              >
                Now: {selectedMicroState.shortLabel} ({neuralCoords.energy}% / {neuralCoords.clarity}%)
              </button>
            )}
            {beat > 3 && (
              <button
                type="button"
                onClick={() => setBeat(3)}
                className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2.5 py-0.5 text-indigo-200 transition hover:bg-indigo-500/25"
              >
                Goal: {TARGET_LABELS[targetState]} · {durationMin}m
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* BEAT 1: WELCOME & NEURAL IDENTITY PROFILE (First-time visitors only) */}
      {/* ===================================================================== */}
      {beat === 1 && (
        <div key="beat-1" className="animate-step glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-mono-tech uppercase tracking-[0.16em] text-cyan-300/85">
              01 / 04 · Create Your Neural Identity (Saved Once)
            </span>
            <button
              type="button"
              onClick={onOpenIdentityModal}
              className="inline-flex items-center gap-1 font-medium text-cyan-300 hover:text-cyan-200"
            >
              <KeyRound className="h-3 w-3" />
              Have a Sync Key? Restore
            </button>
          </div>

          {/* Natural text/voice intro box */}
          <div className="space-y-2">
            <div className="glow-input-wrap">
              <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
                <textarea
                  rows={2}
                  value={introText}
                  onChange={(e) => handleIntroChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAdvanceFromBeat1();
                    }
                  }}
                  placeholder='Introduce yourself naturally — e.g. "I’m Alex, 40 years old male, programmer" (or use the quick buttons below)'
                  className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => toggleVoiceForBeat(1)}
                  className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                    listeningBeat === 1
                      ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
                  }`}
                  title="Speak your introduction"
                >
                  {listeningBeat === 1 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {introText.trim().length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-xs text-slate-200">
                <Cpu className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                <span>
                  <strong className="text-cyan-300">nootropic.fm:</strong> Got it
                  {displayName.trim() ? `, ${displayName.trim()}` : ''} —{' '}
                  <strong className="text-white">{liveProfileSummary}</strong>.
                </span>
              </div>
            )}
          </div>

          {/* Structured compact identity controls (synced live with natural text!) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-8">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                First name / Callsign <span className="text-slate-500">(optional — stay anonymous anytime)</span>
              </label>
              <input
                type="text"
                maxLength={28}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Alex (or leave blank for pure anonymous fingerprint)"
                className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Age <span className="text-cyan-300">(18+ · required)</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={18}
                max={95}
                value={ageInput}
                placeholder="e.g. 28"
                onChange={(e) => {
                  const rawVal = e.target.value;
                  setAgeInput(rawVal);
                  setAgeError(null);
                }}
                className="font-mono-tech w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Gender (required — includes "Prefer not to say") */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-slate-400">
              Gender <span className="text-cyan-300">(required)</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(['male', 'female', 'non_binary', 'prefer_not_to_say'] as UserGender[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setGender(g);
                    setAgeError(null);
                  }}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    gender === g
                      ? 'border-cyan-400/70 bg-cyan-400/15 text-white'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {GENDER_LABELS[g]}
                </button>
              ))}
            </div>
          </div>

          {/* Primary Work / Archetype (required) */}
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-slate-400">
              What best describes your day? <span className="text-cyan-300">(required)</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {(Object.keys(ROLE_SHORT_LABELS) as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    setAgeError(null);
                    if (r === 'driver') {
                      setEnvironment('driving');
                      setDevice('car_audio');
                    } else if (environment === 'driving') {
                      setEnvironment(r === 'student' ? 'study' : 'office');
                      setDevice('headphones');
                    }
                  }}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    role === r
                      ? 'border-indigo-400/70 bg-indigo-500/18 text-white shadow-[0_0_16px_rgba(129,140,248,0.2)]'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {ROLE_SHORT_LABELS[r]}
                </button>
              ))}
            </div>

            {/* Dedicated Profession Input — required when "Other" is selected */}
            {role === 'other' ? (
              <div className="animate-step rounded-2xl border border-indigo-400/40 bg-indigo-500/[0.08] p-3 space-y-1.5">
                <label className="block text-[11px] font-semibold text-indigo-200">
                  Type your profession or craft <span className="text-cyan-300">(required)</span>:
                </label>
                <input
                  type="text"
                  autoFocus
                  maxLength={40}
                  value={occupationLabel}
                  onChange={(e) => {
                    setOccupationLabel(e.target.value);
                    setAgeError(null);
                  }}
                  placeholder="e.g. Architect, Surgeon, Pilot, Chef, Trader, Musician, Therapist..."
                  className="w-full rounded-xl border border-indigo-400/35 bg-slate-950/90 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            ) : (
              <input
                type="text"
                maxLength={40}
                value={occupationLabel}
                onChange={(e) => setOccupationLabel(e.target.value)}
                placeholder={`Optional exact title (e.g. ${
                  role === 'driver'
                    ? 'Minibus Driver, Trucker'
                    : role === 'student'
                      ? 'Medical Student, PhD'
                      : role === 'creative'
                        ? 'Product Designer, Writer'
                        : role === 'entrepreneur'
                          ? 'SaaS Founder, Operations Lead'
                          : role === 'knowledge_worker'
                            ? 'Software Programmer, Data Analyst'
                            : 'Engineer, Designer, Doctor, Student'
                })`}
                className="w-full rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
              />
            )}
          </div>

          {/* Required Anonymous Profile & QR Sync Opt-In */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 text-[11px] leading-relaxed transition ${
              researchConsent
                ? 'border-emerald-400/45 bg-emerald-500/[0.10] text-slate-200'
                : ageError && !researchConsent
                  ? 'border-rose-400/70 bg-rose-500/10 text-rose-100'
                  : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-cyan-400/40'
            }`}
          >
            <input
              type="checkbox"
              checked={researchConsent}
              onChange={(e) => {
                setConsentTouched(true);
                setResearchConsent(e.target.checked);
                if (e.target.checked) setAgeError(null);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-600 bg-slate-900 accent-emerald-400"
            />
            <span>
              <strong className="inline-flex items-center gap-1 text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" /> Save my anonymous profile &amp; QR Sync Code{' '}
                <span className="text-cyan-300">(required)</span>
              </strong>{' '}
              — creates a private anonymous Sync Pass (no email, no password) so your sound adapts
              to you and contributes anonymously to cohort outcomes. You can erase it anytime in
              Privacy.
            </span>
          </label>

          {ageError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3.5 py-2.5 text-xs font-medium text-rose-200">
              {ageError}
            </div>
          )}

          <button
            type="button"
            onClick={handleAdvanceFromBeat1}
            className="btn-aurora flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 sm:text-base"
          >
            Continue — How are you feeling?
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BEAT 2: INTERACTIVE 2D NEURAL STATE COMPASS (19 MICRO-STATES)         */}
      {/* ===================================================================== */}
      {beat === 2 && (
        <div key="beat-2" className="animate-step glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
          <div className="glow-input-wrap">
            <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
              <textarea
                rows={2}
                value={feelingText}
                onChange={(e) => handleFeelingChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAdvanceFromBeat2();
                  }
                }}
                placeholder='Describe anything freely — e.g. "Over-caffeinated and jittery", "Brain fog after 5 Zoom calls", "Creative block"...'
                className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
              />
              <button
                type="button"
                onClick={() => toggleVoiceForBeat(2)}
                className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                  listeningBeat === 2
                    ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                    : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
                }`}
                title="Speak how you feel"
              >
                {listeningBeat === 2 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <NeuralCompassSelector
            coords={neuralCoords}
            selectedState={selectedMicroState}
            baselineScore={baselineScore}
            onChangeCoords={handleCompassCoordsChange}
            onSelectMicroState={(st) => applyMicroState(st, true)}
            onChangeBaseline={setBaselineScore}
          />

          {stateError && <p className="text-xs font-medium text-amber-300">{stateError}</p>}

          <div className="flex items-center gap-2.5">
            {isFirstVisit && (
              <button
                type="button"
                onClick={() => setBeat(1)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleAdvanceFromBeat2}
              className="btn-aurora flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 sm:text-base"
            >
              Next — Where do you want to go?
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BEAT 3: TARGET STATE, ISO-VECTOR TRAJECTORY, DURATION & OUTPUT        */}
      {/* ===================================================================== */}
      {beat === 3 && (
        <div key="beat-3" className="animate-step glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
          {/* Live Iso-Principle Vector Map: Current (X,Y) -> Target (X,Y) */}
          <NeuralTrajectoryPreview
            fromCoords={neuralCoords ?? { energy: DEFAULT_MICRO_STATE.energy, clarity: DEFAULT_MICRO_STATE.clarity }}
            fromLabel={(selectedMicroState ?? DEFAULT_MICRO_STATE).shortLabel}
            targetState={targetState}
            durationMin={durationMin}
          />
          <div className="glow-input-wrap">
            <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
              <textarea
                rows={2}
                value={goalText}
                onChange={(e) => handleGoalChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setBeat(4);
                  }
                }}
                placeholder='Tell me your goal — e.g. "I want to stop feeling tired for the next 20 minutes" or "Deep focus for 45 min"'
                className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
              />
              <button
                type="button"
                onClick={() => toggleVoiceForBeat(3)}
                className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                  listeningBeat === 3
                    ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                    : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
                }`}
                title="Speak your goal & duration"
              >
                {listeningBeat === 3 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Target State Pills */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TARGET_CARDS.map((card) => {
              const disabledForDriving =
                isDriving && (card.target === 'sleep_winddown' || card.target === 'calm_reset');
              const active = targetState === card.target;
              return (
                <button
                  key={card.target}
                  type="button"
                  disabled={disabledForDriving}
                  onClick={() => {
                    setTargetState(card.target);
                    if (!goalText.trim()) setDurationMin(card.defaultMin);
                  }}
                  className={`rounded-2xl border px-3.5 py-2.5 text-left transition-all disabled:opacity-35 ${
                    active
                      ? 'border-cyan-400 bg-cyan-400/15 shadow-[0_0_20px_rgba(34,211,238,0.18)]'
                      : 'border-slate-800/90 bg-slate-950/60 hover:border-cyan-400/40'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">{card.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{card.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Duration & Listening Output */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                For how long?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {durationOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMin(m)}
                    className={`rounded-xl border px-3 py-2 font-mono-tech text-xs font-semibold transition ${
                      durationMin === m
                        ? 'border-cyan-400/70 bg-cyan-400/15 text-cyan-200'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400">How are you listening?</div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectDevice('headphones')}
                  className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition ${
                    device === 'headphones' && !isDriving
                      ? 'border-cyan-400/70 bg-cyan-400/14 text-cyan-200'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <Headphones className="h-3.5 w-3.5" />
                  Headphones
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDevice('speakers')}
                  className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition ${
                    device === 'speakers' && !isDriving
                      ? 'border-cyan-400/70 bg-cyan-400/14 text-cyan-200'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  Speakers
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDevice('car_audio')}
                  className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition ${
                    isDriving
                      ? 'border-amber-400/70 bg-amber-500/15 text-amber-200'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <Car className="h-3.5 w-3.5" />
                  Car Safety
                </button>
              </div>
            </div>
          </div>

          {isDriving && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/8 p-3 text-xs text-amber-100/90">
              <Car className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>
                <strong className="text-amber-200">Driving Safety Mode active:</strong> Traffic
                sirens &amp; horns (800–3500 Hz) stay completely open, and anti-monotony pulse is
                enabled.
              </span>
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setBeat(2)}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => setBeat(4)}
              className="btn-aurora flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 sm:text-base"
            >
              Next — Pick your music vibe
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BEAT 4: PREFERRED MUSIC LAYER (6 Instant R2 + Auto + Custom Vibe)     */}
      {/* ===================================================================== */}
      {beat === 4 && (
        <div key="beat-4" className="animate-step glass-stage w-full rounded-3xl p-5 sm:p-7 space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                <Music2 className="h-4 w-4 text-indigo-400" />
                Choose the music layer we’ll fuse with your scientific frequencies
              </span>
              <span className="text-[11px] text-slate-500">Lyric-free · R2 Studio + Any Genre</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCustomInput(false);
                  setCustomVibeText('');
                  setCustomVibeError(null);
                  setGenreChoice('auto');
                }}
                className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                  !customVibeText.trim() && !showCustomInput && genreChoice === 'auto'
                    ? 'border-cyan-400 bg-cyan-400/20 text-white shadow-[0_0_16px_rgba(34,211,238,0.28)]'
                    : 'subtle-chip'
                }`}
              >
                {!customVibeText.trim() && !showCustomInput && genreChoice === 'auto' ? '✓ ' : ''}
                Auto (Best for my brain)
              </button>

              {(Object.keys(GENRE_META) as ResolvedGenre[]).map((g) => {
                const isSelected = !customVibeText.trim() && !showCustomInput && genreChoice === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setShowCustomInput(false);
                      setCustomVibeText('');
                      setCustomVibeError(null);
                      setGenreChoice(g);
                    }}
                    className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                      isSelected
                        ? 'border-cyan-400 bg-cyan-400/22 text-white shadow-[0_0_18px_rgba(34,211,238,0.3)]'
                        : 'subtle-chip'
                    }`}
                  >
                    {isSelected ? '✓ ' : ''}
                    {GENRE_META[g].label}
                  </button>
                );
              })}

              {/* Instant R2 Cached Community Genres (e.g. Reggae) surfaced directly for 1-tap selection */}
              {popularCustom
                .filter(
                  (v, idx, arr) => arr.findIndex((x) => x.genreSlug === v.genreSlug) === idx
                )
                .slice(0, 4)
                .map((v) => {
                  const isSelected =
                    customVibeText.trim().toLowerCase() === v.displayLabel.toLowerCase();
                  return (
                    <button
                      key={v.genreSlug}
                      type="button"
                      onClick={() => {
                        setCustomVibeText(v.displayLabel);
                        setCustomVibeError(null);
                        setShowCustomInput(true);
                      }}
                      className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                        isSelected
                          ? 'border-fuchsia-400 bg-fuchsia-500/25 text-white shadow-[0_0_18px_rgba(217,70,239,0.3)]'
                          : 'border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100 hover:border-fuchsia-400/70'
                      }`}
                    >
                      {isSelected ? '✓ ' : ''}
                      {v.displayLabel}
                    </button>
                  );
                })}

              <button
                type="button"
                onClick={() => setShowCustomInput((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                  showCustomInput
                    ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 shadow-[0_0_16px_rgba(217,70,239,0.25)]'
                    : 'border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-200 hover:border-fuchsia-400/65'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                Type any genre
              </button>
            </div>

            {/* Custom Any-Genre Input + Community R2 Cache Chips */}
            {showCustomInput && (
              <div className="animate-step space-y-2.5 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/[0.06] p-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-fuchsia-200">
                    Type any instrumental genre you feel like right now:
                  </span>
                  <span className="font-mono-tech text-[10px] text-fuchsia-300/80">
                    {runtimeConfig?.customLiveGenAvailable
                      ? `2-Speed R2 Cache · ${runtimeConfig.dailyCapRemaining} live slots today`
                      : 'R2 Community Cache + Closest Studio Match'}
                  </span>
                </div>
                <input
                  type="text"
                  value={customVibeText}
                  onChange={(e) => {
                    setCustomVibeText(e.target.value);
                    setCustomVibeError(null);
                  }}
                  placeholder="e.g. chill reggae, synthwave, bossa nova, ambient techno, acoustic funk..."
                  className="w-full rounded-xl border border-slate-700/90 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none"
                />
                {customVibeError && <p className="text-[11px] text-rose-300">{customVibeError}</p>}

                {popularCustom.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-slate-400">Instant in Community R2 Cache:</span>
                    {popularCustom.slice(0, 6).map((v) => (
                      <button
                        key={`${v.genreSlug}_${v.energyTier}`}
                        type="button"
                        onClick={() => {
                          setCustomVibeText(v.displayLabel);
                          setCustomVibeError(null);
                        }}
                        className="rounded-full border border-fuchsia-400/30 bg-slate-950/80 px-2.5 py-0.5 text-[10px] font-medium text-fuchsia-200 hover:border-fuchsia-300"
                      >
                        {v.displayLabel}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setBeat(3)}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              disabled={starting}
              onClick={() => void handleLaunch()}
              className="btn-aurora flex flex-1 items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 disabled:opacity-60 sm:text-base"
            >
              <Sparkles className="h-5 w-5" />
              {starting
                ? 'Building your custom sound...'
                : (() => {
                    const alias = customVibeText.trim()
                      ? matchCoreGenreAlias(customVibeText)
                      : null;
                    const sanitized = !alias && customVibeText.trim()
                      ? sanitizeCustomVibe(customVibeText)
                      : null;
                    const activeMusicName = alias
                      ? GENRE_META[alias].label
                      : sanitized?.displayLabel
                        ? sanitized.displayLabel
                        : genreChoice !== 'auto'
                          ? GENRE_META[genreChoice].label
                          : 'Auto Music';
                    return profile?.planTier === 'pro'
                      ? `Craft My Sound · ${activeMusicName}`
                      : `Play ${activeMusicName} · 5 Min Free`;
                  })()}
            </button>
          </div>

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
