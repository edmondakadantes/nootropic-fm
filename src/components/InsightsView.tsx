import { useEffect, useState } from 'react';
import {
  Brain,
  Database,
  Download,
  FlaskConical,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { STATE_LABELS, TARGET_LABELS, type ResearchInsights } from '../../shared/types';
import { API_BASE, api } from '../lib/api';

interface InsightsViewProps {
  profileId?: string;
}

export function InsightsView({ profileId }: InsightsViewProps) {
  const [insights, setInsights] = useState<ResearchInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getInsights(profileId);
      setInsights(res.insights);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load live research data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profileId]);

  if (loading && !insights) {
    return (
      <div className="mx-auto max-w-5xl py-16 text-center text-sm text-slate-400">
        Loading live data from Cloudflare D1 research database...
      </div>
    );
  }

  if (error || !insights) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-200">
        {error ?? 'Unable to load research metrics.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header & Dataset Export */}
      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/12 px-3 py-1 text-xs font-medium text-indigo-300">
            <Database className="h-3.5 w-3.5" />
            Live Data Flywheel · Cloudflare D1 SQLite
          </div>
          <h1 className="mt-2.5 text-2xl font-bold text-white sm:text-3xl">
            Research Brain · <span className="text-cyan-400">nootropic.fm</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Every completed session updates Bayesian Contextual Bandit scores across individual
            profiles and collective cohorts. Zero synthetic data — real outcomes only.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <a
            href={`${API_BASE}/api/dataset/export?format=csv`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </a>
          <a
            href={`${API_BASE}/api/dataset/export?format=json`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/35 bg-indigo-500/12 px-3.5 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </a>
        </div>
      </div>

      {/* KPI Row */}
      <div className="animate-rise delay-75 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Users className="h-3.5 w-3.5 text-cyan-400" /> Profiles
          </div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-white">
            {insights.totalProfiles}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="text-[11px] text-slate-400">Total Sessions</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-white">
            {insights.totalSessions}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="text-[11px] text-slate-400">Rated Debriefs</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-emerald-300">
            {insights.completedDebriefs}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="text-[11px] text-slate-400">Success Rate</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-cyan-300">
            {insights.globalSuccessRatePct}%
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Avg Δ Shift
          </div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-emerald-300">
            {insights.globalAvgDelta >= 0 ? `+${insights.globalAvgDelta}` : insights.globalAvgDelta}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <FlaskConical className="h-3.5 w-3.5 text-purple-400" /> Exploration
          </div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-purple-300">
            {insights.explorationSharePct}%
          </div>
        </div>
      </div>

      {/* Personal Acoustic Profile */}
      <div className="animate-rise delay-150 glass-card rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <Brain className="h-5 w-5" />
          <h2 className="text-base font-semibold text-white">
            Your Personal Psychoacoustic Profile
          </h2>
        </div>

        {insights.personalArms.length === 0 ? (
          <p className="text-sm text-slate-400">
            No completed debriefs on your profile yet. Run your first session and submit the
            10-second debrief to watch the platform map what works best for your brain.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {insights.personalArms.map((arm) => (
              <div
                key={arm.armId}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{arm.armName}</span>
                  <span className="font-mono-tech text-sm font-bold text-cyan-300">
                    {arm.successRatePct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                    style={{ width: `${arm.successRatePct}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono-tech text-[11px] text-slate-400">
                  <span>{arm.trials} trials</span>
                  <span>Δ {arm.avgDelta >= 0 ? `+${arm.avgDelta}` : arm.avgDelta}</span>
                  <span>Completed {arm.avgCompletionPct}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Collective Cohort Intelligence */}
      <div className="animate-rise delay-225 glass-card rounded-3xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            Collective Cohort Intelligence (Archetypes)
          </h2>
          <p className="text-xs text-slate-400">
            When a new user arrives in the same cohort (e.g., Age 35–44 · Driving · Alert Focus),
            the engine starts immediately with the top-performing protocol proven here.
          </p>
        </div>

        {insights.cohorts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
            Database is ready. Complete your first test session (e.g., 40-year-old minibus driver,
            40m focus) to see the first learned cohort appear in real time.
          </div>
        ) : (
          <div className="space-y-4">
            {insights.cohorts.map((cohort) => (
              <div
                key={cohort.cohortKey}
                className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">{cohort.cohortLabel}</div>
                    <div className="font-mono-tech text-[11px] text-slate-500">
                      {cohort.cohortKey} · {cohort.completedSessions}/{cohort.totalSessions} rated
                      sessions · Leading protocol:{' '}
                      <span className="text-cyan-300">{cohort.topArmName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 font-mono-tech text-xs">
                    <span className="rounded-lg bg-emerald-500/12 px-2.5 py-1 text-emerald-300">
                      Success {cohort.successRatePct}%
                    </span>
                    <span className="rounded-lg bg-indigo-500/12 px-2.5 py-1 text-indigo-300">
                      Δ {cohort.avgDelta >= 0 ? `+${cohort.avgDelta}` : cohort.avgDelta}
                    </span>
                  </div>
                </div>

                {cohort.arms.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {cohort.arms.map((arm) => (
                      <div
                        key={arm.armId}
                        className="rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between font-medium text-slate-200">
                          <span>{arm.armName}</span>
                          <span className="font-mono-tech text-cyan-300">{arm.successRatePct}%</span>
                        </div>
                        <div className="mt-1 font-mono-tech text-[10px] text-slate-400">
                          {arm.trials} ratings · Beta({arm.alpha.toFixed(1)}, {arm.beta.toFixed(1)})
                          · Δ {arm.avgDelta >= 0 ? `+${arm.avgDelta}` : arm.avgDelta}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Raw Telemetry Log */}
      {insights.recentSessions.length > 0 && (
        <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-white">Recent Recorded Sessions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 pr-3">Protocol</th>
                  <th className="py-2 pr-3">Transition</th>
                  <th className="py-2 pr-3">Parameters</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {insights.recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 pr-3 font-medium text-white">
                      {s.armName}
                      {s.safetyMode && (
                        <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                          Driving
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {STATE_LABELS[s.currentState]} → {TARGET_LABELS[s.targetState]}
                    </td>
                    <td className="font-mono-tech py-2.5 pr-3 text-[11px] text-cyan-300">
                      {s.acousticParams.modulationHz}Hz · {s.acousticParams.bpm}BPM
                    </td>
                    <td className="font-mono-tech py-2.5 pr-3">
                      {s.status === 'completed' ? (
                        <span className="text-emerald-300">
                          {s.baselineScore}→{s.postScore} (Δ{' '}
                          {(s.deltaScore ?? 0) >= 0 ? `+${s.deltaScore}` : s.deltaScore}) ·{' '}
                          {s.workedRating}
                        </span>
                      ) : (
                        <span className="text-slate-500">Awaiting debrief</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          s.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
