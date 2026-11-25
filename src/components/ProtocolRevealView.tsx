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
  Waves,
} from 'lucide-react';
import { getGenreDisplayMeta } from '../../shared/promptComposer';
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
    label: 'Live Synth · Study-Locked',
    cls: 'border-emerald-400/35 bg-emerald-500/10 text-[#34D399]',
  },
  studio_library: {
    label: 'Studio Mix',
    cls: 'border-white/15 bg-[#16181C] text-[#F3F1EC]',
  },
  community_cache: {
    label: 'Studio Mix · Instant',
    cls: 'border-white/15 bg-[#16181C] text-[#F3F1EC]',
  },
  live_generating: {
    label: 'Custom Track · Blending In',
    cls: 'border-amber-400/35 bg-amber-500/10 text-amber-200',
  },
  lyria_realtime: {
    label: 'Endless Stream · Live',
    cls: 'border-emerald-400/40 bg-emerald-500/12 text-[#34D399]',
  },
  pure_stimulus: {
    label: 'Pure Signal · Zero Music',
    cls: 'border-amber-400/35 bg-amber-500/10 text-amber-200',
  },
  procedural_fallback: {
    label: 'Real-Time DSP',
    cls: 'border-white/10 bg-[#141518] text-[#A3A39E]',
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
  const strokeColor = safetyMode ? '#F59E0B' : '#34D399';

  return (
    <div className="rounded-xl border border-white/10 bg-[#070809] px-3 py-2">
      <div className="mb-1 flex items-center justify-between font-mono-tech text-[10px] text-[#8E8E88]">
        <span className="inline-flex items-center gap-1 text-[#34D399]">
          <Activity className="h-3 w-3" />
          Live DSP Envelope Preview
        </span>
        <span>
          {modulationHz} Hz AM · {Math.min(98, Math.round(modulationDepth * 172))}% effect
        </span>
      </div>
      <svg viewBox="0 0 320 52" className="h-11 w-full overflow-visible">
        <line x1="0" y1="26" x2="320" y2="26" stroke="rgba(255,255,255,0.09)" strokeDasharray="3 3" />
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.join(' ')}
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
  onSwapGenre,
  onLaunchAudio,
  onOpenStudyLab,
  onBack,
}: ProtocolRevealViewProps) {
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
            } → ${recommendation.customGoalLabel || TARGET_LABELS[recommendation.targetState]} for ${recommendation.plannedDurationMin} min`
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
          <SonicOrb mood={mood} size="lg" label="Matching Acoustic Studies" />
          <div className="mt-4 inline-flex items-center gap-2 font-mono-tech text-[11px] uppercase tracking-[0.14em] text-[#8E8E88]">
            <Search className="h-3.5 w-3.5 text-[#34D399]" />
            Searching Scientific Protocols
          </div>
          <h1 className="animate-rise mt-2 text-2xl font-semibold text-[#F3F1EC] sm:text-3xl">
            Matching peer-reviewed acoustics <span className="text-[#34D399]">for your state...</span>
          </h1>
        </div>

        {/* Live Conversational Research Trace */}
        <div className="animate-step glass-stage w-full rounded-2xl p-5 sm:p-6 space-y-3.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono-tech uppercase tracking-[0.14em] text-[#34D399]">
              Live Research Trace
            </span>
            {recommendation && (
              <button
                type="button"
                onClick={() => setRevealedSessionId(recommendation.sessionId)}
                className="text-[#A3A39E] transition hover:text-[#F3F1EC]"
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
                  className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-all duration-300 ${
                    isDone
                      ? 'border-emerald-400/30 bg-emerald-500/[0.06]'
                      : isActive
                        ? 'border-white/25 bg-[#16181C]'
                        : 'border-white/[0.06] bg-[#0B0C0E] opacity-50'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isDone ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-[#34D399]">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : isActive ? (
                      <Loader2 className="h-5 w-5 animate-spin text-[#34D399]" />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/15 text-[10px] text-[#7E7E78]">
                        {st.idx + 1}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div
                      className={`text-xs font-semibold ${
                        isWaiting ? 'text-[#7E7E78]' : 'text-[#F3F1EC]'
                      }`}
                    >
                      {st.title}
                    </div>
                    <div className="text-[11px] leading-relaxed text-[#A3A39E]">{st.detail}</div>

                    {/* Real discovered study chips lighting up in Step 2 */}
                    {st.idx === 1 && recommendation && thoughtStep >= 2 && (
                      <div className="animate-step flex flex-wrap gap-1.5 pt-1">
                        {coreStudies.slice(0, 3).map((s) => (
                          <span
                            key={s.id}
                            className="font-mono-tech rounded border border-white/12 bg-[#111215] px-2 py-0.5 text-[10px] text-[#D4D4CE]"
                          >
                            {s.authors.split(',')[0]} ({s.year})
                          </span>
                        ))}
                        {livePapers.slice(0, 2).map((p) => (
                          <span
                            key={p.pmid}
                            className="font-mono-tech rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-[#34D399]"
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

  const handleLaunchClick = () => {
    onLaunchAudio();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Studio Blueprint Header */}
      <div className="animate-rise text-center space-y-2.5">
        <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
          Research Complete · {totalStudiesCount} Verified Studies Matched · {profileLine}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#F3F1EC] sm:text-4xl">
          Here is the acoustic blueprint
          {profile?.displayName ? (
            <>
              {' '}
              for <span className="text-[#34D399]">{profile.displayName}.</span>
            </>
          ) : (
            <>
              {' '}
              <span className="text-[#34D399]">matched to your state.</span>
            </>
          )}
        </h1>
        <p className="mx-auto max-w-xl text-xs leading-relaxed text-[#A3A39E] sm:text-sm">
          To guide you from{' '}
          <strong className="text-[#F3F1EC]">
            {recommendation.microStateLabel ?? STATE_LABELS[recommendation.currentState].split(' ')[0]}
          </strong>{' '}
          to{' '}
          <strong className="text-[#34D399]">
            {recommendation.customGoalLabel || TARGET_LABELS[recommendation.targetState]}
          </strong>{' '}
          for{' '}
          <strong className="text-[#F3F1EC]">{recommendation.plannedDurationMin} minutes</strong>, below
          are the peer-reviewed studies and exact audio synthesis parameters ready for playback.
        </p>
      </div>

      {/* Driving Safety Notice */}
      {recommendation.safetyMode && (
        <div className="animate-rise rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
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
      <div className="animate-rise glass-card rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[#34D399]">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-base font-semibold text-[#F3F1EC]">
              1. Peer-Reviewed Studies Found ({totalStudiesCount} verified sources)
            </h2>
          </div>
          <span className="font-mono-tech rounded border border-white/12 bg-[#141518] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#A3A39E]">
            Click any study to verify
          </span>
        </div>

        {/* Core Acoustic Science Studies */}
        <div className="space-y-2.5">
          {recommendation.studies.map((study, idx) => (
            <div
              key={study.id}
              style={{ animationDelay: `${idx * 80}ms` }}
              className="animate-rise rounded-xl border border-white/[0.08] bg-[#131417] p-4 space-y-2 transition hover:border-emerald-400/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[#34D399]">
                    {study.authors.split(',')[0]} et al. ({study.year}) · {study.journal}
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-[#F3F1EC]">{study.title}</div>
                </div>
                <a
                  href={study.doiOrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-[#181A1F] px-2.5 py-1 text-[11px] font-semibold text-[#D4D4CE] hover:border-emerald-400/50 hover:text-[#F3F1EC]"
                >
                  Open Paper
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-[#0B0C0E] px-3 py-2 text-xs text-[#D4D4CE]">
                <Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                <span>
                  <strong className="text-[#34D399]">Sound generated from this study:</strong>{' '}
                  {study.soundEffect}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Live Matched NIH PubMed & OpenAlex Papers */}
        {livePapers.length > 0 && (
          <div className="space-y-2.5 border-t border-white/[0.08] pt-3.5">
            <div className="flex items-center gap-1.5 font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#34D399]">
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
                  className="animate-rise group flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#131417] p-3.5 space-y-2 transition hover:border-emerald-400/45"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-[#34D399]">
                      <span className="font-mono-tech uppercase">
                        {p.source === 'openalex' ? 'OpenAlex · DOI' : `NIH PubMed · ${p.pmid}`} · {p.year}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-[#7E7E78] group-hover:text-[#34D399]" />
                    </div>
                    <div className="mt-1 text-xs font-semibold leading-snug text-[#F3F1EC] group-hover:text-white">
                      {p.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#8E8E88]">
                      {p.authors} · {p.journal}
                    </div>
                  </div>
                  {p.appliedMechanism && (
                    <div className="rounded-lg bg-[#0B0C0E] px-2.5 py-1.5 text-[11px] text-[#D4D4CE]">
                      <strong className="text-[#34D399]">→ Applied:</strong> {p.appliedMechanism}
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Executable Study-to-Sound Fidelity Matrix */}
        {recommendation.executableSpec && (
          <div className="space-y-2.5 border-t border-white/[0.08] pt-3.5">
            <StudyFidelityMatrix spec={recommendation.executableSpec} compact />
            {onOpenStudyLab && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onOpenStudyLab}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#16181C] px-3 py-1.5 text-[11px] font-semibold text-[#D4D4CE] transition hover:border-emerald-400/50 hover:text-[#F3F1EC]"
                >
                  <FlaskConical className="h-3.5 w-3.5 text-[#34D399]" />
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
        <div className="px-1 font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#8E8E88]">
          2. Exact Sound Architecture Generated &amp; Fused Live
        </div>

        {/* LAYER 1: SCIENTIFIC SIGNAL + WAVE PREVIEW */}
        <div className="glass-stage rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tech rounded border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#34D399]">
                Layer 1 · Acoustic DSP
              </span>
              <span className="text-sm font-semibold text-[#F3F1EC]">{recommendation.arm.name}</span>
            </div>
            <span className="font-mono-tech text-[11px] text-[#34D399]">
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
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Cortical AM</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-[#34D399]">
                {recommendation.params.modulationHz} Hz
              </div>
              <div className="text-[10px] text-[#8E8E88]">3-Band LR4 clean sub</div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Pulse Tempo</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-[#F3F1EC]">
                {recommendation.params.bpm > 0 ? `${recommendation.params.bpm} BPM` : 'Ambient'}
              </div>
              <div className="text-[10px] text-[#8E8E88]">{energyInfo.label}</div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Noise Floor</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-[#D4D4CE] capitalize">
                {recommendation.params.noiseColor.replace('_', ' ')}
              </div>
              <div className="text-[10px] text-[#8E8E88]">
                {Math.round(recommendation.params.noiseLevel * 100)}% stochastic mask
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Iso-Arc</div>
              <div className="font-mono-tech mt-0.5 text-sm font-bold text-[#34D399]">
                {entryMin}m → {peakMin}m → {landingMin}m
              </div>
              <div className="text-[10px] text-[#8E8E88]">Entry · Peak · Land</div>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-[#A3A39E]">{recommendation.rationale}</p>

          {recommendation.executableSpec?.entrainment.isoBridge && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/35 bg-amber-500/[0.08] p-3 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>
                <strong className="text-amber-300">2-Stage Iso-Bridge Active:</strong> Starts with{' '}
                {Math.round(
                  recommendation.executableSpec.entrainment.isoBridge.stabilizeDurationSec / 60
                )}{' '}
                min at {recommendation.executableSpec.entrainment.isoBridge.stabilizeHz} Hz Alpha (~
                {Math.min(
                  98,
                  Math.round(
                    recommendation.params.modulationDepth *
                      recommendation.executableSpec.entrainment.isoBridge.stabilizeEffectScale *
                      172
                  )
                )}
                % effect) to settle tension first, then glides smoothly into{' '}
                {recommendation.params.modulationHz} Hz.
              </span>
            </div>
          )}

          {recommendation.personalizationSummary && recommendation.personalizationSummary.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {recommendation.personalizationSummary.map((item) => (
                <span
                  key={item}
                  className="rounded-lg border border-white/[0.08] bg-[#141518] px-2.5 py-1 text-[#D4D4CE]"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Connector */}
        <div className="relative flex items-center justify-center py-0.5">
          <div className="inline-flex items-center gap-2 rounded-md border border-white/12 bg-[#141518] px-3.5 py-1 font-mono-tech text-[10px] uppercase tracking-wider text-[#D4D4CE]">
            <Plus className="h-3.5 w-3.5 text-[#34D399]" />
            Fused live in real time with your favorite music
          </div>
        </div>

        {/* LAYER 2: PREFERRED MUSIC CARRIER */}
        <div className="glass-stage rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tech rounded border border-white/15 bg-[#16181C] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#D4D4CE]">
                Layer 2 · Your Preferred Music
              </span>
              <span className="text-sm font-semibold text-[#F3F1EC]">{activeGenreDisplay.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded border px-2.5 py-0.5 text-[10px] font-semibold ${sourceBadge.cls}`}>
                <Radio className="h-3 w-3" />
                {sourceBadge.label}
              </span>
              <span className="font-mono-tech rounded border border-white/12 bg-[#141518] px-2 py-0.5 text-[10px] text-[#D4D4CE]">
                {DEVICE_LABELS[recommendation.device]}
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-[#A3A39E]">
            Preferred lyric-free aesthetics sustain attention (<em>Salimpoor et al. 2011</em>)
            while keeping verbal working memory completely clear (<em>Perham &amp; Currie 2014</em>).
          </p>

          {recommendation.genreAdaptationNote && (
            <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#121417] p-3 text-xs text-[#D4D4CE]">
              <Music2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34D399]" />
              <span>{recommendation.genreAdaptationNote}</span>
            </div>
          )}

          {recommendation.composedMusicPrompt && (
            <div>
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#34D399] hover:text-emerald-300"
              >
                <span>Inspect scientific instrumental prompt for {activeGenreDisplay.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition ${showPrompt ? 'rotate-180' : ''}`} />
              </button>
              {showPrompt && (
                <div className="mt-2 rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-3 font-mono-tech text-[11px] leading-relaxed text-[#D4D4CE]">
                  {recommendation.composedMusicPrompt}
                </div>
              )}
            </div>
          )}

          {/* 1-Tap Layer 2 Swap (10 Curated Genres + Other Coming Soon) */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-[#8E8E88]">
              Want a different music style? Swap in 1 tap before playing:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(GENRE_META) as ResolvedGenre[]).map((g) => {
                const active = !recommendation.customGenreSlug && recommendation.params.genre === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onSwapGenre(g)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                        : 'subtle-chip'
                    }`}
                  >
                    {GENRE_META[g].label}
                  </button>
                );
              })}

              <span
                aria-disabled="true"
                title="More genres & custom styles coming soon"
                className="inline-flex cursor-not-allowed select-none items-center gap-1 rounded-lg border border-dashed border-white/12 bg-[#0B0C0E] px-3 py-1.5 text-xs font-medium text-[#6E6E68]"
              >
                <span>Other</span>
                <span className="rounded border border-white/10 bg-[#141518] px-1.5 py-0.5 font-mono-tech text-[9px] font-bold uppercase tracking-wider text-[#8E8E88]">
                  Coming Soon
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BLOCK 3: APPLY LAYERS & PLAY CTA (+ Expandable Formula Facts)     */}
      {/* ================================================================= */}
      <div className="animate-rise delay-150 glass-stage rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-4 py-4 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC] w-full sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            Adjust
          </button>
          <button
            type="button"
            onClick={() => void handleLaunchClick()}
            className="btn-aurora flex flex-1 w-full items-center justify-center gap-2.5 rounded-xl px-6 py-4 text-base font-semibold"
          >
            <Play className="h-5 w-5 fill-[#0A0B0C]" />
            Apply Layers &amp; Start ({recommendation.plannedDurationMin} min ·{' '}
            {activeGenreDisplay.label})
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3 text-[11px] text-[#8E8E88]">
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-[#34D399]" />
            {recommendation.ephemeralMode
              ? 'Local-Only Mode (Zero Remote Tracking)'
              : recommendation.isExploration
                ? 'Bandit Mode: Controlled Exploration Trial'
                : `Bandit Mode: ${recommendation.confidencePct}% Cohort Fit (${recommendation.cohortTrials} trials)`}
          </span>
          <button
            type="button"
            onClick={() => setShowFormulaFacts((v) => !v)}
            className="inline-flex items-center gap-1 font-medium text-[#34D399] hover:text-emerald-300"
          >
            <span>Full Audio Formula Facts</span>
            <ChevronDown className={`h-3.5 w-3.5 transition ${showFormulaFacts ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showFormulaFacts && (
          <div className="animate-step overflow-hidden rounded-xl border border-white/12 bg-[#0B0C0E]">
            <div className="divide-y divide-white/[0.06]">
              {recommendation.formulaIngredients.map((ing) => (
                <div
                  key={ing.role}
                  className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-12 sm:items-center sm:gap-2"
                >
                  <div className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#8E8E88] sm:col-span-3">
                    {ing.role}
                  </div>
                  <div className="text-xs font-semibold text-[#F3F1EC] sm:col-span-4">{ing.compound}</div>
                  <div className="font-mono-tech text-xs text-[#34D399] sm:col-span-3">{ing.dose}</div>
                  <div className="text-[10px] text-[#8E8E88] sm:col-span-2 sm:text-right">
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
