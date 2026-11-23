import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Cpu,
  ExternalLink,
  FlaskConical,
  Loader2,
  Music2,
  Play,
  Plus,
  Radio,
  Search,
  ShieldAlert,
  Sparkles,
  Waves,
} from 'lucide-react';
import { getGenreDisplayMeta, sanitizeCustomVibe } from '../../shared/promptComposer';
import type { ProtocolRecommendation, ResolvedGenre, UserProfile } from '../../shared/types';
import {
  DEVICE_LABELS,
  ENERGY_LABELS,
  GENRE_META,
  STATE_LABELS,
  TARGET_LABELS,
  formatProfileSummary,
} from '../../shared/types';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';
import { StudyFidelityMatrix } from './StudyFidelityMatrix';

interface ProtocolRevealViewProps {
  loading: boolean;
  recommendation: ProtocolRecommendation | null;
  profile?: UserProfile | null;
  mood: FieldMood;
  customLiveGenAvailable?: boolean;
  onSwapGenre: (genre: ResolvedGenre) => void;
  onSwapCustomVibe: (customLabel: string) => void | Promise<void>;
  onLaunchAudio: () => void;
  onOpenStudyLab?: () => void;
  onBack: () => void;
}

const SOURCE_BADGES = {
  generative_live: {
    label: 'Live Generative · Study-Locked ($0)',
    cls: 'border-cyan-400/45 bg-cyan-400/14 text-cyan-100',
  },
  studio_library: {
    label: 'Instant Studio Library · R2 ($0)',
    cls: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-200',
  },
  community_cache: {
    label: 'Community R2 Cache · Instant',
    cls: 'border-cyan-400/40 bg-cyan-400/12 text-cyan-200',
  },
  live_generating: {
    label: '2-Speed · Instant Start → Custom Crossfade',
    cls: 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200',
  },
  lyria_realtime: {
    label: 'Google Lyria RealTime · Live WebSocket',
    cls: 'border-purple-400/45 bg-purple-500/15 text-purple-100',
  },
  pure_stimulus: {
    label: 'Pure Acoustic Signal · Zero Music',
    cls: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
  },
  procedural_fallback: {
    label: 'Real-Time DSP Fallback',
    cls: 'border-slate-700 bg-slate-900 text-slate-300',
  },
};

/**
 * Lightweight animated SVG wave showing the exact Layer 1 cortical modulation rhythm
 * so the listener can visually see the scientific signal before pressing Play.
 */
function SoundWavePreview({
  modulationHz,
  modulationDepth,
  safetyMode,
}: {
  modulationHz: number;
  modulationDepth: number;
  safetyMode: boolean;
}) {
  const cycles = Math.max(4, Math.min(18, Math.round(modulationHz)));
  const amp = Math.max(8, Math.min(20, Math.round(modulationDepth * 42)));
  const points: string[] = [];
  const totalPts = 96;
  for (let i = 0; i <= totalPts; i++) {
    const x = (i / totalPts) * 320;
    const t = i / totalPts;
    const envelope = Math.sin(Math.PI * t);
    const y = 26 + Math.sin(t * Math.PI * 2 * cycles) * amp * (0.45 + 0.55 * envelope);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const strokeColor = safetyMode ? '#fbbf24' : '#22d3ee';

  return (
    <div className="rounded-xl border border-cyan-400/20 bg-[#04070f]/90 px-3 py-2">
      <div className="mb-1 flex items-center justify-between font-mono-tech text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1 text-cyan-300">
          <Activity className="h-3 w-3" />
          Live DSP Envelope Preview
        </span>
        <span>
          {modulationHz} Hz AM · {Math.round(modulationDepth * 100)}% depth
        </span>
      </div>
      <svg viewBox="0 0 320 52" className="h-11 w-full overflow-visible">
        <line x1="0" y1="26" x2="320" y2="26" stroke="rgba(148,163,184,0.16)" strokeDasharray="3 3" />
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.join(' ')}
          className="animate-pulse"
        />
      </svg>
    </div>
  );
}

export function ProtocolRevealView({
  loading,
  recommendation,
  profile,
  mood,
  customLiveGenAvailable,
  onSwapGenre,
  onSwapCustomVibe,
  onLaunchAudio,
  onOpenStudyLab,
  onBack,
}: ProtocolRevealViewProps) {
  const [showCustomSwap, setShowCustomSwap] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showFormulaFacts, setShowFormulaFacts] = useState(false);

  // Live conversational "Thinking & Searching Studies" state machine (runs once per unique sessionId)
  const [revealedSessionId, setRevealedSessionId] = useState<string | null>(null);
  const [thoughtStep, setThoughtStep] = useState(0);

  useEffect(() => {
    if (loading || !recommendation) {
      setThoughtStep(0);
      const t = window.setTimeout(() => setThoughtStep(1), 550);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [loading, recommendation === null]);

  const currentSessionId = recommendation?.sessionId ?? null;
  const isRevealed = Boolean(!loading && currentSessionId && revealedSessionId === currentSessionId);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    const raf = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(raf);
  }, [loading, isRevealed, currentSessionId]);

  useEffect(() => {
    if (loading || !currentSessionId || revealedSessionId === currentSessionId) return;

    const timers: number[] = [];
    timers.push(window.setTimeout(() => setThoughtStep((s) => Math.max(s, 1)), 250));
    timers.push(window.setTimeout(() => setThoughtStep(2), 1000));
    timers.push(window.setTimeout(() => setThoughtStep(3), 1950));
    timers.push(
      window.setTimeout(() => {
        setRevealedSessionId(currentSessionId);
      }, 2900)
    );

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [loading, currentSessionId, revealedSessionId]);

  const profileLine = profile
    ? `${profile.displayName ? `${profile.displayName} · ` : ''}${formatProfileSummary(profile)}`
    : recommendation?.cohortLabel ?? 'Your Neural Profile';

  // =========================================================================
  // STAGE 1: LIVE THINKING & SCIENTIFIC PROTOCOL SEARCH (~2.9s, skippable)
  // =========================================================================
  if (loading || !recommendation || !isRevealed) {
    const coreStudies = recommendation?.studies ?? [];
    const livePapers = recommendation?.livePubMedPapers ?? [];
    const totalFound = coreStudies.length + livePapers.length;
    const readyGenre = recommendation
      ? getGenreDisplayMeta(
          recommendation.customGenreSlug ?? recommendation.params.genre,
          recommendation.customGenreLabel
        ).label
      : null;

    const traceSteps = [
      {
        idx: 0,
        title: 'Analyzing your identity, neural coordinates & goal',
        detail: recommendation
          ? `${profileLine} · ${
              recommendation.microStateLabel ?? STATE_LABELS[recommendation.currentState].split(' ')[0]
            }${
              typeof recommendation.arousalPct === 'number' && typeof recommendation.clarityPct === 'number'
                ? ` (${recommendation.arousalPct}% Energy · ${recommendation.clarityPct}% Clarity)`
                : ''
            } → ${TARGET_LABELS[recommendation.targetState]} for ${recommendation.plannedDurationMin} min`
          : 'Mapping your profile, arousal × clarity coordinates & target state...',
      },
      {
        idx: 1,
        title: 'Searching peer-reviewed protocols (NIH PubMed & OpenAlex)',
        detail:
          recommendation && thoughtStep >= 2
            ? `Found ${totalFound} verified peer-reviewed studies (${coreStudies.length} core DSP DOIs${
                livePapers.length > 0 ? ` + ${livePapers.length} live PubMed/OpenAlex papers` : ''
              })`
            : 'Scanning peer-reviewed acoustic archives for real DOI & PubMed mechanisms...',
      },
      {
        idx: 2,
        title: 'Designing the exact sounds from those studies',
        detail:
          recommendation && thoughtStep >= 2
            ? `${recommendation.arm.name}: ${recommendation.params.modulationHz} Hz AM (${recommendation.params.crossoverHz}–${((recommendation.params.upperCrossoverHz ?? 4500) / 1000).toFixed(1)} kHz) · ${
                recommendation.params.bpm > 0 ? `${recommendation.params.bpm} BPM` : 'Beatless Ambient'
              } · ${recommendation.params.noiseColor} noise (${Math.round(recommendation.params.noiseLevel * 100)}%)`
            : 'Translating cortical entrainment findings into real-time Web Audio DSP rules...',
      },
      {
        idx: 3,
        title: 'Fusing Layer 1 (Science) + Layer 2 (Your Music)',
        detail:
          recommendation && readyGenre
            ? `Routing ${readyGenre} cleanly through the 3-Band LR4 acoustic matrix...`
            : 'Preparing your personalized 2-layer audio formula...',
      },
    ];

    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-6 sm:py-10 space-y-6">
        <div className="flex flex-col items-center text-center">
          <SonicOrb mood={mood} size="lg" label="Thinking..." />
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/[0.08] px-3 py-1 text-[11px] font-medium text-cyan-200">
            <Search className="h-3.5 w-3.5 animate-pulse text-cyan-300" />
            nootropic.fm · Searching Scientific Protocols
          </div>
          <h1 className="animate-rise mt-3 text-2xl font-bold text-white sm:text-3xl">
            Give me a moment — <span className="text-aurora">searching the science for you...</span>
          </h1>
        </div>

        {/* Live Conversational Research Trace */}
        <div className="animate-step glass-stage w-full rounded-3xl border border-cyan-400/25 p-5 sm:p-6 space-y-3.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono-tech uppercase tracking-[0.16em] text-cyan-300/85">
              Live Research Trace
            </span>
            {recommendation && (
              <button
                type="button"
                onClick={() => setRevealedSessionId(recommendation.sessionId)}
                className="text-slate-400 transition hover:text-cyan-200"
              >
                Skip →
              </button>
            )}
          </div>

          <div className="space-y-3">
            {traceSteps.map((st) => {
              const isDone = thoughtStep > st.idx && (st.idx === 0 || Boolean(recommendation));
              const isActive = thoughtStep === st.idx;
              const isWaiting = thoughtStep < st.idx;

              return (
                <div
                  key={st.idx}
                  className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 transition-all duration-300 ${
                    isDone
                      ? 'border-emerald-400/25 bg-emerald-500/[0.05]'
                      : isActive
                        ? 'border-cyan-400/45 bg-cyan-400/[0.08] shadow-[0_0_20px_rgba(34,211,238,0.12)]'
                        : 'border-slate-800/70 bg-slate-950/40 opacity-45'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isDone ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : isActive ? (
                      <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 text-[10px] text-slate-500">
                        {st.idx + 1}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div
                      className={`text-xs font-semibold ${
                        isWaiting ? 'text-slate-500' : 'text-white'
                      }`}
                    >
                      {st.title}
                    </div>
                    <div className="text-[11px] leading-relaxed text-slate-400">{st.detail}</div>

                    {/* Real discovered study chips lighting up in Step 2 */}
                    {st.idx === 1 && recommendation && thoughtStep >= 2 && (
                      <div className="animate-step flex flex-wrap gap-1.5 pt-1">
                        {coreStudies.slice(0, 3).map((s) => (
                          <span
                            key={s.id}
                            className="font-mono-tech rounded-md border border-cyan-400/30 bg-slate-950/80 px-2 py-0.5 text-[10px] text-cyan-200"
                          >
                            {s.authors.split(',')[0]} ({s.year})
                          </span>
                        ))}
                        {livePapers.slice(0, 2).map((p) => (
                          <span
                            key={p.pmid}
                            className="font-mono-tech rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200"
                          >
                            {p.source === 'openalex' ? 'OpenAlex' : 'PubMed'} ({p.year})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // STAGE 2: "WOW" SCIENCE-FIRST BLUEPRINT REVEAL
  // Order: 1) Studies Found -> 2) Exact Sounds Generated (Layer 1 + Layer 2) -> 3) Apply & Play CTA
  // =========================================================================
  const activeGenreDisplay = getGenreDisplayMeta(
    recommendation.customGenreSlug ?? recommendation.params.genre,
    recommendation.customGenreLabel
  );
  const energyInfo = ENERGY_LABELS[recommendation.params.energyTier];
  const livePapers = recommendation.livePubMedPapers ?? [];
  const totalStudiesCount = recommendation.studies.length + livePapers.length;
  const upperKhz = ((recommendation.params.upperCrossoverHz ?? 4500) / 1000).toFixed(1);
  const sourceBadge = SOURCE_BADGES[recommendation.audioSource] ?? SOURCE_BADGES.studio_library;
  const entryMin = Math.max(1, Math.round(recommendation.plannedDurationMin * 0.15));
  const landingMin = Math.max(1, Math.round(recommendation.plannedDurationMin * 0.12));
  const peakMin = Math.max(1, recommendation.plannedDurationMin - entryMin - landingMin);

  const applyCustomSwap = async (): Promise<boolean> => {
    const check = sanitizeCustomVibe(customDraft);
    if (!check || check.rejectedReason) {
      setCustomError(check?.rejectedReason ?? 'Enter a valid instrumental genre (e.g., chill reggae).');
      return false;
    }
    setCustomError(null);
    await onSwapCustomVibe(check.displayLabel);
    setShowCustomSwap(false);
    setCustomDraft('');
    return true;
  };

  const handleLaunchClick = async () => {
    if (showCustomSwap && customDraft.trim()) {
      const ok = await applyCustomSwap();
      if (!ok) return;
    }
    onLaunchAudio();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Conversational WOW Header */}
      <div className="animate-rise text-center space-y-2.5">
        <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-3.5 py-1 text-[11px] font-semibold text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          Research Complete · {totalStudiesCount} Verified Studies Matched · {profileLine}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-4xl">
          Here’s what the science found
          {profile?.displayName ? (
            <>
              {' '}
              for <span className="text-aurora">{profile.displayName}.</span>
            </>
          ) : (
            <>
              {' '}
              <span className="text-aurora">for you.</span>
            </>
          )}
        </h1>
        <p className="mx-auto max-w-xl text-xs leading-relaxed text-slate-300 sm:text-sm">
          To guide you from{' '}
          <strong>
            {recommendation.microStateLabel ?? STATE_LABELS[recommendation.currentState].split(' ')[0]}
          </strong>{' '}
          to <strong className="text-cyan-200">{TARGET_LABELS[recommendation.targetState]}</strong> for{' '}
          <strong>{recommendation.plannedDurationMin} minutes</strong>, here are the peer-reviewed
          studies I matched and the exact sound layers I will generate for you.
        </p>
      </div>

      {/* Driving Safety Notice */}
      {recommendation.safetyMode && (
        <div className="animate-rise rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-xs text-amber-100">
              <div className="font-semibold uppercase tracking-wide text-amber-300">
                Driving Safety Mode Applied Automatically
              </div>
              <p className="text-amber-100/90">{recommendation.safetyWarnings[0]}</p>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* BLOCK 1: VERIFIED STUDIES FOUND FIRST (Core DOIs + Live PubMed)   */}
      {/* ================================================================= */}
      <div className="animate-rise glass-card rounded-3xl border border-cyan-400/25 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-cyan-300">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-base font-bold text-white">
              1. Peer-Reviewed Studies Found ({totalStudiesCount} verified sources)
            </h2>
          </div>
          <span className="font-mono-tech rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
            Click any study to verify
          </span>
        </div>

        {/* Core Acoustic Science Studies */}
        <div className="space-y-2.5">
          {recommendation.studies.map((study, idx) => (
            <div
              key={study.id}
              style={{ animationDelay: `${idx * 80}ms` }}
              className="animate-rise rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 space-y-2 transition hover:border-cyan-400/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-cyan-300">
                    {study.authors.split(',')[0]} et al. ({study.year}) · {study.journal}
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-white">{study.title}</div>
                </div>
                <a
                  href={study.doiOrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/20"
                >
                  Open Paper
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/8 px-3 py-2 text-xs text-cyan-100">
                <Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                <span>
                  <strong className="text-cyan-200">Sound generated from this study:</strong>{' '}
                  {study.soundEffect}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Live Matched NIH PubMed & OpenAlex Papers */}
        {livePapers.length > 0 && (
          <div className="space-y-2.5 border-t border-slate-800/80 pt-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              <Cpu className="h-3.5 w-3.5" />
              Live Matched Literature (NIH PubMed &amp; OpenAlex)
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {livePapers.map((p, idx) => (
                <a
                  key={p.pmid}
                  href={p.doiUrl || p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${(idx + recommendation.studies.length) * 80}ms` }}
                  className="animate-rise group flex flex-col justify-between rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.04] p-3.5 space-y-2 transition hover:border-emerald-400/55"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-emerald-300">
                      <span className="font-mono-tech uppercase">
                        {p.source === 'openalex' ? 'OpenAlex · DOI' : `NIH PubMed · ${p.pmid}`} · {p.year}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-500 group-hover:text-emerald-300" />
                    </div>
                    <div className="mt-1 text-xs font-semibold leading-snug text-white group-hover:text-emerald-100">
                      {p.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {p.authors} · {p.journal}
                    </div>
                  </div>
                  {p.appliedMechanism && (
                    <div className="rounded-lg bg-slate-950/80 px-2.5 py-1.5 text-[11px] text-cyan-200/90">
                      <strong className="text-cyan-300">→ Applied:</strong> {p.appliedMechanism}
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Executable Study-to-Sound Fidelity Matrix */}
        {recommendation.executableSpec && (
          <div className="space-y-2.5 border-t border-slate-800/80 pt-3.5">
            <StudyFidelityMatrix spec={recommendation.executableSpec} compact />
            {onOpenStudyLab && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onOpenStudyLab}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-400/8 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:border-cyan-400/55 hover:bg-cyan-400/16"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  <span>Want to execute a different PubMed / DOI study? Open Study Lab →</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* BLOCK 2: EXACT SOUNDS GENERATED & FUSED (LAYER 1 + LAYER 2)       */}
      {/* ================================================================= */}
      <div className="animate-rise delay-75 space-y-2">
        <div className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          2. Exact Sound Architecture I Will Generate &amp; Fuse Live
        </div>

        {/* LAYER 1: SCIENTIFIC SIGNAL + WAVE PREVIEW */}
        <div className="glass-stage rounded-3xl border border-cyan-400/30 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tech rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                Layer 1 · Scientific Audio DSP
              </span>
              <span className="text-sm font-bold text-white">{recommendation.arm.name}</span>
            </div>
            <span className="font-mono-tech text-[11px] text-cyan-300">
              {recommendation.params.modulationHz} Hz AM · {recommendation.params.crossoverHz}Hz–{upperKhz}kHz
            </span>
          </div>

          <SoundWavePreview
            modulationHz={recommendation.params.modulationHz}
            modulationDepth={recommendation.params.modulationDepth}
            safetyMode={recommendation.safetyMode}
          />

          {/* Exact Sound Parameter Pills */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Cortical AM</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-cyan-300">
                {recommendation.params.modulationHz} Hz
              </div>
              <div className="text-[10px] text-slate-400">3-Band LR4 clean sub</div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Pulse Tempo</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-white">
                {recommendation.params.bpm > 0 ? `${recommendation.params.bpm} BPM` : 'Ambient'}
              </div>
              <div className="text-[10px] text-slate-400">{energyInfo.label}</div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Noise Floor</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-indigo-200 capitalize">
                {recommendation.params.noiseColor.replace('_', ' ')}
              </div>
              <div className="text-[10px] text-slate-400">
                {Math.round(recommendation.params.noiseLevel * 100)}% stochastic mask
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Iso-Arc</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-emerald-300">
                {entryMin}m → {peakMin}m → {landingMin}m
              </div>
              <div className="text-[10px] text-slate-400">Entry · Peak · Land</div>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-300">{recommendation.rationale}</p>

          {recommendation.personalizationSummary && recommendation.personalizationSummary.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {recommendation.personalizationSummary.map((item) => (
                <span
                  key={item}
                  className="rounded-lg border border-slate-800 bg-slate-950/75 px-2.5 py-1 text-slate-200"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Glowing "+" Fusion Connector */}
        <div className="relative flex items-center justify-center py-0.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-[#070b15] px-4 py-1 text-[11px] font-semibold text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.22)]">
            <Plus className="h-3.5 w-3.5 text-cyan-300" />
            Fused live in real time with your favorite music
          </div>
        </div>

        {/* LAYER 2: PREFERRED MUSIC CARRIER */}
        <div className="glass-stage rounded-3xl border border-indigo-400/30 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tech rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-200">
                Layer 2 · Your Preferred Music
              </span>
              <span className="text-sm font-bold text-white">{activeGenreDisplay.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${sourceBadge.cls}`}>
                <Radio className="h-3 w-3" />
                {sourceBadge.label}
              </span>
              <span className="font-mono-tech rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-indigo-200">
                {DEVICE_LABELS[recommendation.device]}
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-300">
            Preferred lyric-free aesthetics trigger striatal dopamine release (<em>Salimpoor et al. 2011</em>),
            sustaining attention while verbal working memory stays completely clear (<em>Perham &amp; Currie 2014</em>).
          </p>

          {recommendation.genreAdaptationNote && (
            <div className="flex items-start gap-2.5 rounded-xl border border-indigo-400/35 bg-indigo-500/10 p-3 text-xs text-indigo-100">
              <Music2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              <span>{recommendation.genreAdaptationNote}</span>
            </div>
          )}

          {recommendation.composedMusicPrompt && (
            <div>
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
              >
                <span>Inspect scientific instrumental prompt for {activeGenreDisplay.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition ${showPrompt ? 'rotate-180' : ''}`} />
              </button>
              {showPrompt && (
                <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3 font-mono-tech text-[11px] leading-relaxed text-slate-300">
                  {recommendation.composedMusicPrompt}
                </div>
              )}
            </div>
          )}

          {/* 1-Tap Layer 2 Swap */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-slate-400">
              Want a different music layer? Swap in 1 tap before playing:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(GENRE_META) as ResolvedGenre[]).map((g) => {
                const active = !recommendation.customGenreSlug && recommendation.params.genre === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setShowCustomSwap(false);
                      onSwapGenre(g);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-indigo-400 bg-indigo-500/25 text-white shadow-[0_0_16px_rgba(129,140,248,0.28)]'
                        : 'subtle-chip'
                    }`}
                  >
                    {GENRE_META[g].label}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setShowCustomSwap((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  recommendation.customGenreSlug || showCustomSwap
                    ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100'
                    : 'border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-200 hover:border-fuchsia-400/60'
                }`}
              >
                <Plus className="h-3 w-3" />
                {recommendation.customGenreLabel ? `Custom: ${recommendation.customGenreLabel}` : 'Custom vibe'}
              </button>
            </div>

            {showCustomSwap && (
              <div className="animate-step flex flex-col gap-2 pt-1 sm:flex-row">
                <input
                  type="text"
                  value={customDraft}
                  onChange={(e) => {
                    setCustomDraft(e.target.value);
                    setCustomError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyCustomSwap();
                  }}
                  placeholder="e.g. reggae, synthwave, bossa nova, rain..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void applyCustomSwap()}
                  className="rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/20 px-4 py-2 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/30"
                >
                  Apply Vibe
                </button>
              </div>
            )}
            {customError && <p className="text-[11px] text-rose-300">{customError}</p>}
            {showCustomSwap && !customLiveGenAvailable && (
              <p className="text-[10px] text-slate-500">
                Checks Community R2 Cache first; uncached vibes start smoothly on our closest studio match.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BLOCK 3: APPLY LAYERS & PLAY CTA (+ Expandable Formula Facts)     */}
      {/* ================================================================= */}
      <div className="animate-rise delay-150 glass-stage rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-4 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white w-full sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            Adjust
          </button>
          <button
            type="button"
            onClick={() => void handleLaunchClick()}
            className="btn-aurora flex flex-1 w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-base font-bold text-slate-950"
          >
            <Play className="h-5 w-5 fill-slate-950" />
            Apply Layers &amp; Tune My Mind ({recommendation.plannedDurationMin} min ·{' '}
            {activeGenreDisplay.label})
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-purple-400" />
            {recommendation.ephemeralMode
              ? 'Local-Only Mode (Zero Remote Tracking)'
              : recommendation.isExploration
                ? 'Bandit Mode: Controlled Exploration Trial'
                : `Bandit Mode: ${recommendation.confidencePct}% Cohort Fit (${recommendation.cohortTrials} trials)`}
          </span>
          <button
            type="button"
            onClick={() => setShowFormulaFacts((v) => !v)}
            className="inline-flex items-center gap-1 font-medium text-cyan-300 hover:text-cyan-200"
          >
            <span>Full Audio Formula Facts</span>
            <ChevronDown className={`h-3.5 w-3.5 transition ${showFormulaFacts ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showFormulaFacts && (
          <div className="animate-step overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#050812]/90">
            <div className="divide-y divide-slate-800/80">
              {recommendation.formulaIngredients.map((ing) => (
                <div
                  key={ing.role}
                  className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-12 sm:items-center sm:gap-2"
                >
                  <div className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:col-span-3">
                    {ing.role}
                  </div>
                  <div className="text-xs font-semibold text-white sm:col-span-4">{ing.compound}</div>
                  <div className="font-mono-tech text-xs text-cyan-300 sm:col-span-3">{ing.dose}</div>
                  <div className="text-[10px] text-slate-400 sm:col-span-2 sm:text-right">
                    {ing.evidenceTag}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
