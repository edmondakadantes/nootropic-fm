import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Crown,
  FlaskConical,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Zap,
} from 'lucide-react';
import type { LiveAdjustment, UserProfile, WorkedRating } from '../../shared/types';
import { api } from '../lib/api';
import {
  NeuralFingerprintSigil,
  sharePublicNeuralFingerprint,
} from './NeuralFingerprintPass';
import { PvtBenchmarkModal } from './PvtBenchmarkModal';
import { SonicOrb } from './SonicOrb';

interface DebriefViewProps {
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
  studySpecId?: string;
  studyTitle?: string;
  entrainmentType?: string;
  frequencyHz?: number;
  profile?: UserProfile | null;
  syncCode?: string | null;
  isPro?: boolean;
  onUpgradePro?: () => void;
  onStartNew: () => void;
  onViewInsights: () => void;
}

const FEEDBACK_WHISPERS = [
  'Kept me locked in',
  'Warm & pleasant',
  'Calmed my mind quickly',
  'Safe & clear in traffic',
  'Wanted stronger focus',
  'Too monotonous',
  'A bit too intense',
  'Modulation felt distracting',
];

export function DebriefView({
  sessionId,
  armName,
  cohortLabel,
  baselineScore,
  plannedDurationMin,
  actualDurationSec,
  liveAdjustments,
  ephemeralMode = false,
  pvtPreMs = null,
  pvtLapsesPre = null,
  studySpecId,
  studyTitle,
  entrainmentType,
  frequencyHz,
  profile = null,
  syncCode = null,
  isPro = false,
  onUpgradePro,
  onStartNew,
  onViewInsights,
}: DebriefViewProps) {
  const [postScore, setPostScore] = useState<number>(Math.min(5, baselineScore + 2));
  const [workedRating, setWorkedRating] = useState<WorkedRating>('yes');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ephemeralCompleted, setEphemeralCompleted] = useState(false);
  const [studyOutcomeSaved, setStudyOutcomeSaved] = useState(false);
  const [showPostPvt, setShowPostPvt] = useState(false);
  const [pvtPostMs, setPvtPostMs] = useState<number | null>(null);
  const [pvtLapsesPost, setPvtLapsesPost] = useState<number | null>(null);
  const [sharingCard, setSharingCard] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [learningUpdate, setLearningUpdate] = useState<{
    armName: string;
    cohortLabel: string;
    delta: number;
    reward: number;
    cohortSuccessRatePct: number;
    cohortTrials: number;
    profileSuccessRatePct: number;
    profileTrials: number;
    wasControlTrial: boolean;
    preferredModMult: number;
  } | null>(null);

  const isStudyLabTrial = sessionId.startsWith('eph_study_');

  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
  }, [sessionId, ephemeralCompleted, learningUpdate]);
  const deltaPreview = postScore - baselineScore;
  const pvtDeltaMs =
    typeof pvtPreMs === 'number' && typeof pvtPostMs === 'number' ? pvtPostMs - pvtPreMs : null;
  const shareSeed = syncCode || profile?.id || sessionId;

  const handleShareFingerprint = async (shiftOverride?: number) => {
    setSharingCard(true);
    setShareNote(null);
    try {
      const outcome = await sharePublicNeuralFingerprint({
        seed: shareSeed,
        profile,
        highlight: {
          protocolLabel: armName,
          frequencyHz,
          shiftDelta: shiftOverride ?? deltaPreview,
          pvtDeltaMs,
        },
      });
      if (outcome === 'cancelled') return;
      setShareNote(
        outcome === 'shared'
          ? 'Shared your public Neural Fingerprint card!'
          : 'Public Card PNG saved + link copied — private sync key hidden!'
      );
      window.setTimeout(() => setShareNote(null), 4000);
    } finally {
      setSharingCard(false);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    if ((ephemeralMode || sessionId.startsWith('eph_')) && !isStudyLabTrial) {
      setEphemeralCompleted(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitDebrief({
        sessionId,
        actualDurationSec,
        postScore,
        workedRating,
        feedbackTags: selectedTags,
        liveAdjustments,
        notes,
        pvtPreMs,
        pvtPostMs,
        pvtLapsesPre,
        pvtLapsesPost,
        studySpecId,
        studyTitle,
        entrainmentType,
        frequencyHz,
      });
      if (isStudyLabTrial) {
        setStudyOutcomeSaved(true);
        setEphemeralCompleted(true);
      } else {
        setLearningUpdate(res.learningUpdate);
      }
    } catch {
      if (isStudyLabTrial) {
        setEphemeralCompleted(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (ephemeralCompleted) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="animate-rise glass-stage rounded-3xl p-6 sm:p-9 space-y-6 text-center">
          <SonicOrb mood="calm" size="md" label="Session Complete" />
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {studyOutcomeSaved
                ? 'Published to Open Study Leaderboard · Zero User PII'
                : 'Local-Only Privacy Mode · Zero Data Stored'}
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              Your shift: <span className="text-aurora">{baselineScore} → {postScore} (Δ {deltaPreview >= 0 ? `+${deltaPreview}` : deltaPreview})</span>
            </h2>
            {pvtPostMs !== null && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-3 py-1 font-mono-tech text-xs font-semibold text-cyan-200">
                <Zap className="h-3.5 w-3.5 text-cyan-300" />
                {pvtDeltaMs !== null
                  ? `Objective PVT: ${pvtPreMs} ms → ${pvtPostMs} ms (${pvtDeltaMs < 0 ? `${Math.abs(pvtDeltaMs)} ms faster` : pvtDeltaMs === 0 ? 'steady' : `+${pvtDeltaMs} ms`})`
                  : `Post-Session PVT: ${pvtPostMs} ms`}
              </div>
            )}
            <p className="mt-2 text-sm text-slate-400">
              {studyOutcomeSaved
                ? 'Your anonymous study efficacy rating has been aggregated into the live Study Lab Empirical Leaderboard with zero personal identity attached.'
                : 'Because research telemetry was opted out, nothing from this session was saved to your browser or to our servers. You can opt in anytime on the next session to unlock personal Bandit adaptation.'}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={onViewInsights}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#16181C] px-5 py-3 text-sm font-semibold text-[#D4D4CE] transition hover:border-white/30 hover:text-[#F3F1EC]"
            >
              <BarChart3 className="h-4 w-4 text-[#34D399]" />
              Explore Public Research Brain
            </button>
            <button
              type="button"
              onClick={onStartNew}
              className="btn-aurora inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
            >
              Start a New Session
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {/* Safe Public Viral Share Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#101114] px-4 py-3 text-left">
            <div className="flex items-center gap-3 min-w-0">
              <NeuralFingerprintSigil
                seed={shareSeed}
                size={46}
                className="rounded-lg border border-white/10 bg-[#08090B] p-0.5"
              />
              <div className="min-w-0 text-xs">
                <div className="font-semibold text-[#F3F1EC]">Share Your Neural Fingerprint</div>
                <p className="text-[11px] text-[#8E8E88]">
                  Public 1080×1350 card with your sigil &amp; shift · zero private key.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={sharingCard}
              onClick={() => void handleShareFingerprint(deltaPreview)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-[#16181C] px-3.5 py-2 text-xs font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50 disabled:opacity-60"
            >
              <Share2 className="h-3.5 w-3.5 text-[#34D399]" />
              {sharingCard ? 'Exporting...' : 'Share Card'}
            </button>
            {shareNote && (
              <p className="w-full text-[11px] font-medium text-[#34D399]">{shareNote}</p>
            )}
          </div>

          {!isPro && onUpgradePro && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-400/[0.08] px-4 py-3 text-left">
              <div className="text-xs text-amber-100">
                <strong className="text-[#F3F1EC]">Felt the difference?</strong> Unlock full sessions
                (15–60 min), all 10 curated styles &amp; Endless Stream with Pro.
              </div>
              <button
                type="button"
                onClick={onUpgradePro}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-[#0A0B0C] transition hover:bg-amber-300"
              >
                <Crown className="h-3.5 w-3.5" />
                Go Pro
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (learningUpdate) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="animate-rise glass-stage rounded-2xl p-6 sm:p-9 space-y-6 text-center">
          <SonicOrb mood="calm" size="md" label="Synapse Updated" />

          <div>
            <h2 className="text-2xl font-semibold text-[#F3F1EC] sm:text-3xl">
              nootropic.fm just <span className="text-[#34D399]">learned from you.</span>
            </h2>
            <p className="mt-2 text-sm text-[#A3A39E]">
              Protocol <strong className="text-[#F3F1EC]">{learningUpdate.armName}</strong> has been
              re-weighted across both your personal profile and collective cohort intelligence.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4">
              <div className="text-[11px] text-[#8E8E88]">Measured Shift (Δ)</div>
              <div
                className={`font-mono-tech mt-1 text-3xl font-bold ${
                  learningUpdate.delta >= 0 ? 'text-[#34D399]' : 'text-rose-300'
                }`}
              >
                {learningUpdate.delta >= 0 ? `+${learningUpdate.delta}` : learningUpdate.delta}
              </div>
              <div className="text-[11px] text-[#7E7E78]">
                Bandit Reward: {Math.round(learningUpdate.reward * 100)}/100
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4">
              <div className="text-[11px] text-[#8E8E88]">Your Personal Fit</div>
              <div className="font-mono-tech mt-1 text-3xl font-bold text-[#F3F1EC]">
                {learningUpdate.profileSuccessRatePct}%
              </div>
              <div className="text-[11px] text-[#7E7E78]">
                from {learningUpdate.profileTrials} personal trials
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4">
              <div className="text-[11px] text-[#8E8E88]">Collective Cohort Fit</div>
              <div className="font-mono-tech mt-1 text-3xl font-bold text-[#34D399]">
                {learningUpdate.cohortSuccessRatePct}%
              </div>
              <div className="text-[11px] text-[#7E7E78]">
                from {learningUpdate.cohortTrials} real sessions
              </div>
            </div>
          </div>

          {learningUpdate.wasControlTrial && (
            <div className="rounded-xl border border-white/12 bg-[#121417] p-4 text-left text-xs text-[#D4D4CE] space-y-1">
              <div className="inline-flex items-center gap-1.5 font-semibold text-[#34D399]">
                <FlaskConical className="h-4 w-4" />
                Scientific Calibration Bonus · Blind Pure-Music Control Trial
              </div>
              <p className="leading-relaxed text-[#A3A39E]">
                This session played pure 3-Band studio audio (0% AM modulation) as part of our
                transparent Open Research Beta. Your honest rating directly powers our live{' '}
                <strong className="text-[#F3F1EC]">Active AM vs. Pure-Music Control</strong> benchmark in Research Brain!
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#101114] px-4 py-3 text-xs text-[#D4D4CE]">
            <span>
              Updated cohort:{' '}
              <span className="font-semibold text-[#F3F1EC]">{learningUpdate.cohortLabel}</span>
            </span>
            {learningUpdate.preferredModMult !== 1.0 && (
              <span className="font-mono-tech rounded border border-white/15 bg-[#16181C] px-2 py-0.5 text-[11px] text-[#34D399]">
                Personal AM Depth: {Math.round(learningUpdate.preferredModMult * 100)}%
              </span>
            )}
            {pvtPostMs !== null && (
              <span className="font-mono-tech rounded border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-[#34D399]">
                {pvtDeltaMs !== null
                  ? `PVT: ${pvtPreMs}→${pvtPostMs} ms (${pvtDeltaMs < 0 ? `${Math.abs(pvtDeltaMs)} ms faster` : pvtDeltaMs === 0 ? 'steady' : `+${pvtDeltaMs} ms`})`
                  : `Post-PVT: ${pvtPostMs} ms`}
              </span>
            )}
          </div>

          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={onViewInsights}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#16181C] px-5 py-3 text-sm font-semibold text-[#D4D4CE] transition hover:border-white/30 hover:text-[#F3F1EC]"
            >
              <BarChart3 className="h-4 w-4 text-[#34D399]" />
              View Research Brain
            </button>
            <button
              type="button"
              onClick={onStartNew}
              className="btn-aurora inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
            >
              Start a New Session
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {/* Safe Public Viral Share Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#101114] px-4 py-3 text-left">
            <div className="flex items-center gap-3 min-w-0">
              <NeuralFingerprintSigil
                seed={shareSeed}
                size={46}
                className="rounded-lg border border-white/10 bg-[#08090B] p-0.5"
              />
              <div className="min-w-0 text-xs">
                <div className="font-semibold text-[#F3F1EC]">Share Your Neural Fingerprint</div>
                <p className="text-[11px] text-[#8E8E88]">
                  Public 1080×1350 card with your sigil &amp; shift · zero private key.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={sharingCard}
              onClick={() => void handleShareFingerprint(learningUpdate.delta)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-[#16181C] px-3.5 py-2 text-xs font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50 disabled:opacity-60"
            >
              <Share2 className="h-3.5 w-3.5 text-[#34D399]" />
              {sharingCard ? 'Exporting...' : 'Share Card'}
            </button>
            {shareNote && (
              <p className="w-full text-[11px] font-medium text-[#34D399]">{shareNote}</p>
            )}
          </div>

          {!isPro && onUpgradePro && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-amber-400/[0.08] px-4 py-3 text-left">
              <div className="text-xs text-amber-100">
                <strong className="text-[#F3F1EC]">Felt the difference?</strong> Unlock full sessions
                (15–60 min), all 10 curated styles &amp; Endless Stream with Pro.
              </div>
              <button
                type="button"
                onClick={onUpgradePro}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-[#0A0B0C] transition hover:bg-amber-300"
              >
                <Crown className="h-3.5 w-3.5" />
                Go Pro
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="animate-rise glass-stage rounded-2xl p-6 sm:p-8 space-y-6">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Post-Session Debrief · 10 seconds
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-[#F3F1EC] sm:text-3xl">
            How did your mind <span className="text-[#34D399]">respond?</span>
          </h1>
          <p className="mt-1 text-xs text-[#8E8E88]">
            Protocol: <span className="text-[#D4D4CE]">{armName}</span> · Cohort:{' '}
            <span className="text-[#D4D4CE]">{cohortLabel}</span> · Listened:{' '}
            <span className="font-mono-tech text-[#D4D4CE]">
              {Math.max(1, Math.round(actualDurationSec / 60))} / {plannedDurationMin} min
            </span>
          </p>
        </div>

        {/* Before -> After Delta visualizer */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[#D4D4CE]">
              Your state <strong className="text-[#F3F1EC]">NOW</strong> (started at {baselineScore}/5)
            </span>
            <span
              className={`font-mono-tech rounded-lg px-3 py-1 text-sm font-bold ${
                deltaPreview > 0
                  ? 'bg-emerald-500/15 text-[#34D399]'
                  : deltaPreview < 0
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-white/10 text-[#D4D4CE]'
              }`}
            >
              {baselineScore} → {postScore} (Δ {deltaPreview >= 0 ? `+${deltaPreview}` : deltaPreview})
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((score) => (
              <button
                key={score}
                type="button"
                onClick={() => setPostScore(score)}
                className={`rounded-xl border py-3 text-center font-mono-tech text-base font-bold transition-all ${
                  postScore === score
                    ? 'scale-105 border-emerald-400/70 bg-emerald-400/15 text-[#F3F1EC]'
                    : 'border-white/[0.08] bg-[#131417] text-[#8E8E88] hover:border-white/25'
                }`}
              >
                {score}
              </button>
            ))}
          </div>
        </div>

        {/* Optional 15-Second Objective Post-Session Cognitive Benchmark (PVT ms) */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121417] px-4 py-3">
          <div className="space-y-0.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
              <Zap className="h-3.5 w-3.5 text-[#34D399]" />
              Objective 15s Post-Session Brain Check (PVT ms · optional)
            </div>
            <p className="text-[11px] text-[#8E8E88]">
              {pvtPostMs !== null
                ? pvtDeltaMs !== null
                  ? `Measured shift: ${pvtPreMs} ms → ${pvtPostMs} ms (${pvtDeltaMs < 0 ? `${Math.abs(pvtDeltaMs)} ms faster` : pvtDeltaMs === 0 ? 'steady' : `+${pvtDeltaMs} ms`}) · Lapses: ${pvtLapsesPost ?? 0}`
                  : `Recorded post-session reaction speed: ${pvtPostMs} ms · Lapses: ${pvtLapsesPost ?? 0}`
                : typeof pvtPreMs === 'number'
                  ? `Pre-session baseline was ${pvtPreMs} ms. Run 5 quick flashes to measure your real ms shift.`
                  : 'Run 5 quick visual-motor flashes to attach an objective ms reaction benchmark.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPostPvt(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-[#181A1F] px-3.5 py-2 text-xs font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50"
          >
            <Zap className="h-3.5 w-3.5 text-[#34D399]" />
            {pvtPostMs !== null ? `Retake (${pvtPostMs} ms)` : 'Run 15s PVT Check'}
          </button>
        </div>

        {/* Worked rating */}
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setWorkedRating('yes')}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-sm font-semibold transition-all ${
              workedRating === 'yes'
                ? 'border-emerald-400/70 bg-emerald-500/15 text-[#34D399]'
                : 'border-white/[0.08] bg-[#131417] text-[#D4D4CE] hover:border-white/25'
            }`}
          >
            <ThumbsUp className="h-5 w-5" />
            Worked clearly
          </button>
          <button
            type="button"
            onClick={() => setWorkedRating('partial')}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-sm font-semibold transition-all ${
              workedRating === 'partial'
                ? 'border-amber-400/70 bg-amber-500/15 text-amber-200'
                : 'border-white/[0.08] bg-[#131417] text-[#D4D4CE] hover:border-white/25'
            }`}
          >
            <SlidersHorizontal className="h-5 w-5" />
            Somewhat
          </button>
          <button
            type="button"
            onClick={() => setWorkedRating('no')}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-sm font-semibold transition-all ${
              workedRating === 'no'
                ? 'border-rose-400/70 bg-rose-500/15 text-rose-200'
                : 'border-white/[0.08] bg-[#131417] text-[#D4D4CE] hover:border-white/25'
            }`}
          >
            <ThumbsDown className="h-5 w-5" />
            Didn’t work
          </button>
        </div>

        {/* Free-response reflection + subtle whisper tags */}
        <div className="space-y-3">
          <div className="glow-input-wrap">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="In your own words, what happened during the session? (optional)"
              className="w-full resize-none rounded-[0.8rem] bg-[#0B0C0E] px-4 py-3 text-sm text-[#F3F1EC] placeholder-[#5F605C] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {FEEDBACK_WHISPERS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                  selectedTags.includes(tag)
                    ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                    : 'subtle-chip'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="btn-aurora flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold disabled:opacity-60"
        >
          <CheckCircle2 className="h-5 w-5" />
          {isStudyLabTrial
            ? submitting
              ? 'Publishing anonymous study outcome...'
              : 'Submit Anonymous Study Rating (Leaderboard)'
            : ephemeralMode
              ? 'See Local Session Summary'
              : submitting
                ? 'Updating neural model...'
                : 'Save Feedback & Train Platform'}
        </button>
      </div>

      {showPostPvt && (
        <PvtBenchmarkModal
          phase="post"
          baselineMs={pvtPreMs}
          onComplete={(res) => {
            setPvtPostMs(res.medianMs);
            setPvtLapsesPost(res.lapses);
            setShowPostPvt(false);
            if (!ephemeralMode && !sessionId.startsWith('eph_')) {
              void api
                .saveSessionPvt({
                  sessionId,
                  phase: 'post',
                  medianMs: res.medianMs,
                  lapses: res.lapses,
                })
                .catch(() => {});
            }
          }}
          onClose={() => setShowPostPvt(false)}
        />
      )}
    </div>
  );
}
