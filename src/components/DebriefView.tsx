import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FlaskConical,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { LiveAdjustment, WorkedRating } from '../../shared/types';
import { api } from '../lib/api';
import { SonicOrb } from './SonicOrb';

interface DebriefViewProps {
  sessionId: string;
  armName: string;
  cohortLabel: string;
  baselineScore: number;
  plannedDurationMin: number;
  actualDurationSec: number;
  liveAdjustments: LiveAdjustment[];
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
  onStartNew,
  onViewInsights,
}: DebriefViewProps) {
  const [postScore, setPostScore] = useState<number>(Math.min(5, baselineScore + 2));
  const [workedRating, setWorkedRating] = useState<WorkedRating>('yes');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
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

  const deltaPreview = postScore - baselineScore;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
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
      });
      setLearningUpdate(res.learningUpdate);
    } finally {
      setSubmitting(false);
    }
  };

  if (learningUpdate) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="animate-rise glass-stage rounded-3xl p-6 sm:p-9 space-y-6 text-center">
          <SonicOrb mood="calm" size="md" label="Synapse Updated" />

          <div>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              nootropic.fm just <span className="text-aurora">learned from you.</span>
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Protocol <strong className="text-white">{learningUpdate.armName}</strong> has been
              re-weighted across both your personal profile and collective cohort intelligence.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-[11px] text-slate-400">Measured Shift (Δ)</div>
              <div
                className={`font-mono-tech mt-1 text-3xl font-bold ${
                  learningUpdate.delta >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {learningUpdate.delta >= 0 ? `+${learningUpdate.delta}` : learningUpdate.delta}
              </div>
              <div className="text-[11px] text-slate-500">
                Bandit Reward: {Math.round(learningUpdate.reward * 100)}/100
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/8 p-4">
              <div className="text-[11px] text-cyan-200/80">Your Personal Fit</div>
              <div className="font-mono-tech mt-1 text-3xl font-bold text-cyan-300">
                {learningUpdate.profileSuccessRatePct}%
              </div>
              <div className="text-[11px] text-slate-400">
                from {learningUpdate.profileTrials} personal trials
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-400/25 bg-indigo-500/10 p-4">
              <div className="text-[11px] text-indigo-200/80">Collective Cohort Fit</div>
              <div className="font-mono-tech mt-1 text-3xl font-bold text-indigo-300">
                {learningUpdate.cohortSuccessRatePct}%
              </div>
              <div className="text-[11px] text-slate-400">
                from {learningUpdate.cohortTrials} real sessions
              </div>
            </div>
          </div>

          {learningUpdate.wasControlTrial && (
            <div className="rounded-2xl border border-purple-400/35 bg-purple-500/12 p-4 text-left text-xs text-purple-100 space-y-1">
              <div className="inline-flex items-center gap-1.5 font-semibold text-purple-200">
                <FlaskConical className="h-4 w-4 text-purple-300" />
                Scientific Calibration Bonus · Blind Pure-Music Control Trial
              </div>
              <p className="leading-relaxed text-purple-100/85">
                This session played pure 3-Band studio audio (0% AM modulation) as part of our
                transparent Open Research Beta. Your honest rating directly powers our live{' '}
                <strong>Active AM vs. Pure-Music Control</strong> benchmark in Research Brain!
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3 text-xs text-slate-300">
            <span>
              Updated cohort:{' '}
              <span className="font-semibold text-white">{learningUpdate.cohortLabel}</span>
            </span>
            {learningUpdate.preferredModMult !== 1.0 && (
              <span className="font-mono-tech rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200">
                Personal AM Depth: {Math.round(learningUpdate.preferredModMult * 100)}%
              </span>
            )}
          </div>

          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={onViewInsights}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/12 px-5 py-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/20"
            >
              <BarChart3 className="h-4 w-4" />
              View Research Brain
            </button>
            <button
              type="button"
              onClick={onStartNew}
              className="btn-aurora inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-slate-950"
            >
              Start a New Session
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="animate-rise glass-stage rounded-3xl p-6 sm:p-8 space-y-6">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Post-Session Debrief · 10 seconds
          </div>
          <h1 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
            How did your mind <span className="text-aurora">respond?</span>
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Protocol: <span className="text-slate-200">{armName}</span> · Cohort:{' '}
            <span className="text-slate-200">{cohortLabel}</span> · Listened:{' '}
            <span className="font-mono-tech text-slate-200">
              {Math.max(1, Math.round(actualDurationSec / 60))} / {plannedDurationMin} min
            </span>
          </p>
        </div>

        {/* Before -> After Delta visualizer */}
        <div className="rounded-2xl border border-slate-800/90 bg-slate-950/65 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-200">
              Your state <strong>NOW</strong> (started at {baselineScore}/5)
            </span>
            <span
              className={`font-mono-tech rounded-lg px-3 py-1 text-sm font-bold ${
                deltaPreview > 0
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : deltaPreview < 0
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-slate-800 text-slate-300'
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
                    ? 'scale-105 border-emerald-400 bg-emerald-400/20 text-white shadow-[0_0_20px_rgba(52,211,153,0.3)]'
                    : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600'
                }`}
              >
                {score}
              </button>
            ))}
          </div>
        </div>

        {/* Worked rating */}
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setWorkedRating('yes')}
            className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3.5 text-sm font-semibold transition-all ${
              workedRating === 'yes'
                ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200 shadow-[0_0_24px_rgba(52,211,153,0.2)]'
                : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
            }`}
          >
            <ThumbsUp className="h-5 w-5" />
            Worked clearly
          </button>
          <button
            type="button"
            onClick={() => setWorkedRating('partial')}
            className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3.5 text-sm font-semibold transition-all ${
              workedRating === 'partial'
                ? 'border-amber-400 bg-amber-500/15 text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.18)]'
                : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
            }`}
          >
            <Sparkles className="h-5 w-5" />
            Somewhat
          </button>
          <button
            type="button"
            onClick={() => setWorkedRating('no')}
            className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3.5 text-sm font-semibold transition-all ${
              workedRating === 'no'
                ? 'border-rose-400 bg-rose-500/15 text-rose-200'
                : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
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
              placeholder="In your own words — what happened during the session? (optional)"
              className="w-full resize-none rounded-[1rem] bg-[#060a14]/95 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {FEEDBACK_WHISPERS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-all ${
                  selectedTags.includes(tag)
                    ? 'border-cyan-400/70 bg-cyan-400/15 text-cyan-200'
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
          className="btn-aurora flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 disabled:opacity-60"
        >
          <CheckCircle2 className="h-5 w-5" />
          {submitting ? 'Updating neural model...' : 'Save Feedback & Train Platform'}
        </button>
      </div>
    </div>
  );
}
