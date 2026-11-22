import { useEffect, useState } from 'react';
import { BarChart3, Radio, SlidersHorizontal, Sparkles } from 'lucide-react';
import { formatCohortLabel } from '../shared/protocols';
import type {
  CurrentState,
  LiveAdjustment,
  OutputDevice,
  ProtocolRecommendation,
  SessionEnvironment,
  SessionRecord,
  TargetState,
  UserProfile,
} from '../shared/types';
import { CheckInView } from './components/CheckInView';
import { DebriefView } from './components/DebriefView';
import { InsightsView } from './components/InsightsView';
import { OnboardingView } from './components/OnboardingView';
import { PlayerView } from './components/PlayerView';
import { api } from './lib/api';

type Screen = 'onboarding' | 'checkin' | 'player' | 'debrief' | 'insights';

const PROFILE_STORAGE_KEY = 'nootropic_fm_profile_id_v1';

export default function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [booting, setBooting] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pendingDebrief, setPendingDebrief] = useState<SessionRecord | null>(null);
  const [activeRec, setActiveRec] = useState<ProtocolRecommendation | null>(null);
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

  const handleSaveProfile = async (data: Partial<UserProfile>) => {
    setErrorBanner(null);
    const { profile: saved } = await api.saveProfile(data);
    localStorage.setItem(PROFILE_STORAGE_KEY, saved.id);
    setProfile(saved);
    setScreen('checkin');
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
  }) => {
    if (!profile) return;
    setErrorBanner(null);
    try {
      const { recommendation } = await api.startProtocol({
        profileId: profile.id,
        ...payload,
      });
      setActiveRec(recommendation);
      setPendingDebrief(null);
      setScreen('player');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to start protocol');
    }
  };

  const handleFinishToDebrief = (stats: {
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
  }) => {
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
    setScreen('debrief');
  };

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
    setScreen('debrief');
  };

  const handleDismissPending = async () => {
    if (!pendingDebrief) return;
    const id = pendingDebrief.id;
    setPendingDebrief(null);
    await api.dismissPending(id).catch(() => {});
  };

  return (
    <div className="bg-neural-grid min-h-dvh flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#07090e]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => setScreen(profile ? 'checkin' : 'onboarding')}
            className="flex items-center gap-2.5 text-left"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-400/10 text-cyan-300">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-base font-bold tracking-tight text-white leading-none">
                nootropic<span className="text-cyan-400">.fm</span>
              </div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                Open Research Beta
              </div>
            </div>
          </button>

          <nav className="flex items-center gap-1.5">
            {profile && (
              <button
                type="button"
                onClick={() => setScreen(activeRec ? 'player' : 'checkin')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  screen === 'checkin' || screen === 'player' || screen === 'debrief'
                    ? 'bg-cyan-400/15 text-cyan-200 border border-cyan-400/30'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Session</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setScreen('insights')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
                screen === 'insights'
                  ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-400/35'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
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
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
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

      {/* Main Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {errorBanner && (
          <div className="mx-auto mb-5 max-w-3xl rounded-xl border border-rose-500/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-200">
            {errorBanner}
          </div>
        )}

        {booting ? (
          <div className="py-24 text-center text-sm text-slate-400">
            Initializing nootropic.fm...
          </div>
        ) : screen === 'onboarding' ? (
          <OnboardingView initialProfile={profile} onComplete={handleSaveProfile} />
        ) : screen === 'checkin' && profile ? (
          <CheckInView
            profile={profile}
            pendingDebrief={pendingDebrief}
            onOpenPendingDebrief={handleOpenPendingDebrief}
            onDismissPending={() => void handleDismissPending()}
            onStartSession={handleStartSession}
          />
        ) : screen === 'player' && activeRec ? (
          <PlayerView recommendation={activeRec} onFinishToDebrief={handleFinishToDebrief} />
        ) : screen === 'debrief' && debriefContext ? (
          <DebriefView
            {...debriefContext}
            onStartNew={() => {
              setDebriefContext(null);
              setScreen('checkin');
            }}
            onViewInsights={() => {
              setDebriefContext(null);
              setScreen('insights');
            }}
          />
        ) : (
          <InsightsView profileId={profile?.id} />
        )}
      </main>

      <footer className="border-t border-slate-900 py-5 text-center text-[11px] text-slate-500">
        nootropic.fm · Open Research Beta (Year 1 Free) · Psychoacoustic cognitive wellness tool,
        not a medical device.
      </footer>
    </div>
  );
}
