import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Fingerprint,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { matchCoreGenreAlias, sanitizeCustomVibe } from '../shared/promptComposer';
import { formatCohortLabel, swapRecommendationGenre } from '../shared/protocols';
import {
  TARGET_LABELS,
  formatProfileSummary,
  type AppRuntimeConfig,
  type CurrentState,
  type LiveAdjustment,
  type MusicGenreChoice,
  type OutputDevice,
  type ProtocolRecommendation,
  type ResolvedGenre,
  type SessionEnvironment,
  type SessionRecord,
  type TargetState,
  type UserProfile,
} from '../shared/types';
import { AmbientField, type FieldMood } from './components/AmbientField';
import { AppShell, type AppPrimaryTab } from './components/AppShell';
import type { MoodPresetSelection } from './components/CheckInView';
import { MiniPlayerBar } from './components/MiniPlayerBar';
import type { PlayerControlBridge, PlayerMiniSnapshot } from './components/PlayerView';
import { StudioHomeView } from './components/StudioHomeView';

const CheckInView = lazy(() =>
  import('./components/CheckInView').then((m) => ({ default: m.CheckInView }))
);
const SystemPillDrawer = lazy(() =>
  import('./components/SystemPillDrawer').then((m) => ({ default: m.SystemPillDrawer }))
);
import {
  buildStudioUrl,
  resolveLegacyShowcaseRedirect,
  resolveSurfaceMode,
  type SurfaceMode,
} from './lib/domainRouting';
import {
  applyDocumentTheme,
  readCircadianPreference,
  resolveCircadianTheme,
  writeCircadianPreference,
  type CircadianPreference,
  type ResolvedThemeMode,
} from './lib/circadianTheme';
import {
  computeDisclosurePrompts,
  dismissDisclosurePrompt,
  markHugginsVerified,
} from './lib/disclosureScheduler';
import {
  eraseAllLocalStudioData,
  exportLocalStudioDataJson,
  resolvePrivacyState,
} from './lib/privacyGuard';

const FlagshipShowcaseView = lazy(() =>
  import('./components/FlagshipShowcaseView').then((m) => ({ default: m.FlagshipShowcaseView }))
);
const HeroLandingView = lazy(() =>
  import('./components/HeroLandingView').then((m) => ({ default: m.HeroLandingView }))
);
const SoundSystemsModal = lazy(() =>
  import('./components/SoundSystemsModal').then((m) => ({ default: m.SoundSystemsModal }))
);
const DebriefView = lazy(() =>
  import('./components/DebriefView').then((m) => ({ default: m.DebriefView }))
);
const OnboardingView = lazy(() =>
  import('./components/OnboardingView').then((m) => ({ default: m.OnboardingView }))
);
const PlayerView = lazy(() =>
  import('./components/PlayerView').then((m) => ({ default: m.PlayerView }))
);
const ProtocolRevealView = lazy(() =>
  import('./components/ProtocolRevealView').then((m) => ({ default: m.ProtocolRevealView }))
);
const UpgradeProModal = lazy(() =>
  import('./components/UpgradeProModal').then((m) => ({ default: m.UpgradeProModal }))
);
import {
  api,
  clearStoredProfileAuth,
  getStoredProfileAuth,
  saveStoredProfileAuth,
} from './lib/api';
import {
  buildInstantQuickTryRecommendation,
  buildStateGoalQuickRecommendation,
  type QuickFeelingId,
  type QuickTryId,
} from './lib/quickTryProtocols';
import {
  NEURAL_MICRO_STATES,
  coordsToBaselineScore,
  type NeuralCoords,
  type NeuralMicroState,
} from '../shared/neuralStates';

const StudyLabView = lazy(() =>
  import('./components/StudyLabView').then((m) => ({ default: m.StudyLabView }))
);
const InsightsView = lazy(() =>
  import('./components/InsightsView').then((m) => ({ default: m.InsightsView }))
);
const HugginsCheckModal = lazy(() =>
  import('./components/HugginsCheckModal').then((m) => ({ default: m.HugginsCheckModal }))
);

type Screen =
  | 'studio_home'
  | 'landing'
  | 'onboarding'
  | 'checkin'
  | 'studylab'
  | 'reveal'
  | 'player'
  | 'debrief'
  | 'insights';

const SHOWCASE_TARGETS = new Set<TargetState>([
  'deep_flow',
  'alert_focus',
  'energy_lift',
  'calm_reset',
  'sleep_winddown',
]);

const SHOWCASE_DEFAULT_MICRO: Record<TargetState, string> = {
  deep_flow: 'calm_steady',
  alert_focus: 'brain_fog',
  energy_lift: 'sleep_deprived',
  calm_reset: 'frustrated_tense',
  sleep_winddown: 'drowsy_bedtime',
};

function buildShowcasePreset(
  targetRaw?: string | null,
  durationRaw?: number | string | null
): MoodPresetSelection | null {
  if (!targetRaw || !SHOWCASE_TARGETS.has(targetRaw as TargetState)) {
    return null;
  }
  const target = targetRaw as TargetState;
  const preferredId = SHOWCASE_DEFAULT_MICRO[target];
  const micro =
    NEURAL_MICRO_STATES.find((s) => s.id === preferredId) ??
    NEURAL_MICRO_STATES.find((s) => s.suggestedTarget === target) ??
    NEURAL_MICRO_STATES[0];
  const parsedDur = Number(durationRaw);
  const durationMin = Number.isFinite(parsedDur)
    ? Math.max(5, Math.min(90, Math.round(parsedDur)))
    : target === 'deep_flow'
      ? 45
      : target === 'sleep_winddown'
        ? 30
        : target === 'alert_focus'
          ? 25
          : target === 'calm_reset'
            ? 15
            : 20;
  const requestedGenre: MusicGenreChoice =
    target === 'calm_reset' || target === 'sleep_winddown' ? 'ambient_space' : 'deep_electronic';
  return {
    id: `showcase_${target}`,
    label: `${TARGET_LABELS[target]} (${durationMin}m)`,
    microStateId: micro.id,
    targetState: target,
    requestedGenre,
    durationMin,
  };
}

export default function App() {
  const hasInitialHashSync =
    typeof window !== 'undefined' && /^#sync=([A-Za-z0-9-]+)$/i.test(window.location.hash);
  const hasInitialStoredProfile = Boolean(getStoredProfileAuth()?.profileId);

  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(() => resolveSurfaceMode());
  const [screen, setScreen] = useState<Screen>('studio_home');
  const [checkinResetNonce, setCheckinResetNonce] = useState(0);
  const [booting, setBooting] = useState(hasInitialHashSync);
  const [runtimeConfig, setRuntimeConfig] = useState<AppRuntimeConfig | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [pendingDebrief, setPendingDebrief] = useState<SessionRecord | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<MoodPresetSelection | null>(null);
  const [revealOrigin, setRevealOrigin] = useState<'studio_home' | 'landing' | 'checkin'>('checkin');
  const [activeRec, setActiveRec] = useState<ProtocolRecommendation | null>(null);
  const [sessionDisplay, setSessionDisplay] = useState<'full' | 'minimized'>('full');
  const [playerSnapshot, setPlayerSnapshot] = useState<PlayerMiniSnapshot | null>(null);
  const playerControlRef = useRef<PlayerControlBridge | null>(null);
  const [researching, setResearching] = useState(false);
  const [fieldMood, setFieldMood] = useState<FieldMood>('default');
  const [audioActive, setAudioActive] = useState(false);

  // Modals: Privacy + Passwordless Neural Identity / Sync / Switch + Huggins
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);

  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [showSoundSystemsModal, setShowSoundSystemsModal] = useState(false);
  const [showHugginsModal, setShowHugginsModal] = useState(false);
  const [disclosureTick, setDisclosureTick] = useState(0);
  const [circadianPref, setCircadianPref] = useState<CircadianPreference>(() =>
    readCircadianPreference()
  );
  const [themeMode, setThemeMode] = useState<ResolvedThemeMode>(() =>
    resolveCircadianTheme(readCircadianPreference())
  );

  useEffect(() => {
    const bump = () => setDisclosureTick((t) => t + 1);
    window.addEventListener('nootropic-disclosure-updated', bump);
    return () => window.removeEventListener('nootropic-disclosure-updated', bump);
  }, []);

  const privacy = useMemo(
    () => resolvePrivacyState({ profile, runtimeConfig }),
    [profile, runtimeConfig]
  );

  const disclosure = useMemo(() => {
    void disclosureTick;
    return computeDisclosurePrompts({ profile, syncCode });
  }, [disclosureTick, profile, syncCode]);

  useEffect(() => {
    const syncTheme = () => {
      const resolved = resolveCircadianTheme(circadianPref);
      setThemeMode(resolved);
      applyDocumentTheme(resolved);
    };
    syncTheme();
    if (circadianPref !== 'auto') return undefined;
    const id = window.setInterval(syncTheme, 60_000);
    return () => window.clearInterval(id);
  }, [circadianPref]);

  const handleSetCircadianPref = (next: CircadianPreference) => {
    setCircadianPref(next);
    const resolved = resolveCircadianTheme(next);
    setThemeMode(resolved);
    writeCircadianPreference(next);
    applyDocumentTheme(resolved);
  };

  const handleSetCircadianTheme = (next: ResolvedThemeMode) => {
    handleSetCircadianPref(next);
  };
  const [restoreInput, setRestoreInput] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [identityStatus, setIdentityStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [qrToast, setQrToast] = useState<string | null>(null);

  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    const raf = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(raf);
  }, [screen]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(
        e as unknown as {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        }
      );
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const preloadCoreModules = () => {
      void import('./components/PlayerView');
    };
    if (hasInitialStoredProfile) {
      preloadCoreModules();
      return;
    }
    const timer = window.setTimeout(preloadCoreModules, 80);
    return () => window.clearTimeout(timer);
  }, [hasInitialStoredProfile]);

  const [debriefContext, setDebriefContext] = useState<{
    sessionId: string;
    armName: string;
    cohortLabel: string;
    baselineScore: number;
    plannedDurationMin: number;
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
    ephemeralMode?: boolean;
    pvtPreMs?: number | null;
    pvtLapsesPre?: number | null;
    pvtPreInvRt?: number | null;
    pvtTrialCount?: number | null;
    tappingCvPct?: number | null;
    tappingMeanItiMs?: number | null;
    hrvRmssdMs?: number | null;
    hrvLfRatio?: number | null;
    activeTrackKey?: string | null;
    studySpecId?: string;
    studyTitle?: string;
    entrainmentType?: string;
    frequencyHz?: number;
    freeQuotaReached?: boolean;
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const boot = async () => {
      const legacyRedirect = resolveLegacyShowcaseRedirect(window.location);
      if (legacyRedirect) {
        window.location.replace(legacyRedirect);
        return;
      }

      const configPromise = api
        .getConfig()
        .then((res) => setRuntimeConfig(res.config))
        .catch(() => {});

      // 0. Check Stripe Checkout return (?billing=success&session_id=cs_... or ?billing=canceled)
      const searchParams = new URLSearchParams(window.location.search);
      const billingStatus = searchParams.get('billing');
      const checkoutSessionId = searchParams.get('session_id');
      const deepView = searchParams.get('view');
      const deepLaunch = searchParams.get('launch');
      const deepTarget = searchParams.get('target');
      const deepDuration = searchParams.get('duration');

      if (billingStatus || deepView || deepLaunch || deepTarget || deepDuration) {
        const cleaned = new URLSearchParams(window.location.search);
        cleaned.delete('billing');
        cleaned.delete('session_id');
        cleaned.delete('view');
        cleaned.delete('launch');
        cleaned.delete('target');
        cleaned.delete('duration');
        const nextSearch = cleaned.toString();
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        );
      }

      const verifyBillingIfReturned = async () => {
        if (
          billingStatus === 'success' &&
          checkoutSessionId &&
          checkoutSessionId.startsWith('cs_')
        ) {
          try {
            const verified = await api.verifyStripeCheckout(checkoutSessionId);
            if (verified.paid && verified.profile) {
              setProfile(verified.profile);
              setQrToast(
                'Welcome to nootropic.fm Pro! Unlimited music styles & all science studies are now unlocked.'
              );
              setScreen('studio_home');
            }
          } catch {
            // Webhook will still activate Pro asynchronously if verification timed out
          }
        }
      };

      const applyStudioDeepLinks = () => {
        if (resolveSurfaceMode() !== 'studio') return;
        if (deepView === 'studylab') {
          setFieldMood('focus');
          setScreen('studylab');
          return;
        }
        if (deepView === 'insights') {
          setFieldMood('flow');
          setScreen('insights');
          return;
        }
        if (deepLaunch === 'signature_6x40') {
          const rec = buildInstantQuickTryRecommendation('signature_6x40', null);
          setActiveRec(rec);
          setSessionDisplay('full');
          setFieldMood('focus');
          setScreen('player');
          return;
        }
        const deepPreset = buildShowcasePreset(deepTarget, deepDuration);
        if (deepPreset || deepLaunch) {
          setSelectedPreset(deepPreset);
          setActiveRec(null);
          setFieldMood(
            deepPreset
              ? deepPreset.targetState === 'calm_reset'
                ? 'calm'
                : deepPreset.targetState === 'deep_flow'
                  ? 'flow'
                  : deepPreset.targetState === 'sleep_winddown'
                    ? 'sleep'
                    : 'focus'
              : 'default'
          );
          setCheckinResetNonce((n) => n + 1);
          setScreen('checkin');
        }
      };

      // 1. Magic Scanned QR Auto-Restore via private URL hash (#sync=NFM-XXXX-XXXX)
      // Hash fragments never leave the browser in HTTP logs or Referer headers.
      const hashMatch = window.location.hash.match(/^#sync=([A-Za-z0-9-]+)$/i);
      if (hashMatch) {
        const scannedCode = decodeURIComponent(hashMatch[1]).trim();
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        try {
          const res = await api.restoreIdentity(scannedCode);
          saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
          setProfile(res.profile);
          setSyncCode(res.syncCode);
          setPendingDebrief(res.pendingDebrief);
          setQrToast(
            `Neural Fingerprint synced via QR — welcome back${
              res.profile.displayName ? `, ${res.profile.displayName}` : ''
            } (${formatProfileSummary(res.profile)})!`
          );
          await configPromise;
          setBooting(false);
          setScreen('studio_home');
          return;
        } catch {
          setErrorBanner('Scanned QR Sync Key was invalid or already erased.');
        }
      }

      const stored = getStoredProfileAuth();
      if (!stored?.profileId) {
        try {
          const cookieSession = await api.getCurrentSession();
          if (cookieSession.authenticated && cookieSession.profile) {
            saveStoredProfileAuth(cookieSession.profile.id);
            setProfile(cookieSession.profile);
            setPendingDebrief(cookieSession.pendingDebrief);
          }
        } catch {
          // ignore anonymous boot or test mocks without /api/identity/me
        }
        await verifyBillingIfReturned();
        applyStudioDeepLinks();
        void configPromise;
        setBooting(false);
        return;
      }

      if (stored.syncCode) {
        setSyncCode(stored.syncCode);
      }

      try {
        const res = await api.getProfile(stored.profileId);
        if (res.profileToken || res.syncCode) {
          saveStoredProfileAuth(
            res.profile.id,
            res.profileToken ?? undefined,
            res.syncCode ?? stored.syncCode ?? undefined
          );
        }
        if (res.syncCode) {
          setSyncCode(res.syncCode);
        }
        setProfile(res.profile);
        setPendingDebrief(res.pendingDebrief);
      } catch {
        clearStoredProfileAuth();
        setSyncCode(null);
      } finally {
        await verifyBillingIfReturned();
        applyStudioDeepLinks();
        void configPromise;
        setBooting(false);
      }
    };
    void boot();
  }, []);

  const moodFromTarget = useCallback((env: SessionEnvironment, target: TargetState): FieldMood => {
    if (env === 'driving') return 'driving';
    if (target === 'calm_reset') return 'calm';
    if (target === 'deep_flow') return 'flow';
    if (target === 'sleep_winddown') return 'sleep';
    return 'focus';
  }, []);

  const handleLaunchDirectRecommendation = useCallback(
    (rec: ProtocolRecommendation) => {
      setErrorBanner(null);
      setActiveRec(rec);
      setSessionDisplay('full');
      setPlayerSnapshot(null);
      setFieldMood(moodFromTarget(rec.environment, rec.targetState));
      setScreen('player');
    },
    [moodFromTarget]
  );

  const handleInstantHeroPlay = useCallback(
    (id: QuickTryId) => {
      const rec = buildInstantQuickTryRecommendation(id, profile);
      handleLaunchDirectRecommendation(rec);
    },
    [handleLaunchDirectRecommendation, profile]
  );

  const handleLaunchStateGoal = useCallback(
    (feelingId: QuickFeelingId, target: TargetState) => {
      const rec = buildStateGoalQuickRecommendation(feelingId, target, profile);
      handleLaunchDirectRecommendation(rec);
    },
    [handleLaunchDirectRecommendation, profile]
  );

  const handleStartDirectCheckout = useCallback(
    async (plan: 'annual' | 'monthly') => {
      const res = await api.createStripeCheckout({
        plan,
        profileId: profile?.id,
      });
      if (res.profile && res.profileToken) {
        saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
        setProfile(res.profile);
        if (res.syncCode) setSyncCode(res.syncCode);
      }
      window.location.href = res.url;
    },
    [profile?.id]
  );

  const startSession = useCallback(
    async (
      payload: {
        profileId?: string;
        ephemeralMode?: boolean;
        ephemeralProfile?: Partial<UserProfile>;
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
      },
      originScreen: 'landing' | 'checkin' = 'checkin'
    ) => {
      setErrorBanner(null);
      setActiveRec(null);
      setResearching(true);
      setRevealOrigin(originScreen);
      setFieldMood(moodFromTarget(payload.environment, payload.targetState));
      setScreen('reveal');
      try {
        const { recommendation } = await api.startProtocol(payload);
        setActiveRec(recommendation);
        setPendingDebrief(null);
        setFieldMood(moodFromTarget(recommendation.environment, recommendation.targetState));
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Unable to start protocol');
        setScreen(originScreen);
      } finally {
        setResearching(false);
      }
    },
    [moodFromTarget]
  );

  const handleDiscoverFromHero = useCallback(
    (
      microState: NeuralMicroState,
      coords: NeuralCoords,
      target: TargetState,
      durationMin: number
    ) => {
      const isDriver = profile?.role === 'driver';
      const environment: SessionEnvironment = isDriver
        ? 'driving'
        : target === 'calm_reset' || target === 'sleep_winddown'
          ? 'home_relax'
          : 'office';
      const device: OutputDevice = isDriver
        ? 'car_audio'
        : (profile?.defaultDevice ?? 'headphones');
      const baselineScore = coordsToBaselineScore(coords.energy, coords.clarity);
      const isEphemeral = !profile;

      void startSession(
        {
          profileId: profile?.id,
          ephemeralMode: isEphemeral,
          ephemeralProfile: profile ?? undefined,
          rawInputText: `${microState.label} (${coords.energy}% energy, ${coords.clarity}% clarity) -> ${target}`,
          currentState: microState.coreState,
          microStateId: microState.id,
          microStateLabel: microState.label,
          arousalPct: coords.energy,
          clarityPct: coords.clarity,
          baselineScore,
          targetState: target,
          environment,
          device,
          durationMin,
        },
        'landing'
      );
    },
    [profile, startSession]
  );

  const handleSaveProfileStep = useCallback(
    async (data: Partial<UserProfile>) => {
      const { profile: saved, profileToken, syncCode: issuedCode } = await api.saveProfile({
        ...data,
        id: data.id ?? profile?.id,
      });
      saveStoredProfileAuth(
        saved.id,
        profileToken ?? undefined,
        issuedCode ?? syncCode ?? undefined
      );
      if (issuedCode) setSyncCode(issuedCode);
      setProfile(saved);
    },
    [profile?.id, syncCode]
  );

  const handleSaveProfile = async (data: Partial<UserProfile>) => {
    setErrorBanner(null);
    const { profile: saved, profileToken, syncCode: issuedCode } = await api.saveProfile(data);
    saveStoredProfileAuth(saved.id, profileToken, issuedCode ?? syncCode ?? undefined);
    if (issuedCode) setSyncCode(issuedCode);
    setProfile(saved);
    setScreen('studio_home');
  };

  const handleLaunchUnifiedSession = async (payload: {
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
  }) => {
    setErrorBanner(null);

    if (payload.ephemeralMode) {
      const { profileUpdate, ...sessionPayload } = payload;
      await startSession({
        ...sessionPayload,
        ephemeralMode: true,
        ephemeralProfile: profileUpdate ?? (profile ?? undefined),
      });
      return;
    }

    let activeProfile = profile;
    if (!activeProfile || payload.profileUpdate) {
      const { profile: saved, profileToken, syncCode: issuedCode } = await api.saveProfile({
        ...(payload.profileUpdate ?? {
          age: Math.max(18, payload.ageOverride ?? 34),
          defaultDevice: payload.device,
          researchConsent: true,
        }),
        id: activeProfile?.id ?? payload.profileUpdate?.id,
      });
      saveStoredProfileAuth(
        saved.id,
        profileToken ?? undefined,
        issuedCode ?? syncCode ?? undefined
      );
      if (issuedCode) setSyncCode(issuedCode);
      setProfile(saved);
      activeProfile = saved;
    }

    const { profileUpdate: _ignored, ephemeralMode: _eph, ...sessionPayload } = payload;
    await startSession({
      profileId: activeProfile.id,
      ...sessionPayload,
    });
  };

  const handleSwapRevealGenre = useCallback((newGenre: ResolvedGenre) => {
    setActiveRec((prev) => {
      if (!prev) return prev;
      const updated = swapRecommendationGenre(prev, newGenre);
      if (!updated.ephemeralMode) {
        void api
          .updateSessionGenre({
            sessionId: updated.sessionId,
            genre: newGenre,
            customGenreSlug: null,
            audioSource: 'studio_library',
            params: updated.params,
          })
          .catch(() => {});
      }
      return updated;
    });
  }, []);

  const handleSwapCustomVibe = useCallback(
    async (customLabel: string) => {
      if (!activeRec) return;
      const coreAlias = matchCoreGenreAlias(customLabel);
      if (coreAlias) {
        handleSwapRevealGenre(coreAlias);
        return;
      }
      const sanitized = sanitizeCustomVibe(customLabel);
      if (!sanitized || sanitized.rejectedReason || !sanitized.slug) return;

      let cachedUrl: string | undefined;
      try {
        const st = await api.getMusicStatus(sanitized.slug, activeRec.params.energyTier);
        if (st.status === 'ready' && st.track?.url) {
          cachedUrl = st.track.url;
        }
      } catch {
        // fallback cleanly
      }

      setActiveRec((prev) => {
        if (!prev) return prev;
        const updated = swapRecommendationGenre(prev, prev.params.genre, {
          slug: sanitized.slug,
          label: sanitized.displayLabel,
          cachedUrl,
          liveGenAvailable: runtimeConfig?.customLiveGenAvailable ?? false,
          noiseSensitivity: profile?.noiseSensitivity ?? 'medium',
        });
        if (!updated.ephemeralMode) {
          void api
            .updateSessionGenre({
              sessionId: updated.sessionId,
              genre: updated.fallbackCoreGenre,
              customGenreSlug: sanitized.slug,
              audioSource: updated.audioSource,
              params: updated.params,
            })
            .catch(() => {});
        }
        return updated;
      });
    },
    [activeRec, runtimeConfig, profile, handleSwapRevealGenre]
  );

  const handleFinishToDebrief = useCallback(
    (stats: {
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
    }) => {
      if (!activeRec) return;
      const spec = activeRec.executableSpec;
      setDebriefContext({
        sessionId: stats.sessionIdOverride ?? activeRec.sessionId,
        armName: activeRec.arm.name,
        cohortLabel: activeRec.cohortLabel,
        baselineScore: activeRec.baselineScore,
        plannedDurationMin: activeRec.plannedDurationMin,
        actualDurationSec: stats.actualDurationSec,
        liveAdjustments: stats.liveAdjustments,
        ephemeralMode:
          typeof stats.ephemeralOverride === 'boolean'
            ? stats.ephemeralOverride
            : activeRec.ephemeralMode,
        pvtPreMs: stats.pvtPreMs ?? null,
        pvtLapsesPre: stats.pvtLapsesPre ?? null,
        pvtPreInvRt: stats.pvtPreInvRt ?? null,
        pvtTrialCount: stats.pvtTrialCount ?? null,
        tappingCvPct: stats.tappingCvPct ?? null,
        tappingMeanItiMs: stats.tappingMeanItiMs ?? null,
        hrvRmssdMs: stats.hrvRmssdMs ?? null,
        hrvLfRatio: stats.hrvLfRatio ?? null,
        activeTrackKey: stats.activeTrackKey ?? null,
        studySpecId: spec?.id,
        studyTitle: spec?.shortLabel || spec?.studyRef.title,
        entrainmentType: spec?.entrainment.type,
        frequencyHz: spec?.entrainment.frequencyHz ?? activeRec.params.modulationHz,
        freeQuotaReached: stats.freeQuotaReached,
      });
      setSessionDisplay('full');
      setPlayerSnapshot(null);
      setActiveRec(null);
      setAudioActive(false);
      setFieldMood('calm');
      setScreen('debrief');
    },
    [activeRec]
  );

  const handleOpenPendingDebrief = () => {
    if (!pendingDebrief) return;
    setDebriefContext({
      sessionId: pendingDebrief.id,
      armName: pendingDebrief.armName,
      cohortLabel: formatCohortLabel(pendingDebrief.cohortKey),
      baselineScore: pendingDebrief.baselineScore,
      plannedDurationMin: pendingDebrief.plannedDurationMin,
      actualDurationSec: pendingDebrief.actualDurationSec || 600,
      liveAdjustments: pendingDebrief.liveAdjustments,
      ephemeralMode: false,
    });
    setPendingDebrief(null);
    setFieldMood('calm');
    setScreen('debrief');
  };

  const handleDismissPending = async () => {
    if (!pendingDebrief) return;
    const id = pendingDebrief.id;
    const dur = pendingDebrief.actualDurationSec;
    setPendingDebrief(null);
    await api.dismissPending(id, dur).catch(() => {});
  };

  const handleRestoreIdentity = async () => {
    if (!restoreInput.trim()) return;
    setRestoring(true);
    setIdentityStatus(null);
    try {
      const res = await api.restoreIdentity(restoreInput.trim());
      saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
      setProfile(res.profile);
      setSyncCode(res.syncCode);
      setPendingDebrief(res.pendingDebrief);
      setRestoreInput('');
      setIdentityStatus({
        kind: 'ok',
        msg: `Identity restored: ${res.profile.displayName ? `${res.profile.displayName} · ` : ''}${formatProfileSummary(res.profile)}!`,
      });
      setScreen('studio_home');
    } catch (err) {
      setIdentityStatus({
        kind: 'err',
        msg: err instanceof Error ? err.message : 'Unable to restore identity.',
      });
    } finally {
      setRestoring(false);
    }
  };

  const handleSwitchIdentity = () => {
    // Signs out locally without deleting remote D1 history (can always restore via QR / Sync Key!)
    clearStoredProfileAuth();
    void api.signOutSession().catch(() => {});
    setProfile(null);
    setSyncCode(null);
    setPendingDebrief(null);
    setActiveRec(null);
    setSessionDisplay('full');
    setPlayerSnapshot(null);
    setDebriefContext(null);
    setAudioActive(false);
    setShowIdentityModal(false);
    setScreen('studio_home');
  };

  const handleExportLocalJson = useCallback(() => {
    try {
      const jsonText = exportLocalStudioDataJson();
      const blob = new Blob([jsonText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nootropic-fm-local-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setQrToast('Exported your local browser N-of-1 data as JSON (auth tokens excluded).');
    } catch {
      setErrorBanner('Unable to export local JSON in this browser.');
    }
  }, []);

  const handleDeleteMyData = async () => {
    setDeletingData(true);
    setPrivacyStatus(null);
    try {
      if (profile) {
        await api.deleteProfile(profile.id);
      }
      clearStoredProfileAuth();
      eraseAllLocalStudioData();
      setProfile(null);
      setSyncCode(null);
      setPendingDebrief(null);
      setActiveRec(null);
      setSessionDisplay('full');
      setPlayerSnapshot(null);
      setDebriefContext(null);
      setAudioActive(false);
      setShowIdentityModal(false);
      setDisclosureTick((t) => t + 1);
      setScreen('studio_home');
      setPrivacyStatus(
        'Your Neural Identity, Sync Key, session history, local pins, and personal Bandit records have been permanently erased from our servers and this browser.'
      );
    } catch (err) {
      setPrivacyStatus(
        err instanceof Error
          ? `Could not delete remote record: ${err.message}`
          : 'Unable to delete profile right now.'
      );
    } finally {
      setDeletingData(false);
    }
  };

  const handleEnterStudioFromShowcase = useCallback(
    (opts?: {
      launch?: string;
      target?: TargetState;
      durationMin?: number;
      screen?: 'studylab' | 'insights';
    }) => {
      setSurfaceMode('studio');
      const nextUrl = buildStudioUrl(opts);
      if (typeof window !== 'undefined') {
        try {
          const parsed = new URL(nextUrl, window.location.href);
          if (parsed.origin === window.location.origin) {
            window.history.replaceState({}, '', `${parsed.pathname}${parsed.search}${parsed.hash}`);
          }
        } catch {
          /* ignore history errors */
        }
      }
      if (opts?.screen === 'studylab') {
        setFieldMood('focus');
        setScreen('studylab');
        return;
      }
      if (opts?.screen === 'insights') {
        setFieldMood('flow');
        setScreen('insights');
        return;
      }
      if (opts?.launch === 'signature_6x40') {
        const rec = buildInstantQuickTryRecommendation('signature_6x40', profile);
        handleLaunchDirectRecommendation(rec);
        return;
      }
      const preset = buildShowcasePreset(opts?.target, opts?.durationMin);
      setSelectedPreset(preset);
      setActiveRec(null);
      setSessionDisplay('full');
      setPlayerSnapshot(null);
      setFieldMood(
        preset
          ? preset.targetState === 'calm_reset'
            ? 'calm'
            : preset.targetState === 'deep_flow'
              ? 'flow'
              : preset.targetState === 'sleep_winddown'
                ? 'sleep'
                : 'focus'
          : 'default'
      );
      setCheckinResetNonce((n) => n + 1);
      setScreen(preset ? 'checkin' : 'studio_home');
    },
    [handleLaunchDirectRecommendation, profile]
  );

  useEffect(() => {
    if (!showIdentityModal && !showPrivacyModal) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowIdentityModal(false);
        setShowPrivacyModal(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showIdentityModal, showPrivacyModal]);

  const activeTab: AppPrimaryTab =
    screen === 'insights' ? 'memory' : screen === 'studylab' ? 'studylab' : 'studio';
  const isZenLocked = screen === 'player' && sessionDisplay === 'full' && activeRec !== null;
  const hasMinimizedPlayer =
    Boolean(activeRec) && sessionDisplay === 'minimized' && screen !== 'player';

  return (
    <div className="relative min-h-dvh flex flex-col overflow-x-hidden bg-[#0A0B0C]">
      {/* Architectural studio calibration backdrop */}
      <AmbientField mood={fieldMood} activePulse={audioActive} themeMode={themeMode} />

      {surfaceMode === 'showcase' ? (
        <Suspense
          fallback={
            <div className="py-28 text-center font-mono-tech text-xs uppercase tracking-[0.25em] text-[#8E8E88]">
              Loading nootropic.fm...
            </div>
          }
        >
          <FlagshipShowcaseView
            profile={profile}
            syncCode={syncCode}
            themeMode={themeMode}
            onSetThemeMode={handleSetCircadianTheme}
            onOpenProModal={() => setShowProModal(true)}
            onOpenIdentityModal={() => {
              setIdentityStatus(null);
              setShowIdentityModal(true);
            }}
            onOpenPrivacyModal={() => {
              setPrivacyStatus(null);
              setShowPrivacyModal(true);
            }}
            onEnterStudio={handleEnterStudioFromShowcase}
          />
        </Suspense>
      ) : (
        <AppShell
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (tab === 'studio') {
              if (activeRec && sessionDisplay === 'full') {
                setScreen('player');
              } else {
                setFieldMood('default');
                setScreen('studio_home');
              }
              return;
            }
            if (tab === 'memory') {
              if (activeRec && screen === 'player') {
                setSessionDisplay('minimized');
              }
              setFieldMood('flow');
              setScreen('insights');
              return;
            }
            if (tab === 'studylab') {
              if (activeRec && screen === 'player') {
                setSessionDisplay('minimized');
              }
              setFieldMood('focus');
              setScreen('studylab');
            }
          }}
          onLogoClick={() => {
            if (activeRec && screen === 'player') {
              setSessionDisplay('minimized');
            }
            setSelectedPreset(null);
            setFieldMood('default');
            setCheckinResetNonce((n) => n + 1);
            setScreen('studio_home');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          isZenLocked={isZenLocked}
          hasMinimizedPlayer={hasMinimizedPlayer}
          privacyStatusLabel={privacy.statusLabel}
          isPro={profile?.planTier === 'pro'}
          profile={profile}
          syncCode={syncCode}
          themeMode={themeMode}
          onSetThemeMode={handleSetCircadianTheme}
          onOpenSystemDrawer={() => {
            setIdentityStatus(null);
            setShowIdentityModal(true);
          }}
          onOpenSoundSystems={() => setShowSoundSystemsModal(true)}
          onOpenProModal={() => setShowProModal(true)}
          onOpenPrivacyModal={() => {
            setPrivacyStatus(null);
            setShowPrivacyModal(true);
          }}
          installPromptAvailable={Boolean(installPrompt)}
          onInstallApp={async () => {
            if (!installPrompt) return;
            await installPrompt.prompt();
            await installPrompt.userChoice;
            setInstallPrompt(null);
          }}
          miniPlayerSlot={
            hasMinimizedPlayer && activeRec ? (
              <MiniPlayerBar
                title={
                  playerSnapshot?.title ??
                  activeRec.executableSpec?.shortLabel ??
                  TARGET_LABELS[activeRec.targetState]
                }
                genreLabel={playerSnapshot?.genreLabel ?? activeRec.params.genre}
                modulationHz={playerSnapshot?.modulationHz ?? activeRec.params.modulationHz}
                elapsedSec={playerSnapshot?.elapsedSec ?? 0}
                plannedDurationMin={
                  playerSnapshot?.plannedDurationMin ?? activeRec.plannedDurationMin
                }
                isPlaying={playerSnapshot?.isPlaying ?? audioActive}
                onTogglePlay={() => void playerControlRef.current?.togglePlay()}
                onExpand={() => {
                  setSessionDisplay('full');
                  setFieldMood(moodFromTarget(activeRec.environment, activeRec.targetState));
                  setScreen('player');
                }}
                onEndSession={() => playerControlRef.current?.endSession()}
              />
            ) : undefined
          }
        >
        {qrToast && (
          <div className="animate-rise mx-auto mb-5 flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/12 px-4 py-3 text-xs font-medium text-emerald-200 backdrop-blur-md">
            <span className="inline-flex items-center gap-2">
              <Fingerprint className="h-4 w-4 shrink-0 text-emerald-300" />
              {qrToast}
            </span>
            <button
              type="button"
              onClick={() => setQrToast(null)}
              aria-label="Dismiss notification"
              className="rounded-lg p-1 text-emerald-200/70 hover:bg-emerald-500/20 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {errorBanner && (
          <div className="mx-auto mb-5 max-w-2xl rounded-2xl border border-rose-500/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-200 backdrop-blur-md">
            {errorBanner}
          </div>
        )}

        {booting ? (
          <div className="py-28 text-center font-mono-tech text-xs uppercase tracking-[0.25em] text-[#8E8E88]">
            Restoring your Neural Sync Pass...
          </div>
        ) : screen === 'studio_home' ? (
          <StudioHomeView
            profile={profile}
            privacy={privacy}
            disclosure={disclosure}
            pendingDebrief={pendingDebrief}
            themeMode={themeMode}
            onLaunchRecommendation={handleLaunchDirectRecommendation}
            onOpenCheckIn={(opts) => {
              const preset = opts?.presetTarget
                ? buildShowcasePreset(opts.presetTarget, opts.durationMin)
                : null;
              setSelectedPreset(preset);
              setCheckinResetNonce((n) => n + 1);
              setScreen('checkin');
            }}
            onOpenStudyLab={() => {
              setFieldMood('focus');
              setScreen('studylab');
            }}
            onOpenOnboarding={() => setScreen('onboarding')}
            onOpenHugginsCheck={() => setShowHugginsModal(true)}
            onDismissHugginsBanner={() => dismissDisclosurePrompt('huggins')}
            onDismissSelfStudyBanner={() => dismissDisclosurePrompt('self_study')}
            onOpenPendingDebrief={handleOpenPendingDebrief}
            onDismissPending={() => void handleDismissPending()}
          />
        ) : screen === 'landing' ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Loading Neural Brain Map...
              </div>
            }
          >
            <HeroLandingView
              isPro={profile?.planTier === 'pro'}
              hasProfile={Boolean(profile)}
              profile={profile}
              themeMode={themeMode}
              onInstantPlay={handleInstantHeroPlay}
              onLaunchStateGoal={handleLaunchStateGoal}
              onDiscoverProtocol={handleDiscoverFromHero}
              onStartCustomize={() => {
                setSelectedPreset(null);
                setScreen('checkin');
              }}
              onOpenStudyLab={() => {
                setFieldMood('focus');
                setScreen('studylab');
              }}
              onOpenIdentityModal={() => {
                setIdentityStatus(null);
                setShowIdentityModal(true);
              }}
            />
          </Suspense>
        ) : screen === 'onboarding' ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Loading Profile Setup...
              </div>
            }
          >
            <OnboardingView
              initialProfile={profile}
              themeMode={themeMode}
              onComplete={handleSaveProfile}
              onCancel={() => setScreen('studio_home')}
              onMoodChange={setFieldMood}
            />
          </Suspense>
        ) : screen === 'checkin' ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Loading State Compass...
              </div>
            }
          >
            <CheckInView
              key={`${selectedPreset?.id ?? 'default'}-${checkinResetNonce}`}
              profile={profile}
              syncCode={syncCode}
              runtimeConfig={runtimeConfig}
              pendingDebrief={pendingDebrief}
              initialPreset={selectedPreset}
              themeMode={themeMode}
              onClearPreset={() => setSelectedPreset(null)}
              onOpenPendingDebrief={handleOpenPendingDebrief}
              onDismissPending={() => void handleDismissPending()}
              onOpenIdentityModal={() => {
                setIdentityStatus(null);
                setShowIdentityModal(true);
              }}
              onEditProfile={() => setScreen('onboarding')}
              onSaveProfileStep={handleSaveProfileStep}
              onMoodChange={setFieldMood}
              onOpenSoundSystems={() => setShowSoundSystemsModal(true)}
              onBackToStudio={() => {
                setSelectedPreset(null);
                setFieldMood('default');
                setScreen('studio_home');
              }}
              onLaunchUnifiedSession={handleLaunchUnifiedSession}
            />
          </Suspense>
        ) : screen === 'studylab' ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Loading Study-to-Sound Lab...
              </div>
            }
          >
            <StudyLabView
              defaultDevice={profile?.defaultDevice ?? 'headphones'}
              profileId={profile?.id}
              ephemeralMode={privacy.ephemeralMode}
              onExecuteRecommendation={(rec, directPlay) => {
                setErrorBanner(null);
                setActiveRec(rec);
                setSessionDisplay('full');
                setPlayerSnapshot(null);
                setFieldMood(moodFromTarget(rec.environment, rec.targetState));
                setScreen(directPlay ? 'player' : 'reveal');
              }}
            />
          </Suspense>
        ) : screen === 'reveal' ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Preparing Protocol...
              </div>
            }
          >
            <ProtocolRevealView
              loading={researching}
              recommendation={activeRec}
              profile={profile}
              mood={fieldMood}
              themeMode={themeMode}
              customLiveGenAvailable={runtimeConfig?.customLiveGenAvailable}
              onSwapGenre={handleSwapRevealGenre}
              onSwapCustomVibe={(label) => handleSwapCustomVibe(label)}
              onLaunchAudio={() => {
                setSessionDisplay('full');
                setPlayerSnapshot(null);
                setScreen('player');
              }}
              onOpenSoundSystems={() => setShowSoundSystemsModal(true)}
              onOpenStudyLab={() => {
                setFieldMood('focus');
                setScreen('studylab');
              }}
              onBack={() => {
                setActiveRec(null);
                setScreen(revealOrigin);
              }}
            />
          </Suspense>
        ) : screen === 'player' && activeRec ? null : screen === 'debrief' && debriefContext ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Loading Session Debrief...
              </div>
            }
          >
            <DebriefView
              {...debriefContext}
              profile={profile}
              syncCode={syncCode}
              isPro={profile?.planTier === 'pro'}
              themeMode={themeMode}
              freeQuotaReached={debriefContext.freeQuotaReached}
              onUpgradePro={() => setShowProModal(true)}
              onOpenOnboarding={() => {
                setDebriefContext(null);
                setScreen('onboarding');
              }}
              onLearningApplied={(update) => {
                setProfile((prev) => {
                  if (!prev) return prev;
                  const nextFavs =
                    update.learnedGenre && (update.learnedGenreFitPct ?? 0) >= 58
                      ? [
                          update.learnedGenre,
                          ...(prev.favoriteGenres ?? []).filter((g) => g !== update.learnedGenre),
                        ].slice(0, 2)
                      : prev.favoriteGenres;
                  return {
                    ...prev,
                    preferredModMult: update.preferredModMult,
                    neuralMemory: update.neuralMemory ?? prev.neuralMemory,
                    favoriteGenres: nextFavs,
                    sessionCount: Math.max((prev.sessionCount ?? 0) + 1, update.profileTrials || 0),
                  };
                });
              }}
              onStartNew={() => {
                setDebriefContext(null);
                setFieldMood('default');
                setScreen('studio_home');
              }}
              onViewInsights={() => {
                setDebriefContext(null);
                setFieldMood('flow');
                setScreen('insights');
              }}
            />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Loading Memory &amp; Research Brain...
              </div>
            }
          >
            <InsightsView
              profileId={profile?.id}
              profile={profile}
              onOpenOnboarding={() => setScreen('onboarding')}
              onOpenSoundSystems={() => setShowSoundSystemsModal(true)}
            />
          </Suspense>
        )}

        {/* Persistent PlayerView mount: stays mounted across Minimize -> Memory / Study Lab -> Expand */}
        {activeRec && (
          <Suspense
            fallback={
              screen === 'player' ? (
                <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                  Initializing Audio Engine...
                </div>
              ) : null
            }
          >
            <PlayerView
              recommendation={activeRec}
              profile={profile}
              syncCode={syncCode}
              lyriaRealtimeAvailable={runtimeConfig?.lyriaRealtimeAvailable}
              isPro={profile?.planTier === 'pro'}
              stripeAvailable={runtimeConfig?.stripeBillingAvailable ?? false}
              themeMode={themeMode}
              minimized={sessionDisplay === 'minimized' || screen !== 'player'}
              showSessionOneSilentToast={disclosure.showSessionOneSilentToast}
              showPvtLabBadge={disclosure.showPvtLabBadge}
              controlRef={playerControlRef}
              onMinimize={() => {
                setSessionDisplay('minimized');
                setFieldMood('default');
                setScreen('studio_home');
              }}
              onSnapshot={setPlayerSnapshot}
              onHugginsVerified={(passed) => {
                if (passed) markHugginsVerified(true);
              }}
              onOpenSoundSystems={() => setShowSoundSystemsModal(true)}
              onUpgradePro={() => setShowProModal(true)}
              onStartDirectCheckout={handleStartDirectCheckout}
              onOpenCustomCheckIn={() => {
                setSessionDisplay('minimized');
                setScreen('checkin');
              }}
              onReturnHome={() => {
                setSelectedPreset(null);
                setActiveRec(null);
                setSessionDisplay('full');
                setPlayerSnapshot(null);
                setAudioActive(false);
                setFieldMood('default');
                setCheckinResetNonce((n) => n + 1);
                setScreen('studio_home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onPlayingChange={setAudioActive}
              onSessionClaimed={(claimed) => {
                setProfile(claimed.profile);
                setSyncCode(claimed.syncCode);
              }}
              onFinishToDebrief={handleFinishToDebrief}
            />
          </Suspense>
        )}
      </AppShell>
      )}

      {/* NootropicFM Sound Systems & Earbuds Hardware Lab Modal */}
      {showSoundSystemsModal && (
        <Suspense fallback={null}>
          <SoundSystemsModal
            profileId={profile?.id}
            onClose={() => setShowSoundSystemsModal(false)}
          />
        </Suspense>
      )}

      {/* Huggins 600 Hz Dichotic Stereo Seal Check Modal */}
      {showHugginsModal && (
        <Suspense fallback={null}>
          <HugginsCheckModal
            onComplete={({ passed }) => {
              if (passed) markHugginsVerified(true);
            }}
            onClose={() => setShowHugginsModal(false)}
          />
        </Suspense>
      )}

      {/* Stripe Pro Subscription Upgrade / Billing Portal Modal */}
      {showProModal && (
        <Suspense fallback={null}>
          <UpgradeProModal
            profile={profile}
            stripeAvailable={runtimeConfig?.stripeBillingAvailable ?? false}
            onProfileCreated={(saved, issuedCode) => {
              setProfile(saved);
              if (issuedCode) setSyncCode(issuedCode);
            }}
            onClose={() => setShowProModal(false)}
          />
        </Suspense>
      )}

      {/* Consolidated System Pill Drawer (Sync, Pass, Appearance, 600 Hz Seal, Export & Privacy) */}
      {showIdentityModal && (
        <Suspense fallback={null}>
          <SystemPillDrawer
            open={showIdentityModal}
            onClose={() => setShowIdentityModal(false)}
            profile={profile}
            syncCode={syncCode}
            privacy={privacy}
            hugginsVerified={disclosure.state.hugginsVerified}
            circadianPref={circadianPref}
            onSetCircadianPref={handleSetCircadianPref}
            restoreInput={restoreInput}
            onRestoreInputChange={setRestoreInput}
            restoring={restoring}
            onRestoreIdentity={() => void handleRestoreIdentity()}
            identityStatus={identityStatus}
            onEditProfile={() => setScreen('onboarding')}
            onSwitchIdentity={handleSwitchIdentity}
            onOpenHugginsCheck={() => setShowHugginsModal(true)}
            onOpenSoundSystems={() => setShowSoundSystemsModal(true)}
            onOpenProModal={() => setShowProModal(true)}
            onExportLocalJson={handleExportLocalJson}
            onOpenPrivacyModal={() => {
              setPrivacyStatus(null);
              setShowPrivacyModal(true);
            }}
            onDeleteAllData={() => void handleDeleteMyData()}
            deletingData={deletingData}
          />
        </Suspense>
      )}

      {/* Privacy & Delete My Data Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage my-auto w-full max-w-md rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#34D399]">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="text-base font-semibold text-[#F3F1EC]">Privacy &amp; Your Data (18+)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                aria-label="Close Privacy modal"
                className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/10 hover:text-[#F3F1EC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs leading-relaxed text-[#D4D4CE]">
              <p>
                <strong>Zero third-party ad trackers or external font CDNs.</strong> All fonts are
                self-hosted on Cloudflare edge.
              </p>
              <p>
                <strong>Genuine opt-in (EEA / UK / Global Privacy Control):</strong> Without research
                consent, nootropic.fm runs in 100% local-only mode with zero database writes and zero
                retention beacons.
              </p>
              <p>
                <strong>Passwordless &amp; 18+ only:</strong> Neural Identities use a random device
                token + hashed Sync Key (90-day local TTL) and are never exposed in public Research
                Brain feeds.
              </p>
              <p>
                <strong>Open Audio Credits (CC-BY 3.0):</strong> Real studio multi-samples in Live
                As-We-Go Composer are courtesy of Salamander Grand Piano (Alexander Holm) &amp;
                FluidR3 GM SoundFont, hosted on Cloudflare R2.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
              <a
                href="/privacy/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                Full Privacy Policy
              </a>
              <span aria-hidden="true" className="text-[#8E8E88]">·</span>
              <a
                href="/terms/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                Terms &amp; Wellness Disclaimer
              </a>
              <span aria-hidden="true" className="text-[#8E8E88]">·</span>
              <a
                href="/delete-data/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                Delete Data via Sync Key
              </a>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3 space-y-2">
              <div className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#A3A39E]">
                Official Department Channels
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                {[
                  { role: 'General & Product', email: 'hello@nootropic.fm' },
                  { role: 'Partnerships & OEM', email: 'partners@nootropic.fm' },
                  { role: 'Research & Datasets', email: 'research@nootropic.fm' },
                  { role: 'Press & Briefings', email: 'press@nootropic.fm' },
                  { role: 'Investor Relations', email: 'investors@nootropic.fm' },
                  { role: 'Founder Desk', email: 'founders@nootropic.fm' },
                  { role: 'Listener Support', email: 'support@nootropic.fm' },
                  { role: 'Privacy & Data Rights', email: 'privacy@nootropic.fm' },
                ].map((dept) => (
                  <div key={dept.email} className="flex items-center justify-between gap-2">
                    <span className="text-[#A3A39E]">{dept.role}:</span>
                    <a
                      href={`mailto:${dept.email}`}
                      className="font-mono-tech font-medium text-[#34D399] underline-offset-2 hover:underline"
                    >
                      {dept.email}
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {privacyStatus && (
              <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
                {privacyStatus}
              </div>
            )}

            {profile ? (
              <div className="space-y-2.5 border-t border-white/10 pt-3">
                <div className="text-[11px] text-[#8E8E88]">
                  Active Neural Identity stored on this device ({formatProfileSummary(profile)}).
                </div>
                <button
                  type="button"
                  disabled={deletingData}
                  onClick={() => void handleDeleteMyData()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-4 py-3 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingData ? 'Erasing data...' : 'Delete My Identity & All Session Data'}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 border-t border-white/10 pt-3">
                <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3.5 py-2.5 text-xs text-[#8E8E88]">
                  Running in Local-Only mode — no remote Neural Identity is stored on our servers.
                </div>
                <button
                  type="button"
                  disabled={deletingData}
                  onClick={() => void handleDeleteMyData()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-4 py-2.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingData ? 'Clearing local data...' : 'Reset Local Browser Storage'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
