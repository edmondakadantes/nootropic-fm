import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Car,
  Compass,
  FlaskConical,
  Headphones,
  Moon,
  Pin,
  Play,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import {
  GENRE_META,
  TARGET_LABELS,
  type ProtocolRecommendation,
  type SessionRecord,
  type TargetState,
  type UserProfile,
} from '../../shared/types';
import { primeGestureAudioContext } from '../audio/PsychoacousticEngine';
import type { DisclosurePrompts } from '../lib/disclosureScheduler';
import {
  readPinnedProtocols,
  unpinStudyProtocol,
  type PinnedStudyProtocol,
} from '../lib/pinnedProtocols';
import type { PrivacyResolution } from '../lib/privacyGuard';
import {
  buildInstantQuickTryRecommendation,
  buildStateGoalQuickRecommendation,
  type QuickFeelingId,
  type QuickTryId,
} from '../lib/quickTryProtocols';

interface StudioHomeViewProps {
  profile: UserProfile | null;
  privacy: PrivacyResolution;
  disclosure: DisclosurePrompts;
  pendingDebrief: SessionRecord | null;
  themeMode: 'daylight' | 'night';
  onLaunchRecommendation: (rec: ProtocolRecommendation) => void;
  onOpenCheckIn: (opts?: { presetTarget?: TargetState; durationMin?: number }) => void;
  onOpenStudyLab: () => void;
  onOpenOnboarding: () => void;
  onOpenHugginsCheck: () => void;
  onDismissHugginsBanner: () => void;
  onDismissSelfStudyBanner: () => void;
  onOpenPendingDebrief: () => void;
  onDismissPending: () => void;
}

interface DayOneGoalCard {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  durationMin: number;
  feelingId: QuickFeelingId;
  target: TargetState;
  quickTryId?: QuickTryId;
}

const DAY_ONE_GOALS: DayOneGoalCard[] = [
  {
    id: 'deep_flow',
    title: 'Deep Flow',
    subtitle: 'Sustained coding, writing & analytical absorption.',
    badge: '45m · 15 Hz SMR-Beta · Woods 2024',
    durationMin: 45,
    feelingId: 'calm_ready',
    target: 'deep_flow',
    quickTryId: 'focus_lofi',
  },
  {
    id: 'sharp_focus',
    title: 'Sharp Focus',
    subtitle: 'Cut through distraction & mental drift rapidly.',
    badge: '25m · 16 Hz Beta · Rapid AM Lock',
    durationMin: 25,
    feelingId: 'distracted',
    target: 'alert_focus',
  },
  {
    id: 'calm_reset',
    title: 'Calm Reset',
    subtitle: 'Settle tension with a smooth 0.10 Hz autonomic tide.',
    badge: '15m · 0.10 Hz HRV · Lehrer 2014',
    durationMin: 15,
    feelingId: 'stressed_anxious',
    target: 'calm_reset',
    quickTryId: 'calm_rain',
  },
  {
    id: 'sleep_winddown',
    title: 'Sleep Wind-Down',
    subtitle: 'Gentle beatless 6 Hz Theta drift for evening unwind.',
    badge: '45m · 6 Hz Theta · Sleep Drift',
    durationMin: 45,
    feelingId: 'burned_out',
    target: 'sleep_winddown',
  },
];

const QUICK_FEELING_PILLS: Array<{
  id: QuickFeelingId;
  label: string;
  target: TargetState;
  hint: string;
}> = [
  { id: 'tired_fog', label: 'Brain Fog', target: 'energy_lift', hint: '18 Hz Lift' },
  { id: 'stressed_anxious', label: 'Wired & Anxious', target: 'calm_reset', hint: '0.10 Hz HRV' },
  { id: 'distracted', label: 'Scattered', target: 'alert_focus', hint: '16 Hz Lock' },
  { id: 'burned_out', label: 'Drained', target: 'calm_reset', hint: '10 Hz Alpha' },
  { id: 'sad_low', label: 'Low Warmth', target: 'energy_lift', hint: '14 Hz Major' },
  { id: 'calm_ready', label: 'Steady · Flow', target: 'deep_flow', hint: '15 Hz SMR' },
];

function resolveCircadianPrescription(
  hour: number,
  profile: UserProfile | null
): {
  windowLabel: string;
  headline: string;
  rationale: string;
  feelingId: QuickFeelingId;
  target: TargetState;
  defaultDurationMin: number;
  badgeHz: string;
} {
  if (hour >= 5 && hour < 12) {
    return {
      windowLabel: 'Morning Peak Window',
      headline: 'Morning Peak Flow',
      rationale: 'Aligned to morning cortisol alertness with clean 15 Hz Beta-SMR modulation.',
      feelingId: 'calm_ready',
      target: 'deep_flow',
      defaultDurationMin: 45,
      badgeHz: '15 Hz Flow',
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      windowLabel: 'Afternoon Window',
      headline: 'Afternoon Slump Shield',
      rationale: 'Counters mid-day attention dip using rhythmic 16 Hz Beta mid-band drive.',
      feelingId: 'distracted',
      target: 'alert_focus',
      defaultDurationMin: 25,
      badgeHz: '16 Hz Beta',
    };
  }
  if (hour >= 17 && hour < 21) {
    return {
      windowLabel: 'Evening Decompression',
      headline: 'Evening Calm Reset',
      rationale: 'Down-regulates sympathetic arousal smoothly via 0.10 Hz paced autonomic breath.',
      feelingId: 'stressed_anxious',
      target: 'calm_reset',
      defaultDurationMin: 15,
      badgeHz: '0.10 Hz / 10 Hz',
    };
  }
  return {
    windowLabel: 'Nocturnal Window',
    headline: 'Sleep Wind-Down Drift',
    rationale: 'Melatonin-safe >3.2 kHz roll-off with beatless 6 Hz Theta acoustic settling.',
    feelingId: 'burned_out',
    target: 'sleep_winddown',
    defaultDurationMin: 45,
    badgeHz: profile?.neuralMemory?.personalIafHz ? '6 Hz Theta' : '6 Hz Drift',
  };
}

export function StudioHomeView({
  profile,
  privacy,
  disclosure,
  pendingDebrief,
  themeMode,
  onLaunchRecommendation,
  onOpenCheckIn,
  onOpenStudyLab,
  onOpenOnboarding,
  onOpenHugginsCheck,
  onDismissHugginsBanner,
  onDismissSelfStudyBanner,
  onOpenPendingDebrief,
  onDismissPending,
}: StudioHomeViewProps) {
  const [selectedDurationMin, setSelectedDurationMin] = useState<number>(
    () => resolveCircadianPrescription(new Date().getHours(), profile).defaultDurationMin
  );
  const [pinned, setPinned] = useState<PinnedStudyProtocol[]>(() => readPinnedProtocols());

  useEffect(() => {
    const syncPins = () => setPinned(readPinnedProtocols());
    window.addEventListener('nootropic-pins-updated', syncPins);
    return () => window.removeEventListener('nootropic-pins-updated', syncPins);
  }, []);

  const isDay = themeMode === 'daylight';
  const rx = resolveCircadianPrescription(new Date().getHours(), profile);
  const isDayOne = disclosure.isDayOneZeroFriction;

  const launchGoalDirect = (
    feelingId: QuickFeelingId,
    target: TargetState,
    durationMin: number,
    quickTryId?: QuickTryId
  ) => {
    primeGestureAudioContext();
    const rec = quickTryId
      ? buildInstantQuickTryRecommendation(quickTryId, profile)
      : buildStateGoalQuickRecommendation(feelingId, target, profile);
    rec.plannedDurationMin = durationMin;
    if (rec.executableSpec) {
      rec.executableSpec.protocol.recommendedDurationMin = durationMin;
    }
    rec.ephemeralMode = privacy.ephemeralMode;
    onLaunchRecommendation(rec);
  };

  const launchSignature6x40 = () => {
    primeGestureAudioContext();
    const rec = buildInstantQuickTryRecommendation('signature_6x40', profile);
    rec.plannedDurationMin = isDayOne ? 25 : selectedDurationMin;
    rec.ephemeralMode = privacy.ephemeralMode;
    onLaunchRecommendation(rec);
  };

  const launchDrivingSafe = () => {
    primeGestureAudioContext();
    const rec = buildStateGoalQuickRecommendation('distracted', 'alert_focus', profile);
    rec.plannedDurationMin = 25;
    rec.device = 'car_audio';
    rec.environment = 'driving';
    rec.safetyMode = true;
    rec.safetyWarnings = [
      'Driving Safety Mode: >=14 Hz alert range locked, open 800-3500 Hz traffic cues preserved.',
    ];
    rec.params = {
      ...rec.params,
      modulationHz: Math.max(14, rec.params.modulationHz),
      speakerSafeEQ: true,
      stereoAmSpread: false,
      antiMonotonyCycleMin: 5,
      noiseLevel: Math.min(rec.params.noiseLevel, 0.06),
    };
    rec.ephemeralMode = privacy.ephemeralMode;
    onLaunchRecommendation(rec);
  };

  const launchPinnedProtocol = (entry: PinnedStudyProtocol) => {
    primeGestureAudioContext();
    const rec = structuredClone(entry.recommendationTemplate);
    rec.sessionId = `eph_study_pin_${entry.id}_${Date.now().toString(36)}`;
    rec.ephemeralMode = privacy.ephemeralMode;
    onLaunchRecommendation(rec);
  };

  return (
    <div data-testid="studio-home-view" className="mx-auto max-w-4xl space-y-6">
      {/* Compliance & Privacy Micro-Pill */}
      <div className="animate-rise flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.07] px-3.5 py-2 text-[11px] text-[#D4D4CE]">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
          <span>
            <strong className="text-[#34D399]">48 kHz Psychoacoustic Wellness (18+)</strong> ·{' '}
            {privacy.statusLabel} · Best with sealed In-Ear Buds
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] text-[#34D399]">
          <Headphones className="h-3 w-3" />
          Zero Sign-Up Needed
        </span>
      </div>

      {/* Pending Unrated Debrief */}
      {pendingDebrief && (
        <div className="animate-rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-500/10 p-3.5 text-xs">
          <div>
            <div className="font-semibold text-amber-100">
              Complete quick debrief ({pendingDebrief.armName})
            </div>
            <p className="text-[11px] text-amber-200/80">
              10 seconds updates your personal adaptive calibration.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenPendingDebrief}
              className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-[#0A0B0C] hover:bg-amber-300"
            >
              Rate Now
            </button>
            <button
              type="button"
              onClick={onDismissPending}
              aria-label="Dismiss pending debrief"
              className="rounded-lg p-1.5 text-amber-200/80 hover:bg-amber-400/15"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Session #2 Non-Blocking Pre-Play Huggins Calibration Card */}
      {disclosure.showPrePlayHugginsCard && (
        <div
          data-testid="disclosure-huggins-banner"
          className="animate-rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/12 bg-[#131518] px-4 py-3 text-xs"
        >
          <div className="flex items-start gap-2.5">
            <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-[#34D399]" />
            <div>
              <div className="font-semibold text-[#F3F1EC]">
                Session #2 Calibration · Verify 600 Hz Earbud Seal (35s)
              </div>
              <p className="text-[11px] text-[#A3A39E]">
                Confirms true stereo phase separation and auto-protects against Apple Spatial Audio
                or speaker crosstalk.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenHugginsCheck}
              className="btn-aurora rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              Verify Earbuds
            </button>
            <button
              type="button"
              onClick={onDismissHugginsBanner}
              className="rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] font-medium text-[#A3A39E] hover:text-[#F3F1EC]"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* Session #3+ Non-Blocking N-of-1 Self-Study Invite */}
      {disclosure.showSelfStudyOptInPrompt && (
        <div
          data-testid="disclosure-selfstudy-banner"
          className="animate-rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-[#101215] px-4 py-3 text-xs"
        >
          <div className="space-y-0.5">
            <div className="font-semibold text-[#F3F1EC]">
              Unlock Your 8-Session Blinded N-of-1 Proof
            </div>
            <p className="text-[11px] text-[#A3A39E]">
              Optionally add age &amp; role priors plus 25% blinded Sham control to measure your
              verified Active vs. Sham delta.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenOnboarding}
              className="rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-[#34D399] hover:bg-emerald-500/25"
            >
              Enable Self-Study
            </button>
            <button
              type="button"
              onClick={onDismissSelfStudyBanner}
              className="rounded-lg px-2 py-1.5 text-[11px] text-[#8E8E88] hover:text-[#F3F1EC]"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {isDayOne ? (
        /* =============================================================== */
        /* DAY-1 ZERO-FRICTION STUDIO ENTRY (TTFA < 15s, Zero Wall)        */
        /* =============================================================== */
        <div className="space-y-5">
          <div className="animate-rise glass-stage rounded-3xl p-5 sm:p-7 space-y-5">
            <div className="space-y-2 text-center sm:text-left">
              <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#34D399]">
                <Waves className="h-3.5 w-3.5" />
                Instant 48 kHz Studio · Local-Only
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-[#F3F1EC] sm:text-4xl">
                Shift your state in <span className="text-[#34D399]">60 seconds.</span>
              </h1>
              <p className="max-w-2xl text-xs leading-relaxed text-[#A3A39E] sm:text-sm">
                Pick what your mind needs right now for 1-tap studio playback, or map your exact A →
                B brain trajectory across peer-reviewed NIH PubMed studies.
              </p>
            </div>

            {/* 4 Instant 1-Tap Goal Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DAY_ONE_GOALS.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  data-testid={`instant-goal-card-${goal.id}`}
                  onClick={() =>
                    launchGoalDirect(goal.feelingId, goal.target, goal.durationMin, goal.quickTryId)
                  }
                  className="group flex flex-col justify-between rounded-2xl border border-white/12 bg-[#131518] p-4 text-left transition hover:border-emerald-400/60"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-base font-bold text-[#F3F1EC]">
                        {goal.title}
                      </span>
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/12 text-[#34D399] transition group-hover:bg-emerald-500/20">
                        <Play className="h-3.5 w-3.5 translate-x-0.5 fill-[#34D399]" />
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#A3A39E]">{goal.subtitle}</p>
                  </div>
                  <div className="mt-3 font-mono-tech text-[10px] font-semibold text-[#34D399]">
                    {goal.badge}
                  </div>
                </button>
              ))}
            </div>

            {/* NootropicFM Signature 6x40 Hz Fast-Lane */}
            <button
              type="button"
              data-testid="signature-fast-lane"
              onClick={launchSignature6x40}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-400/45 bg-emerald-500/[0.08] px-4 py-3.5 text-left transition hover:border-emerald-400/75 hover:bg-emerald-500/15"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#F3F1EC]">
                  <Sparkles className="h-4 w-4 shrink-0 text-[#34D399]" />
                  <span>NootropicFM Signature · 6×40 Hz Theta-Gamma</span>
                  <span className="rounded border border-emerald-400/40 bg-[#0B0C0E] px-1.5 py-0.5 font-mono-tech text-[9.5px] font-bold uppercase text-[#34D399]">
                    0% Sham
                  </span>
                </div>
                <p className="text-xs text-[#A3A39E]">
                  120.000 BPM sub-harmonic stem lock with 0.10 Hz autonomic orbit (25m · In-Ear Buds).
                </p>
              </div>
              <span className="btn-aurora shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold">
                ▶ Launch
              </span>
            </button>
          </div>

          {/* Precision A -> B & Study Matcher Card */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              data-testid="open-precision-checkin"
              onClick={() => onOpenCheckIn()}
              className="glass-card sm:col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-white/12 p-4 text-left transition hover:border-emerald-400/55"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-500/10 text-[#34D399]">
                  <Compass className="h-5 w-5" />
                </span>
                <div className="space-y-0.5">
                  <div className="text-sm font-bold text-[#F3F1EC]">
                    Map Exact State (A → B) &amp; Match PubMed Studies
                  </div>
                  <p className="text-xs text-[#A3A39E]">
                    Interactive 2D Neural Compass · Live Research Trace · Pick any of 10 studio
                    genres
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#34D399]" />
            </button>

            <button
              type="button"
              onClick={launchDrivingSafe}
              className="glass-card flex items-center justify-between gap-2 rounded-2xl border border-amber-400/35 bg-amber-500/[0.06] p-4 text-left transition hover:border-amber-400/65"
            >
              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#F3F1EC]">
                  <Car className="h-4 w-4 text-amber-300" />
                  <span>Driving Mode</span>
                </div>
                <p className="text-[11px] text-[#A3A39E]">Road-safe ≥14 Hz alerts</p>
              </div>
              <Play className="h-4 w-4 shrink-0 text-amber-300" />
            </button>
          </div>
        </div>
      ) : (
        /* =============================================================== */
        /* RETURNING CIRCADIAN STUDIO HOME (Session #2+ / Active Profile)  */
        /* =============================================================== */
        <div className="space-y-5">
          {/* Block 1: 1-Tap Smart Circadian Prescription */}
          <div className="animate-rise glass-stage rounded-3xl p-5 sm:p-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 font-mono-tech text-[10.5px] font-semibold text-[#34D399]">
                {isDay ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {rx.windowLabel} · {rx.badgeHz}
              </div>
              {profile?.displayName && (
                <span className="font-mono-tech text-xs font-semibold text-[#D4D4CE]">
                  Welcome back, {profile.displayName}
                </span>
              )}
            </div>

            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <h1 className="font-display text-2xl font-bold tracking-tight text-[#F3F1EC] sm:text-3xl">
                  {rx.headline}
                </h1>
                <p className="max-w-xl text-xs leading-relaxed text-[#A3A39E] sm:text-sm">
                  {rx.rationale}
                </p>
                {profile?.favoriteGenres && profile.favoriteGenres.length > 0 && (
                  <div className="font-mono-tech text-[11px] text-[#34D399]">
                    Preferred carrier: {GENRE_META[profile.favoriteGenres[0]].label}
                  </div>
                )}
              </div>

              <div className="space-y-2.5 sm:text-right">
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  {[15, 25, 45, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedDurationMin(m)}
                      className={`rounded-lg border px-2.5 py-1.5 font-mono-tech text-xs font-semibold transition ${
                        selectedDurationMin === m
                          ? 'border-emerald-400/65 bg-emerald-500/15 text-[#F3F1EC]'
                          : 'border-white/12 bg-[#131518] text-[#A3A39E] hover:text-[#F3F1EC]'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  data-testid="start-prescribed-session"
                  onClick={() => launchGoalDirect(rx.feelingId, rx.target, selectedDurationMin)}
                  className="btn-aurora inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold sm:w-auto"
                >
                  <Play className="h-4 w-4 fill-[#0A0B0C]" />
                  <span>Start Prescribed Session ({selectedDurationMin}m)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Block 2: Signature 6x40 Hz + Driving Mode */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              data-testid="signature-fast-lane"
              onClick={launchSignature6x40}
              className="sm:col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/45 bg-emerald-500/[0.08] p-4 text-left transition hover:border-emerald-400/75 hover:bg-emerald-500/14"
            >
              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 text-sm font-bold text-[#F3F1EC]">
                  <Zap className="h-4 w-4 text-[#34D399]" />
                  <span>NootropicFM Signature · 6×40 Hz</span>
                </div>
                <p className="text-xs text-[#A3A39E]">
                  120.000 BPM cross-frequency deep flow · 0% sham dilution
                </p>
              </div>
              <span className="rounded-lg border border-emerald-400/40 bg-[#0B0C0E] px-3 py-1.5 font-mono-tech text-xs font-bold text-[#34D399]">
                ▶ Play
              </span>
            </button>

            <button
              type="button"
              onClick={launchDrivingSafe}
              className="flex items-center justify-between gap-2 rounded-2xl border border-amber-400/35 bg-amber-500/[0.07] p-4 text-left transition hover:border-amber-400/65"
            >
              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#F3F1EC]">
                  <Car className="h-4 w-4 text-amber-300" />
                  <span>Driving Mode</span>
                </div>
                <p className="text-[11px] text-[#A3A39E]">≥14 Hz road-safe alerts</p>
              </div>
              <Play className="h-4 w-4 text-amber-300" />
            </button>
          </div>

          {/* Block 3: How is your mind right now? */}
          <div className="glass-card rounded-2xl border border-white/10 p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#F3F1EC]">How is your mind right now?</h2>
              <button
                type="button"
                data-testid="open-precision-checkin"
                onClick={() => onOpenCheckIn()}
                className="inline-flex items-center gap-1.5 font-mono-tech text-xs font-semibold text-[#34D399] hover:underline"
              >
                <Compass className="h-3.5 w-3.5" />
                <span>Open 2D Brain Map &amp; Study Matcher →</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUICK_FEELING_PILLS.map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => launchGoalDirect(pill.id, pill.target, selectedDurationMin)}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#131518] px-3 py-2.5 text-left transition hover:border-emerald-400/55"
                >
                  <span className="truncate text-xs font-semibold text-[#F3F1EC]">{pill.label}</span>
                  <span className="shrink-0 font-mono-tech text-[10px] text-[#34D399]">
                    {pill.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Block 4: Pinned from Study Lab Shelf */}
      <div
        data-testid="pinned-protocols-shelf"
        className="glass-card rounded-2xl border border-white/10 p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm font-bold text-[#F3F1EC]">
            <Pin className="h-4 w-4 text-[#34D399]" />
            <span>Pinned from Study Lab</span>
          </div>
          <button
            type="button"
            onClick={onOpenStudyLab}
            className="inline-flex items-center gap-1.5 font-mono-tech text-xs font-semibold text-[#34D399] hover:underline"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span>Browse PubMed / DOI Lab →</span>
          </button>
        </div>

        {pinned.length === 0 ? (
          <p className="text-xs text-[#8E8E88]">
            Pin any peer-reviewed paper in Study Lab for instant 1-tap launch here (up to 8
            protocols).
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {pinned.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#131518] px-3.5 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => launchPinnedProtocol(entry)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-xs font-semibold text-[#F3F1EC]">{entry.title}</div>
                  <div className="mt-0.5 truncate font-mono-tech text-[10px] text-[#34D399]">
                    {entry.modulationHz > 0 ? `${entry.modulationHz} Hz` : TARGET_LABELS[entry.targetState]}{' '}
                    · {entry.durationMin}m · {entry.citation}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => launchPinnedProtocol(entry)}
                    aria-label={`Play pinned protocol ${entry.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/12 text-[#34D399] hover:bg-emerald-500/20"
                  >
                    <Play className="h-3.5 w-3.5 fill-[#34D399]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinned(unpinStudyProtocol(entry.id))}
                    aria-label={`Unpin ${entry.title}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-[#8E8E88] hover:border-rose-400/40 hover:text-rose-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
