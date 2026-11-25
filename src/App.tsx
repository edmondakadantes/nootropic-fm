import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Crown,
  Download,
  Fingerprint,
  FlaskConical,
  KeyRound,
  LogOut,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { matchCoreGenreAlias, sanitizeCustomVibe } from '../shared/promptComposer';
import { formatCohortLabel, swapRecommendationGenre } from '../shared/protocols';
import {
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
import { CheckInView, type MoodPresetSelection } from './components/CheckInView';
import { HeroLandingView } from './components/HeroLandingView';
import { NeuralFingerprintSigil, NeuralPassCard } from './components/NeuralFingerprintPass';

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

type Screen =
  | 'landing'
  | 'onboarding'
  | 'checkin'
  | 'studylab'
  | 'reveal'
  | 'player'
  | 'debrief'
  | 'insights';

export default function App() {
  const hasInitialHashSync =
    typeof window !== 'undefined' && /^#sync=([A-Za-z0-9-]+)$/i.test(window.location.hash);
  const hasInitialStoredProfile = Boolean(getStoredProfileAuth()?.profileId);

  const [screen, setScreen] = useState<Screen>('checkin');
  const [checkinResetNonce, setCheckinResetNonce] = useState(0);
  const [booting, setBooting] = useState(hasInitialHashSync);
  const [runtimeConfig, setRuntimeConfig] = useState<AppRuntimeConfig | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [syncCode, setSyncCode] = useState<string | null>(null);
  const [pendingDebrief, setPendingDebrief] = useState<SessionRecord | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<MoodPresetSelection | null>(null);
  const [revealOrigin, setRevealOrigin] = useState<'landing' | 'checkin'>('checkin');
  const [activeRec, setActiveRec] = useState<ProtocolRecommendation | null>(null);
  const [researching, setResearching] = useState(false);
  const [fieldMood, setFieldMood] = useState<FieldMood>('default');
  const [audioActive, setAudioActive] = useState(false);

  // Modals: Privacy + Passwordless Neural Identity / Sync / Switch
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);

  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
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
    studySpecId?: string;
    studyTitle?: string;
    entrainmentType?: string;
    frequencyHz?: number;
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const boot = async () => {
      const configPromise = api
        .getConfig()
        .then((res) => setRuntimeConfig(res.config))
        .catch(() => {});

      // 0. Check Stripe Checkout return (?billing=success&session_id=cs_... or ?billing=canceled)
      const searchParams = new URLSearchParams(window.location.search);
      const billingStatus = searchParams.get('billing');
      const checkoutSessionId = searchParams.get('session_id');
      if (billingStatus) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
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
              setScreen('checkin');
            }
          } catch {
            // Webhook will still activate Pro asynchronously if verification timed out
          }
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
          setScreen('checkin');
          return;
        } catch {
          setErrorBanner('Scanned QR Sync Key was invalid or already erased.');
        }
      }

      const stored = getStoredProfileAuth();
      if (!stored?.profileId) {
        await verifyBillingIfReturned();
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

  const handleInstantHeroPlay = useCallback(
    (id: QuickTryId) => {
      setErrorBanner(null);
      const rec = buildInstantQuickTryRecommendation(id, profile);
      setActiveRec(rec);
      setFieldMood(moodFromTarget(rec.environment, rec.targetState));
      setScreen('player');
    },
    [moodFromTarget, profile]
  );

  const handleLaunchStateGoal = useCallback(
    (feelingId: QuickFeelingId, target: TargetState) => {
      setErrorBanner(null);
      const rec = buildStateGoalQuickRecommendation(feelingId, target, profile);
      setActiveRec(rec);
      setFieldMood(moodFromTarget(rec.environment, rec.targetState));
      setScreen('player');
    },
    [moodFromTarget, profile]
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
    setScreen('checkin');
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
      sessionIdOverride?: string;
      ephemeralOverride?: boolean;
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
        studySpecId: spec?.id,
        studyTitle: spec?.shortLabel || spec?.studyRef.title,
        entrainmentType: spec?.entrainment.type,
        frequencyHz: spec?.entrainment.frequencyHz ?? activeRec.params.modulationHz,
      });
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
      setScreen('checkin');
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
    setProfile(null);
    setSyncCode(null);
    setPendingDebrief(null);
    setActiveRec(null);
    setDebriefContext(null);
    setAudioActive(false);
    setShowIdentityModal(false);
    setScreen('checkin');
  };

  const handleDeleteMyData = async () => {
    setDeletingData(true);
    setPrivacyStatus(null);
    try {
      if (profile) {
        await api.deleteProfile(profile.id);
      }
      clearStoredProfileAuth();
      setProfile(null);
      setSyncCode(null);
      setPendingDebrief(null);
      setActiveRec(null);
      setDebriefContext(null);
      setAudioActive(false);
      setScreen('checkin');
      setPrivacyStatus(
        'Your Neural Identity, Sync Key, session history, and personal Bandit records have been permanently erased from our servers and this browser.'
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

  return (
    <div className="relative min-h-dvh flex flex-col overflow-x-hidden bg-[#0A0B0C]">
      {/* Architectural studio calibration backdrop */}
      <AmbientField mood={fieldMood} activePulse={audioActive} />

      {/* Precision Console Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0A0B0C]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3.5">
          <button
            type="button"
            onClick={() => {
              setSelectedPreset(null);
              setAudioActive(false);
              setFieldMood('default');
              setCheckinResetNonce((n) => n + 1);
              setScreen('checkin');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="group flex shrink-0 items-center gap-2 text-left sm:gap-2.5"
            title="Return to nootropic.fm main page"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#131518] text-[#34D399] transition group-hover:border-white/30 sm:h-9 sm:w-9">
              <Radio className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
            </div>
            <div className="whitespace-nowrap">
              <div className="font-display text-sm font-bold tracking-tight text-[#F3F1EC] leading-none sm:text-base">
                nootropic<span className="text-[#34D399]">.fm</span>
              </div>
              <div className="mt-0.5 text-[9px] font-mono-tech uppercase tracking-[0.14em] text-[#34D399]/85 sm:text-[10px] sm:tracking-[0.16em]">
                Tune your mind
              </div>
            </div>
          </button>

          <nav className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {installPrompt && (
              <button
                type="button"
                onClick={async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/12 bg-[#131518] px-2.5 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC] sm:px-3"
                title="Install nootropic.fm as an app"
              >
                <Download className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span className="hidden md:inline">Install App</span>
              </button>
            )}

            {profile && (
              <button
                type="button"
                onClick={() => setScreen(activeRec ? 'player' : 'checkin')}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                  screen === 'checkin' || screen === 'reveal' || screen === 'player' || screen === 'debrief'
                    ? 'border-white/15 bg-[#16181C] text-[#F3F1EC]'
                    : 'border-transparent text-[#A3A39E] hover:bg-white/[0.05] hover:text-[#F3F1EC]'
                }`}
                title="Active Session"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden md:inline">Session</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setFieldMood('focus');
                setScreen('studylab');
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                screen === 'studylab'
                  ? 'border-white/15 bg-[#16181C] text-[#F3F1EC]'
                  : 'border-transparent text-[#A3A39E] hover:bg-white/[0.05] hover:text-[#F3F1EC]'
              }`}
              title="Browse & play published science studies"
            >
              <FlaskConical className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
              <span className="hidden sm:inline">Study Lab</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFieldMood('flow');
                setScreen('insights');
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                screen === 'insights'
                  ? 'border-white/15 bg-[#16181C] text-[#F3F1EC]'
                  : 'border-transparent text-[#A3A39E] hover:bg-white/[0.05] hover:text-[#F3F1EC]'
              }`}
              title="Research Brain & Live Outcomes"
            >
              <BarChart3 className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">Research Brain</span>
              <span className="hidden sm:inline md:hidden">Research</span>
            </button>

            <button
              type="button"
              onClick={() => setShowProModal(true)}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition sm:gap-1.5 sm:px-3 ${
                profile?.planTier === 'pro'
                  ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                  : 'border-amber-400/35 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'
              }`}
              title={
                profile?.planTier === 'pro'
                  ? 'Manage your nootropic.fm Pro subscription'
                  : 'Upgrade to nootropic.fm Pro'
              }
            >
              <Crown className="h-3.5 w-3.5 shrink-0" />
              <span>{profile?.planTier === 'pro' ? 'PRO' : 'Go Pro'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIdentityStatus(null);
                setShowIdentityModal(true);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/12 bg-[#131518] px-2 py-1.5 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC] sm:px-2.5"
              title="Neural Fingerprint Pass, Scannable QR & Switch Identity"
            >
              {profile ? (
                <>
                  <NeuralFingerprintSigil seed={syncCode || profile.id} size={22} />
                  <span className="hidden lg:inline">
                    {profile.displayName ? `${profile.displayName} · ${profile.age}` : `Pass · ${profile.age}`}
                  </span>
                </>
              ) : (
                <>
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                  <span className="hidden sm:inline">Sync QR</span>
                </>
              )}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Stage (vertically centered distraction-free canvas during active Player) */}
      <main
        className={`relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6 ${
          screen === 'player'
            ? 'flex flex-col justify-center py-5 sm:py-8'
            : 'py-7 sm:py-11'
        }`}
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
        ) : screen === 'landing' ? (
          <HeroLandingView
            isPro={profile?.planTier === 'pro'}
            hasProfile={Boolean(profile)}
            profile={profile}
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
              onComplete={handleSaveProfile}
              onCancel={() => setScreen('checkin')}
              onMoodChange={setFieldMood}
            />
          </Suspense>
        ) : screen === 'checkin' ? (
          <CheckInView
            key={`${selectedPreset?.id ?? 'default'}-${checkinResetNonce}`}
            profile={profile}
            syncCode={syncCode}
            runtimeConfig={runtimeConfig}
            pendingDebrief={pendingDebrief}
            initialPreset={selectedPreset}
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
            onLaunchUnifiedSession={handleLaunchUnifiedSession}
          />
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
              ephemeralMode={profile ? !profile.researchConsent : true}
              onExecuteRecommendation={(rec, directPlay) => {
                setErrorBanner(null);
                setActiveRec(rec);
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
              customLiveGenAvailable={runtimeConfig?.customLiveGenAvailable}
              onSwapGenre={handleSwapRevealGenre}
              onSwapCustomVibe={(label) => handleSwapCustomVibe(label)}
              onLaunchAudio={() => setScreen('player')}
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
        ) : screen === 'player' && activeRec ? (
          <Suspense
            fallback={
              <div className="py-24 text-center font-mono-tech text-xs uppercase tracking-[0.2em] text-[#8E8E88]">
                Initializing Audio Engine...
              </div>
            }
          >
            <PlayerView
              recommendation={activeRec}
              profile={profile}
              syncCode={syncCode}
              lyriaRealtimeAvailable={runtimeConfig?.lyriaRealtimeAvailable}
              isPro={profile?.planTier === 'pro'}
              stripeAvailable={runtimeConfig?.stripeBillingAvailable ?? false}
              onUpgradePro={() => setShowProModal(true)}
              onStartDirectCheckout={handleStartDirectCheckout}
              onOpenCustomCheckIn={() => {
                setAudioActive(false);
                setScreen('checkin');
              }}
              onReturnHome={() => {
                setSelectedPreset(null);
                setAudioActive(false);
                setFieldMood('default');
                setCheckinResetNonce((n) => n + 1);
                setScreen('checkin');
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
        ) : screen === 'debrief' && debriefContext ? (
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
              onUpgradePro={() => setShowProModal(true)}
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
                    favoriteGenres: nextFavs,
                    sessionCount: (prev.sessionCount ?? 0) + 1,
                  };
                });
              }}
              onStartNew={() => {
                setDebriefContext(null);
                setScreen(profile ? 'checkin' : 'landing');
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
                Loading Research Brain...
              </div>
            }
          >
            <InsightsView profileId={profile?.id} />
          </Suspense>
        )}
      </main>

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

      {/* Identity Pass, Scannable QR & Switch Identity Modal */}
      {showIdentityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage my-auto w-full max-w-lg rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#34D399]">
                <Fingerprint className="h-5 w-5" />
                <h3 className="text-base font-semibold text-[#F3F1EC]">Your Neural Fingerprint &amp; QR Pass</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIdentityModal(false)}
                className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/[0.06] hover:text-[#F3F1EC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {profile && (
              <div className="space-y-3">
                <NeuralPassCard profile={profile} syncCode={syncCode} />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowIdentityModal(false);
                      setScreen('onboarding');
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-3.5 py-2.5 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC]"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[#34D399]" />
                    Edit Profile Details
                  </button>
                  <button
                    type="button"
                    onClick={handleSwitchIdentity}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-3.5 py-2.5 text-xs font-medium text-[#D4D4CE] transition hover:border-amber-400/45 hover:text-amber-200"
                  >
                    <LogOut className="h-3.5 w-3.5 text-amber-300" />
                    Switch Person / New Pass
                  </button>
                </div>
              </div>
            )}

            {/* Restore Identity via Sync Key */}
            <div className="space-y-2 border-t border-white/[0.08] pt-3.5">
              <div className="text-xs font-semibold text-[#F3F1EC]">
                {profile ? 'Or restore another Pass with a Sync Key:' : 'Restore your Neural Pass on this device:'}
              </div>
              <p className="text-[11px] leading-relaxed text-[#A3A39E]">
                Scan your QR Pass with your phone camera, or enter your{' '}
                <code className="font-mono-tech text-[#34D399]">NFM-XXXX-XXXX</code> key below.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={restoreInput}
                  onChange={(e) => setRestoreInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRestoreIdentity();
                  }}
                  placeholder="NFM-XXXX-XXXX"
                  className="font-mono-tech flex-1 rounded-xl border border-white/15 bg-[#0A0B0C] px-3.5 py-2.5 text-xs uppercase tracking-wider text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={restoring || !restoreInput.trim()}
                  onClick={() => void handleRestoreIdentity()}
                  className="btn-aurora rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  {restoring ? 'Syncing...' : 'Restore'}
                </button>
              </div>
              {identityStatus && (
                <div
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    identityStatus.kind === 'ok'
                      ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
                      : 'border-rose-400/35 bg-rose-500/10 text-rose-200'
                  }`}
                >
                  {identityStatus.msg}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Privacy & Delete My Data Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage w-full max-w-md rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#34D399]">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="text-base font-semibold text-[#F3F1EC]">Privacy &amp; Your Data (18+)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
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
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                Full Privacy Policy
              </a>
              <span className="text-[#555550]">·</span>
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                Terms &amp; Wellness Disclaimer
              </a>
              <span className="text-[#555550]">·</span>
              <a
                href="/delete-data"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                Delete Data via Sync Key
              </a>
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
              <div className="rounded-xl border border-white/10 bg-[#0B0C0E] px-3.5 py-2.5 text-xs text-[#8E8E88]">
                No personal Neural Identity is currently stored in this browser.
              </div>
            )}
          </div>
        </div>
      )}

      {screen !== 'player' && (
        <footer className="relative z-10 border-t border-white/[0.06] px-4 py-5 text-center text-[11px] text-[#6E6E68]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
            <span>
              nootropic.fm · Tune your mind · Psychoacoustic cognitive wellness, focus, and relaxation
              audio (not a medical device). Not intended to diagnose, treat, cure, or prevent any
              medical condition. Listeners 18+.
            </span>
            <span className="text-[#555550]">
              Samples: Salamander Grand Piano &amp; FluidR3 GM (CC-BY 3.0)
            </span>
            <button
              type="button"
              onClick={() => {
                setPrivacyStatus(null);
                setShowPrivacyModal(true);
              }}
              className="inline-flex items-center gap-1 font-medium text-[#D4D4CE] underline-offset-2 hover:text-[#34D399] hover:underline"
            >
              <ShieldCheck className="h-3 w-3" />
              Privacy, Credits &amp; Delete My Data
            </button>
            <a
              href="/privacy"
              className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
            >
              Privacy Policy
            </a>
            <a
              href="/terms"
              className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
            >
              Terms
            </a>
            <a
              href="/delete-data"
              className="text-[#A3A39E] underline-offset-2 hover:text-[#34D399] hover:underline"
            >
              Delete Data
            </a>
          </div>
        </footer>
      )}
    </div>
  );
}
