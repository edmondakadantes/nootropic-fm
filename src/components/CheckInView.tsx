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
  QrCode,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Volume2,
  X,
  Zap,
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
  computeIsoBridgeForState,
  pickSmartInitialEffectTier,
} from '../../shared/psychometrics';
import {
  CURATED_GOAL_PRESETS,
  resolveOpenGoalIntent,
  type OpenGoalResolution,
} from '../../shared/openGoals';
import {
  parseNaturalCheckIn,
  parseOnboardingAnswers,
  parseProfileSentence,
} from '../../shared/parser';
import {
  DEVICE_LABELS,
  GENDER_LABELS,
  GENRE_META,
  ROLE_SHORT_LABELS,
  STUDIO_MIX_GENRES,
  TARGET_LABELS,
  formatProfileSummary,
  isProfileOnboardingComplete,
  type AppRuntimeConfig,
  type CurrentState,
  type MusicGenreChoice,
  type NoiseSensitivity,
  type OutputDevice,
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
  themeMode?: 'daylight' | 'night';
  onClearPreset?: () => void;
  onOpenPendingDebrief: () => void;
  onDismissPending: () => void;
  onOpenIdentityModal: () => void;
  onEditProfile?: () => void;
  onSaveProfileStep?: (data: Partial<UserProfile>) => Promise<void>;
  onMoodChange?: (mood: FieldMood) => void;
  onOpenSoundSystems?: () => void;
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
    customGoalText?: string;
    customGoalSlug?: string;
    customGoalLabel?: string;
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
  themeMode = 'night',
  onClearPreset,
  onOpenPendingDebrief,
  onDismissPending,
  onOpenIdentityModal,
  onSaveProfileStep,
  onMoodChange,
  onOpenSoundSystems,
  onLaunchUnifiedSession,
}: CheckInViewProps) {
  const onboardingComplete = isProfileOnboardingComplete(profile);
  const isFirstVisit = !onboardingComplete;
  const presetMicro = initialPreset
    ? NEURAL_MICRO_STATES.find((s) => s.id === initialPreset.microStateId) ?? null
    : null;
  const [beat, setBeat] = useState<1 | 2 | 3 | 4>(
    onboardingComplete ? (initialPreset ? 4 : 2) : 1
  );

  // Beat 1: Neural Identity & Demographics (ZERO pre-filled fields until real Onboarding is completed!)
  const [introText, setIntroText] = useState('');
  const [displayName, setDisplayName] = useState(
    onboardingComplete ? (profile?.displayName ?? '') : ''
  );
  const [ageInput, setAgeInput] = useState<string>(
    onboardingComplete && profile ? String(Math.max(18, profile.age)) : ''
  );
  const [ageError, setAgeError] = useState<string | null>(null);
  const [gender, setGender] = useState<UserGender | null>(
    onboardingComplete ? (profile?.gender ?? null) : null
  );
  const [role, setRole] = useState<UserRole | null>(
    onboardingComplete && profile ? profile.role : null
  );
  const [occupationLabel, setOccupationLabel] = useState(
    onboardingComplete ? (profile?.occupationLabel ?? '') : ''
  );
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

  // Beat 3: Target state, open-goal intent, duration & output
  const [goalText, setGoalText] = useState('');
  const [targetState, setTargetState] = useState<TargetState>(
    initialPreset?.targetState ?? 'energy_lift'
  );
  const [selectedGoalSlug, setSelectedGoalSlug] = useState<string | null>(
    initialPreset?.targetState ?? null
  );
  const [openGoalIntent, setOpenGoalIntent] = useState<OpenGoalResolution | null>(null);
  const [targetPicked, setTargetPicked] = useState<boolean>(Boolean(initialPreset));
  const [targetError, setTargetError] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState<number>(initialPreset?.durationMin ?? 20);
  const [environment, setEnvironment] = useState<SessionEnvironment>(
    profile?.role === 'driver' ? 'driving' : 'office'
  );
  const [device, setDevice] = useState<OutputDevice>(
    profile?.role === 'driver' ? 'car_audio' : (profile?.defaultDevice ?? 'headphones')
  );

  // Beat 4: Preferred Music Layer (10 curated studio + infinite AI genres)
  const [genreChoice, setGenreChoice] = useState<MusicGenreChoice>(
    initialPreset?.requestedGenre ??
      (profile?.favoriteGenres && profile.favoriteGenres.length > 0 ? 'auto' : 'deep_electronic')
  );

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
    if (profile && isProfileOnboardingComplete(profile)) {
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
    } else if (!profile) {
      setAgeInput('');
      setGender(null);
      setRole(null);
      setOccupationLabel('');
      setBeat(1);
    }
  }, [profile?.id, onboardingComplete]);

  useEffect(() => {
    if (selectedGoalSlug === 'trance_lock') {
      setGenreChoice('nootropic_trance');
    }
  }, [selectedGoalSlug]);

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
    if (parsed.extractedGenre) {
      setGenreChoice(parsed.extractedGenre);
    }
  };

  const handleGoalChange = (text: string) => {
    setGoalText(text);
    if (!text.trim()) {
      setOpenGoalIntent(null);
      return;
    }
    const parsed = parseNaturalCheckIn(text, { age: effectiveAge, role: effectiveRole, defaultDevice: device });
    const hasExplicitMin = /\b(\d{1,3})\s*(?:minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b|(?:an?\s+hour)/i.test(
      text
    );
    const resolved = resolveOpenGoalIntent(text, isDriving);
    if (resolved) {
      setOpenGoalIntent(resolved);
      setSelectedGoalSlug(resolved.slug);
      setTargetState(resolved.coreTarget);
      setTargetPicked(true);
      setTargetError(null);
      setDurationMin(hasExplicitMin ? parsed.durationMin : resolved.defaultMin);
    } else {
      setOpenGoalIntent(null);
      setTargetState(parsed.targetState);
      setSelectedGoalSlug(parsed.targetState);
      setTargetPicked(true);
      setTargetError(null);
      if (hasExplicitMin) setDurationMin(parsed.durationMin);
    }
    if (parsed.environment === 'driving') {
      setEnvironment('driving');
      setDevice('car_audio');
    } else if (parsed.device !== device && /\b(headphones|earbuds|speakers|car)\b/i.test(text)) {
      setDevice(parsed.device);
    }
    if (parsed.extractedGenre) {
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
    return null;
  };

  const handleAdvanceFromBeat1 = () => {
    const err = validateBeat1();
    if (err) {
      setAgeError(err);
      return;
    }
    setAgeError(null);
    if (researchConsent && onSaveProfileStep) {
      const parsedBase = parseOnboardingAnswers(introText, '');
      void onSaveProfileStep({
        id: profile?.id,
        displayName: displayName.trim() || undefined,
        age: Math.max(18, Math.min(95, effectiveAge || parsedBase.age)),
        gender: effectiveGender,
        role: isDriving && effectiveRole === 'knowledge_worker' ? 'driver' : effectiveRole,
        occupationLabel: occupationLabel.trim() || undefined,
        texturePref: parsedBase.texturePref,
        noiseSensitivity,
        defaultDevice: isDriving ? 'car_audio' : device,
        primaryChallenge: 'distraction',
        researchConsent: true,
      }).catch(() => {});
    }
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

  const handleLaunch = async (genreOverride?: MusicGenreChoice) => {
    const activeGenreChoice = genreOverride ?? genreChoice;
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
      ]
        .filter(Boolean)
        .join(' | ');

      const parsedBase = parseOnboardingAnswers(introText, '');
      const profileUpdate: Partial<UserProfile> = {
        id: profile?.id,
        displayName: displayName.trim() || undefined,
        age: Math.max(18, Math.min(95, effectiveAge || parsedBase.age)),
        gender: effectiveGender,
        role: isDriving && effectiveRole === 'knowledge_worker' ? 'driver' : effectiveRole,
        occupationLabel: occupationLabel.trim() || undefined,
        texturePref: profile?.texturePref ?? parsedBase.texturePref,
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

      const activeCuratedGoal = CURATED_GOAL_PRESETS.find((g) => g.slug === selectedGoalSlug);
      const effectiveCustomGoalSlug =
        activeGenreChoice === 'nootropic_trance'
          ? 'trance_lock'
          : (openGoalIntent?.slug ?? activeCuratedGoal?.slug ?? undefined);
      const effectiveCustomGoalLabel =
        activeGenreChoice === 'nootropic_trance'
          ? 'NootropicFM Signature Lock (6×40 Hz)'
          : (openGoalIntent?.label ?? activeCuratedGoal?.label ?? undefined);

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
        customGoalText: goalText.trim() || undefined,
        customGoalSlug: effectiveCustomGoalSlug,
        customGoalLabel: effectiveCustomGoalLabel,
        environment: effectiveEnv,
        device:
          activeGenreChoice === 'nootropic_trance' && !isDriving
            ? 'headphones'
            : effectiveDevice,
        durationMin,
        ageOverride: effectiveAge,
        requestedGenre: activeGenreChoice,
      });
    } finally {
      setStarting(false);
    }
  };

  const totalBeats = isFirstVisit ? 4 : 3;
  const visibleStepNum = isFirstVisit ? beat : Math.max(1, beat - 1);
  const presetDurations = [15, 20, 30, 40, 60];
  const durationOptions = presetDurations.includes(durationMin)
    ? presetDurations
    : [...presetDurations, durationMin].sort((a, b) => a - b);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center space-y-5">
      {/* Explicit Platform Acoustic Law: Engineered Exclusively for In-Ear Buds + Sound Systems Lab */}
      {!isDriving && (
        <div className="animate-rise flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/[0.07] px-3.5 py-2 text-[11px] text-[#D4D4CE]">
          <span className="inline-flex items-center gap-2">
            <Headphones className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
            <span>
              <strong className="uppercase tracking-wider text-[#34D399]">
                Engineered Exclusively for In-Ear Buds:
              </strong>{' '}
              Seal both earbuds for 100% dichotic L/R phase-lock &amp; zero room crosstalk.
            </span>
          </span>
          {onOpenSoundSystems && (
            <button
              type="button"
              onClick={onOpenSoundSystems}
              className="shrink-0 rounded-md border border-emerald-400/35 bg-[#0B0C0E] px-2.5 py-1 font-mono-tech text-[10px] font-semibold text-[#34D399] transition hover:border-emerald-400/70 hover:text-[#F3F1EC]"
            >
              Sound Systems · Earbuds 01 →
            </button>
          )}
        </div>
      )}

      {/* Selected Mood Goal Pill */}
      {initialPreset && (
        <div className="animate-rise w-full flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/[0.06] px-4 py-2.5 text-xs text-[#D4D4CE]">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
            <span>
              Selected shift: <strong className="text-[#F3F1EC]">{initialPreset.label}</strong>
              {beat === 1
                ? ' · Quick profile, then pick your music'
                : ' · Pick your favorite music below'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClearPreset?.();
              setBeat(2);
            }}
            className="text-[11px] font-semibold text-[#34D399] underline-offset-2 hover:text-[#F3F1EC] hover:underline"
          >
            Edit mood
          </button>
        </div>
      )}

      {/* Returning Listener Identity + Personal Neural AI Memory Card (shown only after Onboarding Step 1 is completed and user is on Step 2+) */}
      {profile && onboardingComplete && beat > 1 && (() => {
        const mem = profile.neuralMemory;
        const calPct = mem?.calibrationPct ?? 0;
        const sessionsCount = Math.max(profile.sessionCount ?? 0, mem?.learnedSessions ?? 0);
        const isDay = themeMode === 'daylight';
        return (
          <div className="animate-rise w-full space-y-2.5">
            <div className="w-full flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-white/10 bg-[#101114] px-4 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <NeuralFingerprintSigil
                  seed={syncCode || profile.id}
                  size={38}
                  className="rounded-lg border border-white/10 bg-[#08090B] p-0.5"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[#F3F1EC]">
                    {profile.displayName ? `Welcome back, ${profile.displayName}` : 'Welcome back'}
                    <span className="ml-2 font-mono-tech text-[10px] font-normal text-[#34D399]">
                      {liveProfileSummary}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#7E7E78]">
                    Neural Tuning AI active · {sessionsCount} session{sessionsCount === 1 ? '' : 's'} learned for your mind
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setBeat(1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#141518] px-2.5 py-1.5 text-[11px] font-medium text-[#A3A39E] transition hover:border-white/25 hover:text-[#F3F1EC]"
                  title="Edit your Onboarding profile (age, gender, occupation)"
                >
                  <UserCog className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>Edit Profile</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenIdentityModal}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-[#16181C] px-3 py-1.5 text-[11px] font-semibold text-[#D4D4CE] transition hover:border-white/30 hover:text-[#F3F1EC]"
                >
                  <QrCode className="h-3.5 w-3.5 text-[#34D399]" />
                  Neural Pass &amp; QR
                </button>
              </div>
            </div>

            {profile.researchConsent && mem && (
              <div
                data-testid="personal-neural-memory-card"
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  isDay
                    ? 'border-slate-300/90 bg-white/95 text-slate-900 shadow-sm'
                    : 'border-emerald-400/20 bg-[#0D1117]/95 text-[#F3F1EC]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-[0.14em]">
                    <Cpu className={`h-3.5 w-3.5 ${isDay ? 'text-[#1E40AF]' : 'text-[#34D399]'}`} />
                    <span className={isDay ? 'text-[#1E40AF]' : 'text-[#34D399]'}>
                      Your Personal Neural AI Memory
                    </span>
                  </div>
                  <span
                    className={`font-mono-tech text-[11px] font-bold ${
                      isDay ? 'text-[#047857]' : 'text-[#34D399]'
                    }`}
                  >
                    {calPct}% Calibrated
                  </span>
                </div>
                <div
                  className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${
                    isDay ? 'bg-slate-200' : 'bg-white/10'
                  }`}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isDay ? 'bg-[#047857]' : 'bg-[#34D399]'
                    }`}
                    style={{ width: `${Math.max(4, calPct)}%` }}
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-mono-tech">
                  <span
                    className={`rounded-md border px-2 py-0.5 ${
                      isDay
                        ? 'border-slate-300 bg-slate-50 text-slate-800'
                        : 'border-white/12 bg-[#14171D] text-[#D4D4CE]'
                    }`}
                  >
                    IAF {mem.personalIafHz.toFixed(1)} Hz
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 ${
                      isDay
                        ? 'border-slate-300 bg-slate-50 text-slate-800'
                        : 'border-white/12 bg-[#14171D] text-[#D4D4CE]'
                    }`}
                  >
                    Focus {mem.focusOffsetHz >= 0 ? `+${mem.focusOffsetHz.toFixed(1)}` : mem.focusOffsetHz.toFixed(1)} Hz
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 ${
                      isDay
                        ? 'border-slate-300 bg-slate-50 text-slate-800'
                        : 'border-white/12 bg-[#14171D] text-[#D4D4CE]'
                    }`}
                  >
                    Dose {Math.round(mem.focusModMult * 100)}% / Calm {Math.round(mem.calmModMult * 100)}%
                  </span>
                  {mem.peakChronoBucket && (
                    <span
                      className={`rounded-md border px-2 py-0.5 capitalize ${
                        isDay
                          ? 'border-slate-300 bg-slate-50 text-[#1E40AF]'
                          : 'border-sky-400/25 bg-sky-500/10 text-sky-300'
                      }`}
                    >
                      Peak: {mem.peakChronoBucket}
                    </span>
                  )}
                  {mem.fatigueDipMinute && (
                    <span
                      className={`rounded-md border px-2 py-0.5 ${
                        isDay
                          ? 'border-slate-300 bg-slate-50 text-[#047857]'
                          : 'border-emerald-400/25 bg-emerald-500/10 text-[#34D399]'
                      }`}
                    >
                      Pre-Dip Lift @ {Math.max(4, mem.fatigueDipMinute - 2)}m
                    </span>
                  )}
                  {mem.causalLiftMs !== null && mem.causalLiftMs > 0 && (
                    <span
                      className={`rounded-md border px-2 py-0.5 font-bold ${
                        isDay
                          ? 'border-emerald-600/30 bg-emerald-50 text-[#047857]'
                          : 'border-emerald-400/40 bg-emerald-500/15 text-[#34D399]'
                      }`}
                    >
                      PVT Lift: {mem.causalLiftMs} ms faster vs Sham
                    </span>
                  )}
                </div>
                {mem.lastInsightLine && (
                  <p className={`mt-1.5 text-[11px] leading-snug ${isDay ? 'text-slate-600' : 'text-[#A3A39E]'}`}>
                    {mem.lastInsightLine}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Deferred Debrief Banner (returning users) */}
      {pendingDebrief && (
        <div className="animate-rise w-full flex flex-col justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <div className="text-sm font-semibold text-amber-100">
                Unrated previous session ({pendingDebrief.armName})
              </div>
              <p className="text-xs text-amber-200/80">
                10 seconds: rate how your {Math.max(1, Math.round(pendingDebrief.actualDurationSec / 60))}-min
                session worked so your profile keeps adapting.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenPendingDebrief}
              className="rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-[#0A0B0C] transition hover:bg-amber-300"
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

      {/* Calibration Header & Live Step Prompt */}
      <div className="animate-rise flex flex-col items-center text-center">
        <SonicOrb
          mood={activeMood}
          size={beat === 1 || (!isFirstVisit && beat === 2) ? 'lg' : 'sm'}
          label={`Step ${visibleStepNum} of ${totalBeats} · Adaptive AI Calibration`}
          themeMode={themeMode}
        />

        {beat === 1 && (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F3F1EC] sm:text-4xl leading-[1.12]">
              Welcome to <span className="text-[#34D399]">nootropic.fm.</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#A3A39E] sm:text-base">
              How the human mind responds to sound is still largely unexplored. Share your age,
              gender, and role so the <strong className="text-[#F3F1EC]">nootropic.fm</strong> AI
              can test published acoustic studies from how you feel to where you want to arrive —
              and learn how to tune your mind at its peak.
            </p>
          </>
        )}

        {beat === 2 && (
          <>
            <p className="mt-3 font-mono-tech text-[11px] uppercase tracking-wider text-[#34D399]">
              {isFirstVisit
                ? `${displayName.trim() ? `${displayName.trim()} · ` : ''}${liveProfileSummary}`
                : `Ready to tune${displayName.trim() ? `, ${displayName.trim()}` : ''}`}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#F3F1EC] sm:text-4xl leading-[1.12]">
              How are you <span className="text-[#34D399]">feeling right now?</span>
            </h1>
          </>
        )}

        {beat === 3 && (
          <>
            <p className="mt-3 font-mono-tech text-[11px] text-[#34D399]">
              Current state: {(selectedMicroState ?? DEFAULT_MICRO_STATE).label} (Energy{' '}
              {(neuralCoords ?? DEFAULT_MICRO_STATE).energy}% · Clarity{' '}
              {(neuralCoords ?? DEFAULT_MICRO_STATE).clarity}%)
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#F3F1EC] sm:text-3xl leading-[1.12]">
              What state do you want to reach, <span className="text-[#34D399]">and for how long?</span>
            </h1>
          </>
        )}

        {beat === 4 && (
          <>
            <p className="mt-3 font-mono-tech text-[11px] text-[#34D399]">
              Target locked:{' '}
              {openGoalIntent?.label ??
                CURATED_GOAL_PRESETS.find((g) => g.slug === selectedGoalSlug)?.label ??
                TARGET_LABELS[targetState]}{' '}
              · {durationMin} min · {DEVICE_LABELS[device]}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#F3F1EC] sm:text-3xl leading-[1.12]">
              Choose your <span className="text-[#34D399]">music style</span>
            </h1>
          </>
        )}
      </div>

      {/* Progress Bars + Clickable Breadcrumbs */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        <div className="flex items-center gap-2">
          {([1, 2, 3, 4] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                if (b <= beat || !isFirstVisit) setBeat(b);
              }}
              aria-label={`Beat ${b}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                b === beat
                  ? 'w-12 bg-[#34D399]'
                  : b < beat
                    ? 'w-7 bg-emerald-400/50 hover:bg-emerald-400/80'
                    : 'w-5 bg-white/15'
              }`}
            />
          ))}
        </div>

        {/* Soft breadcrumb strip showing collected answers */}
        {beat > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => setBeat(1)}
              className="rounded-md border border-white/12 bg-[#141518] px-2.5 py-0.5 text-[#D4D4CE] transition hover:border-white/30 hover:text-[#F3F1EC]"
              title="Click to edit your age or occupation"
            >
              {displayName.trim() ? `${displayName.trim()} · ` : ''}
              {liveProfileSummary}
            </button>
            {beat > 2 && selectedMicroState && neuralCoords && (
              <button
                type="button"
                onClick={() => setBeat(2)}
                className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[#34D399] transition hover:bg-emerald-500/20"
              >
                Now: {selectedMicroState.shortLabel} ({neuralCoords.energy}% / {neuralCoords.clarity}%)
              </button>
            )}
            {beat > 3 && (
              <button
                type="button"
                onClick={() => setBeat(3)}
                className="rounded-md border border-white/15 bg-[#181A1F] px-2.5 py-0.5 text-[#F3F1EC] transition hover:border-white/30"
              >
                Goal:{' '}
                {openGoalIntent?.label ??
                  CURATED_GOAL_PRESETS.find((g) => g.slug === selectedGoalSlug)?.label ??
                  TARGET_LABELS[targetState]}{' '}
                · {durationMin}m
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* BEAT 1: WELCOME & NEURAL IDENTITY PROFILE (First-time visitors only) */}
      {/* ===================================================================== */}
      {beat === 1 && (
        <div key="beat-1" className="animate-step glass-stage w-full rounded-2xl p-5 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-mono-tech uppercase tracking-[0.14em] text-[#34D399]">
              01 / 04 · Create Your Neural Identity (Saved Once)
            </span>
            <button
              type="button"
              onClick={onOpenIdentityModal}
              className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] hover:text-[#34D399]"
            >
              <KeyRound className="h-3 w-3 text-[#34D399]" />
              Have a Sync Key? Restore
            </button>
          </div>

          {/* Natural text/voice intro box */}
          <div className="space-y-2">
            <div className="glow-input-wrap">
              <div className="relative flex items-start rounded-[0.8rem] bg-[#0B0C0E]">
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
                  placeholder='Introduce yourself naturally, e.g. "I am Alex, 40 years old male, programmer" (or use buttons below)'
                  className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-[#F3F1EC] placeholder-[#5F605C] focus:outline-none sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => toggleVoiceForBeat(1)}
                  className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-all ${
                    listeningBeat === 1
                      ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-white/12 bg-[#141518] text-[#34D399] hover:border-emerald-400/50 hover:bg-[#191B1F]'
                  }`}
                  title="Speak your introduction"
                >
                  {listeningBeat === 1 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {introText.trim().length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/[0.06] px-3 py-2 text-xs text-[#D4D4CE]">
                <Cpu className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span>
                  <strong className="text-[#34D399]">Detected profile:</strong>{' '}
                  {displayName.trim() ? `${displayName.trim()}, ` : ''}
                  <strong className="text-[#F3F1EC]">{liveProfileSummary}</strong>
                </span>
              </div>
            )}
          </div>

          {/* Structured compact identity controls */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-8">
              <label className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
                First name / Callsign <span className="text-[#8E8E88]">(optional, anonymous by default)</span>
              </label>
              <input
                type="text"
                maxLength={28}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Alex (or leave blank for anonymous pass)"
                className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
                Age <span className="text-[#34D399]">(18+ · required)</span>
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
                className="font-mono-tech w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Gender */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-[#A3A39E]">
              Gender <span className="text-[#34D399]">(required)</span>
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
                      ? 'border-emerald-400/60 bg-emerald-400/12 text-[#F3F1EC]'
                      : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/20 hover:text-[#F3F1EC]'
                  }`}
                >
                  {GENDER_LABELS[g]}
                </button>
              ))}
            </div>
          </div>

          {/* Primary Work / Archetype */}
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-[#A3A39E]">
              What best describes your day? <span className="text-[#34D399]">(required)</span>
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
                      ? 'border-emerald-400/60 bg-emerald-400/12 text-[#F3F1EC]'
                      : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/20 hover:text-[#F3F1EC]'
                  }`}
                >
                  {ROLE_SHORT_LABELS[r]}
                </button>
              ))}
            </div>

            {role === 'other' ? (
              <div className="animate-step rounded-xl border border-emerald-400/35 bg-emerald-500/[0.06] p-3 space-y-1.5">
                <label className="block text-[11px] font-semibold text-[#F3F1EC]">
                  Type your profession or craft <span className="text-[#34D399]">(required)</span>:
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
                  className="w-full rounded-lg border border-white/15 bg-[#0B0C0E] px-3.5 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
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
                className="w-full rounded-xl border border-white/[0.08] bg-[#0B0C0E] px-3 py-2 text-[11px] text-[#D4D4CE] placeholder-[#5F605C] focus:border-emerald-400/60 focus:outline-none"
              />
            )}
          </div>

          {/* Optional Anonymous Profile & QR Sync Opt-In (uncheck for 100% local-only mode) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[11px] leading-relaxed transition ${
              researchConsent
                ? 'border-emerald-400/40 bg-emerald-500/[0.08] text-[#D4D4CE]'
                : 'border-white/12 bg-[#0B0C0E] text-[#A3A39E] hover:border-white/25'
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
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-[#141518] accent-emerald-400"
            />
            <span>
              <strong className="inline-flex items-center gap-1 text-[#34D399]">
                <ShieldCheck className="h-3.5 w-3.5" /> Save my anonymous profile &amp; QR Sync Code{' '}
                <span className="font-normal text-[#A3A39E]">(optional · uncheck for local-only mode)</span>
              </strong>{' '}
              creates a private anonymous Sync Pass (no email, no password) so the sound adapts
              over time and contributes anonymously to cohort metrics. Unchecked = 100% local-only
              with zero server writes.
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
            className="btn-aurora flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold sm:text-base"
          >
            {initialPreset && selectedMicroState && neuralCoords
              ? 'Continue: Choose Music Style'
              : 'Continue: Current State'}
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BEAT 2: INTERACTIVE 2D NEURAL STATE COMPASS (19 MICRO-STATES)         */}
      {/* ===================================================================== */}
      {beat === 2 && (
        <div key="beat-2" className="animate-step glass-stage w-full rounded-2xl p-5 sm:p-7 space-y-5">
          <div className="glow-input-wrap">
            <div className="relative flex items-start rounded-[0.8rem] bg-[#0B0C0E]">
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
                placeholder='Describe anything freely, e.g. "Over-caffeinated and jittery", "Brain fog after 5 calls", "Creative block"...'
                className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-[#F3F1EC] placeholder-[#5F605C] focus:outline-none sm:text-base"
              />
              <button
                type="button"
                onClick={() => toggleVoiceForBeat(2)}
                className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-all ${
                  listeningBeat === 2
                    ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                    : 'border-white/12 bg-[#141518] text-[#34D399] hover:border-emerald-400/50 hover:bg-[#191B1F]'
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
            themeMode={themeMode}
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
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-4 py-4 text-xs font-medium text-[#D4D4CE] hover:border-white/25 hover:text-[#F3F1EC]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleAdvanceFromBeat2}
              className="btn-aurora flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold sm:text-base"
            >
              Next: Target &amp; Duration
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BEAT 3: TARGET STATE, ISO-VECTOR TRAJECTORY, DURATION & OUTPUT        */}
      {/* ===================================================================== */}
      {beat === 3 && (
        <div key="beat-3" className="animate-step glass-stage w-full rounded-2xl p-5 sm:p-7 space-y-5">
          {/* Live Iso-Principle Vector Map: Current (X,Y) -> Target (X,Y) — drawn ONLY once targetPicked */}
          {(() => {
            const activeMicro = selectedMicroState ?? DEFAULT_MICRO_STATE;
            const activeFrom = neuralCoords ?? {
              energy: activeMicro.energy,
              clarity: activeMicro.clarity,
            };
            const activePreset = CURATED_GOAL_PRESETS.find((g) => g.slug === selectedGoalSlug);
            const customCoords = targetPicked
              ? (openGoalIntent?.coords ?? activePreset?.coords ?? null)
              : null;
            const customLabel = targetPicked
              ? (openGoalIntent?.label ?? activePreset?.label ?? null)
              : null;
            const previewTargetHz =
              openGoalIntent?.dspOverride?.modulationHz ??
              activePreset?.dspOverride?.modulationHz ??
              (targetState === 'energy_lift'
                ? 18
                : targetState === 'alert_focus'
                  ? 16
                  : targetState === 'deep_flow'
                    ? 15
                    : targetState === 'calm_reset'
                      ? 10
                      : 6);
            const iso =
              targetPicked && previewTargetHz > 12
                ? computeIsoBridgeForState({
                    currentState: activeMicro.coreState,
                    microStateId: activeMicro.id,
                    targetState,
                    targetHz: previewTargetHz,
                    safetyMode: isDriving,
                  })
                : undefined;
            const tierInfo = targetPicked
              ? pickSmartInitialEffectTier({
                  currentState: activeMicro.coreState,
                  microStateId: activeMicro.id,
                  targetState,
                  safetyMode: isDriving,
                  noiseSensitivity,
                  preferredModMult: profile?.preferredModMult,
                })
              : null;
            const effectTierLabel = tierInfo
              ? tierInfo.tier === 'max'
                ? 'Auto Max Effect · 94%'
                : tierInfo.tier === 'min'
                  ? 'Auto Min Effect · 36%'
                  : iso
                    ? 'Iso-Bridge · 38% → 65%'
                    : 'Auto Standard · 65%'
              : null;
            const isoBridgeLabel = iso
              ? `2-Stage Iso-Bridge: 3m ${iso.stabilizeHz} Hz Calm → ${previewTargetHz} Hz`
              : null;

            return (
              <NeuralTrajectoryPreview
                fromCoords={activeFrom}
                fromLabel={activeMicro.shortLabel}
                targetState={targetPicked ? targetState : null}
                customDestCoords={customCoords}
                customDestLabel={customLabel}
                durationMin={durationMin}
                effectTierLabel={effectTierLabel}
                isoBridgeLabel={isoBridgeLabel}
                themeMode={themeMode}
              />
            );
          })()}

          {/* Free-form Open Scientific Goal Input (works with ANY cognitive/wellness goal + typos!) */}
          <div className="space-y-2">
            <div className="glow-input-wrap">
              <div className="relative flex items-start rounded-[0.8rem] bg-[#0B0C0E]">
                <textarea
                  rows={2}
                  value={goalText}
                  onChange={(e) => handleGoalChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!targetPicked) {
                        setTargetError('Type any goal above or select one below to continue.');
                        return;
                      }
                      setBeat(4);
                    }
                  }}
                  placeholder='Type any goal freely — e.g. "I want to feel creative", "memorize for my exam", "public speaking confidence", "deep focus for 45 min"...'
                  className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-[#F3F1EC] placeholder-[#5F605C] focus:outline-none sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => toggleVoiceForBeat(3)}
                  className={`absolute right-2.5 top-2.5 inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-all ${
                    listeningBeat === 3
                      ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-white/12 bg-[#141518] text-[#34D399] hover:border-emerald-400/50 hover:bg-[#191B1F]'
                  }`}
                  title="Speak your goal & duration"
                >
                  {listeningBeat === 3 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {goalText.trim().length > 0 && openGoalIntent && (
              <div className="animate-step flex items-start gap-2.5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-[#D4D4CE]">
                <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <div className="space-y-0.5">
                  <div>
                    <strong className="text-[#34D399]">
                      {openGoalIntent.isOpenCustomTopic
                        ? 'Custom Science Search Ready:'
                        : 'Matched Scientific Goal:'}
                    </strong>{' '}
                    <strong className="text-[#F3F1EC]">{openGoalIntent.label}</strong>
                    {openGoalIntent.dspOverride && (
                      <span className="ml-1.5 rounded border border-emerald-400/30 bg-[#0B0C0E] px-1.5 py-0.5 font-mono-tech text-[10px] text-[#34D399]">
                        {openGoalIntent.dspOverride.modulationHz} Hz
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#A3A39E]">
                    {openGoalIntent.isOpenCustomTopic
                      ? `Will search NIH PubMed, Europe PMC & OpenAlex live for "${openGoalIntent.label}" and compile the matching Hz & audio layers.`
                      : `${openGoalIntent.subtitle} · PubMed & OpenAlex query locked.`}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Optional Expanded Quick-Select Scientific Goals */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-[#8E8E88]">
              <span>Or quick-select a verified goal (optional if you typed above):</span>
              <span className="font-mono-tech text-[10px] text-[#34D399]">8 Core Categories</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CURATED_GOAL_PRESETS.map((card) => {
                const disabledForDriving =
                  isDriving &&
                  (card.coreTarget === 'sleep_winddown' || card.coreTarget === 'calm_reset');
                const active =
                  targetPicked &&
                  !openGoalIntent?.isOpenCustomTopic &&
                  selectedGoalSlug === card.slug;
                return (
                  <button
                    key={card.slug}
                    type="button"
                    disabled={disabledForDriving}
                    onClick={() => {
                      setGoalText('');
                      setOpenGoalIntent(null);
                      setSelectedGoalSlug(card.slug);
                      setTargetState(card.coreTarget);
                      setTargetPicked(true);
                      setTargetError(null);
                      setDurationMin(card.defaultMin);
                    }}
                    className={`rounded-xl border px-3.5 py-2.5 text-left transition-all disabled:opacity-35 ${
                      active
                        ? 'border-emerald-400/60 bg-emerald-400/12 text-[#F3F1EC]'
                        : 'border-white/[0.08] bg-[#131417] text-[#D4D4CE] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#F3F1EC]">{card.shortLabel}</span>
                      <span className="shrink-0 rounded border border-white/10 bg-[#0B0C0E] px-1.5 py-0.5 font-mono-tech text-[9.5px] text-[#34D399]">
                        {card.hzBadge}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#8E8E88]">{card.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {targetError && <p className="text-xs font-medium text-amber-300">{targetError}</p>}

          {/* Duration & Listening Output */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#A3A39E]">
                <Clock className="h-3.5 w-3.5 text-[#34D399]" />
                For how long?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {durationOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMin(m)}
                    className={`rounded-lg border px-3 py-2 font-mono-tech text-xs font-semibold transition ${
                      durationMin === m
                        ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                        : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/25'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-[#A3A39E]">
                <span>Listening Hardware</span>
                <span className="font-mono-tech text-[9.5px] font-semibold uppercase tracking-wider text-[#34D399]">
                  Earbuds Required
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectDevice('headphones')}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border py-2 text-[11px] font-semibold transition ${
                    device === 'headphones' && !isDriving
                      ? 'border-emerald-400/70 bg-emerald-400/15 text-[#F3F1EC]'
                      : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/25'
                  }`}
                >
                  <Headphones className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>In-Ear Buds</span>
                  <span className="font-mono-tech text-[8.5px] text-[#34D399]">100% Lock</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDevice('speakers')}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border py-2 text-[11px] font-medium transition ${
                    device === 'speakers' && !isDriving
                      ? 'border-amber-400/65 bg-amber-500/12 text-amber-200'
                      : 'border-white/[0.08] bg-[#131417] text-[#8E8E88] hover:border-white/25'
                  }`}
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Speakers</span>
                  <span className="font-mono-tech text-[8.5px] text-amber-300/80">Degraded</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDevice('car_audio')}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border py-2 text-[11px] font-medium transition ${
                    isDriving
                      ? 'border-amber-400/70 bg-amber-500/15 text-amber-200'
                      : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/25'
                  }`}
                >
                  <Car className="h-3.5 w-3.5" />
                  <span>Car Safety</span>
                  <span className="font-mono-tech text-[8.5px] text-[#7E7E78]">Road Safe</span>
                </button>
              </div>
            </div>
          </div>

          {device === 'speakers' && !isDriving && (
            <div className="animate-step flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-400/45 bg-amber-500/10 p-3 text-xs text-amber-100">
              <div className="flex items-start gap-2.5 max-w-lg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <span>
                  <strong className="text-amber-200">
                    Acoustic Crosstalk Warning — In-Ear Buds Strongly Required:
                  </strong>{' '}
                  Open speakers leak Left/Right channels across the room (~0.3 ms delay), canceling
                  brainstem dichotic phase-locking and weakening neural entrainment by &gt;60%.
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleSelectDevice('headphones')}
                className="shrink-0 rounded-lg border border-emerald-400/50 bg-[#0B0C0E] px-3 py-1.5 font-mono-tech text-[10.5px] font-semibold text-[#34D399] transition hover:border-emerald-400"
              >
                Switch to In-Ear Buds
              </button>
            </div>
          )}

          {isDriving && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-4 py-4 text-xs font-medium text-[#D4D4CE] hover:border-white/25 hover:text-[#F3F1EC]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (!targetPicked) {
                  setTargetError('Please choose the state you want to reach.');
                  return;
                }
                setTargetError(null);
                setBeat(4);
              }}
              className="btn-aurora flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold sm:text-base"
            >
              Next: Music Style
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* BEAT 4: STANDALONE NOOTROPIC FM MODE vs 10 STUDIO MIX GENRES          */}
      {/* ===================================================================== */}
      {beat === 4 && (
        <div key="beat-4" className="animate-step glass-stage w-full rounded-2xl p-5 sm:p-7 space-y-5">
          {/* SECTION A: STANDALONE FLAGSHIP NOOTROPIC FM SIGNATURE ENGINE */}
          <div
            onClick={() => {
              setGenreChoice('nootropic_trance');
              if (!isDriving && device === 'speakers') {
                setDevice('headphones');
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setGenreChoice('nootropic_trance');
                if (!isDriving && device === 'speakers') setDevice('headphones');
              }
            }}
            className={`cursor-pointer rounded-2xl border p-4 sm:p-5 transition-all space-y-3 ${
              genreChoice === 'nootropic_trance'
                ? 'border-emerald-400/80 bg-emerald-500/[0.11] shadow-[0_0_28px_rgba(52,211,153,0.16)]'
                : 'border-emerald-400/35 bg-[#0B0C0E] hover:border-emerald-400/65 hover:bg-emerald-500/[0.06]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/45 bg-emerald-500/15 px-2.5 py-0.5 font-mono-tech text-[10px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                <Zap className="h-3 w-3" />
                Standalone Flagship Engine · Separate from Studio Mix
              </div>
              <span className="inline-flex items-center gap-1 rounded border border-white/12 bg-[#131518] px-2 py-0.5 font-mono-tech text-[9.5px] font-semibold text-[#D4D4CE]">
                <Headphones className="h-3 w-3 text-[#34D399]" />
                In-Ear Buds Only · 6×40 Hz CFC
              </span>
            </div>

            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <div className="font-display text-base font-bold text-[#F3F1EC] sm:text-lg">
                  {genreChoice === 'nootropic_trance' ? '✓ ' : ''}NootropicFM Mode — Deep Trance &amp; Neural Lock
                </div>
                <p className="text-xs leading-relaxed text-[#A3A39E]">
                  Locks our dedicated <strong>6 Hz Theta × 40 Hz Gamma</strong> Cross-Frequency
                  Coupling directly onto phase-aligned <strong>120.000 BPM</strong> hypnotic
                  sub-bass stems (0% sham dilution, maximum tunnel immersion).
                </p>
              </div>
              <button
                type="button"
                disabled={starting}
                onClick={(e) => {
                  e.stopPropagation();
                  setGenreChoice('nootropic_trance');
                  if (!isDriving && device === 'speakers') setDevice('headphones');
                  void handleLaunch('nootropic_trance');
                }}
                className="btn-aurora inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Lock NootropicFM Mode
              </button>
            </div>
          </div>

          {/* CLEAN ARCHITECTURAL DIVIDER */}
          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-white/10" />
            <span className="mx-3 shrink-0 font-mono-tech text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8E8E88]">
              Or Pair Your Study With 10 Studio Mix Genres
            </span>
            <div className="flex-grow border-t border-white/10" />
          </div>

          {/* SECTION B: 10 STANDARD STUDIO MIX GENRES */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-[#F3F1EC]">
                <Music2 className="h-4 w-4 text-[#34D399]" />
                Standard Studio Mix Carrier (blended with matched PubMed studies)
              </span>
              <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#8E8E88]">
                10 Studio Genres · Lyric-free
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGenreChoice('auto')}
                className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
                  genreChoice === 'auto'
                    ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                    : 'subtle-chip'
                }`}
              >
                {genreChoice === 'auto' ? '✓ ' : ''}
                Auto (Best match)
              </button>

              {STUDIO_MIX_GENRES.map((g) => {
                const isSelected = genreChoice === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenreChoice(g)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
                      isSelected
                        ? 'border-emerald-400/75 bg-emerald-400/18 text-[#F3F1EC] shadow-[0_0_18px_rgba(52,211,153,0.18)]'
                        : 'subtle-chip'
                    }`}
                  >
                    <span>
                      {isSelected ? '✓ ' : ''}
                      {GENRE_META[g].label}
                    </span>
                  </button>
                );
              })}

              <span
                aria-disabled="true"
                title="Additional music styles are coming soon"
                className="inline-flex cursor-not-allowed select-none items-center gap-1.5 rounded-lg border border-dashed border-white/12 bg-[#0B0C0E] px-3.5 py-2 text-xs font-medium text-[#8E8E88]"
              >
                <span>Other</span>
                <span className="rounded border border-white/10 bg-[#141518] px-1.5 py-0.5 font-mono-tech text-[9px] font-bold uppercase tracking-wider text-[#8E8E88]">
                  Coming Soon
                </span>
              </span>
            </div>

            {genreChoice === 'auto' && profile?.favoriteGenres && profile.favoriteGenres.length > 0 && (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] px-3.5 py-2 text-[11px] text-[#D4D4CE]">
                <span className="font-semibold text-[#34D399]">Learned top match:</span>{' '}
                {GENRE_META[profile.favoriteGenres[0]].label}
                {profile.favoriteGenres[1]
                  ? ` (runner-up: ${GENRE_META[profile.favoriteGenres[1]].label})`
                  : ''}
              </div>
            )}

            {genreChoice !== 'auto' && (
              <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3.5 py-2 text-[11px] text-[#D4D4CE]">
                <strong className="text-[#34D399]">{GENRE_META[genreChoice].label}:</strong>{' '}
                {GENRE_META[genreChoice].shortDesc} ·{' '}
                <span className="text-[#8E8E88]">{GENRE_META[genreChoice].vibeTag}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setBeat(3)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-4 py-4 text-xs font-medium text-[#D4D4CE] hover:border-white/25 hover:text-[#F3F1EC]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              disabled={starting}
              onClick={() => void handleLaunch()}
              className="btn-aurora flex flex-1 items-center justify-center gap-2.5 rounded-xl px-6 py-4 text-sm font-semibold disabled:opacity-60 sm:text-base"
            >
              <Search className="h-4 w-4 shrink-0" />
              {starting
                ? 'Searching Scientific Studies...'
                : (() => {
                    const activeMusicName =
                      genreChoice !== 'auto' ? GENRE_META[genreChoice].label : 'Auto Music';
                    return `Find Scientific Studies & Prepare (${activeMusicName})`;
                  })()}
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          </div>

          {isDriving && (
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#7E7E78]">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400/70" />
              Start before driving. Audio supports focus but never replaces rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
