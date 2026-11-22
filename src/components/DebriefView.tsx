import { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Brain,
  CheckCircle2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { LiveAdjustment, WorkedRating } from '../../shared/types';
import { api } from '../lib/api';

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

const FEEDBACK_TAGS = [
  'Kept me focused',
  'Pleasant sound',
  'Calmed me quickly',
  'Traffic-safe',
  'Too monotonous',
  'Too intense',
  'Modulation felt distracting',
  'Fatiguing',
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
  const [selectedTags, setSelectedTags] = useState<string[]>(['Kept me focused', 'Pleasant sound']);
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
        <div className="glass-card rounded-2xl p-6 sm:p-8 space-y-6 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300 border border-emerald-400/30">
            <Brain className="h-7 w-7" />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Self-Learning Update Complete
            </div>
            <h2 className="mt-1.5 text-2xl font-bold text-white">
              nootropic.fm just learned from your session!
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Protocol <strong className="text-white">{learningUpdate.armName}</strong> has been
              updated across both your personal profile and collective cohort intelligence.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-[11px] text-slate-400">Measured Shift (Δ)</div>
              <div
                className={`font-mono-tech mt-1 text-2xl font-bold ${
                  learningUpdate.delta >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {learningUpdate.delta >= 0 ? `+${learningUpdate.delta}` : learningUpdate.delta}
              </div>
              <div className="text-[11px] text-slate-500">
                Bandit Reward: {Math.round(learningUpdate.reward * 100)}/100
              </div>
            </div>

            <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/8 p-4">
              <div className="text-[11px] text-cyan-200/80">Your Personal Score</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-cyan-300">
                {learningUpdate.profileSuccessRatePct}%
              </div>
              <div className="text-[11px] text-slate-400">
                from {learningUpdate.profileTrials} personal trials
              </div>
            </div>

            <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-4">
              <div className="text-[11px] text-indigo-200/80">Collective Cohort Score</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-indigo-300">
                {learningUpdate.cohortSuccessRatePct}%
              </div>
              <div className="text-[11px] text-slate-400">
                from {learningUpdate.cohortTrials} real sessions
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
            Updated cohort:{' '}
            <span className="font-semibold text-white">{learningUpdate.cohortLabel}</span>
          </div>

          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={onViewInsights}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/12 px-5 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/20"
            >
              <BarChart3 className="h-4 w-4" />
              View Research Brain (Live Data)
            </button>
            <button
              type="button"
              onClick={onStartNew}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300"
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
      <div className="glass-card rounded-2xl p-6 sm:p-8 space-y-6">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Post-Session Debrief · 10 seconds
          </div>
          <h1 className="mt-3 text-2xl font-bold text-white">How well did this session work?</h1>
          <p className="mt-1 text-xs text-slate-400">
            Protocol: <span className="text-slate-200">{armName}</span> · Cohort:{' '}
            <span className="text-slate-200">{cohortLabel}</span> · Listened:{' '}
            <span className="font-mono-tech text-slate-200">
              {Math.max(1, Math.round(actualDurationSec / 60))} / {plannedDurationMin} min
            </span>
          </p>
        </div>

        {/* Before vs After Delta Score */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-200">
              How is your mental state <strong>NOW</strong> (compared to {baselineScore}/5 before)?
            </span>
            <span
              className={`font-mono-tech rounded-lg px-2.5 py-1 text-sm font-bold ${
                deltaPreview > 0
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : deltaPreview < 0
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-slate-800 text-slate-300'
              }`}
            >
              Δ {deltaPreview >= 0 ? `+${deltaPreview}` : deltaPreview}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((score) => (
              <button
                key={score}
                type="button"
                onClick={() => setPostScore(score)}
                className={`rounded-xl border py-3 text-center font-mono-tech text-base font-bold transition ${
                  postScore === score
                    ? 'border-emerald-400 bg-emerald-400/20 text-white'
                    : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700'
                }`}
              >
                {score}
              </button>
            ))}
          </div>
        </div>

        {/* Worked rating */}
        <div>
          <label className="mb-2.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
            Did this audio help you reach your target state?
          </label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setWorkedRating('yes')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-sm font-semibold transition ${
                workedRating === 'yes'
                  ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <ThumbsUp className="h-5 w-5" />
              Yes, clearly
            </button>
            <button
              type="button"
              onClick={() => setWorkedRating('partial')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-sm font-semibold transition ${
                workedRating === 'partial'
                  ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <Sparkles className="h-5 w-5" />
              Somewhat
            </button>
            <button
              type="button"
              onClick={() => setWorkedRating('no')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-sm font-semibold transition ${
                workedRating === 'no'
                  ? 'border-rose-400 bg-rose-500/15 text-rose-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <ThumbsDown className="h-5 w-5" />
              Didn’t help
            </button>
          </div>
        </div>

        {/* Quick diagnostic tags */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
            What did you notice? (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  selectedTags.includes(tag)
                    ? 'border-cyan-400/70 bg-cyan-400/15 text-cyan-200'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional short note (e.g., locked into focus around minute 10...)"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-4 text-sm font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
        >
          <CheckCircle2 className="h-5 w-5" />
          {submitting ? 'Updating learning model...' : 'Save Feedback & Train Platform'}
        </button>
      </div>
    </div>
  );
}
