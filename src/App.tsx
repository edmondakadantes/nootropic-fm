import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { sanitizeCustomVibe } from '../shared/promptComposer';
import { formatCohortLabel, swapRecommendationGenre } from '../shared/protocols';
import type {
  AppRuntimeConfig,
  CurrentState,
  LiveAdjustment,
  MusicGenreChoice,
  OutputDevice,
  ProtocolRecommendation,
  ResolvedGenre,
  SessionEnvironment,
  SessionRecord,
  TargetState,
  UserProfile,
} from '../shared/types';
import { AmbientField, type FieldMood } from './components/AmbientField';
import { CheckInView } from './components/CheckInView';
import { DebriefView } from './components/DebriefView';
import { InsightsView } from './components/InsightsView';
import { OnboardingView } from './components/OnboardingView';
import { PlayerView } from './components/PlayerView';
import { ProtocolRevealView } from './components/ProtocolRevealView';
import {
  api,
  clearStoredProfileAuth,
  getStoredProfileAuth,
  saveStoredProfileAuth,
} from './lib/api';

type Screen = 'onboarding' | 'checkin' | 'reveal' | 'player' | 'debrief' | 'insights';

export default function App() {
  const [screen, setScreen] = useState<Screen>('checkin');
  const [booting, setBooting] = useState(true);
  const [runtimeConfig, setRuntimeConfig] = useState<AppRuntimeConfig | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pendingDebrief, setPendingDebrief] = useState<SessionRecord | null>(null);
  const [activeRec, setActiveRec] = useState<ProtocolRecommendation | null>(null);
  const [researching, setResearching] = useState(false);
  const [fieldMood, setFieldMood] = useState<FieldMood>('default');
  const [audioActive, setAudioActive] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);

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

  const [debriefContext, setDebriefContext] = useState<{
    sessionId: string;
    armName: string;
    cohortLabel: string;
    baselineScore: number;
    plannedDurationMin: number;
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
    ephemeralMode?: boolean;
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const boot = async () => {
      // Fetch runtime config (region opt-in, live music gen capability, popular R2 custom vibes)
      const configPromise = api
        .getConfig()
        .then((res) => setRuntimeConfig(res.config))
        .catch(() => {});

      const stored = getStoredProfileAuth();
      if (!stored?.profileId) {
        await configPromise;
        setBooting(false);
        setScreen('checkin');
        return;
      }

      try {
        const res = await api.getProfile(stored.profileId);
        if (res.profileToken) {
          saveStoredProfileAuth(res.profile.id, res.profileToken);
        }
        setProfile(res.profile);
        setPendingDebrief(res.pendingDebrief);
        setScreen('checkin');
      } catch {
        clearStoredProfileAuth();
        setScreen('checkin');
      } finally {
        await configPromise;
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

  const startSession = useCallback(
    async (payload: {
      profileId?: string;
      ephemeralMode?: boolean;
      ephemeralProfile?: Partial<UserProfile>;
      rawInputText: string;
      currentState: CurrentState;
      baselineScore: number;
      targetState: TargetState;
      environment: SessionEnvironment;
      device: OutputDevice;
      durationMin: number;
      ageOverride?: number;
      requestedGenre?: MusicGenreChoice;
      customGenreInput?: string;
    }) => {
      setErrorBanner(null);
      setActiveRec(null);
      setResearching(true);
      setFieldMood(moodFromTarget(payload.environment, payload.targetState));
      setScreen('reveal');
      try {
        const { recommendation } = await api.startProtocol(payload);
        setActiveRec(recommendation);
        setPendingDebrief(null);
        setFieldMood(moodFromTarget(recommendation.environment, recommendation.targetState));
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Unable to start protocol');
        setScreen('checkin');
      } finally {
        setResearching(false);
      }
    },
    [moodFromTarget]
  );

  const handleSaveProfile = async (
    data: Partial<UserProfile>,
    firstSession?: {
      rawInputText: string;
      currentState: CurrentState;
      baselineScore: number;
      targetState: TargetState;
      environment: SessionEnvironment;
      device: OutputDevice;
      durationMin: number;
      ageOverride?: number;
      requestedGenre?: MusicGenreChoice;
    }
  ) => {
    setErrorBanner(null);
    const { profile: saved, profileToken } = await api.saveProfile(data);
    saveStoredProfileAuth(saved.id, profileToken);
    setProfile(saved);
    if (firstSession) {
      await startSession({
        profileId: saved.id,
        ...firstSession,
      });
    } else {
      setScreen('checkin');
    }
  };

  const handleLaunchUnifiedSession = async (payload: {
    profileUpdate?: Partial<UserProfile>;
    ephemeralMode: boolean;
    rawInputText: string;
    currentState: CurrentState;
    baselineScore: number;
    targetState: TargetState;
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
    if (!activeProfile) {
      const { profile: saved, profileToken } = await api.saveProfile(
        payload.profileUpdate ?? {
          age: Math.max(18, payload.ageOverride ?? 32),
          defaultDevice: payload.device,
          researchConsent: true,
        }
      );
      saveStoredProfileAuth(saved.id, profileToken);
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
      const sanitized = sanitizeCustomVibe(customLabel);
      if (!sanitized || sanitized.rejectedReason || !sanitized.slug) return;

      // Fast check if this custom vibe already exists in Cloudflare R2 Community Cache
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
    [activeRec, runtimeConfig, profile]
  );

  const handleFinishToDebrief = useCallback(
    (stats: { actualDurationSec: number; liveAdjustments: LiveAdjustment[] }) => {
      if (!activeRec) return;
      setDebriefContext({
        sessionId: activeRec.sessionId,
        armName: activeRec.arm.name,
        cohortLabel: activeRec.cohortLabel,
        baselineScore: activeRec.baselineScore,
        plannedDurationMin: activeRec.plannedDurationMin,
        actualDurationSec: stats.actualDurationSec,
        liveAdjustments: stats.liveAdjustments,
        ephemeralMode: activeRec.ephemeralMode,
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
    setPendingDebrief(null);
    await api.dismissPending(id).catch(() => {});
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
      setPendingDebrief(null);
      setActiveRec(null);
      setDebriefContext(null);
      setAudioActive(false);
      setScreen('checkin');
      setPrivacyStatus(
        'Your profile, session history, and personal Bandit records have been permanently erased from Cloudflare D1 and this browser.'
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
    <div className="relative min-h-dvh flex flex-col bg-[#05070d]">
      {/* Full-bleed 60fps interactive bioluminescent soundwave & neural particle canvas */}
      <AmbientField mood={fieldMood} activePulse={audioActive} />

      {/* Floating Glass Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#05070d]/65 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => setScreen('checkin')}
            className="group flex items-center gap-2.5 text-left"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.18)] transition group-hover:scale-105 group-hover:border-cyan-300/60">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-base font-bold tracking-tight text-white leading-none">
                nootropic<span className="text-cyan-400">.fm</span>
              </div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                Tune your mind
              </div>
            </div>
          </button>

          <nav className="flex items-center gap-1.5">
            {installPrompt && (
              <button
                type="button"
                onClick={async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                title="Install nootropic.fm as an app"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Install App</span>
              </button>
            )}

            {profile && (
              <button
                type="button"
                onClick={() => setScreen(activeRec ? 'player' : 'checkin')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  screen === 'checkin' || screen === 'reveal' || screen === 'player' || screen === 'debrief'
                    ? 'bg-cyan-400/15 text-cyan-200 border border-cyan-400/35'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Session</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setFieldMood('flow');
                setScreen('insights');
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
                screen === 'insights'
                  ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-400/35'
                  : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Research Brain</span>
            </button>

            {profile && (
              <button
                type="button"
                onClick={() => setScreen('onboarding')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  screen === 'onboarding'
                    ? 'bg-slate-800/90 text-white border border-slate-700'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                }`}
                title="Edit your profile"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Age {profile.age}</span>
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content Stage */}
      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 py-7 sm:px-6 sm:py-11">
        {errorBanner && (
          <div className="mx-auto mb-5 max-w-2xl rounded-2xl border border-rose-500/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-200 backdrop-blur-md">
            {errorBanner}
          </div>
        )}

        {booting ? (
          <div className="py-28 text-center font-mono-tech text-xs uppercase tracking-[0.25em] text-cyan-300/70">
            Calibrating neural audio field...
          </div>
        ) : screen === 'onboarding' ? (
          <OnboardingView
            initialProfile={profile}
            onComplete={handleSaveProfile}
            onMoodChange={setFieldMood}
          />
        ) : screen === 'checkin' ? (
          <CheckInView
            profile={profile}
            runtimeConfig={runtimeConfig}
            pendingDebrief={pendingDebrief}
            onOpenPendingDebrief={handleOpenPendingDebrief}
            onDismissPending={() => void handleDismissPending()}
            onMoodChange={setFieldMood}
            onLaunchUnifiedSession={handleLaunchUnifiedSession}
          />
        ) : screen === 'reveal' ? (
          <ProtocolRevealView
            loading={researching}
            recommendation={activeRec}
            mood={fieldMood}
            customLiveGenAvailable={runtimeConfig?.customLiveGenAvailable}
            onSwapGenre={handleSwapRevealGenre}
            onSwapCustomVibe={(label) => void handleSwapCustomVibe(label)}
            onLaunchAudio={() => setScreen('player')}
            onBack={() => {
              setActiveRec(null);
              setScreen('checkin');
            }}
          />
        ) : screen === 'player' && activeRec ? (
          <PlayerView
            recommendation={activeRec}
            onPlayingChange={setAudioActive}
            onFinishToDebrief={handleFinishToDebrief}
          />
        ) : screen === 'debrief' && debriefContext ? (
          <DebriefView
            {...debriefContext}
            onStartNew={() => {
              setDebriefContext(null);
              setScreen('checkin');
            }}
            onViewInsights={() => {
              setDebriefContext(null);
              setFieldMood('flow');
              setScreen('insights');
            }}
          />
        ) : (
          <InsightsView profileId={profile?.id} />
        )}
      </main>

      {/* Privacy & Delete My Data Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage w-full max-w-md rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="text-base font-semibold text-white">Privacy &amp; Your Data (18+)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs leading-relaxed text-slate-300">
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
                <strong>Pseudonymized &amp; 18+ only:</strong> Profiles use a random device token
                (90-day local TTL) and are never exposed in public Research Brain feeds.
              </p>
            </div>

            {privacyStatus && (
              <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
                {privacyStatus}
              </div>
            )}

            {profile ? (
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                <div className="text-[11px] text-slate-400">
                  Active pseudonymized profile stored on this device (Age {profile.age}).
                </div>
                <button
                  type="button"
                  disabled={deletingData}
                  onClick={() => void handleDeleteMyData()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-4 py-3 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingData ? 'Erasing data...' : 'Delete My Profile & Session Data'}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs text-slate-400">
                No personal profile is currently stored in this browser.
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="relative z-10 border-t border-white/[0.05] px-4 py-5 text-center text-[11px] text-slate-500">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <span>
            nootropic.fm · Tune your mind · Open Research Beta (18+ · Year 1 Free) · Psychoacoustic
            cognitive wellness audio, not a medical device.
          </span>
          <button
            type="button"
            onClick={() => {
              setPrivacyStatus(null);
              setShowPrivacyModal(true);
            }}
            className="inline-flex items-center gap-1 font-medium text-cyan-400/90 underline-offset-2 hover:text-cyan-300 hover:underline"
          >
            <ShieldCheck className="h-3 w-3" />
            Privacy &amp; Delete My Data
          </button>
        </div>
      </footer>
    </div>
  );
}
