import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  Database,
  Download,
  FlaskConical,
  Layers,
  Lock,
  Music2,
  RefreshCw,
  Repeat,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { getGenreDisplayMeta } from '../../shared/promptComposer';
import { STATE_LABELS, TARGET_LABELS, type ResearchInsights } from '../../shared/types';
import { API_BASE, api } from '../lib/api';

interface InsightsViewProps {
  profileId?: string;
}

export function InsightsView({ profileId }: InsightsViewProps) {
  const [insights, setInsights] = useState<ResearchInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleAdminExport = async (format: 'csv' | 'json') => {
    if (!adminKey.trim()) {
      setExportStatus('Please enter your Researcher Admin Key.');
      return;
    }
    setExporting(true);
    setExportStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/dataset/export?format=${format}`, {
        headers: { 'X-Admin-Key': adminKey.trim() },
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Unauthorized' }))) as { error?: string };
        setExportStatus(err.error ?? `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nootropic-fm-research-dataset.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportStatus(`Downloaded ${format.toUpperCase()} dataset securely.`);
    } catch {
      setExportStatus('Network error while exporting dataset.');
    } finally {
      setExporting(false);
    }
  };

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

  const ret = insights.retentionMetrics;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header & Dataset Export */}
      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/12 px-3 py-1 text-xs font-medium text-indigo-300">
            <Database className="h-3.5 w-3.5" />
            Live Data Flywheel · Cloudflare D1 SQLite (Aggregated &amp; Pseudonymized)
          </div>
          <h1 className="mt-2.5 text-2xl font-bold text-white sm:text-3xl">
            Research Brain · <span className="text-cyan-400">nootropic.fm</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Hybrid Bayesian Contextual Bandit combining explicit debrief ratings (weight 1.0) with
            real behavioral retention &amp; D1/D7 return signals (weight 0.45). Zero synthetic data.
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
          <button
            type="button"
            onClick={() => {
              setExportStatus(null);
              setShowExportModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
          >
            <Lock className="h-3.5 w-3.5" />
            Admin Dataset Export
          </button>
        </div>
      </div>

      {/* Admin-Protected Dataset Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage w-full max-w-md rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-300">
                <Lock className="h-4 w-4" />
                <h3 className="text-base font-semibold text-white">Protected Research Export</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Raw session datasets are protected with your Cloudflare Worker secret{' '}
              <code className="font-mono-tech text-cyan-300">ADMIN_EXPORT_KEY</code> so only you can
              download the collected training data.
            </p>
            <div className="glow-input-wrap">
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Enter your Researcher Admin Key..."
                className="w-full rounded-[1rem] bg-[#060a14]/95 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none"
              />
            </div>
            {exportStatus && <p className="text-xs text-amber-300">{exportStatus}</p>}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleAdminExport('csv')}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/12 px-4 py-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleAdminExport('json')}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-4 py-2.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download JSON
              </button>
            </div>
          </div>
        </div>
      )}

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
          <div className="text-[11px] text-slate-400">Explicit Success</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-cyan-300">
            {insights.globalSuccessRatePct}%
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Avg Explicit Δ
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

      {/* Implicit Behavioral Retention & D1/D7 Return Rate */}
      {ret && (
        <div className="animate-rise delay-100 glass-card rounded-3xl border border-emerald-400/20 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-300">
              <Activity className="h-5 w-5" />
              <h2 className="text-base font-semibold text-white">
                Implicit Retention &amp; Return Learning (Behavioral Telemetry · Weight 0.45)
              </h2>
            </div>
            <span className="font-mono-tech rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
              {ret.trackedSessions} tracked sessions · {ret.returningProfiles} returning profiles
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            Even when listeners skip the 10-second debrief, consented sessions train the Bandit via
            listen completion (&gt;75%), early bounces (&lt;90s), instant genre swaps (&lt;60s), and
            real D1/D7 return bonuses. Locking your screen while listening is never penalized.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3.5">
              <div className="text-[11px] text-emerald-200/80">Avg Listen Retention</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-emerald-300">
                {ret.avgListenRetentionPct}%
              </div>
              <div className="text-[10px] text-slate-400">of planned session</div>
            </div>

            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] p-3.5">
              <div className="text-[11px] text-cyan-200/80">Completion (&ge;75%)</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-cyan-300">
                {ret.completionRatePct}%
              </div>
              <div className="text-[10px] text-slate-400">strong retention signal</div>
            </div>

            <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-3.5">
              <div className="text-[11px] text-amber-200/80">Early Bounce (&lt;90s)</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-amber-300">
                {ret.earlyBounceRatePct}%
              </div>
              <div className="text-[10px] text-slate-400">negative combo signal</div>
            </div>

            <div className="rounded-2xl border border-slate-700/80 bg-slate-950/70 p-3.5">
              <div className="text-[11px] text-slate-400">Instant Swap (&lt;60s)</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-slate-200">
                {ret.instantSwapRatePct}%
              </div>
              <div className="text-[10px] text-slate-500">initial genre mismatch</div>
            </div>

            <div className="rounded-2xl border border-indigo-400/25 bg-indigo-500/[0.08] p-3.5">
              <div className="flex items-center gap-1 text-[11px] text-indigo-200/80">
                <Repeat className="h-3 w-3" /> D1 Return Rate
              </div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-indigo-300">
                {ret.d1ReturnRatePct}%
              </div>
              <div className="text-[10px] text-slate-400">came back 12h–36h</div>
            </div>

            <div className="rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/[0.08] p-3.5">
              <div className="flex items-center gap-1 text-[11px] text-fuchsia-200/80">
                <Repeat className="h-3 w-3" /> D7 Return Rate
              </div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-fuchsia-300">
                {ret.d7ReturnRatePct}%
              </div>
              <div className="text-[10px] text-slate-400">came back within 7d</div>
            </div>
          </div>
        </div>
      )}

      {/* Blind A/B Scientific Validation: Active 3-Band AM vs Pure-Music Control */}
      {insights.abValidation && (
        <div className="animate-rise delay-100 glass-card rounded-3xl border border-purple-400/25 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-purple-300">
              <FlaskConical className="h-5 w-5" />
              <h2 className="text-base font-semibold text-white">
                Scientific Validation · Active 3-Band AM vs. Pure-Music Control (Blind A/B)
              </h2>
            </div>
            <span
              className={`font-mono-tech rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                insights.abValidation.readyForStats
                  ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                  : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
              }`}
            >
              {insights.abValidation.readyForStats
                ? 'Live A/B Signal Active'
                : 'Collecting Baseline (need ≥10 AM & ≥5 Control)'}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            12% of consented sessions run as blinded Pure-Music Controls (AM = 0%, identical studio
            audio &amp; EQ) so nootropic.fm measures both explicit cognitive Δ lift and real listen
            retention lift over music alone.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] p-4 space-y-1">
              <div className="text-[11px] font-medium text-cyan-200/80">
                Active 3-Band LR4 AM (n = {insights.abValidation.activeSessions})
              </div>
              <div className="font-mono-tech text-2xl font-bold text-cyan-300">
                Δ{' '}
                {insights.abValidation.activeAvgDelta >= 0
                  ? `+${insights.abValidation.activeAvgDelta}`
                  : insights.abValidation.activeAvgDelta}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{insights.abValidation.activeSuccessRatePct}% positive</span>
                <span className="font-mono-tech text-cyan-200">
                  {insights.abValidation.activeListenRetentionPct}% retention
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700/80 bg-slate-950/70 p-4 space-y-1">
              <div className="text-[11px] font-medium text-slate-400">
                Pure-Music Blind Control (n = {insights.abValidation.controlSessions})
              </div>
              <div className="font-mono-tech text-2xl font-bold text-slate-200">
                Δ{' '}
                {insights.abValidation.controlAvgDelta >= 0
                  ? `+${insights.abValidation.controlAvgDelta}`
                  : insights.abValidation.controlAvgDelta}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{insights.abValidation.controlSuccessRatePct}% positive</span>
                <span className="font-mono-tech text-slate-300">
                  {insights.abValidation.controlListenRetentionPct}% retention
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-purple-400/30 bg-purple-500/10 p-4 space-y-1">
              <div className="text-[11px] font-medium text-purple-200/80">
                Measured AM Lift (Δ AM − Δ Control)
              </div>
              <div
                className={`font-mono-tech text-2xl font-bold ${
                  insights.abValidation.deltaLift > 0
                    ? 'text-emerald-300'
                    : insights.abValidation.deltaLift < 0
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }`}
              >
                {insights.abValidation.controlSessions === 0
                  ? 'Pending'
                  : insights.abValidation.deltaLift >= 0
                    ? `+${insights.abValidation.deltaLift}`
                    : insights.abValidation.deltaLift}
              </div>
              <div className="text-[11px] text-slate-400">
                {insights.abValidation.controlSessions === 0
                  ? 'Awaiting first blind control debrief'
                  : `Retention lift: ${
                      insights.abValidation.retentionLiftPct >= 0
                        ? `+${insights.abValidation.retentionLiftPct}%`
                        : `${insights.abValidation.retentionLiftPct}%`
                    }`}
              </div>
            </div>
          </div>
        </div>
      )}

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
            No recorded trials on your profile yet. Run a session with consent enabled to watch the
            engine learn which protocol and vibe work best for your brain.
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
                  <span>Retention {arm.avgCompletionPct}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Music Layer (Core + Custom Community Cache Genres) Performance */}
      {insights.genreLeaderboard && insights.genreLeaderboard.length > 0 && (
        <div className="animate-rise delay-225 glass-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 text-indigo-300">
            <Music2 className="h-5 w-5" />
            <h2 className="text-base font-semibold text-white">
              Music Layer Performance (Studio Genres &amp; Custom Vibes × Outcomes)
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {insights.genreLeaderboard.map((g) => (
              <div
                key={g.genre}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-sm font-semibold text-white">{g.label}</span>
                    {g.isCustom && (
                      <span className="shrink-0 rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-fuchsia-200">
                        Custom
                      </span>
                    )}
                  </div>
                  <span className="font-mono-tech text-sm font-bold text-indigo-300">
                    {g.successRatePct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400"
                    style={{ width: `${g.successRatePct}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono-tech text-[11px] text-slate-400">
                  <span>{g.sessions} sessions</span>
                  <span>Δ {g.avgDelta >= 0 ? `+${g.avgDelta}` : g.avgDelta}</span>
                  {typeof g.avgRetentionPct === 'number' && (
                    <span>Ret {g.avgRetentionPct}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Archetype x Protocol x Genre Combinations */}
      {insights.topArchetypeCombos && insights.topArchetypeCombos.length > 0 && (
        <div className="animate-rise delay-225 glass-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 text-fuchsia-300">
            <Layers className="h-5 w-5" />
            <h2 className="text-base font-semibold text-white">
              Top Learned Combinations (Archetype × Protocol × Genre)
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {insights.topArchetypeCombos.map((combo, idx) => (
              <div
                key={`${combo.cohortKey}_${combo.armName}_${combo.genreSlug}_${idx}`}
                className="rounded-xl border border-slate-800/90 bg-slate-950/65 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">{combo.cohortLabel}</div>
                    <div className="mt-0.5 text-[11px] text-cyan-300">
                      {combo.armName} · <span className="text-fuchsia-200">{combo.genreLabel}</span>
                    </div>
                  </div>
                  <span className="font-mono-tech shrink-0 rounded-lg bg-emerald-500/12 px-2 py-0.5 text-xs font-bold text-emerald-300">
                    {combo.successRatePct}% fit
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono-tech text-[11px] text-slate-400">
                  <span>{combo.sessions} sessions</span>
                  <span>Avg Δ {combo.avgDelta >= 0 ? `+${combo.avgDelta}` : combo.avgDelta}</span>
                  <span>Listen Retention {combo.avgRetentionPct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            Database is ready. Complete your first session to see the first learned cohort appear in
            real time.
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
                          {arm.trials} signals · Beta({arm.alpha.toFixed(1)}, {arm.beta.toFixed(1)})
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

      {/* Recent Anonymized Telemetry Log (Zero profileId exposed) */}
      {insights.recentSessions.length > 0 && (
        <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-white">Recent Recorded Sessions (Anonymized)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 pr-3">Protocol &amp; Vibe</th>
                  <th className="py-2 pr-3">Transition</th>
                  <th className="py-2 pr-3">Parameters</th>
                  <th className="py-2 pr-3">Outcome &amp; Retention</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {insights.recentSessions.map((s) => {
                  const genreMeta = getGenreDisplayMeta(s.customGenreSlug || s.musicGenre);
                  const retPct = Math.round((s.completionRatio ?? 0) * 100);
                  return (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-3 font-medium text-white">
                        <div>
                          {s.armName}
                          {s.safetyMode && (
                            <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                              Driving
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-normal text-slate-400">
                          {genreMeta.label}
                          {s.audioSource === 'community_cache' && (
                            <span className="ml-1 text-fuchsia-300">· R2 Cache</span>
                          )}
                        </div>
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
                            {s.workedRating} · {retPct}%
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            Listened {retPct}%
                            {s.retentionOutcome ? ` (${s.retentionOutcome.replace('_', ' ')})` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            s.status === 'completed'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : s.status === 'abandoned'
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
