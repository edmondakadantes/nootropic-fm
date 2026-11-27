import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  Cpu,
  Database,
  Download,
  FlaskConical,
  Headphones,
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
import {
  GENRE_META,
  STATE_LABELS,
  TARGET_LABELS,
  type ResearchInsights,
  type UserProfile,
} from '../../shared/types';
import { API_BASE, api } from '../lib/api';
import {
  readDisclosureState,
  resolveMemoryMaturityStage,
} from '../lib/disclosureScheduler';
import { CohortIntelligenceShowcase } from './CohortIntelligenceShowcase';

interface InsightsViewProps {
  profileId?: string;
  profile?: UserProfile | null;
  onOpenOnboarding?: () => void;
  onOpenSoundSystems?: () => void;
}

export function InsightsView({
  profileId,
  profile = null,
  onOpenOnboarding,
  onOpenSoundSystems,
}: InsightsViewProps) {
  const [insights, setInsights] = useState<ResearchInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [memoryScope, setMemoryScope] = useState<'all' | 'personal' | 'collective'>('all');

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

  useEffect(() => {
    if (!showExportModal) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') setShowExportModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showExportModal]);

  const ret = insights?.retentionMetrics;
  const localCompleted = readDisclosureState().completedSessions;
  const mem = profile?.neuralMemory;
  const learnedSessions = Math.max(
    mem?.learnedSessions ?? 0,
    profile?.sessionCount ?? 0,
    localCompleted
  );
  const maturityStage = resolveMemoryMaturityStage(learnedSessions);
  const hasConsentedProfile = Boolean(profile?.id && profile.researchConsent);
  const activePvtN = mem?.activePvtCount ?? 0;
  const shamPvtN = mem?.shamPvtCount ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header & Dataset Export */}
      <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-3 py-1 font-mono-tech text-[11px] font-medium text-[#34D399]">
            <Database className="h-3.5 w-3.5" />
            Personal Neural Memory + Collective Research Brain · Cloudflare D1
          </div>
          <h1 className="font-display mt-2.5 text-2xl font-bold text-[#F3F1EC] sm:text-3xl">
            Memory &amp; Research Brain · <span className="text-[#34D399]">nootropic.fm</span>
          </h1>
          <p className="mt-1 text-sm text-[#A3A39E]">
            Your N-of-1 blinded calibration alongside our collective Bayesian Contextual Bandit. Zero synthetic data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/12 bg-[#131518] p-0.5 text-[11px] font-semibold">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'personal', label: 'Personal Memory' },
                { id: 'collective', label: 'Collective Brain' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMemoryScope(opt.id)}
                className={`rounded-lg px-2.5 py-1.5 transition ${
                  memoryScope === opt.id
                    ? 'bg-emerald-500/15 text-[#34D399]'
                    : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#14161A] px-3.5 py-2 text-xs font-medium text-[#D4D4CE] hover:border-white/30 hover:text-[#F3F1EC]"
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
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-3.5 py-2 text-xs font-semibold text-[#34D399] hover:bg-emerald-500/20"
          >
            <Lock className="h-3.5 w-3.5" />
            Admin Dataset Export
          </button>
        </div>
      </div>

      {/* PRIMARY ZONE: Personal Neural Memory (3 Honest Statistical Maturity Stages) */}
      {memoryScope !== 'collective' && (
        <div
          data-testid="personal-memory-zone"
          className="animate-rise glass-stage rounded-2xl border border-emerald-400/25 p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[#34D399]">
              <Cpu className="h-5 w-5" />
              <div>
                <h2 className="text-base font-semibold text-[#F3F1EC]">
                  Personal Neural Memory (N-of-1 Self-Study)
                </h2>
                <p className="text-xs text-[#8E8E88]">
                  {maturityStage === 'cold_start'
                    ? `Cold Start · ${Math.min(8, learnedSessions)} / 8 blinded sessions logged`
                    : maturityStage === 'calibrating'
                      ? `Preliminary Signals · Calibrating (Low Confidence · ${learnedSessions} / 8 sessions)`
                      : `Validated Personal Proof (${learnedSessions} blinded sessions completed)`}
                </p>
              </div>
            </div>

            <span className="font-mono-tech rounded-full border border-emerald-400/35 bg-emerald-500/12 px-3 py-1 text-[10.5px] font-bold text-[#34D399]">
              {maturityStage === 'cold_start'
                ? `${Math.min(8, learnedSessions)} / 8 Sessions`
                : maturityStage === 'calibrating'
                  ? 'Calibrating · Low Confidence'
                  : '8+ Validated Proof'}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono-tech text-[11px] text-[#A3A39E]">
              <span>Blinded N-of-1 Power Threshold (25% Sham Control)</span>
              <span className="text-[#34D399]">
                {Math.min(100, Math.round((learnedSessions / 8) * 100))}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#34D399] transition-all duration-500"
                style={{ width: `${Math.max(4, Math.min(100, (learnedSessions / 8) * 100))}%` }}
              />
            </div>
          </div>

          {maturityStage === 'cold_start' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0B0C0E] p-4 text-xs">
              <div className="space-y-1 max-w-xl">
                <div className="font-semibold text-[#F3F1EC]">
                  Collecting unbiased baseline sessions before unblinding
                </div>
                <p className="text-[#A3A39E] leading-relaxed">
                  Complete {Math.max(1, 8 - learnedSessions)} more blinded session
                  {8 - learnedSessions === 1 ? '' : 's'} with post-session debriefs (and optional
                  20-trial PVT checks) to unlock your statistically powered Active vs. Sham lift.
                  {profile?.favoriteGenres?.[0]
                    ? ` Top observed carrier so far: ${GENRE_META[profile.favoriteGenres[0]].label}.`
                    : ''}
                </p>
              </div>
              {!hasConsentedProfile && onOpenOnboarding && (
                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="btn-aurora shrink-0 rounded-xl px-4 py-2 text-xs font-semibold"
                >
                  Enable Blinded Self-Study
                </button>
              )}
            </div>
          )}

          {maturityStage === 'calibrating' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5">
                <div className="text-[11px] text-[#8E8E88]">Estimated Alpha Peak (IAF)</div>
                <div className="font-mono-tech mt-1 text-xl font-bold text-[#F3F1EC]">
                  {(mem?.personalIafHz ?? 10.0).toFixed(1)} Hz
                </div>
                <div className="text-[10px] text-[#8E8E88]">Preliminary · Low Confidence</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5">
                <div className="text-[11px] text-[#8E8E88]">Preferred AM Dose</div>
                <div className="font-mono-tech mt-1 text-xl font-bold text-[#34D399]">
                  {Math.round((mem?.focusModMult ?? profile?.preferredModMult ?? 1) * 100)}%
                </div>
                <div className="text-[10px] text-[#8E8E88]">
                  Active vs. Sham remains blinded until Session 8
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5">
                <div className="text-[11px] text-[#8E8E88]">Leading Carrier Genre</div>
                <div className="mt-1 text-base font-bold text-[#F3F1EC]">
                  {profile?.favoriteGenres?.[0]
                    ? GENRE_META[profile.favoriteGenres[0]].label
                    : 'Calibrating'}
                </div>
                <div className="text-[10px] text-[#8E8E88]">
                  {Math.max(1, 8 - learnedSessions)} sessions to Validated Proof
                </div>
              </div>
            </div>
          )}

          {maturityStage === 'validated_proof' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/[0.07] p-4 space-y-1">
                  <div className="text-[11px] text-[#D4D4CE]">Validated Active vs. Sham Delta</div>
                  <div className="font-mono-tech text-2xl font-bold text-[#34D399]">
                    {typeof mem?.causalLiftMs === 'number'
                      ? mem.causalLiftMs > 0
                        ? `${mem.causalLiftMs} ms faster`
                        : `${mem.causalLiftMs} ms`
                      : 'Active Blinded'}
                  </div>
                  <div className="font-mono-tech text-[10px] text-[#8E8E88]">
                    Active n={activePvtN} · Sham n={shamPvtN} · N={learnedSessions}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-4 space-y-1">
                  <div className="text-[11px] text-[#8E8E88]">Circadian Focus Curve</div>
                  <div className="font-mono-tech text-xl font-bold capitalize text-[#F3F1EC]">
                    {mem?.peakChronoBucket ?? 'Morning'} Peak
                  </div>
                  <div className="text-[10px] text-[#8E8E88]">
                    IAF {(mem?.personalIafHz ?? 10.0).toFixed(1)} Hz ·{' '}
                    {mem?.fatigueDipMinute
                      ? `Pre-dip lift @ ${mem.fatigueDipMinute}m`
                      : 'Stable plateau'}
                  </div>
                </div>
                <div className="flex flex-col justify-between rounded-xl border border-emerald-400/30 bg-[#0D110F] p-4 space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-[#F3F1EC]">
                      Closed-Loop Optical HRV Ready
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#A3A39E]">
                      Stream real-time ear-canal PPG without chest straps or iOS BLE blocks.
                    </p>
                  </div>
                  {onOpenSoundSystems && (
                    <button
                      type="button"
                      onClick={onOpenSoundSystems}
                      className="inline-flex items-center gap-1.5 font-mono-tech text-[11px] font-semibold text-[#34D399] hover:underline"
                    >
                      <Headphones className="h-3.5 w-3.5" />
                      Reserve Earbuds Pro ($249) →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {memoryScope !== 'personal' && (
        <>
          {/* Blurred B2B Cohort Intelligence Matrix & Real 25/50/75/90% Retention Funnel */}
          <CohortIntelligenceShowcase mode="full" />

          {loading && !insights ? (
            <div className="py-12 text-center font-mono-tech text-xs uppercase tracking-[0.18em] text-[#8E8E88]">
              Loading live data from Cloudflare D1 research database...
            </div>
          ) : error || !insights ? (
            <div className="mx-auto max-w-2xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3 text-sm text-rose-200">
              <p>{error ?? 'Unable to load research metrics.'}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#14161A] px-4 py-2 text-xs font-semibold text-[#F3F1EC] hover:border-white/30"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Loading Insights
              </button>
            </div>
          ) : (
            <>
              {/* KPI Row */}
      <div className="animate-rise delay-75 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E88]">
            <Users className="h-3.5 w-3.5 text-[#34D399]" /> Profiles
          </div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-[#F3F1EC]">
            {insights.totalProfiles}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="text-[11px] text-[#8E8E88]">Total Sessions</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-[#F3F1EC]">
            {insights.totalSessions}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="text-[11px] text-[#8E8E88]">Rated Debriefs</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-[#34D399]">
            {insights.completedDebriefs}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="text-[11px] text-[#8E8E88]">Explicit Success</div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-[#34D399]">
            {insights.globalSuccessRatePct}%
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1 text-[11px] text-[#8E8E88]">
            <TrendingUp className="h-3.5 w-3.5 text-[#34D399]" /> Avg Explicit Δ
          </div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-[#34D399]">
            {insights.globalAvgDelta >= 0 ? `+${insights.globalAvgDelta}` : insights.globalAvgDelta}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-1 text-[11px] text-[#8E8E88]">
            <FlaskConical className="h-3.5 w-3.5 text-[#F59E0B]" /> Exploration
          </div>
          <div className="font-mono-tech mt-2 text-2xl font-bold text-[#F59E0B]">
            {insights.explorationSharePct}%
          </div>
        </div>
      </div>

      {/* Implicit Behavioral Retention & D1/D7 Return Rate */}
      {ret && (
        <div className="animate-rise delay-100 glass-card rounded-2xl border border-emerald-400/20 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[#34D399]">
              <Activity className="h-5 w-5" />
              <h2 className="text-base font-semibold text-[#F3F1EC]">
                Implicit Retention &amp; Return Learning (Behavioral Telemetry · Weight 0.45)
              </h2>
            </div>
            <span className="font-mono-tech rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
              {ret.trackedSessions} tracked sessions · {ret.returningProfiles} returning profiles
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Even when listeners skip the 10-second debrief, consented sessions train the Bandit via
            listen completion (&gt;75%), early bounces (&lt;90s), instant genre swaps (&lt;60s), and
            real D1/D7 return bonuses. Locking your screen while listening is never penalized.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3.5">
              <div className="text-[11px] text-[#D4D4CE]">Avg Listen Retention</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-[#34D399]">
                {ret.avgListenRetentionPct}%
              </div>
              <div className="text-[10px] text-[#8E8E88]">of planned session</div>
            </div>

            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3.5">
              <div className="text-[11px] text-[#D4D4CE]">Completion (&ge;75%)</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-[#34D399]">
                {ret.completionRatePct}%
              </div>
              <div className="text-[10px] text-[#8E8E88]">strong retention signal</div>
            </div>

            <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3.5">
              <div className="text-[11px] text-amber-200/80">Early Bounce (&lt;90s)</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-[#F59E0B]">
                {ret.earlyBounceRatePct}%
              </div>
              <div className="text-[10px] text-[#8E8E88]">negative combo signal</div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-3.5">
              <div className="text-[11px] text-[#8E8E88]">Instant Swap (&lt;60s)</div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-[#D4D4CE]">
                {ret.instantSwapRatePct}%
              </div>
              <div className="text-[10px] text-[#8E8E88]">initial genre mismatch</div>
            </div>

            <div className="rounded-xl border border-white/12 bg-[#131519] p-3.5">
              <div className="flex items-center gap-1 text-[11px] text-[#D4D4CE]">
                <Repeat className="h-3 w-3 text-[#34D399]" /> D1 Return Rate
              </div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-[#F3F1EC]">
                {ret.d1ReturnRatePct}%
              </div>
              <div className="text-[10px] text-[#8E8E88]">came back 12h–36h</div>
            </div>

            <div className="rounded-xl border border-white/12 bg-[#131519] p-3.5">
              <div className="flex items-center gap-1 text-[11px] text-[#D4D4CE]">
                <Repeat className="h-3 w-3 text-[#F59E0B]" /> D7 Return Rate
              </div>
              <div className="font-mono-tech mt-1 text-2xl font-bold text-[#F3F1EC]">
                {ret.d7ReturnRatePct}%
              </div>
              <div className="text-[10px] text-[#8E8E88]">came back within 7d</div>
            </div>
          </div>
        </div>
      )}

      {/* Blind A/B Scientific Validation: Active 3-Band AM vs Pure-Music Control */}
      {insights.abValidation && (
        <div className="animate-rise delay-100 glass-card rounded-2xl border border-white/12 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[#F59E0B]">
              <FlaskConical className="h-5 w-5" />
              <h2 className="text-base font-semibold text-[#F3F1EC]">
                Scientific Validation · Active 3-Band AM vs. Pure-Music Control (Blind A/B)
              </h2>
            </div>
            <span
              className={`font-mono-tech rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                insights.abValidation.readyForStats
                  ? 'border-emerald-400/35 bg-emerald-500/12 text-[#34D399]'
                  : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
              }`}
            >
              {insights.abValidation.readyForStats
                ? 'Live A/B Signal Active'
                : 'Collecting Baseline (need ≥10 AM & ≥5 Control)'}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[#A3A39E]">
            12% of consented sessions run as blinded Pure-Music Controls (AM = 0%, identical studio
            audio &amp; EQ) so nootropic.fm measures both explicit cognitive Δ lift and real listen
            retention lift over music alone.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-4 space-y-1">
              <div className="text-[11px] font-medium text-[#D4D4CE]">
                Active 3-Band LR4 AM (n = {insights.abValidation.activeSessions})
              </div>
              <div className="font-mono-tech text-2xl font-bold text-[#34D399]">
                Δ{' '}
                {insights.abValidation.activeAvgDelta >= 0
                  ? `+${insights.abValidation.activeAvgDelta}`
                  : insights.abValidation.activeAvgDelta}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#8E8E88]">
                <span>{insights.abValidation.activeSuccessRatePct}% positive</span>
                <span className="font-mono-tech text-[#34D399]">
                  {insights.abValidation.activeListenRetentionPct}% retention
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 space-y-1">
              <div className="text-[11px] font-medium text-[#8E8E88]">
                Pure-Music Blind Control (n = {insights.abValidation.controlSessions})
              </div>
              <div className="font-mono-tech text-2xl font-bold text-[#D4D4CE]">
                Δ{' '}
                {insights.abValidation.controlAvgDelta >= 0
                  ? `+${insights.abValidation.controlAvgDelta}`
                  : insights.abValidation.controlAvgDelta}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#8E8E88]">
                <span>{insights.abValidation.controlSuccessRatePct}% positive</span>
                <span className="font-mono-tech text-[#D4D4CE]">
                  {insights.abValidation.controlListenRetentionPct}% retention
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-4 space-y-1">
              <div className="text-[11px] font-medium text-amber-200/80">
                Measured AM Lift (Δ AM − Δ Control)
              </div>
              <div
                className={`font-mono-tech text-2xl font-bold ${
                  insights.abValidation.deltaLift > 0
                    ? 'text-[#34D399]'
                    : insights.abValidation.deltaLift < 0
                      ? 'text-[#F59E0B]'
                      : 'text-[#D4D4CE]'
                }`}
              >
                {insights.abValidation.controlSessions === 0
                  ? 'Pending'
                  : insights.abValidation.deltaLift >= 0
                    ? `+${insights.abValidation.deltaLift}`
                    : insights.abValidation.deltaLift}
              </div>
              <div className="text-[11px] text-[#8E8E88]">
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
      <div className="animate-rise delay-150 glass-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 text-[#34D399]">
          <Brain className="h-5 w-5" />
          <h2 className="text-base font-semibold text-[#F3F1EC]">
            Your Personal Psychoacoustic Profile
          </h2>
        </div>

        {insights.personalArms.length === 0 ? (
          <p className="text-sm text-[#8E8E88]">
            No recorded trials on your profile yet. Run a session with consent enabled to watch the
            engine learn which protocol and vibe work best for your brain.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {insights.personalArms.map((arm) => (
              <div
                key={arm.armId}
                className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#F3F1EC]">{arm.armName}</span>
                  <span className="font-mono-tech text-sm font-bold text-[#34D399]">
                    {arm.successRatePct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#34D399]"
                    style={{ width: `${arm.successRatePct}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono-tech text-[11px] text-[#8E8E88]">
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
        <div className="animate-rise delay-225 glass-card rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 text-[#34D399]">
            <Music2 className="h-5 w-5" />
            <h2 className="text-base font-semibold text-[#F3F1EC]">
              Music Layer Performance (Studio Genres &amp; Custom Vibes × Outcomes)
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {insights.genreLeaderboard.map((g) => (
              <div
                key={g.genre}
                className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-sm font-semibold text-[#F3F1EC]">{g.label}</span>
                    {g.isCustom && (
                      <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-200">
                        Custom
                      </span>
                    )}
                  </div>
                  <span className="font-mono-tech text-sm font-bold text-[#34D399]">
                    {g.successRatePct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#34D399]"
                    style={{ width: `${g.successRatePct}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono-tech text-[11px] text-[#8E8E88]">
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
        <div className="animate-rise delay-225 glass-card rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 text-[#F59E0B]">
            <Layers className="h-5 w-5" />
            <h2 className="text-base font-semibold text-[#F3F1EC]">
              Top Learned Combinations (Archetype × Protocol × Genre)
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {insights.topArchetypeCombos.map((combo, idx) => (
              <div
                key={`${combo.cohortKey}_${combo.armName}_${combo.genreSlug}_${idx}`}
                className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[#F3F1EC]">{combo.cohortLabel}</div>
                    <div className="mt-0.5 text-[11px] text-[#34D399]">
                      {combo.armName} · <span className="text-[#F59E0B]">{combo.genreLabel}</span>
                    </div>
                  </div>
                  <span className="font-mono-tech shrink-0 rounded-lg bg-emerald-500/12 px-2 py-0.5 text-xs font-bold text-[#34D399]">
                    {combo.successRatePct}% fit
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono-tech text-[11px] text-[#8E8E88]">
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
      <div className="animate-rise delay-225 glass-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[#F3F1EC]">
            Collective Cohort Intelligence (Archetypes)
          </h2>
          <p className="text-xs text-[#8E8E88]">
            When a new user arrives in the same cohort (e.g., Age 35–44 · Driving · Alert Focus),
            the engine starts immediately with the top-performing protocol proven here.
          </p>
        </div>

        {insights.cohorts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/12 p-8 text-center text-sm text-[#8E8E88]">
            Database is ready. Complete your first session to see the first learned cohort appear in
            real time.
          </div>
        ) : (
          <div className="space-y-4">
            {insights.cohorts.map((cohort) => (
              <div
                key={cohort.cohortKey}
                className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[#F3F1EC]">{cohort.cohortLabel}</div>
                    <div className="font-mono-tech text-[11px] text-[#8E8E88]">
                      {cohort.cohortKey} · {cohort.completedSessions}/{cohort.totalSessions} rated
                      sessions · Leading protocol:{' '}
                      <span className="text-[#34D399]">{cohort.topArmName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 font-mono-tech text-xs">
                    <span className="rounded-lg bg-emerald-500/12 px-2.5 py-1 text-[#34D399]">
                      Success {cohort.successRatePct}%
                    </span>
                    <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[#F3F1EC]">
                      Δ {cohort.avgDelta >= 0 ? `+${cohort.avgDelta}` : cohort.avgDelta}
                    </span>
                  </div>
                </div>

                {cohort.arms.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {cohort.arms.map((arm) => (
                      <div
                        key={arm.armId}
                        className="rounded-lg border border-white/[0.08] bg-[#131519] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between font-medium text-[#F3F1EC]">
                          <span>{arm.armName}</span>
                          <span className="font-mono-tech text-[#34D399]">{arm.successRatePct}%</span>
                        </div>
                        <div className="mt-1 font-mono-tech text-[10px] text-[#8E8E88]">
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
          <h2 className="text-base font-semibold text-[#F3F1EC]">Recent Recorded Sessions (Anonymized)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 text-[#8E8E88]">
                <tr>
                  <th className="py-2 pr-3">Protocol &amp; Vibe</th>
                  <th className="py-2 pr-3">Transition</th>
                  <th className="py-2 pr-3">Parameters</th>
                  <th className="py-2 pr-3">Outcome &amp; Retention</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-[#D4D4CE]">
                {insights.recentSessions.map((s) => {
                  const genreMeta = getGenreDisplayMeta(s.customGenreSlug || s.musicGenre);
                  const retPct = Math.round((s.completionRatio ?? 0) * 100);
                  return (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-3 font-medium text-[#F3F1EC]">
                        <div>
                          {s.armName}
                          {s.safetyMode && (
                            <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                              Driving
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-normal text-[#8E8E88]">
                          {genreMeta.label}
                          {s.audioSource === 'community_cache' && (
                            <span className="ml-1 text-[#F59E0B]">· R2 Cache</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {STATE_LABELS[s.currentState]} → {TARGET_LABELS[s.targetState]}
                      </td>
                      <td className="font-mono-tech py-2.5 pr-3 text-[11px] text-[#34D399]">
                        {s.acousticParams.modulationHz}Hz · {s.acousticParams.bpm}BPM
                      </td>
                      <td className="font-mono-tech py-2.5 pr-3">
                        {s.status === 'completed' ? (
                          <span className="text-[#34D399]">
                            {s.baselineScore}→{s.postScore} (Δ{' '}
                            {(s.deltaScore ?? 0) >= 0 ? `+${s.deltaScore}` : s.deltaScore}) ·{' '}
                            {s.workedRating} · {retPct}%
                          </span>
                        ) : (
                          <span className="text-[#8E8E88]">
                            Listened {retPct}%
                            {s.retentionOutcome ? ` (${s.retentionOutcome.replace('_', ' ')})` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            s.status === 'completed'
                              ? 'bg-emerald-500/15 text-[#34D399]'
                              : s.status === 'abandoned'
                                ? 'bg-white/[0.06] text-[#8E8E88]'
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
            </>
          )}
        </>
      )}

      {/* Admin-Protected Dataset Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage my-auto w-full max-w-md rounded-2xl border border-white/15 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#34D399]">
                <Lock className="h-4 w-4" />
                <h3 className="text-base font-semibold text-[#F3F1EC]">Protected Research Export</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                aria-label="Close export modal"
                className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/10 hover:text-[#F3F1EC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-[#A3A39E]">
              Raw session datasets are protected with your Cloudflare Worker secret{' '}
              <code className="font-mono-tech text-[#34D399]">ADMIN_EXPORT_KEY</code> so only you can
              download the collected training data.
            </p>
            <div className="glow-input-wrap">
              <label htmlFor="insights-admin-key" className="sr-only">
                Researcher Admin Key
              </label>
              <input
                id="insights-admin-key"
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Enter ADMIN_EXPORT_KEY..."
                className="w-full rounded-[0.8rem] bg-[#0B0C0E] px-4 py-3 text-sm text-[#F3F1EC] placeholder-[#5F605C] focus:outline-none"
              />
            </div>
            {exportStatus && (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {exportStatus}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleAdminExport('json')}
                className="btn-aurora inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download JSON
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleAdminExport('csv')}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#14161A] px-4 py-2.5 text-xs font-semibold text-[#F3F1EC] hover:border-emerald-400/50 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5 text-[#34D399]" />
                Download CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
