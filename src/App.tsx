import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, Radio, SlidersHorizontal, Sparkles } from 'lucide-react';
import { formatCohortLabel } from '../shared/protocols';
import type {
  CurrentState,
  LiveAdjustment,
  MusicGenreChoice,
  OutputDevice,
  ProtocolRecommendation,
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
import { api } from './lib/api';

type Screen = 'onboarding' | 'checkin' | 'reveal' | 'player' | 'debrief' | 'insights';

const PROFILE_STORAGE_KEY = 'nootropic_fm_profile_id_v1';

export default function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [booting, setBooting] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pendingDebrief, setPendingDebrief] = useState<SessionRecord | null>(null);
  const [activeRec, setActiveRec] = useState<ProtocolRecommendation | null>(null);
  const [researching, setResearching] = useState(false);
  const [fieldMood, setFieldMood] = useState<FieldMood>('default');
  const [audioActive, setAudioActive] = useState(false);
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
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const restore = async () => {
      const savedId = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!savedId) {
        setBooting(false);
        setScreen('onboarding');
        return;
      }
      try {
        const res = await api.getProfile(savedId);
        setProfile(res.profile);
        setPendingDebrief(res.pendingDebrief);
        setScreen('checkin');
      } catch {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        setScreen('onboarding');
      } finally {
        setBooting(false);
      }
    };
    void restore();
  }, []);

  const moodFromTarget = useCallback((env: SessionEnvironment, target: TargetState): FieldMood => {
    if (env === 'driving') return 'driving';
    if (target === 'calm_reset') return 'calm';
    if (target === 'deep_flow') return 'flow';
    if (target === 'sleep_winddown') return 'sleep';
    return 'focus';
  }, []);

  const startSessionWithProfile = useCallback(
    async (
      activeProfile: UserProfile,
      payload: {
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
      setActiveRec(null);
      setResearching(true);
      setFieldMood(moodFromTarget(payload.environment, payload.targetState));
      setScreen('reveal');
      try {
        const { recommendation } = await api.startProtocol({
          profileId: activeProfile.id,
          ...payload,
        });
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
    const { profile: saved } = await api.saveProfile(data);
    localStorage.setItem(PROFILE_STORAGE_KEY, saved.id);
    setProfile(saved);
    if (firstSession) {
      await startSessionWithProfile(saved, firstSession);
    } else {
      setScreen('checkin');
    }
  };

  const handleStartSession = async (payload: {
    rawInputText: string;
    currentState: CurrentState;
    baselineScore: number;
    targetState: TargetState;
    environment: SessionEnvironment;
    device: OutputDevice;
    durationMin: number;
    ageOverride?: number;
    requestedGenre?: MusicGenreChoice;
  }) => {
    if (!profile) return;
    await startSessionWithProfile(profile, payload);
  };

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

  return (
    <div className="relative min-h-dvh flex flex-col bg-[#05070d]">
      {/* Full-bleed 60fps interactive bioluminescent soundwave & neural particle canvas */}
      <AmbientField mood={fieldMood} activePulse={audioActive} />

      {/* Floating Glass Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#05070d]/65 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => setScreen(profile ? 'checkin' : 'onboarding')}
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
                Open Research Beta
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
        ) : screen === 'checkin' && profile ? (
          <CheckInView
            profile={profile}
            pendingDebrief={pendingDebrief}
            onOpenPendingDebrief={handleOpenPendingDebrief}
            onDismissPending={() => void handleDismissPending()}
            onMoodChange={setFieldMood}
            onStartSession={handleStartSession}
          />
        ) : screen === 'reveal' ? (
          <ProtocolRevealView
            loading={researching}
            recommendation={activeRec}
            mood={fieldMood}
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

      <footer className="relative z-10 border-t border-white/[0.05] py-5 text-center text-[11px] text-slate-500">
        nootropic.fm · Open Research Beta (Year 1 Free) · Psychoacoustic cognitive wellness audio,
        not a medical device.
      </footer>
    </div>
  );
}
