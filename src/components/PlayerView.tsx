import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudRain,
  CreditCard,
  Crown,
  ExternalLink,
  Headphones,
  HeartPulse,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  Play,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { getGenreDisplayMeta } from '../../shared/promptComposer';
import { NEURAL_EFFECT_MULT, pickSmartInitialEffectTier } from '../../shared/protocols';
import {
  ENTRAINMENT_LABELS,
  type CarrierEngineMode,
} from '../../shared/studySpec';
import type {
  AudioSourceType,
  LiveAdjustment,
  ProtocolRecommendation,
  ResolvedGenre,
  UserProfile,
} from '../../shared/types';
import {
  DEVICE_LABELS,
  GENRE_META,
  STUDIO_MIX_GENRES,
  TARGET_LABELS,
  type OutputDevice,
} from '../../shared/types';
import { estimateAgePriorIafHz } from '../audio/dspMath';
import {
  PsychoacousticEngine,
  type EngineTelemetry,
  type LayerMonitorMode,
} from '../audio/PsychoacousticEngine';
import { SESSION_INTRO_VOICE_DELAY_MS } from '../audio/VoiceConciergePlayer';
import type { TappingBiomarkerResult } from '../../shared/psychometrics';
import { BleHrvMonitor, isWebBluetoothSupported, type BleHrvState } from '../lib/bleHrv';
import { TappingTestModal } from './TappingTestModal';
import type { GammaStimulusMode } from '../audio/MedicalStimulusRack';
import { API_BASE, api, saveStoredProfileAuth } from '../lib/api';
import type { ConciergeVoiceOption } from '../../shared/voiceConcierge';
import { markSilentHintShown } from '../lib/disclosureScheduler';
import { isNativePlayStoreApp } from '../lib/platform';
import { HugginsCheckModal } from './HugginsCheckModal';
import { LiveEnvelopeProof } from './LiveEnvelopeProof';
import {
  NeuralFingerprintSigil,
  sharePublicNeuralFingerprint,
} from './NeuralFingerprintPass';
import { NeuralVisualizer } from './NeuralVisualizer';
import { PvtBenchmarkModal } from './PvtBenchmarkModal';
import { StudyFidelityMatrix } from './StudyFidelityMatrix';

const FREE_PREVIEW_LIMIT_SEC = 300; // 5-minute free calibration session (+30 min Share Bonus)
const FREE_LYRIA_PREVIEW_SEC = 90; // 90-second daily live Endless Stream preview for Free tier
const SHARE_BONUS_SEC = 1800; // +30 minutes free when sharing your 1-of-1 Neural Fingerprint Card
const SHARE_BONUS_DAY_KEY = 'nootropic_fm_share_bonus_day_v1';
const FREE_USAGE_STORAGE_KEY = 'nootropic_fm_free_usage_v1';
const VOICE_GUIDE_STORAGE_KEY = 'nootropic_fm_voice_guide_v1';
const VOICE_ID_STORAGE_KEY = 'nootropic_fm_voice_id_v4';
const VOICE_DAY_COUNT_KEY = 'nootropic_fm_voice_day_v1';

function readSavedVoiceId(): string | null {
  try {
    const raw = localStorage.getItem(VOICE_ID_STORAGE_KEY)?.trim() ?? '';
    return /^[A-Za-z0-9_-]{2,48}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeSavedVoiceId(voiceId: string): void {
  try {
    localStorage.setItem(VOICE_ID_STORAGE_KEY, voiceId);
  } catch {
    // ignore storage restrictions
  }
}

function getTodayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readVoiceGuideEnabled(): boolean {
  try {
    const raw = localStorage.getItem(VOICE_GUIDE_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== '0' && raw !== 'false';
  } catch {
    return true;
  }
}

function writeVoiceGuideEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(VOICE_GUIDE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore storage restrictions
  }
}

function consumeDailyVoiceIntroType(): 'intro_full' | 'intro_short' {
  try {
    const today = getTodayUtcKey();
    const raw = localStorage.getItem(VOICE_DAY_COUNT_KEY);
    let count = 0;
    if (raw) {
      const parsed = JSON.parse(raw) as { day?: string; count?: number };
      if (parsed.day === today) {
        count = Math.max(0, Math.floor(Number(parsed.count) || 0));
      }
    }
    localStorage.setItem(VOICE_DAY_COUNT_KEY, JSON.stringify({ day: today, count: count + 1 }));
    return count === 0 ? 'intro_full' : 'intro_short';
  } catch {
    return 'intro_full';
  }
}

function inferClientTimeBucket(): 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'midday';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 22) return 'evening';
  return 'night';
}

function hasClaimedShareBonusToday(): boolean {
  try {
    return localStorage.getItem(SHARE_BONUS_DAY_KEY) === getTodayUtcKey();
  } catch {
    return false;
  }
}

function readDailyFreeUsage(): { usedSec: number; lyriaSec: number } {
  try {
    const raw = localStorage.getItem(FREE_USAGE_STORAGE_KEY);
    if (!raw) return { usedSec: 0, lyriaSec: 0 };
    const parsed = JSON.parse(raw) as { day?: string; usedSec?: number; lyriaSec?: number };
    if (parsed.day !== getTodayUtcKey()) return { usedSec: 0, lyriaSec: 0 };
    return {
      usedSec: Math.max(0, Math.floor(Number(parsed.usedSec) || 0)),
      lyriaSec: Math.max(0, Math.floor(Number(parsed.lyriaSec) || 0)),
    };
  } catch {
    return { usedSec: 0, lyriaSec: 0 };
  }
}

function writeDailyFreeUsage(usedSec: number, lyriaSec: number): void {
  try {
    localStorage.setItem(
      FREE_USAGE_STORAGE_KEY,
      JSON.stringify({
        day: getTodayUtcKey(),
        usedSec: Math.max(0, Math.floor(usedSec)),
        lyriaSec: Math.max(0, Math.floor(lyriaSec)),
      })
    );
  } catch {
    // ignore storage restrictions
  }
}

export interface PlayerControlBridge {
  togglePlay: () => Promise<void>;
  endSession: () => void;
  unlockBonusAndResume: () => Promise<void>;
}

export interface PlayerMiniSnapshot {
  title: string;
  genreLabel: string;
  modulationHz: number;
  elapsedSec: number;
  plannedDurationMin: number;
  isPlaying: boolean;
}

interface PlayerViewProps {
  recommendation: ProtocolRecommendation;
  profile?: UserProfile | null;
  syncCode?: string | null;
  lyriaRealtimeAvailable?: boolean;
  isPro?: boolean;
  stripeAvailable?: boolean;
  themeMode?: 'daylight' | 'night';
  minimized?: boolean;
  showSessionOneSilentToast?: boolean;
  showPvtLabBadge?: boolean;
  controlRef?: React.MutableRefObject<PlayerControlBridge | null>;
  onMinimize?: () => void;
  onSnapshot?: (snap: PlayerMiniSnapshot) => void;
  onHugginsVerified?: (passed: boolean) => void;
  onOpenSoundSystems?: () => void;
  onUpgradePro?: () => void;
  onStartDirectCheckout?: (plan: 'annual' | 'monthly') => Promise<void>;
  onOpenCustomCheckIn?: () => void;
  onReturnHome?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  onSessionClaimed?: (claimed: {
    profile: UserProfile;
    profileToken: string;
    syncCode: string;
    sessionId: string;
  }) => void;
  onFinishToDebrief: (stats: {
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
    pvtPreMs?: number | null;
    pvtLapsesPre?: number | null;
    pvtPreInvRt?: number | null;
    pvtTrialCount?: number | null;
    tappingCvPct?: number | null;
    tappingMeanItiMs?: number | null;
    hrvRmssdMs?: number | null;
    hrvLfRatio?: number | null;
    activeTrackKey?: string | null;
    sessionIdOverride?: string;
    ephemeralOverride?: boolean;
    freeQuotaReached?: boolean;
  }) => void;
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PlayerView({
  recommendation,
  profile = null,
  syncCode = null,
  lyriaRealtimeAvailable: _lyriaRealtimeAvailable = false,
  isPro = false,
  stripeAvailable = false,
  themeMode = 'night',
  minimized = false,
  showSessionOneSilentToast = false,
  showPvtLabBadge = false,
  controlRef,
  onMinimize,
  onSnapshot,
  onHugginsVerified,
  onOpenSoundSystems,
  onUpgradePro,
  onStartDirectCheckout,
  onOpenCustomCheckIn,
  onReturnHome,
  onPlayingChange,
  onSessionClaimed,
  onFinishToDebrief,
}: PlayerViewProps) {
  const engineRef = useRef<PsychoacousticEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PsychoacousticEngine();
  }

  const initialCarrier: CarrierEngineMode =
    recommendation.audioSource === 'pure_stimulus'
      ? 'pure_stimulus'
      : recommendation.audioSource === 'studio_library' ||
          recommendation.audioSource === 'community_cache' ||
          recommendation.audioSource === 'live_generating'
        ? 'studio_library'
        : 'generative_live';

  const isCalmOrSleepGoal =
    recommendation.targetState === 'calm_reset' || recommendation.targetState === 'sleep_winddown';
  const learnedModForGoal = profile?.neuralMemory
    ? isCalmOrSleepGoal
      ? profile.neuralMemory.calmModMult
      : profile.neuralMemory.focusModMult
    : profile?.preferredModMult;

  const smartEffectInit = pickSmartInitialEffectTier({
    currentState: recommendation.currentState,
    microStateId: recommendation.microStateId,
    targetState: recommendation.targetState,
    safetyMode: recommendation.safetyMode,
    noiseSensitivity: profile?.noiseSensitivity,
    preferredModMult: learnedModForGoal,
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [volume, setVolume] = useState(0.74);
  const [intensityMult, setIntensityMult] = useState(1.0);
  const [modMult, setModMult] = useState<number>(smartEffectInit.modMult);
  const [effectAutoTag, setEffectAutoTag] = useState<string | null>(smartEffectInit.autoReason);
  const [adjustments, setAdjustments] = useState<LiveAdjustment[]>([]);
  const [genre, setGenre] = useState<ResolvedGenre>(
    recommendation.params.genre ?? 'deep_electronic'
  );
  const [carrierMode, setCarrierMode] = useState<CarrierEngineMode>(initialCarrier);
  const [layerMonitor, setLayerMonitor] = useState<LayerMonitorMode>(
    initialCarrier === 'pure_stimulus' ? 'science_only' : 'full_mix'
  );
  const [lyriaNotice, setLyriaNotice] = useState<string | null>(null);
  const [connectingLyria, setConnectingLyria] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSourceType>(
    recommendation.audioSource ?? 'generative_live'
  );
  const [activeCustomLabel, setActiveCustomLabel] = useState<string | null>(
    recommendation.customGenreLabel ?? null
  );
  const [customGenState, setCustomGenState] = useState<'idle' | 'generating' | 'ready' | 'notice'>(
    recommendation.audioSource === 'live_generating'
      ? 'generating'
      : recommendation.audioSource === 'community_cache'
        ? 'ready'
        : 'idle'
  );
  const [customGenNotice, setCustomGenNotice] = useState<string | null>(null);
  const [showPrePvt, setShowPrePvt] = useState(false);
  const [showHugginsCheck, setShowHugginsCheck] = useState(false);
  const [showTappingCheck, setShowTappingCheck] = useState(false);
  const [tappingResult, setTappingResult] = useState<TappingBiomarkerResult | null>(null);
  const bleHrvRef = useRef<BleHrvMonitor | null>(null);
  const lastBleBiomarkerSaveMsRef = useRef<number>(0);
  const [bleHrvState, setBleHrvState] = useState<BleHrvState>({
    connected: false,
    deviceName: null,
    latestHrBpm: null,
    metrics: null,
  });
  const pausedForHugginsRef = useRef(false);
  const [alphaIafHz, setAlphaIafHz] = useState<number>(
    () => profile?.neuralMemory?.personalIafHz ?? estimateAgePriorIafHz(profile?.ageBand)
  );
  const tappingResultRef = useRef<TappingBiomarkerResult | null>(null);
  const bleHrvMetricsRef = useRef<{ rmssdMs: number; lfPowerRatio: number } | null>(null);
  const activeTrackKeyRef = useRef<string | null>(null);

  useEffect(() => {
    tappingResultRef.current = tappingResult;
  }, [tappingResult]);

  useEffect(() => {
    const liveMetrics = bleHrvState.connected && bleHrvState.metrics ? bleHrvState.metrics : null;
    bleHrvMetricsRef.current = liveMetrics
      ? { rmssdMs: liveMetrics.rmssdMs, lfPowerRatio: liveMetrics.lfPowerRatio }
      : null;
    engineRef.current?.ingestLiveHrvMetrics(bleHrvMetricsRef.current);
  }, [bleHrvState.connected, bleHrvState.metrics]);
  const [pvtPreMs, setPvtPreMs] = useState<number | null>(null);
  const [pvtLapsesPre, setPvtLapsesPre] = useState<number | null>(null);
  const [pvtPreInvRt, setPvtPreInvRt] = useState<number | null>(null);
  const [pvtPreTrials, setPvtPreTrials] = useState<number | null>(null);
  const [previewLocked, setPreviewLocked] = useState<boolean>(() => {
    if (isPro) return false;
    const limit = FREE_PREVIEW_LIMIT_SEC + (hasClaimedShareBonusToday() ? SHARE_BONUS_SEC : 0);
    return readDailyFreeUsage().usedSec >= limit;
  });
  const [shareBonusSec, setShareBonusSec] = useState<number>(() =>
    hasClaimedShareBonusToday() ? SHARE_BONUS_SEC : 0
  );
  const [dailyFreeUsedSec, setDailyFreeUsedSec] = useState<number>(
    () => readDailyFreeUsage().usedSec
  );
  const [dailyLyriaUsedSec, setDailyLyriaUsedSec] = useState<number>(
    () => readDailyFreeUsage().lyriaSec
  );
  const [shareBonusUsedToday, setShareBonusUsedToday] = useState<boolean>(() =>
    hasClaimedShareBonusToday()
  );
  const [sharingForBonus, setSharingForBonus] = useState(false);
  const [shareBonusToast, setShareBonusToast] = useState<string | null>(null);
  const [selectedPaywallPlan, setSelectedPaywallPlan] = useState<'annual' | 'monthly'>('annual');
  const [unlockingCheckout, setUnlockingCheckout] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [paywallSyncKey, setPaywallSyncKey] = useState('');
  const [redeemingSyncKey, setRedeemingSyncKey] = useState(false);
  const [isLabOpen, setIsLabOpen] = useState(false);
  const [showBlueprintSheet, setShowBlueprintSheet] = useState(false);
  const [rainOverlayPct, setRainOverlayPct] = useState<number | null>(null);
  const [tuning432, setTuning432] = useState<boolean>(
    () => recommendation.executableSpec?.music.tuningA4Hz === 432
  );
  const [silentToastDismissed, setSilentToastDismissed] = useState(false);
  const [audioInterrupted, setAudioInterrupted] = useState(false);
  const [voiceGuideEnabled, setVoiceGuideEnabled] = useState<boolean>(() => readVoiceGuideEnabled());
  const [conciergeVoices, setConciergeVoices] = useState<ConciergeVoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(() => readSavedVoiceId());
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [activeDevice, setActiveDevice] = useState<OutputDevice>(recommendation.device);

  const effectiveFreeLimitSec = FREE_PREVIEW_LIMIT_SEC + shareBonusSec;
  const remainingFreeSec = Math.max(0, effectiveFreeLimitSec - dailyFreeUsedSec);
  const shareSeed = syncCode || profile?.id || recommendation.sessionId;

  // Live session promotion (lets 1-Click Quick-Try listeners claim a 5s anonymous profession profile without audio stutter!)
  const [liveSessionId, setLiveSessionId] = useState<string>(recommendation.sessionId);
  const [isEphemeral, setIsEphemeral] = useState<boolean>(Boolean(recommendation.ephemeralMode));
  const [claimProfession, setClaimProfession] = useState('');
  const [claimAge, setClaimAge] = useState('');
  const [claimingProfile, setClaimingProfile] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedSyncCode, setClaimedSyncCode] = useState<string | null>(null);

  const spec = recommendation.executableSpec;
  const [telemetry, setTelemetry] = useState<EngineTelemetry>({
    phase: 'entry',
    phaseLabel: 'Entry & Iso-Alignment',
    progressRatio: 0,
    currentModHz: spec?.entrainment.frequencyHz ?? recommendation.params.modulationHz,
    currentModDepth: Number((recommendation.params.modulationDepth * 0.76).toFixed(2)),
    crossoverHz: spec?.entrainment.modulationBandHz[0] ?? recommendation.params.crossoverHz ?? 190,
    upperCrossoverHz: spec?.entrainment.modulationBandHz[1] ?? recommendation.params.upperCrossoverHz ?? 4500,
    stereoAmActive: Boolean(recommendation.params.stereoAmSpread && !recommendation.params.speakerSafeEQ),
    energyTier: recommendation.params.energyTier ?? 'focus',
    currentBpm: spec?.music.bpmRamp?.start ?? spec?.music.bpm ?? recommendation.params.bpm,
    antiMonotonyActive: false,
    genre: recommendation.params.genre ?? 'deep_electronic',
    backgroundAudioActive: false,
    usingStudioAudio: false,
    usingCustomTrack: false,
    activeTrackName: null,
    carrierMode: initialCarrier,
    entrainmentType: spec?.entrainment.type ?? 'amplitude_modulation',
    stimulusCarrierLabel: spec
      ? ENTRAINMENT_LABELS[spec.entrainment.type]
      : `${recommendation.params.modulationHz} Hz LR4 AM`,
    tuningA4Hz: spec?.music.tuningA4Hz ?? 440,
    tonalMode: spec?.music.tonalMode ?? 'suspended',
    noiseColor: spec?.noise.color ?? recommendation.params.noiseColor,
    noiseSnrDb: spec?.noise.snrDb ?? -20,
    hrvActive: Boolean(spec?.entrainment.hrvBreathHz || spec?.entrainment.type === 'hrv_breathing_swell'),
    hrvBreathPhase: null,
    hrvBreathProgress: 0,
    lyriaStatus: 'idle',
    usingRealSamples: false,
    studioRetuned432: false,
    layerMonitorMode: initialCarrier === 'pure_stimulus' ? 'science_only' : 'full_mix',
    momentaryLufs: null,
    truePeakDbtp: null,
    gammaMode: initialCarrier === 'pure_stimulus' ? 'clinical_clicks' : 'harmonic_mbi',
    alphaIafHz: estimateAgePriorIafHz(profile?.ageBand),
    hugginsStatus: 'untested',
    bluetoothSafeActive: false,
    band2FlattenerActive: false,
    stemCodecLabel: null,
    stemSubHarmonicLocked: false,
  });

  useEffect(() => {
    activeTrackKeyRef.current = telemetry.activeTrackKey ?? null;
  }, [telemetry.activeTrackKey]);

  const plannedSec = recommendation.plannedDurationMin * 60;
  const elapsedRef = useRef(0);
  const activeElapsedMsRef = useRef(0);
  const lastCheckpointSecRef = useRef(0);
  const adjustmentsRef = useRef<LiveAdjustment[]>([]);
  const audioStartedRef = useRef(false);
  const milestonesSentRef = useRef<Set<number>>(new Set());
  const endedByUserRef = useRef(false);
  const switchedAwayRef = useRef(false);
  const pvtPreRef = useRef<{
    medianMs: number | null;
    lapses: number | null;
    meanInvRt: number | null;
    trialCount: number | null;
  }>({
    medianMs: null,
    lapses: null,
    meanInvRt: null,
    trialCount: null,
  });
  const dailyFreeUsedRef = useRef(dailyFreeUsedSec);
  const dailyLyriaUsedRef = useRef(dailyLyriaUsedSec);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const carrierModeRef = useRef<CarrierEngineMode>(carrierMode);
  const modMultRef = useRef<number>(modMult);
  modMultRef.current = modMult;
  const voiceGuideEnabledRef = useRef<boolean>(voiceGuideEnabled);
  voiceGuideEnabledRef.current = voiceGuideEnabled;
  const voiceIntroSentRef = useRef<boolean>(false);
  const voiceOutroSentRef = useRef<boolean>(false);
  const genreRef = useRef<ResolvedGenre>(genre);
  genreRef.current = genre;
  const profileNameRef = useRef<string | null>(profile?.displayName ?? null);
  profileNameRef.current = profile?.displayName ?? null;
  const layerMonitorRef = useRef<LayerMonitorMode>(layerMonitor);
  layerMonitorRef.current = layerMonitor;
  const activeDeviceRef = useRef<OutputDevice>(activeDevice);
  activeDeviceRef.current = activeDevice;
  const themeModeRef = useRef<'daylight' | 'night'>(themeMode);
  themeModeRef.current = themeMode;
  const selectedVoiceIdRef = useRef<string | null>(selectedVoiceId);
  selectedVoiceIdRef.current = selectedVoiceId;

  useEffect(() => {
    engineRef.current?.setCircadianMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getVoiceConciergeVoices()
      .then((catalog) => {
        if (cancelled || !catalog?.available || !Array.isArray(catalog.voices) || catalog.voices.length === 0) {
          return;
        }
        setConciergeVoices(catalog.voices);
        const currentSaved = selectedVoiceIdRef.current;
        const resolvedId =
          currentSaved && catalog.voices.some((v) => v.voiceId === currentSaved)
            ? currentSaved
            : catalog.defaultVoiceId || catalog.voices[0].voiceId;
        selectedVoiceIdRef.current = resolvedId;
        setSelectedVoiceId(resolvedId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const triggerSessionVoiceCue = (
    cueType: 'intro_full' | 'intro_short' | 'outro_landing',
    immediatePreview = false
  ) => {
    if (!voiceGuideEnabledRef.current || layerMonitorRef.current === 'science_only') return;
    if (cueType !== 'outro_landing' && !immediatePreview) {
      engineRef.current?.primeVoiceIntroHold();
    }
    void api
      .getVoiceConciergeCue({
        cueType,
        firstName: profileNameRef.current,
        voiceId: selectedVoiceIdRef.current,
        currentState: recommendation.currentState,
        targetState: recommendation.targetState,
        armId: recommendation.arm.id,
        modulationHz: recommendation.params.modulationHz,
        genre: genreRef.current,
        isDriving: recommendation.safetyMode,
        device: activeDeviceRef.current,
        timeBucket: inferClientTimeBucket(),
        durationMin: recommendation.plannedDurationMin,
      })
      .then(async (res) => {
        if (
          !res ||
          !res.available ||
          !res.greetingUrl ||
          !res.bodyUrl ||
          !voiceGuideEnabledRef.current ||
          layerMonitorRef.current === 'science_only'
        ) {
          engineRef.current?.releaseVoiceIntroHold();
          return;
        }
        const greetingUrl = res.greetingUrl.startsWith('http')
          ? res.greetingUrl
          : `${API_BASE}${res.greetingUrl}`;
        const bodyUrl = res.bodyUrl.startsWith('http')
          ? res.bodyUrl
          : `${API_BASE}${res.bodyUrl}`;
        setVoiceTranscript(res.transcript || null);
        const started = await engineRef.current?.playVoiceConciergeCue({
          greetingUrl,
          bodyUrl,
          breathPauseMs: res.breathPauseMs,
          minSessionOffsetMs:
            cueType === 'outro_landing' || immediatePreview ? 0 : SESSION_INTRO_VOICE_DELAY_MS,
          initialDelayMs: cueType === 'outro_landing' ? 220 : immediatePreview ? 380 : 450,
        });
        if (!started) {
          engineRef.current?.releaseVoiceIntroHold();
        }
      })
      .catch(() => {
        engineRef.current?.releaseVoiceIntroHold();
      });
  };
  const triggerVoiceCueRef = useRef(triggerSessionVoiceCue);
  triggerVoiceCueRef.current = triggerSessionVoiceCue;

  elapsedRef.current = elapsedSec;
  adjustmentsRef.current = adjustments;
  audioStartedRef.current = audioStarted;
  pvtPreRef.current = {
    medianMs: pvtPreMs,
    lapses: pvtLapsesPre,
    meanInvRt: pvtPreInvRt,
    trialCount: pvtPreTrials,
  };
  dailyFreeUsedRef.current = dailyFreeUsedSec;
  dailyLyriaUsedRef.current = dailyLyriaUsedSec;
  carrierModeRef.current = carrierMode;

  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
  }, [recommendation.sessionId]);

  useEffect(() => {
    setLiveSessionId(recommendation.sessionId);
    setIsEphemeral(Boolean(recommendation.ephemeralMode));
    setClaimedSyncCode(null);
    setClaimError(null);
    const limit = FREE_PREVIEW_LIMIT_SEC + (hasClaimedShareBonusToday() ? SHARE_BONUS_SEC : 0);
    setPreviewLocked(!isPro && readDailyFreeUsage().usedSec >= limit);
    setUnlockError(null);
    setLayerMonitor(initialCarrier === 'pure_stimulus' ? 'science_only' : 'full_mix');
    const isCalmGoal =
      recommendation.targetState === 'calm_reset' || recommendation.targetState === 'sleep_winddown';
    const goalModMult = profile?.neuralMemory
      ? isCalmGoal
        ? profile.neuralMemory.calmModMult
        : profile.neuralMemory.focusModMult
      : profile?.preferredModMult;
    const nextSmartEffect = pickSmartInitialEffectTier({
      currentState: recommendation.currentState,
      microStateId: recommendation.microStateId,
      targetState: recommendation.targetState,
      safetyMode: recommendation.safetyMode,
      noiseSensitivity: profile?.noiseSensitivity,
      preferredModMult: goalModMult,
    });
    setModMult(nextSmartEffect.modMult);
    modMultRef.current = nextSmartEffect.modMult;
    setEffectAutoTag(nextSmartEffect.autoReason);
    milestonesSentRef.current = new Set();
    voiceIntroSentRef.current = false;
    voiceOutroSentRef.current = false;
    setVoiceSpeaking(false);
    setVoiceTranscript(null);
    setActiveDevice(recommendation.device);
    lastBleBiomarkerSaveMsRef.current = 0;
    elapsedRef.current = 0;
    activeElapsedMsRef.current = 0;
    lastCheckpointSecRef.current = 0;
    setElapsedSec(0);
  }, [recommendation.sessionId, recommendation.ephemeralMode, initialCarrier, isPro]);

  useEffect(() => {
    if (isPro && previewLocked) {
      setPreviewLocked(false);
    }
  }, [isPro, previewLocked]);

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  // Start instant audio + 2-Speed custom vibe resolution / crossfade
  useEffect(() => {
    let mounted = true;
    switchedAwayRef.current = false;
    milestonesSentRef.current = new Set();
    endedByUserRef.current = false;
    const unsubInterrupt = engineRef.current?.onInterruptionChange((interrupted) => {
      if (!mounted) return;
      setAudioInterrupted(interrupted);
      if (interrupted) {
        setIsPlaying(false);
        return;
      }
      setIsPlaying(true);
      setAudioStarted(true);
      if (
        !voiceIntroSentRef.current &&
        carrierModeRef.current !== 'pure_stimulus' &&
        voiceGuideEnabledRef.current
      ) {
        voiceIntroSentRef.current = true;
        triggerVoiceCueRef.current(consumeDailyVoiceIntroType());
      }
    });
    const unsubVoice = engineRef.current?.onVoiceSpeakingChange((speaking) => {
      if (mounted) setVoiceSpeaking(speaking);
    });

    const triggerCustomCrossfade = async (trackUrl: string, label: string) => {
      if (!mounted || switchedAwayRef.current || !engineRef.current) return;
      const fullUrl = trackUrl.startsWith('http') ? trackUrl : `${API_BASE}${trackUrl}`;
      const ok = await engineRef.current.crossfadeToCustomTrack(fullUrl, label);
      if (mounted && ok && !switchedAwayRef.current) {
        setAudioSource('community_cache');
        setActiveCustomLabel(label);
        setCustomGenState('ready');
        setCustomGenNotice(null);
      }
    };

    const startAudio = async () => {
      try {
        const latestUsage = readDailyFreeUsage();
        const currentLimit =
          FREE_PREVIEW_LIMIT_SEC + (hasClaimedShareBonusToday() ? SHARE_BONUS_SEC : 0);
        if (!isPro && latestUsage.usedSec >= currentLimit) {
          dailyFreeUsedRef.current = latestUsage.usedSec;
          dailyLyriaUsedRef.current = latestUsage.lyriaSec;
          setDailyFreeUsedSec(latestUsage.usedSec);
          setDailyLyriaUsedSec(latestUsage.lyriaSec);
          setPreviewLocked(true);
          setIsPlaying(false);
          return;
        }
        // Fetch live Cloudflare R2 Studio Stem catalog in parallel so stems fade in seamlessly
        void api
          .getAudioCatalog()
          .then(({ tracksByGenre }) => {
            if (!mounted) return;
            const resolved: typeof tracksByGenre = {
              nootropic_trance: [],
              lofi_keys: [],
              deep_electronic: [],
              cinematic_strings: [],
              jazz_rhodes: [],
              acoustic_pluck: [],
              nature_rain: [],
              dub_reggae: [],
              ambient_space: [],
              solo_piano: [],
              bossa_nova: [],
            };
            (Object.keys(tracksByGenre) as ResolvedGenre[]).forEach((g) => {
              resolved[g] = tracksByGenre[g].map((t) => ({
                ...t,
                url: `${API_BASE}${t.url}`,
                opusUrl: t.opusUrl ? `${API_BASE}${t.opusUrl}` : undefined,
                aacUrl: t.aacUrl ? `${API_BASE}${t.aacUrl}` : undefined,
              }));
            });
            engineRef.current?.setStudioCatalog(resolved);
          })
          .catch(() => {});

        const titleLabel =
          recommendation.customGenreLabel ??
          GENRE_META[recommendation.params.genre].label;

        const hasCachedCustom = Boolean(
          recommendation.customTrackUrl && recommendation.customGenreLabel
        );

        await engineRef.current?.start(
          recommendation.params,
          recommendation.plannedDurationMin,
          `${recommendation.arm.name} · ${titleLabel}`,
          isPro ? false : recommendation.isControlTrial,
          recommendation.executableSpec,
          initialCarrier,
          API_BASE,
          hasCachedCustom
        );

        if (!mounted) return;
        engineRef.current?.setCircadianMode(themeModeRef.current);
        engineRef.current?.setAlphaIafHz(alphaIafHz);
        engineRef.current?.setPersonalAutopilot({
          fatigueDipMinute: profile?.neuralMemory?.fatigueDipMinute ?? null,
          personalIafHz: profile?.neuralMemory?.personalIafHz ?? alphaIafHz,
        });
        engineRef.current?.adjustModDepth(modMultRef.current);
        if (engineRef.current) {
          setTelemetry(engineRef.current.updateElapsed(0));
        }
        const blockedAtStart = Boolean(engineRef.current?.isAudioInterrupted());
        setAudioInterrupted(blockedAtStart);
        setIsPlaying(!blockedAtStart);
        setAudioStarted(!blockedAtStart);
        if (engineRef.current) {
          setGenre(engineRef.current.getGenre());
        }
        if (
          !blockedAtStart &&
          !voiceIntroSentRef.current &&
          initialCarrier !== 'pure_stimulus' &&
          voiceGuideEnabledRef.current
        ) {
          voiceIntroSentRef.current = true;
          triggerVoiceCueRef.current(consumeDailyVoiceIntroType());
        }

        // Case A: Custom vibe already exists in Cloudflare R2 Community Cache -> immediate HTTP Range streaming!
        if (hasCachedCustom && recommendation.customTrackUrl && recommendation.customGenreLabel) {
          void triggerCustomCrossfade(
            recommendation.customTrackUrl,
            recommendation.customGenreLabel
          );
          return;
        }

        // Case B: 2-Speed Background Generation (User already hears matched Studio Library audio)
        if (
          recommendation.audioSource === 'live_generating' &&
          recommendation.customGenreLabel
        ) {
          setCustomGenState('generating');
          try {
            const genRes = await api.generateCustomMusic({
              customGenre: recommendation.customGenreLabel,
              energyTier: recommendation.params.energyTier,
              targetState: recommendation.targetState,
              bpm: recommendation.params.bpm,
              harmonicMode: recommendation.params.harmonicMode,
              speakerSafeEQ: recommendation.params.speakerSafeEQ,
              sessionId: recommendation.ephemeralMode ? undefined : recommendation.sessionId,
            });

            if (!mounted || switchedAwayRef.current) return;

            if (genRes.status === 'ready' && genRes.track) {
              await triggerCustomCrossfade(genRes.track.url, genRes.track.displayLabel);
              return;
            }

            if (genRes.status === 'generating' && recommendation.customGenreSlug) {
              // Another request is already generating this exact custom vibe — poll cleanly
              const slug = recommendation.customGenreSlug;
              const energy = recommendation.params.energyTier;
              for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise((r) => window.setTimeout(r, genRes.pollAfterMs ?? 4000));
                if (!mounted || switchedAwayRef.current) return;
                try {
                  const st = await api.getMusicStatus(slug, energy);
                  if (st.status === 'ready' && st.track) {
                    await triggerCustomCrossfade(st.track.url, st.track.displayLabel);
                    return;
                  }
                  if (st.status === 'failed') {
                    setAudioSource('studio_library');
                    setCustomGenState('notice');
                    setCustomGenNotice(
                      st.error ||
                        'Live generation paused — continuing seamlessly on our closest Studio Library match.'
                    );
                    return;
                  }
                } catch {
                  // transient network hiccup; keep polling
                }
              }
              if (mounted && !switchedAwayRef.current) {
                setAudioSource('studio_library');
                setCustomGenState('notice');
                setCustomGenNotice(
                  'Custom track is still rendering in the background — continuing smoothly on Studio Library.'
                );
              }
              return;
            }

            // Cap reached / unavailable / failed -> transparent honest fallback
            setAudioSource('studio_library');
            setCustomGenState('notice');
            setCustomGenNotice(
              genRes.message ??
                'Continuing seamlessly on our closest Studio Library match through the exact same 3-Band LR4 DSP.'
            );
          } catch {
            if (mounted && !switchedAwayRef.current) {
              setAudioSource('studio_library');
              setCustomGenState('notice');
              setCustomGenNotice(
                'Live custom generation is currently offline — continuing seamlessly on Studio Library.'
              );
            }
          }
        }
      } catch {
        if (mounted) {
          setIsPlaying(false);
          setAudioStarted(false);
        }
      }
    };
    void startAudio();

    return () => {
      mounted = false;
      unsubInterrupt?.();
      unsubVoice?.();
      onPlayingChange?.(false);
      engineRef.current?.stop();
    };
  }, [recommendation, onPlayingChange]);

  // Behavioral Retention Beacon lifecycle (visibilitychange checkpoint + pagehide finalize)
  useEffect(() => {
    if (isEphemeral) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && !endedByUserRef.current && elapsedRef.current > 0) {
        // Checkpoint-only: never penalizes locking phone screen while listening in background!
        api.sendSessionBeacon({
          sessionId: liveSessionId,
          event: 'visibility',
          actualDurationSec: elapsedRef.current,
          audioStarted: audioStartedRef.current,
          liveAdjustments: adjustmentsRef.current,
        });
      }
    };

    const handlePageHide = () => {
      if (!endedByUserRef.current && elapsedRef.current > 0) {
        api.sendSessionBeacon({
          sessionId: liveSessionId,
          event: 'pagehide',
          actualDurationSec: elapsedRef.current,
          audioStarted: audioStartedRef.current,
          liveAdjustments: adjustmentsRef.current,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [liveSessionId, isEphemeral]);

  // Wall-clock active session ticker (immune to background timer throttling) + 90s checkpoint + retention milestones
  useEffect(() => {
    if (!isPlaying) return;
    let lastWallMs = Date.now();
    activeElapsedMsRef.current = Math.max(activeElapsedMsRef.current, elapsedRef.current * 1000);
    let stopped = false;

    const advanceClock = () => {
      if (stopped) return;
      const nowMs = Date.now();
      const wallDeltaMs = Math.max(0, Math.min(3_600_000, nowMs - lastWallMs));
      lastWallMs = nowMs;
      activeElapsedMsRef.current += wallDeltaMs;

      const targetSec = Math.floor(activeElapsedMsRef.current / 1000);
      const prev = elapsedRef.current;
      if (targetSec <= prev) return;

      const next = plannedSec > 0 ? Math.min(plannedSec, targetSec) : targetSec;
      const deltaSec = Math.max(1, next - prev);
      elapsedRef.current = next;
      setElapsedSec(next);

      const tel = engineRef.current?.updateElapsed(next);
      if (tel) setTelemetry(tel);

      // 4-point behavioral listening retention milestones (25% / 50% halfway / 75% deep / 90% full)
      if (!isEphemeral && plannedSec > 0) {
        const ratio = next / plannedSec;
        const checkpoints: Array<{ pct: number; ratio: number; event: 'milestone_25' | 'milestone_50' | 'milestone_75' | 'milestone_90' }> = [
          { pct: 25, ratio: 0.25, event: 'milestone_25' },
          { pct: 50, ratio: 0.5, event: 'milestone_50' },
          { pct: 75, ratio: 0.75, event: 'milestone_75' },
          { pct: 90, ratio: 0.9, event: 'milestone_90' },
        ];
        for (const cp of checkpoints) {
          if (ratio >= cp.ratio && !milestonesSentRef.current.has(cp.pct)) {
            milestonesSentRef.current.add(cp.pct);
            api.sendSessionBeacon({
              sessionId: liveSessionId,
              event: cp.event,
              actualDurationSec: next,
              audioStarted: audioStartedRef.current,
              liveAdjustments: adjustmentsRef.current,
            });
          }
        }
      }

      // Periodic checkpoint every >=90s active playback (D1 free-tier write friendly)
      if (!isEphemeral && next - lastCheckpointSecRef.current >= 90) {
        lastCheckpointSecRef.current = next;
        void api
          .saveProgress({
            sessionId: liveSessionId,
            actualDurationSec: next,
            liveAdjustments: adjustmentsRef.current,
          })
          .catch(() => {});
      }

      // Daily Free Quota + 90s Endless Stream Preview Gate for non-Pro listeners
      if (!isPro) {
        const nextDailyUsed = dailyFreeUsedRef.current + deltaSec;
        const isStreamingLyria = carrierModeRef.current === 'lyria_realtime';
        const nextLyriaUsed = isStreamingLyria
          ? dailyLyriaUsedRef.current + deltaSec
          : dailyLyriaUsedRef.current;

        dailyFreeUsedRef.current = nextDailyUsed;
        dailyLyriaUsedRef.current = nextLyriaUsed;
        setDailyFreeUsedSec(nextDailyUsed);
        if (isStreamingLyria) {
          setDailyLyriaUsedSec(nextLyriaUsed);
        }
        writeDailyFreeUsage(nextDailyUsed, nextLyriaUsed);

        if (isStreamingLyria && nextLyriaUsed >= FREE_LYRIA_PREVIEW_SEC) {
          engineRef.current?.setCarrierMode('studio_library');
          setCarrierMode('studio_library');
          setAudioSource('studio_library');
          setLyriaNotice(
            '90s daily Endless Stream preview complete. Playing Studio Mix seamlessly (start your 7-Day Free Trial for unlimited Endless Stream).'
          );
        }

        const secsRemaining = effectiveFreeLimitSec - nextDailyUsed;
        if (secsRemaining > 0 && secsRemaining <= 12) {
          engineRef.current?.setVolume(
            Number((volumeRef.current * Math.max(0.16, secsRemaining / 12)).toFixed(3))
          );
        }

        if (nextDailyUsed >= effectiveFreeLimitSec) {
          stopped = true;
          window.clearInterval(id);
          endedByUserRef.current = true;
          engineRef.current?.stop();
          setIsPlaying(false);
          if (!isEphemeral) {
            void api
              .saveProgress({
                sessionId: liveSessionId,
                actualDurationSec: next,
                liveAdjustments: adjustmentsRef.current,
              })
              .catch(() => {});
          }
          onFinishToDebrief({
            actualDurationSec: next,
            liveAdjustments: adjustmentsRef.current,
            pvtPreMs: pvtPreRef.current.medianMs,
            pvtLapsesPre: pvtPreRef.current.lapses,
            pvtPreInvRt: pvtPreRef.current.meanInvRt,
            pvtTrialCount: pvtPreRef.current.trialCount,
            tappingCvPct: tappingResultRef.current?.cvPct ?? null,
            tappingMeanItiMs: tappingResultRef.current?.meanItiMs ?? null,
            hrvRmssdMs: bleHrvMetricsRef.current?.rmssdMs ?? null,
            hrvLfRatio: bleHrvMetricsRef.current?.lfPowerRatio ?? null,
            activeTrackKey: activeTrackKeyRef.current,
            sessionIdOverride: liveSessionId,
            ephemeralOverride: isEphemeral,
            freeQuotaReached: true,
          });
          return;
        }
      }

      // Soft-landing Voice Concierge whisper 12s before full-session completion (>= 5 min)
      if (
        plannedSec >= 300 &&
        plannedSec - next <= 12 &&
        plannedSec - next >= 9 &&
        !voiceOutroSentRef.current &&
        voiceGuideEnabledRef.current &&
        layerMonitorRef.current !== 'science_only' &&
        (isPro || effectiveFreeLimitSec - dailyFreeUsedRef.current > 14)
      ) {
        voiceOutroSentRef.current = true;
        triggerVoiceCueRef.current('outro_landing');
      }

      if (plannedSec > 0 && next >= plannedSec) {
        stopped = true;
        window.clearInterval(id);
        endedByUserRef.current = true;
        engineRef.current?.stop();
        setIsPlaying(false);
        onFinishToDebrief({
          actualDurationSec: next,
          liveAdjustments: adjustmentsRef.current,
          pvtPreMs: pvtPreRef.current.medianMs,
          pvtLapsesPre: pvtPreRef.current.lapses,
          pvtPreInvRt: pvtPreRef.current.meanInvRt,
          pvtTrialCount: pvtPreRef.current.trialCount,
          tappingCvPct: tappingResultRef.current?.cvPct ?? null,
          tappingMeanItiMs: tappingResultRef.current?.meanItiMs ?? null,
          hrvRmssdMs: bleHrvMetricsRef.current?.rmssdMs ?? null,
          hrvLfRatio: bleHrvMetricsRef.current?.lfPowerRatio ?? null,
          activeTrackKey: activeTrackKeyRef.current,
          sessionIdOverride: liveSessionId,
          ephemeralOverride: isEphemeral,
        });
      }
    };

    const id = window.setInterval(advanceClock, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        advanceClock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isPlaying, isPro, effectiveFreeLimitSec, plannedSec, liveSessionId, isEphemeral, onFinishToDebrief]);

  const togglePlay = async () => {
    if (!isPro && (previewLocked || dailyFreeUsedRef.current >= effectiveFreeLimitSec)) {
      setPreviewLocked(true);
      return;
    }
    if (audioInterrupted || engineRef.current?.isAudioInterrupted()) {
      const ok = await engineRef.current?.resumeFromInterruption();
      if (ok) {
        setAudioInterrupted(false);
        setIsPlaying(true);
        setAudioStarted(true);
      }
      return;
    }
    if (engineRef.current?.consumeRecentGestureResume()) {
      setAudioInterrupted(false);
      setIsPlaying(true);
      setAudioStarted(true);
      return;
    }
    if (!audioStarted) {
      await engineRef.current?.start(
        recommendation.params,
        recommendation.plannedDurationMin,
        recommendation.arm.name,
        isPro ? false : recommendation.isControlTrial,
        recommendation.executableSpec,
        carrierMode,
        API_BASE
      );
      const stillBlocked = Boolean(engineRef.current?.isAudioInterrupted());
      setAudioInterrupted(stillBlocked);
      setAudioStarted(!stillBlocked);
      setIsPlaying(!stillBlocked);
      if (
        !stillBlocked &&
        !voiceIntroSentRef.current &&
        carrierMode !== 'pure_stimulus' &&
        voiceGuideEnabledRef.current
      ) {
        voiceIntroSentRef.current = true;
        triggerVoiceCueRef.current(consumeDailyVoiceIntroType());
      }
      return;
    }
    if (isPlaying) {
      await engineRef.current?.pause();
      setIsPlaying(false);
    } else {
      await engineRef.current?.resume();
      setIsPlaying(true);
    }
  };

  const togglePlayRef = useRef<() => Promise<void>>(async () => {});
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (previewLocked || showPrePvt || showHugginsCheck || showTappingCheck) return;
      const activeTag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || activeTag === 'BUTTON') {
        return;
      }
      e.preventDefault();
      void togglePlayRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewLocked, showPrePvt, showHugginsCheck, showTappingCheck]);

  const handleToggleBleHrv = async () => {
    if (bleHrvState.connected) {
      bleHrvRef.current?.disconnect();
      return;
    }
    if (!bleHrvRef.current) {
      bleHrvRef.current = new BleHrvMonitor();
    }
    await bleHrvRef.current.connect((snap) => {
      setBleHrvState(snap);
      const nowMs = Date.now();
      if (
        snap.metrics &&
        !isEphemeral &&
        !liveSessionId.startsWith('eph_') &&
        nowMs - lastBleBiomarkerSaveMsRef.current >= 60_000
      ) {
        lastBleBiomarkerSaveMsRef.current = nowMs;
        void api
          .saveSessionBiomarkers({
            sessionId: liveSessionId,
            hrvRmssdMs: snap.metrics.rmssdMs,
            hrvLfRatio: snap.metrics.lfPowerRatio,
          })
          .catch(() => {});
      }
    });
  };

  useEffect(() => {
    return () => {
      bleHrvRef.current?.disconnect();
    };
  }, []);

  const openHugginsModal = async () => {
    pausedForHugginsRef.current = isPlaying;
    if (isPlaying) {
      await engineRef.current?.pause();
      setIsPlaying(false);
    }
    setShowHugginsCheck(true);
  };

  const closeHugginsModal = async (result?: { passed: boolean; score: number; total: number }) => {
    setShowHugginsCheck(false);
    if (result) {
      engineRef.current?.applyAcousticProfile({ hugginsPassed: result.passed });
      onHugginsVerified?.(result.passed);
      setTelemetry((prev) => ({
        ...prev,
        hugginsStatus: result.passed ? 'verified_stereo' : 'monaural_safe',
      }));
    }
    if (pausedForHugginsRef.current) {
      pausedForHugginsRef.current = false;
      await engineRef.current?.resume();
      setIsPlaying(true);
    }
  };

  const handleGammaModeSwitch = (mode: GammaStimulusMode) => {
    engineRef.current?.setGammaMode(mode);
    setTelemetry((prev) => ({ ...prev, gammaMode: mode }));
    if (engineRef.current && audioStarted) {
      setTelemetry(engineRef.current.updateElapsed(elapsedRef.current));
    }
  };

  const handleAlphaIafSelect = (hz: number) => {
    setAlphaIafHz(hz);
    engineRef.current?.setAlphaIafHz(hz);
    if (engineRef.current && audioStarted) {
      setTelemetry(engineRef.current.updateElapsed(elapsedRef.current));
    } else {
      setTelemetry((prev) => ({ ...prev, alphaIafHz: hz }));
    }
  };

  const resumeInterruptedOrGestureForSwitch = async (): Promise<'ready' | 'blocked' | 'needs_start'> => {
    if (audioInterrupted || engineRef.current?.isAudioInterrupted()) {
      const ok = await engineRef.current?.resumeFromInterruption();
      const stillBlocked = !ok || Boolean(engineRef.current?.isAudioInterrupted());
      setAudioInterrupted(stillBlocked);
      setAudioStarted(!stillBlocked);
      setIsPlaying(!stillBlocked);
      return stillBlocked ? 'blocked' : 'ready';
    }
    if (!audioStarted) {
      if (engineRef.current?.consumeRecentGestureResume()) {
        setAudioInterrupted(false);
        setAudioStarted(true);
        setIsPlaying(true);
        return 'ready';
      }
      return 'needs_start';
    }
    if (!isPlaying) {
      await engineRef.current?.resume();
      setIsPlaying(true);
    }
    return 'ready';
  };

  const handleLayerMonitorChange = async (nextMode: LayerMonitorMode) => {
    if (!isPro && previewLocked) {
      return;
    }
    setLayerMonitor(nextMode);
    layerMonitorRef.current = nextMode;
    if (nextMode === 'science_only') {
      engineRef.current?.stopVoiceConcierge(0.15);
    }
    const wasStarted = audioStarted;
    const switchState = await resumeInterruptedOrGestureForSwitch();
    if (switchState === 'blocked') return;
    if (switchState === 'needs_start') {
      await engineRef.current?.start(
        recommendation.params,
        recommendation.plannedDurationMin,
        recommendation.arm.name,
        isPro ? false : recommendation.isControlTrial,
        recommendation.executableSpec,
        initialCarrier === 'pure_stimulus' ? 'studio_library' : initialCarrier,
        API_BASE
      );
      const stillBlocked = Boolean(engineRef.current?.isAudioInterrupted());
      setAudioInterrupted(stillBlocked);
      setAudioStarted(!stillBlocked);
      setIsPlaying(!stillBlocked);
      if (stillBlocked) return;
    }
    if (wasStarted && carrierMode === 'pure_stimulus' && nextMode !== 'science_only') {
      setCarrierMode('studio_library');
      setAudioSource('studio_library');
      engineRef.current?.setCarrierMode('studio_library');
    }
    engineRef.current?.setLayerMonitorMode(nextMode);
    setTelemetry((prev) =>
      engineRef.current
        ? engineRef.current.updateElapsed(elapsedRef.current)
        : { ...prev, layerMonitorMode: nextMode }
    );
  };

  const handleCarrierSwitch = async (nextMode: CarrierEngineMode) => {
    if (!isPro && previewLocked) {
      return;
    }
    if (
      audioStarted &&
      isPlaying &&
      carrierMode === nextMode &&
      (nextMode === 'pure_stimulus' || layerMonitor !== 'science_only') &&
      !connectingLyria
    ) {
      return;
    }

    setLyriaNotice(null);
    if (nextMode !== 'pure_stimulus' && layerMonitor === 'science_only') {
      setLayerMonitor('full_mix');
      engineRef.current?.setLayerMonitorMode('full_mix');
    } else if (nextMode === 'pure_stimulus') {
      setLayerMonitor('science_only');
      layerMonitorRef.current = 'science_only';
      engineRef.current?.stopVoiceConcierge(0.15);
    }
    if (nextMode === 'lyria_realtime') {
      if (!isPro && dailyLyriaUsedRef.current >= FREE_LYRIA_PREVIEW_SEC) {
        setLyriaNotice(
          "Today's 90s Endless Stream preview is complete — playing Studio Mix seamlessly. Start your 7-Day Free Trial ($0 today) for unlimited Endless Stream."
        );
        const switchState = await resumeInterruptedOrGestureForSwitch();
        if (switchState === 'blocked') return;
        if (switchState === 'needs_start') {
          await engineRef.current?.start(
            recommendation.params,
            recommendation.plannedDurationMin,
            recommendation.arm.name,
            isPro ? false : recommendation.isControlTrial,
            recommendation.executableSpec,
            'studio_library',
            API_BASE
          );
          const stillBlocked = Boolean(engineRef.current?.isAudioInterrupted());
          setAudioInterrupted(stillBlocked);
          setAudioStarted(!stillBlocked);
          setIsPlaying(!stillBlocked);
          if (stillBlocked) return;
        }
        setCarrierMode('studio_library');
        setAudioSource('studio_library');
        engineRef.current?.setCarrierMode('studio_library');
        return;
      }
      if (connectingLyria) return;
      setConnectingLyria(true);
      try {
        const switchState = await resumeInterruptedOrGestureForSwitch();
        if (switchState === 'blocked') {
          setConnectingLyria(false);
          return;
        }
        if (switchState === 'needs_start') {
          await engineRef.current?.start(
            recommendation.params,
            recommendation.plannedDurationMin,
            recommendation.arm.name,
            isPro ? false : recommendation.isControlTrial,
            recommendation.executableSpec,
            'studio_library',
            API_BASE
          );
          const stillBlocked = Boolean(engineRef.current?.isAudioInterrupted());
          setAudioInterrupted(stillBlocked);
          setAudioStarted(!stillBlocked);
          setIsPlaying(!stillBlocked);
          if (stillBlocked) {
            setConnectingLyria(false);
            return;
          }
        }

        const res = await api.getLyriaRealtimeToken();
        if (!res.available || !res.token) {
          setLyriaNotice(
            res.reason ?? 'Endless Stream is temporarily unavailable — continuing smoothly on Studio Mix.'
          );
          setCarrierMode('studio_library');
          setAudioSource('studio_library');
          engineRef.current?.setCarrierMode('studio_library');
          setConnectingLyria(false);
          return;
        }
        const ok = await engineRef.current?.activateLyriaRealtime(
          res.token,
          res.model ?? 'models/lyria-realtime-exp',
          (status, note) => {
            if (status === 'streaming') {
              setLyriaNotice(null);
              setCarrierMode('lyria_realtime');
              setAudioSource('lyria_realtime');
            } else if (status === 'error' || status === 'unavailable') {
              setLyriaNotice(
                note ?? 'Endless Stream connection interrupted — continuing seamlessly on Studio Mix.'
              );
              setCarrierMode('studio_library');
              setAudioSource('studio_library');
              engineRef.current?.setCarrierMode('studio_library');
            }
          },
          async () => {
            try {
              const fresh = await api.getLyriaRealtimeToken();
              return fresh.available && fresh.token
                ? { token: fresh.token, model: fresh.model ?? 'models/lyria-realtime-exp' }
                : null;
            } catch {
              return null;
            }
          }
        );
        if (ok) {
          setCarrierMode('lyria_realtime');
          setAudioSource('lyria_realtime');
        } else {
          setLyriaNotice((prev) =>
            prev ?? 'Endless Stream could not connect right now — continuing smoothly on Studio Mix.'
          );
          setCarrierMode('studio_library');
          setAudioSource('studio_library');
          engineRef.current?.setCarrierMode('studio_library');
        }
      } catch {
        setLyriaNotice(
          'Endless Stream could not connect right now — continuing smoothly on Studio Mix.'
        );
        setCarrierMode('studio_library');
        setAudioSource('studio_library');
        engineRef.current?.setCarrierMode('studio_library');
      } finally {
        setConnectingLyria(false);
      }
      return;
    }

    const switchState = await resumeInterruptedOrGestureForSwitch();
    if (switchState === 'blocked') return;
    if (switchState === 'needs_start') {
      await engineRef.current?.start(
        recommendation.params,
        recommendation.plannedDurationMin,
        recommendation.arm.name,
        isPro ? false : recommendation.isControlTrial,
        recommendation.executableSpec,
        nextMode,
        API_BASE
      );
      const stillBlocked = Boolean(engineRef.current?.isAudioInterrupted());
      setAudioInterrupted(stillBlocked);
      setAudioStarted(!stillBlocked);
      setIsPlaying(!stillBlocked);
      if (stillBlocked) return;
    }
    setCarrierMode(nextMode);
    setAudioSource(nextMode);
    engineRef.current?.setCarrierMode(nextMode);
  };

  const handleToggleVoiceGuide = () => {
    const next = !voiceGuideEnabled;
    setVoiceGuideEnabled(next);
    voiceGuideEnabledRef.current = next;
    writeVoiceGuideEnabled(next);
    if (!next) {
      engineRef.current?.stopVoiceConcierge(0.18);
      setVoiceSpeaking(false);
    } else if (
      audioStarted &&
      isPlaying &&
      elapsedRef.current < 25 &&
      !voiceIntroSentRef.current &&
      layerMonitorRef.current !== 'science_only'
    ) {
      voiceIntroSentRef.current = true;
      triggerVoiceCueRef.current('intro_full');
    }
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    engineRef.current?.setVolume(v);
  };

  const tweakIntensity = (delta: number) => {
    const next = Number(Math.max(0.5, Math.min(1.5, intensityMult + delta)).toFixed(2));
    setIntensityMult(next);
    engineRef.current?.adjustIntensity(next);
    setAdjustments((prev) => [...prev, { atSec: elapsedRef.current, control: 'intensity', delta }]);
  };

  const setDirectModDepth = (targetMult: number) => {
    const clamped = Number(Math.max(0.3, Math.min(1.6, targetMult)).toFixed(2));
    const delta = Number((clamped - modMult).toFixed(2));
    setModMult(clamped);
    modMultRef.current = clamped;
    setEffectAutoTag(null);
    if (layerMonitor === 'music_only') {
      setLayerMonitor('full_mix');
      engineRef.current?.setLayerMonitorMode('full_mix');
    }
    engineRef.current?.adjustModDepth(clamped);
    if (delta !== 0) {
      setAdjustments((prev) => [...prev, { atSec: elapsedRef.current, control: 'modulation', delta }]);
    }
  };

  const switchGenre = (style: ResolvedGenre) => {
    switchedAwayRef.current = true;
    setGenre(style);
    setActiveCustomLabel(null);
    setCustomGenState('idle');
    setCustomGenNotice(null);
    const keepEndless = carrierMode === 'lyria_realtime';
    if (!keepEndless && carrierMode !== 'studio_library') {
      setCarrierMode('studio_library');
      setAudioSource('studio_library');
      engineRef.current?.setCarrierMode('studio_library');
    }
    engineRef.current?.setGenre(style);
    setAdjustments((prev) => [
      ...prev,
      { atSec: elapsedRef.current, control: 'genre', delta: 0, note: style },
    ]);
    if (!isEphemeral) {
      void api
        .updateSessionGenre({
          sessionId: liveSessionId,
          genre: style,
          customGenreSlug: null,
          audioSource:
            carrierMode === 'lyria_realtime'
              ? 'lyria_realtime'
              : carrierMode === 'generative_live'
                ? 'procedural_fallback'
                : 'studio_library',
          atSec: elapsedRef.current,
        })
        .catch(() => {});
    }
  };

  const handleClaimProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimError(null);
    const parsedAge = Number(claimAge);
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 95) {
      setClaimError('Enter an age between 18 and 95.');
      return;
    }
    if (claimProfession.trim().length < 2) {
      setClaimError('Enter your profession (e.g. Doctor, Programmer, Student, Driver).');
      return;
    }
    setClaimingProfile(true);
    try {
      const res = await api.claimQuickTryProfile({
        occupationLabel: claimProfession.trim(),
        age: Math.round(parsedAge),
        currentState: recommendation.currentState,
        targetState: recommendation.targetState,
        environment: recommendation.environment,
        device: recommendation.device,
        plannedDurationMin: recommendation.plannedDurationMin,
        actualDurationSec: elapsedRef.current,
        armId: recommendation.arm.id,
        armName: recommendation.arm.name,
        studySpecId: recommendation.executableSpec?.id,
        musicGenre: genre,
        energyTier: recommendation.params.energyTier,
        acousticParams: recommendation.params,
        citedStudyIds: recommendation.arm.studyIds,
      });
      saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
      setLiveSessionId(res.sessionId);
      setIsEphemeral(false);
      setClaimedSyncCode(res.syncCode);
      onSessionClaimed?.(res);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Unable to save profile right now.');
    } finally {
      setClaimingProfile(false);
    }
  };

  const handleShareFor30MinBonus = async () => {
    setSharingForBonus(true);
    setUnlockError(null);
    try {
      const outcome = await sharePublicNeuralFingerprint({
        seed: shareSeed,
        profile,
        highlight: {
          protocolLabel: recommendation.arm.name,
          frequencyHz: telemetry.currentModHz,
        },
      });
      if (outcome === 'cancelled') {
        return;
      }
      try {
        localStorage.setItem(SHARE_BONUS_DAY_KEY, getTodayUtcKey());
      } catch {
        // ignore storage restrictions
      }
      setShareBonusUsedToday(true);
      setShareBonusSec(SHARE_BONUS_SEC);
      setPreviewLocked(false);
      setShareBonusToast(
        outcome === 'shared'
          ? 'Thanks for sharing your Neural Fingerprint! +30 minutes unlocked.'
          : 'Public Fingerprint Card saved & link copied — +30 minutes unlocked!'
      );
      window.setTimeout(() => setShareBonusToast(null), 6000);
      await engineRef.current?.resume();
      setIsPlaying(true);
    } catch {
      setUnlockError('Could not generate the share card right now — please try again.');
    } finally {
      setSharingForBonus(false);
    }
  };

  const handleRedeemPaywallSyncKey = async () => {
    if (!paywallSyncKey.trim()) return;
    setUnlockError(null);
    setRedeemingSyncKey(true);
    try {
      const res = await api.restoreIdentity(paywallSyncKey.trim());
      saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
      onSessionClaimed?.({
        profile: res.profile,
        profileToken: res.profileToken,
        syncCode: res.syncCode,
        sessionId: liveSessionId,
      });
      setPaywallSyncKey('');
      if (res.profile.planTier === 'pro') {
        setPreviewLocked(false);
        await engineRef.current?.resume();
        setIsPlaying(true);
      } else {
        setUnlockError('Pass synced, but this pass is on the Free tier.');
      }
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Invalid Sync / Access Key.');
    } finally {
      setRedeemingSyncKey(false);
    }
  };

  const handleEndSession = () => {
    endedByUserRef.current = true;
    engineRef.current?.stop();
    setIsPlaying(false);
    if (!isEphemeral) {
      void api
        .saveProgress({
          sessionId: liveSessionId,
          actualDurationSec: elapsedRef.current,
          liveAdjustments: adjustmentsRef.current,
        })
        .catch(() => {});
    }
    onFinishToDebrief({
      actualDurationSec: elapsedRef.current,
      liveAdjustments: adjustmentsRef.current,
      pvtPreMs: pvtPreRef.current.medianMs,
      pvtLapsesPre: pvtPreRef.current.lapses,
      pvtPreInvRt: pvtPreRef.current.meanInvRt,
      pvtTrialCount: pvtPreRef.current.trialCount,
      tappingCvPct: tappingResultRef.current?.cvPct ?? null,
      tappingMeanItiMs: tappingResultRef.current?.meanItiMs ?? null,
      hrvRmssdMs: bleHrvMetricsRef.current?.rmssdMs ?? null,
      hrvLfRatio: bleHrvMetricsRef.current?.lfPowerRatio ?? null,
      activeTrackKey: activeTrackKeyRef.current,
      sessionIdOverride: liveSessionId,
      ephemeralOverride: isEphemeral,
    });
  };

  const handleRainOverlayChange = (pct: number | null) => {
    setRainOverlayPct(pct);
    engineRef.current?.setRainOverlayLevel(pct === null ? null : pct / 100);
  };

  const handleToggleTuning432 = () => {
    const next = !tuning432;
    setTuning432(next);
    engineRef.current?.setTuning432(next);
    if (engineRef.current) {
      setTelemetry(engineRef.current.updateElapsed(elapsedRef.current));
    }
  };

  const progressPct = Math.min(100, (elapsedSec / plannedSec) * 100);
  const livePapers = recommendation.livePubMedPapers ?? [];
  const activeVibeDisplay = activeCustomLabel
    ? getGenreDisplayMeta(recommendation.customGenreSlug ?? genre, activeCustomLabel)
    : getGenreDisplayMeta(genre);

  const activeSourceShort =
    layerMonitor === 'science_only' || telemetry.carrierMode === 'pure_stimulus'
      ? 'Layer 1 · Science Signal'
      : layerMonitor === 'music_only'
        ? `${activeVibeDisplay.label} · Plain Music`
        : genre === 'nootropic_trance' && !telemetry.usingCustomTrack
          ? 'NootropicFM Mode · 6×40 Hz Lock'
          : telemetry.carrierMode === 'lyria_realtime'
            ? `${activeVibeDisplay.label} · Endless Stream`
            : telemetry.usingCustomTrack || audioSource === 'community_cache'
              ? activeVibeDisplay.label
              : telemetry.usingStudioAudio
                ? `${activeVibeDisplay.label} · Studio`
                : activeVibeDisplay.label;

  useEffect(() => {
    if (controlRef) {
      controlRef.current = {
        togglePlay: () => togglePlayRef.current(),
        endSession: handleEndSession,
        unlockBonusAndResume: async () => {
          setShareBonusUsedToday(true);
          setShareBonusSec(SHARE_BONUS_SEC);
          setPreviewLocked(false);
          await engineRef.current?.resume();
          setIsPlaying(true);
        },
      };
    }
  });

  useEffect(() => {
    onSnapshot?.({
      title: TARGET_LABELS[recommendation.targetState],
      genreLabel: activeSourceShort,
      modulationHz: telemetry.currentModHz,
      elapsedSec,
      plannedDurationMin: recommendation.plannedDurationMin,
      isPlaying,
    });
  }, [
    onSnapshot,
    recommendation.targetState,
    recommendation.plannedDurationMin,
    activeSourceShort,
    telemetry.currentModHz,
    elapsedSec,
    isPlaying,
  ]);

  const primaryStudy = recommendation.studies[0];
  const shortStudyCite = primaryStudy
    ? `${primaryStudy.authors.split(',')[0]} ${primaryStudy.year}`
    : recommendation.arm.name;

  return (
    <div
      className={
        minimized
          ? 'hidden'
          : `mx-auto w-full ${isLabOpen ? 'max-w-6xl' : 'max-w-2xl'} space-y-4`
      }
    >
      {recommendation.safetyMode ? (
        <div className="animate-rise rounded-xl border border-amber-400/40 bg-amber-500/10 p-3.5">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="space-y-0.5 text-xs text-amber-100">
              <div className="font-semibold uppercase tracking-wide text-amber-300">
                Driving Safety Mode Active
              </div>
              {recommendation.safetyWarnings[0] && (
                <p className="leading-relaxed text-amber-100/90">{recommendation.safetyWarnings[0]}</p>
              )}
            </div>
          </div>
        </div>
      ) : activeDevice === 'speakers' ? (
        <div className="animate-rise flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-400/45 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          <div className="flex items-start gap-2.5 max-w-md">
            <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>
              <strong className="text-amber-200">Speaker Mode Degraded — In-Ear Buds Required:</strong>{' '}
              Room crosstalk weakens stereo phase-locking. Put both earbuds in to unlock 100%
              dichotic depth.
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveDevice('headphones');
                engineRef.current?.applyAcousticProfile({ hugginsPassed: true });
                setTelemetry((prev) => ({ ...prev, hugginsStatus: 'verified_stereo' }));
              }}
              className="rounded-lg border border-emerald-400/50 bg-[#0B0C0E] px-2.5 py-1.5 font-mono-tech text-[10px] font-semibold text-[#34D399] transition hover:border-emerald-400"
            >
              Earbuds In · Unlock Stereo
            </button>
            {onOpenSoundSystems && (
              <button
                type="button"
                onClick={onOpenSoundSystems}
                className="rounded-lg border border-white/15 bg-[#141518] px-2.5 py-1.5 font-mono-tech text-[10px] text-[#D4D4CE] hover:text-[#F3F1EC]"
              >
                Earbuds 01
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Brief Custom Music Background Status */}
      {customGenState === 'generating' && activeCustomLabel && (
        <div className="animate-rise flex items-center gap-2.5 rounded-xl border border-white/15 bg-[#121417] px-4 py-2.5 text-xs text-[#F3F1EC]">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#34D399]" />
          <span>
            Crafting custom <strong>“{activeCustomLabel}”</strong> while{' '}
            <strong>{GENRE_META[genre].label}</strong> plays cleanly underneath.
          </span>
        </div>
      )}

      {customGenState === 'notice' && customGenNotice && (
        <div className="animate-rise flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <Activity className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span>{customGenNotice}</span>
        </div>
      )}

      {shareBonusToast && (
        <div className="animate-rise flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/12 px-4 py-2.5 text-xs font-medium text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#34D399]" />
          <span>{shareBonusToast}</span>
        </div>
      )}

      {(audioInterrupted || telemetry.audioInterrupted) && (
        <button
          type="button"
          onClick={() => {
            void engineRef.current?.resumeFromInterruption().then((ok) => {
              if (ok) {
                setAudioInterrupted(false);
                setIsPlaying(true);
                setAudioStarted(true);
              }
            });
          }}
          className="animate-rise flex w-full items-center justify-between gap-3 rounded-xl border border-amber-400/45 bg-amber-500/15 px-4 py-3 text-left text-xs text-amber-100 transition hover:bg-amber-500/20"
        >
          <span className="font-medium">
            {elapsedSec < 3
              ? 'Browser audio is awaiting a quick tap to start — tap anywhere to activate sound.'
              : 'Audio paused by a system or Bluetooth interruption — tap anywhere to resume smoothly.'}
          </span>
          <span className="shrink-0 rounded-lg bg-amber-400/25 px-3 py-1 font-semibold text-amber-200">
            {elapsedSec < 3 ? 'Start Audio' : 'Resume Audio'}
          </span>
        </button>
      )}

      {/* Session #1 Touch/iOS Silent-Mode Hint Toast (t = 4s..18s) */}
      {showSessionOneSilentToast && !silentToastDismissed && elapsedSec >= 4 && elapsedSec <= 20 && (
        <div
          data-testid="silent-mode-hint-toast"
          className="animate-rise flex items-center justify-between gap-3 rounded-xl border border-emerald-400/35 bg-emerald-500/[0.09] px-4 py-2.5 text-xs text-[#D4D4CE]"
        >
          <span className="inline-flex items-center gap-2">
            <Headphones className="h-4 w-4 shrink-0 text-[#34D399]" />
            <span>
              <strong className="text-[#F3F1EC]">Tip for iPhone / iPad:</strong> Flip the side{' '}
              <em>Silent</em> switch off and keep both earbuds sealed for full 48 kHz phase-lock.
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setSilentToastDismissed(true);
              markSilentHintShown();
            }}
            aria-label="Dismiss audio tip"
            className="rounded-lg p-1 text-[#A3A39E] hover:bg-white/10 hover:text-[#F3F1EC]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* RESPONSIVE TWO-TIER STUDIO WORKSPACE */}
      <div
        className={
          isLabOpen
            ? 'grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start'
            : 'space-y-4'
        }
      >
        {/* =============================================================== */}
        {/* TIER 1: CALM INSTRUMENT COCKPIT (Always Visible in Zen Focus)   */}
        {/* =============================================================== */}
        <div
          data-testid="tier1-calm-cockpit"
          className={`animate-rise glass-stage rounded-2xl p-4 sm:p-6 space-y-5 ${
            isLabOpen ? 'xl:col-span-6' : ''
          }`}
        >
          {/* Zen Cockpit Header: Minimize · InlineProtocolPill · End */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {onMinimize ? (
              <button
                type="button"
                data-testid="minimize-player-btn"
                onClick={onMinimize}
                aria-label="Minimize player and browse tabs"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-[#14161A] px-3 py-2 text-xs font-semibold text-[#D4D4CE] transition hover:border-emerald-400/45 hover:text-[#F3F1EC]"
              >
                <Minimize2 className="h-3.5 w-3.5 text-[#34D399]" />
                <span>Minimize</span>
              </button>
            ) : (
              <span />
            )}

            <button
              type="button"
              data-testid="inline-protocol-pill"
              onClick={() => setShowBlueprintSheet(true)}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/[0.08] px-3 py-1.5 font-mono-tech text-[10.5px] font-semibold text-[#34D399] transition hover:border-emerald-400/65 hover:bg-emerald-500/15"
              title="Open protocol citations & fidelity blueprint"
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {telemetry.currentModHz > 0 && layerMonitor !== 'music_only'
                  ? `${telemetry.currentModHz} Hz`
                  : activeVibeDisplay.label}{' '}
                · {shortStudyCite} · DOI ↗
              </span>
            </button>

            <button
              type="button"
              onClick={handleEndSession}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-[#16181C] px-3 py-2 text-xs font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50 hover:bg-[#1C1F24]"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-[#34D399]" />
              {isEphemeral ? 'End Session' : 'End & Rate'}
            </button>
          </div>

          {/* Centerpiece Breathing & Progress Ring */}
          <div className="flex flex-col items-center justify-center py-2 text-center space-y-3">
            <div className="relative flex h-44 w-44 items-center justify-center">
              <svg
                viewBox="0 0 180 180"
                className="h-full w-full -rotate-90"
                aria-label="Session Progress Ring"
              >
                <circle
                  cx="90"
                  cy="90"
                  r="78"
                  fill="none"
                  stroke={themeMode === 'daylight' ? 'rgba(15, 23, 42, 0.10)' : 'rgba(148, 163, 184, 0.18)'}
                  strokeWidth="6"
                />
                <circle
                  cx="90"
                  cy="90"
                  r="78"
                  fill="none"
                  stroke={themeMode === 'daylight' ? '#047857' : '#34D399'}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 78}
                  strokeDashoffset={
                    2 * Math.PI * 78 * (1 - Math.max(0.02, progressPct / 100))
                  }
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-3">
                <span className="font-mono-tech text-[10px] uppercase tracking-[0.14em] text-[#34D399]">
                  {telemetry.hrvActive && telemetry.hrvBreathPhase
                    ? telemetry.hrvBreathPhase === 'inhale'
                      ? 'Inhale · 0.10 Hz'
                      : 'Exhale · 0.10 Hz'
                    : telemetry.phaseLabel}
                </span>
                <div className="font-mono-tech mt-1 text-3xl font-bold tracking-tight text-[#F3F1EC]">
                  {formatTimer(elapsedSec)}
                </div>
                <div className="font-mono-tech mt-0.5 text-[11px] text-[#8E8E88]">
                  of {recommendation.plannedDurationMin}:00 min
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-xl font-semibold text-[#F3F1EC] sm:text-2xl">
                {TARGET_LABELS[recommendation.targetState]}
              </h1>
              <p className="text-[11px] text-[#8E8E88]">
                {activeSourceShort} · {DEVICE_LABELS[activeDevice]}
                {telemetry.currentBpm > 0 && layerMonitor !== 'science_only'
                  ? ` · ${telemetry.currentBpm} BPM`
                  : ''}
                {telemetry.activeTrackKeyLabel && layerMonitor !== 'science_only' && (
                  <> · Key-locked · {telemetry.activeTrackKeyLabel}</>
                )}
              </p>
            </div>

            {!isPro && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpgradePro?.()}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono-tech text-[10px] font-semibold transition ${
                    shareBonusSec > 0
                      ? 'border-emerald-400/40 bg-emerald-500/12 text-[#34D399]'
                      : remainingFreeSec <= 45
                        ? 'border-amber-400/60 bg-amber-400/18 text-amber-200'
                        : 'border-amber-400/35 bg-amber-400/10 text-amber-200'
                  }`}
                >
                  <Clock className="h-3 w-3" />
                  {previewLocked
                    ? 'Preview ended'
                    : shareBonusSec > 0
                      ? `+30m Bonus · ${formatTimer(remainingFreeSec)}`
                      : `Free · ${formatTimer(remainingFreeSec)}`}
                </button>
                {!shareBonusUsedToday && shareBonusSec === 0 && !previewLocked && (
                  <button
                    type="button"
                    disabled={sharingForBonus}
                    onClick={() => void handleShareFor30MinBonus()}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/12 px-2.5 py-1 font-mono-tech text-[10px] font-semibold text-[#34D399] transition hover:bg-emerald-500/20 disabled:opacity-60"
                  >
                    <Share2 className="h-2.5 w-2.5" />
                    {sharingForBonus ? 'Sharing...' : '+30m Share'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Voice Concierge Whisper Strip */}
          {voiceSpeaking && voiceTranscript && (
            <div className="animate-rise flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] px-3.5 py-2 text-xs text-[#E8E6DF]">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34D399]" />
                </span>
                <p className="truncate italic text-[#D9F3E7]/95">“{voiceTranscript}”</p>
              </div>
              <button
                type="button"
                onClick={() => engineRef.current?.stopVoiceConcierge(0.18)}
                className="shrink-0 rounded-md border border-white/12 bg-white/[0.05] px-2 py-0.5 font-mono-tech text-[10px] text-[#A3A39E] transition hover:text-[#F3F1EC]"
              >
                Skip
              </button>
            </div>
          )}

          {/* Primary Hardware Transport Deck */}
          <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-1 items-center gap-3 min-w-[180px]">
                <button
                  type="button"
                  onClick={() => void togglePlay()}
                  className="btn-aurora inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#0A0B0C]"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 fill-[#0A0B0C]" />
                  ) : (
                    <Play className="h-5 w-5 translate-x-0.5 fill-[#0A0B0C]" />
                  )}
                </button>

                <div className="flex-1 max-w-[230px] space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[#8E8E88]">
                    <span className="inline-flex items-center gap-1.5">
                      <Volume2 className="h-3 w-3" /> Volume
                    </span>
                    <span className="font-mono-tech text-[#D4D4CE]">
                      {Math.round(volume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Master Volume"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => handleVolume(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {voiceGuideEnabled && conciergeVoices.length > 1 && (
                  <select
                    aria-label="Studio Concierge Voice"
                    value={selectedVoiceId ?? conciergeVoices[0].voiceId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      selectedVoiceIdRef.current = nextId;
                      setSelectedVoiceId(nextId);
                      writeSavedVoiceId(nextId);
                      if (
                        audioStarted &&
                        isPlaying &&
                        layerMonitorRef.current !== 'science_only'
                      ) {
                        triggerVoiceCueRef.current('intro_short', true);
                      }
                    }}
                    className="max-w-[155px] truncate rounded-lg border border-white/15 bg-[#14161A] px-2 py-2 font-mono-tech text-[11px] font-medium text-[#D4D4CE] focus:border-emerald-400/60 focus:outline-none"
                  >
                    {conciergeVoices.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {v.shortLabel}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={handleToggleVoiceGuide}
                  aria-pressed={voiceGuideEnabled}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 font-mono-tech text-[11px] font-medium transition ${
                    voiceGuideEnabled
                      ? 'border-emerald-400/45 bg-emerald-500/12 text-[#34D399]'
                      : 'border-white/10 bg-[#101215] text-[#8E8E88] hover:text-[#F3F1EC]'
                  }`}
                >
                  {voiceGuideEnabled ? (
                    <Mic className="h-3.5 w-3.5 text-[#34D399]" />
                  ) : (
                    <MicOff className="h-3.5 w-3.5 text-[#8E8E88]" />
                  )}
                  <span>{voiceGuideEnabled ? 'Alanya ON' : 'Voice OFF'}</span>
                </button>
              </div>
            </div>

            {/* Compact Genre & Neural Effect Controls */}
            <div className="grid grid-cols-1 gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="player-genre-select"
                  className="block font-mono-tech text-[9.5px] uppercase tracking-wider text-[#8E8E88]"
                >
                  Carrier Style &amp; Mode
                </label>
                <div className="flex gap-1.5">
                  <select
                    id="player-genre-select"
                    value={genre}
                    onChange={(e) => switchGenre(e.target.value as ResolvedGenre)}
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#14161A] px-2.5 py-1.5 text-xs font-semibold text-[#F3F1EC] focus:border-emerald-400/60 focus:outline-none"
                  >
                    <option value="nootropic_trance">Signature · 6×40 Hz CFC</option>
                    {STUDIO_MIX_GENRES.map((g) => (
                      <option key={g} value={g}>
                        {GENRE_META[g].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCarrierSwitch(
                        carrierMode === 'lyria_realtime' ? 'studio_library' : 'lyria_realtime'
                      )
                    }
                    disabled={connectingLyria}
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 font-mono-tech text-[10px] font-semibold transition ${
                      carrierMode === 'lyria_realtime'
                        ? 'border-emerald-400/55 bg-emerald-500/15 text-[#34D399]'
                        : 'border-white/12 bg-[#14161A] text-[#A3A39E] hover:text-[#F3F1EC]'
                    }`}
                  >
                    {connectingLyria ? 'Sync...' : carrierMode === 'lyria_realtime' ? 'Stream ON' : 'Endless'}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono-tech text-[9.5px] uppercase tracking-wider text-[#8E8E88]">
                  <span>Neural Effect</span>
                  <span className="text-[#34D399]">
                    {layerMonitor === 'music_only'
                      ? '0% Bypass'
                      : `${Math.round(telemetry.currentModDepth * 100)}%`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/12 bg-[#141518] p-0.5 text-[10.5px] font-semibold">
                  {[
                    { label: 'Min', val: NEURAL_EFFECT_MULT.min, active: modMult <= 0.78 },
                    {
                      label: 'Standard',
                      val: NEURAL_EFFECT_MULT.standard,
                      active: modMult > 0.78 && modMult < 1.24,
                    },
                    { label: 'Max', val: NEURAL_EFFECT_MULT.max, active: modMult >= 1.24 },
                  ].map((tier) => (
                    <button
                      key={tier.label}
                      type="button"
                      onClick={() => setDirectModDepth(tier.val)}
                      className={`rounded-md py-1 transition ${
                        tier.active
                          ? 'bg-[#22252A] text-[#F3F1EC]'
                          : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                      }`}
                    >
                      {tier.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {lyriaNotice && (
              <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                {lyriaNotice}
              </div>
            )}
          </div>

          {/* Tier-2 Lab & Telemetry Toggle Handle */}
          <button
            type="button"
            data-testid="toggle-lab-drawer"
            aria-expanded={isLabOpen}
            onClick={() => setIsLabOpen((v) => !v)}
            className={`flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-xs font-semibold transition ${
              isLabOpen
                ? 'border-emerald-400/55 bg-emerald-500/12 text-[#F3F1EC]'
                : 'border-white/12 bg-[#131518] text-[#D4D4CE] hover:border-emerald-400/45 hover:text-[#F3F1EC]'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#34D399]" />
              <span>
                Lab &amp; Telemetry ·{' '}
                {layerMonitor === 'music_only'
                  ? 'Plain Music'
                  : layerMonitor === 'science_only'
                    ? 'Science Only'
                    : 'Nootropic Mix'}{' '}
                · 48 kHz
              </span>
              {showPvtLabBadge && !isLabOpen && (
                <span className="rounded border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 font-mono-tech text-[9.5px] font-bold text-[#34D399]">
                  Measure PVT
                </span>
              )}
            </span>
            {isLabOpen ? (
              <ChevronDown className="h-4 w-4 text-[#34D399]" />
            ) : (
              <ChevronUp className="h-4 w-4 text-[#34D399]" />
            )}
          </button>
        </div>

        {/* =============================================================== */}
        {/* TIER 2: EXPANDABLE LAB & TELEMETRY DRAWER                       */}
        {/* Renders oscilloscope canvases ONLY when open & not minimized    */}
        {/* =============================================================== */}
        {isLabOpen && (
          <div
            data-testid="tier2-lab-drawer"
            className="animate-step glass-card rounded-2xl p-4 sm:p-5 space-y-4 xl:col-span-6"
          >
            {/* 1) 3-Way A/B/C Audio Layer Monitor */}
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px]">
                <span className="uppercase tracking-[0.14em] text-[#8E8E88]">
                  Audio Layer Monitor · A/B Compare
                </span>
                <span className="text-[#34D399]">
                  {layerMonitor === 'full_mix'
                    ? 'Layer 1 + 2 Active'
                    : layerMonitor === 'science_only'
                      ? `Isolating ${telemetry.currentModHz} Hz Wave`
                      : 'Science Bypassed (Plain Music)'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    {
                      mode: 'full_mix' as const,
                      title: 'Nootropic Mix',
                      sub: 'Layer 1 + 2',
                      activeCls: 'border-emerald-400/55 bg-emerald-500/[0.10] text-[#F3F1EC]',
                    },
                    {
                      mode: 'science_only' as const,
                      title: 'Science Only',
                      sub: `${telemetry.currentModHz} Hz Wave`,
                      activeCls: 'border-amber-400/60 bg-amber-400/[0.12] text-[#F3F1EC]',
                    },
                    {
                      mode: 'music_only' as const,
                      title: 'Plain Music',
                      sub: 'Layer 2 · Raw',
                      activeCls:
                        themeMode === 'daylight'
                          ? 'border-slate-900 bg-[#22252A] text-[#F3F1EC]'
                          : 'border-white/35 bg-[#191C22] text-[#F3F1EC]',
                    },
                  ]
                ).map((opt) => {
                  const active = layerMonitor === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() => void handleLayerMonitorChange(opt.mode)}
                      className={`rounded-lg border px-2.5 py-2 text-left transition-all ${
                        active
                          ? opt.activeCls
                          : 'border-white/[0.08] bg-[#121418] text-[#9E9E98] hover:border-white/20 hover:text-[#F3F1EC]'
                      }`}
                    >
                      <div className="truncate text-[11px] font-semibold leading-tight">
                        {opt.title}
                      </div>
                      <div className="mt-0.5 truncate font-mono-tech text-[9px] text-[#A3A39E]">
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2) Live Oscilloscope Y(t) / X/Y Lissajous + 36-Band Spectrum */}
            {!minimized && (
              <>
                <LiveEnvelopeProof
                  engine={engineRef.current}
                  isPlaying={isPlaying}
                  entrainmentType={telemetry.entrainmentType}
                  frequencyHz={telemetry.currentModHz}
                  depth={telemetry.currentModDepth}
                  carrierLabel={activeSourceShort}
                  tuningA4Hz={telemetry.tuningA4Hz}
                  layerMode={layerMonitor}
                  isPureWave={layerMonitor === 'science_only'}
                  themeMode={themeMode}
                  onTogglePureWave={() =>
                    void handleLayerMonitorChange(
                      layerMonitor === 'science_only' ? 'full_mix' : 'science_only'
                    )
                  }
                />
                <NeuralVisualizer
                  engine={engineRef.current}
                  isPlaying={isPlaying}
                  safetyMode={recommendation.safetyMode}
                  modulationHz={telemetry.currentModHz}
                  themeMode={themeMode}
                />
              </>
            )}

            {/* 3) Live Sound Modifiers: Balance + Rain Overlay + 432 Hz + Live Synth */}
            <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                  <Sliders className="h-3.5 w-3.5 text-[#34D399]" />
                  Acoustic Modifiers
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => tweakIntensity(-0.15)}
                    className="subtle-chip rounded-lg px-2.5 py-1 text-[11px] font-medium"
                  >
                    Calmer
                  </button>
                  <button
                    type="button"
                    onClick={() => tweakIntensity(0.15)}
                    className="subtle-chip rounded-lg px-2.5 py-1 text-[11px] font-medium"
                  >
                    More drive
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCarrierSwitch(
                        carrierMode === 'generative_live' ? 'studio_library' : 'generative_live'
                      )
                    }
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                      carrierMode === 'generative_live'
                        ? 'border-emerald-400/55 bg-emerald-400/12 text-[#34D399]'
                        : 'border-white/10 bg-[#14161A] text-[#A3A39E] hover:text-[#F3F1EC]'
                    }`}
                  >
                    {carrierMode === 'generative_live' ? '✓ Live Synth' : 'Live Synth'}
                  </button>
                </div>
              </div>

              {/* Rain Layer Fader + 432 Hz Tuning */}
              <div className="grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1.5 font-medium text-[#D4D4CE]">
                      <CloudRain className="h-3.5 w-3.5 text-[#34D399]" />
                      Rain Overlay
                    </span>
                    <div className="flex items-center gap-2 font-mono-tech text-[10px] text-[#34D399]">
                      <span>{rainOverlayPct === null ? 'Auto' : `${rainOverlayPct}%`}</span>
                      {rainOverlayPct !== null && (
                        <button
                          type="button"
                          onClick={() => handleRainOverlayChange(null)}
                          className="text-[#8E8E88] hover:text-[#F3F1EC]"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label="Rain Layer Volume"
                    min={0}
                    max={100}
                    step={5}
                    value={rainOverlayPct ?? (genre === 'nature_rain' ? 70 : 0)}
                    onChange={(e) => handleRainOverlayChange(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#131518] px-3 py-2">
                  <div>
                    <div className="text-xs font-semibold text-[#F3F1EC]">432 Hz Natural Tuning</div>
                    <div className="font-mono-tech text-[10px] text-[#8E8E88]">
                      Active: A={telemetry.tuningA4Hz} Hz
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleTuning432}
                    aria-pressed={tuning432}
                    className={`rounded-lg border px-2.5 py-1 font-mono-tech text-[11px] font-semibold transition ${
                      tuning432
                        ? 'border-emerald-400/55 bg-emerald-500/15 text-[#34D399]'
                        : 'border-white/12 bg-[#14161A] text-[#A3A39E] hover:text-[#F3F1EC]'
                    }`}
                  >
                    {tuning432 ? '432 Hz ON' : '440 Hz'}
                  </button>
                </div>
              </div>

              {effectAutoTag && (
                <div className="text-[10.5px] font-mono-tech text-[#8E8E88]">
                  Effect Note: {effectAutoTag}
                </div>
              )}
            </div>

            {/* 4) Huggins Earbud Seal + Gamma/IAF + Biomarkers (PVT / Tapping / BLE 0x180D) */}
            <div className="rounded-xl border border-white/10 bg-[#121417] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                  <Headphones className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>600 Hz Dichotic Seal</span>
                  {telemetry.hugginsStatus === 'verified_stereo' && (
                    <span className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono-tech text-[9.5px] text-[#34D399]">
                      Stereo Verified
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void openHugginsModal()}
                  className="rounded-lg border border-white/15 bg-[#181A1F] px-3 py-1.5 text-xs font-semibold text-[#F3F1EC] hover:border-emerald-400/50"
                >
                  {telemetry.hugginsStatus === 'untested' ? 'Verify Headphones (35s)' : 'Recheck'}
                </button>
              </div>

              {telemetry.entrainmentType === 'gamma_40hz_clicks' && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
                  <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#8E8E88]">
                    40 Hz Gamma Delivery
                  </span>
                  <div className="inline-flex rounded-lg border border-white/12 bg-[#0B0C0E] p-0.5 text-[10.5px] font-semibold">
                    {(
                      [
                        { id: 'harmonic_mbi' as const, label: 'Harmonic' },
                        { id: 'gamma_chirp' as const, label: '40 Hz Chirp' },
                        { id: 'clinical_clicks' as const, label: 'Lab Clicks' },
                      ]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleGammaModeSwitch(opt.id)}
                        className={`rounded-md px-2 py-1 transition ${
                          telemetry.gammaMode === opt.id
                            ? 'bg-[#22252A] text-[#34D399]'
                            : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {((spec && spec.entrainment.frequencyHz >= 8 && spec.entrainment.frequencyHz <= 12) ||
                (telemetry.currentModHz >= 8 && telemetry.currentModHz <= 12)) && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
                  <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#8E8E88]">
                    Alpha IAF ({alphaIafHz.toFixed(1)} Hz)
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {[8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5].map((hz) => (
                      <button
                        key={hz}
                        type="button"
                        onClick={() => handleAlphaIafSelect(hz)}
                        className={`rounded-md border px-2 py-0.5 font-mono-tech text-[10px] font-semibold transition ${
                          Math.abs(alphaIafHz - hz) < 0.1
                            ? 'border-emerald-400/50 bg-emerald-500/15 text-[#34D399]'
                            : 'border-white/10 bg-[#0B0C0E] text-[#8E8E88] hover:text-[#F3F1EC]'
                        }`}
                      >
                        {hz.toFixed(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {!recommendation.safetyMode && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#121417] px-3.5 py-2.5">
                  <div className="space-y-0.5">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                      <Zap className="h-3.5 w-3.5 text-[#34D399]" />
                      {pvtPreMs !== null
                        ? `Baseline Recorded: ${pvtPreInvRt !== null ? `${pvtPreInvRt.toFixed(2)} s⁻¹ · ` : ''}${pvtPreMs} ms`
                        : '20-Trial Visual 1/RT Brain Benchmark'}
                    </div>
                    <p className="text-[10.5px] text-[#8E8E88]">
                      Measure pre/post reaction speed delta (~75s).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPrePvt(true)}
                    className="rounded-lg border border-white/15 bg-[#181A1F] px-3 py-1.5 text-xs font-semibold text-[#F3F1EC] hover:border-emerald-400/50"
                  >
                    {pvtPreMs !== null ? 'Retake' : 'Run PVT (~75s)'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#121417] px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[#F3F1EC]">
                        {tappingResult
                          ? `Tapping CV ${tappingResult.cvPct.toFixed(1)}%`
                          : '15s Motor Tapping CV'}
                      </div>
                      <p className="truncate text-[10px] text-[#8E8E88]">Motor rhythm stability</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTappingCheck(true)}
                      className="shrink-0 rounded-lg border border-white/15 bg-[#181A1F] px-2.5 py-1.5 text-[11px] font-semibold text-[#F3F1EC] hover:border-emerald-400/50"
                    >
                      {tappingResult ? 'Retest' : 'Run (15s)'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#121417] px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-1.5 truncate text-xs font-semibold text-[#F3F1EC]">
                        <HeartPulse className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                        <span className="truncate">
                          {bleHrvState.connected
                            ? bleHrvState.metrics
                              ? `HRV ${Math.round(bleHrvState.metrics.rmssdMs)} ms`
                              : `${bleHrvState.latestHrBpm ?? '--'} BPM`
                            : 'BLE HRV (0x180D)'}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-[#8E8E88]">
                        {isWebBluetoothSupported()
                          ? 'Optional HR strap RMSSD'
                          : 'Web BLE unavailable on iOS'}
                      </p>
                    </div>
                    {isWebBluetoothSupported() ? (
                      <button
                        type="button"
                        onClick={() => void handleToggleBleHrv()}
                        className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                          bleHrvState.connected
                            ? 'border-emerald-400/50 bg-emerald-500/15 text-[#34D399]'
                            : 'border-white/15 bg-[#181A1F] text-[#F3F1EC]'
                        }`}
                      >
                        {bleHrvState.connected ? 'Disconnect' : 'Connect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenSoundSystems?.()}
                        className="shrink-0 rounded-lg border border-emerald-400/40 bg-emerald-500/12 px-2 py-1 text-[10px] font-semibold text-[#34D399]"
                      >
                        Earbuds Pro →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Optional 5-second Anonymous Save form */}
            {!recommendation.safetyMode &&
              recommendation.sessionId.startsWith('eph_quick_') &&
              !profile &&
              (claimedSyncCode ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  <span>Saved ({claimProfession.trim()})</span>
                  <span className="font-mono-tech text-[11px]">{claimedSyncCode}</span>
                </div>
              ) : (
                <form
                  onSubmit={(e) => void handleClaimProfile(e)}
                  className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#D4D4CE]">
                    <span className="font-semibold">Save progress anonymously (optional):</span>
                    {onOpenCustomCheckIn && (
                      <button
                        type="button"
                        onClick={() => {
                          engineRef.current?.stop();
                          onOpenCustomCheckIn();
                        }}
                        className="font-mono-tech text-[10px] font-semibold text-[#34D399]"
                      >
                        Full Calibration →
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      maxLength={40}
                      value={claimProfession}
                      onChange={(e) => {
                        setClaimProfession(e.target.value);
                        setClaimError(null);
                      }}
                      placeholder="Profession"
                      className="flex-1 rounded-xl border border-white/12 bg-[#141518] px-3 py-2 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={18}
                      max={95}
                      value={claimAge}
                      onChange={(e) => {
                        setClaimAge(e.target.value);
                        setClaimError(null);
                      }}
                      placeholder="Age 18+"
                      className="font-mono-tech w-full rounded-xl border border-white/12 bg-[#141518] px-3 py-2 text-xs text-[#F3F1EC] placeholder-[#5F605C] sm:w-24 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={claimingProfile}
                      className="btn-aurora rounded-xl px-4 py-2 text-xs font-semibold"
                    >
                      {claimingProfile ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  {claimError && <p className="text-[11px] text-rose-300">{claimError}</p>}
                </form>
              ))}
          </div>
        )}
      </div>

      {/* Study Blueprint Sheet Modal (opened from InlineProtocolPill) */}
      {showBlueprintSheet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBlueprintSheet(false);
          }}
        >
          <div className="animate-step glass-stage my-auto max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[#34D399]">
                <BookOpen className="h-5 w-5" />
                <h2 className="text-base font-semibold text-[#F3F1EC]">
                  Verified Science &amp; Acoustic Blueprint
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowBlueprintSheet(false)}
                aria-label="Close protocol blueprint"
                className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/10 hover:text-[#F3F1EC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-[#A3A39E]">{recommendation.rationale}</p>
            {recommendation.executableSpec && (
              <StudyFidelityMatrix spec={recommendation.executableSpec} />
            )}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {recommendation.studies.map((study) => (
                <a
                  key={study.id}
                  href={study.doiOrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-xl border border-white/[0.08] bg-[#131417] p-3.5 space-y-1 transition hover:border-emerald-400/45"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold text-[#34D399]">
                      {study.authors.split(',')[0]} et al. ({study.year})
                    </div>
                    <ExternalLink className="h-3 w-3 shrink-0 text-[#8E8E88] group-hover:text-[#34D399]" />
                  </div>
                  <div className="text-xs font-medium text-[#F3F1EC]">{study.title}</div>
                  <p className="text-[11px] leading-relaxed text-[#8E8E88]">{study.summary}</p>
                </a>
              ))}
            </div>
            {livePapers.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {livePapers.map((paper) => (
                  <a
                    key={paper.pmid}
                    href={paper.doiUrl || paper.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-white/[0.08] bg-[#131417] p-3 space-y-1"
                  >
                    <div className="font-mono-tech text-[9.5px] font-semibold text-[#34D399]">
                      {paper.source === 'openalex' ? 'OpenAlex' : 'NIH PubMed'} · {paper.year}
                    </div>
                    <div className="text-xs font-medium text-[#F3F1EC]">{paper.title}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5-Minute Free Calibration Complete -> Stripe Pro Unlock Overlay */}
      {previewLocked && !isPro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage my-auto w-full max-w-lg rounded-2xl border border-white/15 p-5 sm:p-7 space-y-5">
            {onReturnHome && (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    endedByUserRef.current = true;
                    engineRef.current?.stop();
                    setIsPlaying(false);
                    onReturnHome();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#14161A] px-3 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:border-emerald-400/45 hover:text-[#F3F1EC]"
                >
                  <ArrowLeft className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>Main Page</span>
                </button>
                <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#8E8E88]">
                  nootropic.fm
                </span>
              </div>
            )}
            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                <Lock className="h-3 w-3" />
                5-Minute Free Calibration Complete
                {telemetry.currentModHz > 0 ? ` · ${telemetry.currentModHz} Hz Phase-Locked` : ''}
              </div>
              <h2 className="font-display text-2xl font-semibold text-[#F3F1EC] sm:text-[1.65rem] leading-tight">
                Your signal is calibrated.{' '}
                <span className="text-[#34D399]">Keep full sessions open.</span>
              </h2>
              <p className="text-xs leading-relaxed text-[#A3A39E] sm:text-sm">
                Your <strong className="text-[#F3F1EC]">{activeVibeDisplay.label}</strong> and{' '}
                <strong className="text-[#34D399]">{recommendation.arm.name}</strong> mix is tuned
                for your full {recommendation.plannedDurationMin}-minute session.
              </p>
            </div>

            {/* Annual vs Monthly Plan Picker (Web Stripe; hidden on Play Store to comply with Google Play Payments Policy) */}
            {!isNativePlayStoreApp() && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPaywallPlan('annual')}
                    className={`relative rounded-xl border p-4 text-left transition ${
                      selectedPaywallPlan === 'annual'
                        ? 'border-amber-400/70 bg-amber-400/10'
                        : 'border-white/10 bg-[#121316] hover:border-white/25'
                    }`}
                  >
                    <span className="absolute -top-2.5 right-3 rounded bg-amber-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0A0B0C]">
                      7-Day Free Trial · Save 50%
                    </span>
                    <div className="text-xs font-semibold text-amber-200">Annual Studio Pass</div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-mono-tech text-2xl font-bold text-[#F3F1EC]">$59</span>
                      <span className="text-xs text-[#8E8E88]">/ year</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[#8E8E88]">$0.00 today · $4.92/mo after trial</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPaywallPlan('monthly')}
                    className={`rounded-xl border p-4 text-left transition ${
                      selectedPaywallPlan === 'monthly'
                        ? 'border-emerald-400/70 bg-emerald-400/10'
                        : 'border-white/10 bg-[#121316] hover:border-white/25'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[#34D399]">Monthly Pass</div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-mono-tech text-2xl font-bold text-[#F3F1EC]">$9.99</span>
                      <span className="text-xs text-[#8E8E88]">/ month</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[#8E8E88]">Cancel anytime in 1 click</div>
                  </button>
                </div>

                {selectedPaywallPlan === 'annual' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 font-mono-tech text-[10px] text-amber-100">
                    <span>Today: $0.00</span>
                    <span className="text-[#8E8E88]">→</span>
                    <span>Day 5: Reminder email</span>
                    <span className="text-[#8E8E88]">→</span>
                    <span>Day 7: $59/yr (cancel anytime)</span>
                  </div>
                )}
              </>
            )}

            <ul className="space-y-1.5 rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-3.5 text-xs text-[#D4D4CE]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span>Unlimited full-length sessions (15, 30, 45, 60 min with zero cutoffs)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span>All 11 curated instrumental styles + NootropicFM Mode &amp; Endless Stream</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span>Real-time Y(t) &amp; X/Y Lissajous oscilloscope + Science Study Lab</span>
              </li>
            </ul>

            {unlockError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {unlockError}
              </div>
            )}

            {!isNativePlayStoreApp() && (
              <button
                type="button"
                disabled={unlockingCheckout}
                onClick={async () => {
                  setUnlockError(null);
                  if (!stripeAvailable || !onStartDirectCheckout) {
                    onUpgradePro?.();
                    return;
                  }
                  setUnlockingCheckout(true);
                  try {
                    await onStartDirectCheckout(selectedPaywallPlan);
                  } catch (err) {
                    setUnlockError(
                      err instanceof Error ? err.message : 'Unable to open Stripe Checkout right now.'
                    );
                    setUnlockingCheckout(false);
                  }
                }}
                className="btn-aurora flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold disabled:opacity-60 sm:text-base"
              >
                {unlockingCheckout ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                {unlockingCheckout
                  ? 'Opening Secure Stripe Checkout...'
                  : selectedPaywallPlan === 'annual'
                    ? 'Start 7-Day Free Trial · Then $59/yr'
                    : 'Start Monthly Pass · $9.99/mo'}
              </button>
            )}

            {/* Viral Share Bonus: Share your 1-of-1 Neural Fingerprint Card -> +30 Min Free Instantly! */}
            {!shareBonusUsedToday && shareBonusSec === 0 && (
              <div className="rounded-xl border border-emerald-400/30 bg-[#0D110F] p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <NeuralFingerprintSigil
                    seed={shareSeed}
                    size={48}
                    className="rounded-lg border border-white/10 bg-[#08090B] p-0.5"
                  />
                  <div className="min-w-0 space-y-0.5 text-left">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                      <Share2 className="h-3.5 w-3.5 text-[#34D399]" />
                      Want +30 minutes free right now?
                    </div>
                    <p className="text-[11px] leading-relaxed text-[#A3A39E]">
                      Share your unique <strong className="text-[#F3F1EC]">1-of-1 Neural Fingerprint</strong>{' '}
                      card (public QR only, your private login key stays hidden) to unlock{' '}
                      <strong className="text-[#34D399]">+30 extra minutes</strong> instantly.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={sharingForBonus}
                  onClick={() => void handleShareFor30MinBonus()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/45 bg-emerald-400/15 px-4 py-2.5 text-xs font-semibold text-[#F3F1EC] transition hover:bg-emerald-400/25 disabled:opacity-60"
                >
                  {sharingForBonus ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5 text-[#34D399]" />
                  )}
                  {sharingForBonus
                    ? 'Preparing Your Fingerprint Card...'
                    : 'Share My Neural Fingerprint · Unlock +30 Min Free'}
                </button>
              </div>
            )}

            {/* Direct Pro / Lifetime Access Key Unlock right inside Paywall */}
            <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                <KeyRound className="h-3.5 w-3.5 text-[#34D399]" />
                <span>Have a Pro / Lifetime Sync Key?</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={paywallSyncKey}
                  onChange={(e) => setPaywallSyncKey(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRedeemPaywallSyncKey();
                  }}
                  placeholder="NFM-XXXX-XXXX"
                  className="font-mono-tech flex-1 rounded-xl border border-white/15 bg-[#121418] px-3 py-2 text-xs uppercase tracking-wider text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={redeemingSyncKey || !paywallSyncKey.trim()}
                  onClick={() => void handleRedeemPaywallSyncKey()}
                  className="rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-4 py-2 text-xs font-semibold text-[#34D399] transition hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  {redeemingSyncKey ? 'Unlocking...' : 'Unlock'}
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 pt-0.5 text-center">
              {!isNativePlayStoreApp() && (
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#8E8E88]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>Secured by Stripe · Instant unlock · Cancel anytime</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleEndSession}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A3A39E] underline-offset-2 transition hover:text-[#34D399] hover:underline"
              >
                <Crown className="h-3 w-3 opacity-60" />
                Not now, end preview &amp; rate how I feel
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrePvt && (
        <PvtBenchmarkModal
          phase="pre"
          onComplete={(res) => {
            setPvtPreMs(res.medianMs);
            setPvtLapsesPre(res.lapses);
            setPvtPreInvRt(res.meanInvRt);
            setPvtPreTrials(res.trialCount);
            setShowPrePvt(false);
            if (!isEphemeral && !liveSessionId.startsWith('eph_')) {
              void api
                .saveSessionPvt({
                  sessionId: liveSessionId,
                  phase: 'pre',
                  medianMs: res.medianMs,
                  lapses: res.lapses,
                  meanInvRt: res.meanInvRt,
                  trialCount: res.trialCount,
                  refreshHz: res.refreshHz,
                  decileSpreadMs: res.decileSpreadMs,
                })
                .catch(() => {});
            }
          }}
          onClose={() => setShowPrePvt(false)}
        />
      )}

      {showHugginsCheck && (
        <HugginsCheckModal
          onComplete={(res) => void closeHugginsModal(res)}
          onClose={() => void closeHugginsModal()}
        />
      )}

      {showTappingCheck && (
        <TappingTestModal
          targetBpm={telemetry.currentBpm > 0 ? telemetry.currentBpm : 100}
          onComplete={(res) => {
            setTappingResult(res);
            if (!isEphemeral && !liveSessionId.startsWith('eph_')) {
              void api
                .saveSessionBiomarkers({
                  sessionId: liveSessionId,
                  tappingCvPct: res.cvPct,
                  tappingMeanItiMs: res.meanItiMs,
                })
                .catch(() => {});
            }
          }}
          onClose={() => setShowTappingCheck(false)}
        />
      )}
    </div>
  );
}
