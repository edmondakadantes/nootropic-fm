import { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Cpu,
  ExternalLink,
  FlaskConical,
  Loader2,
  Music2,
  Play,
  Plus,
  Radio,
  ShieldAlert,
  Sparkles,
  Waves,
} from 'lucide-react';
import { getGenreDisplayMeta, sanitizeCustomVibe } from '../../shared/promptComposer';
import type { ProtocolRecommendation, ResolvedGenre } from '../../shared/types';
import { DEVICE_LABELS, ENERGY_LABELS, GENRE_META, TARGET_LABELS } from '../../shared/types';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';

interface ProtocolRevealViewProps {
  loading: boolean;
  recommendation: ProtocolRecommendation | null;
  mood: FieldMood;
  customLiveGenAvailable?: boolean;
  onSwapGenre: (genre: ResolvedGenre) => void;
  onSwapCustomVibe: (customLabel: string) => void;
  onLaunchAudio: () => void;
  onBack: () => void;
}

const SOURCE_BADGES = {
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
  procedural_fallback: {
    label: 'Real-Time DSP Fallback',
    cls: 'border-slate-700 bg-slate-900 text-slate-300',
  },
};

export function ProtocolRevealView({
  loading,
  recommendation,
  mood,
  customLiveGenAvailable,
  onSwapGenre,
  onSwapCustomVibe,
  onLaunchAudio,
  onBack,
}: ProtocolRevealViewProps) {
  const [showCustomSwap, setShowCustomSwap] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  // Zero artificial delay — displays immediately as soon as real API + PubMed/OpenAlex response arrives!
  if (loading || !recommendation) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
        <SonicOrb mood={mood} size="lg" label="Tune your mind" />
        <h1 className="animate-rise mt-6 text-2xl font-bold text-white sm:text-3xl">
          Synthesizing your <span className="text-aurora">2-Layer Audio Formula...</span>
        </h1>
        <p className="mt-2 inline-flex items-center gap-2 text-xs text-slate-400 sm:text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
          Querying peer-reviewed literature (NIH PubMed &amp; OpenAlex) &amp; Bandit weights
        </p>
      </div>
    );
  }

  const activeGenreDisplay = getGenreDisplayMeta(
    recommendation.customGenreSlug ?? recommendation.params.genre,
    recommendation.customGenreLabel
  );
  const energyInfo = ENERGY_LABELS[recommendation.params.energyTier];
  const livePapers = recommendation.livePubMedPapers ?? [];
  const upperKhz = ((recommendation.params.upperCrossoverHz ?? 4500) / 1000).toFixed(1);
  const sourceBadge = SOURCE_BADGES[recommendation.audioSource] ?? SOURCE_BADGES.studio_library;

  const applyCustomSwap = () => {
    const check = sanitizeCustomVibe(customDraft);
    if (!check || check.rejectedReason) {
      setCustomError(check?.rejectedReason ?? 'Enter a valid instrumental genre (e.g., chill reggae).');
      return;
    }
    setCustomError(null);
    onSwapCustomVibe(check.displayLabel);
    setShowCustomSwap(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div className="animate-rise text-center space-y-2">
        <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-3 py-1 text-[11px] font-semibold text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          2-Layer Formula Ready · {recommendation.cohortLabel}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-4xl">
          Your <span className="text-aurora">Nootropic Audio Formula</span>
        </h1>
        <p className="mx-auto max-w-xl text-xs leading-relaxed text-slate-400 sm:text-sm">
          Real-time 3-Band LR4 neuro-modulation fused seamlessly inside studio audio — sub-bass
          (&lt;{recommendation.params.crossoverHz} Hz) and highs (&gt;{upperKhz} kHz) remain 100% untouched.
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

      {/* VISUAL 2-LAYER ARCHITECTURE: LAYER 1 (+) LAYER 2 */}
      <div className="animate-rise space-y-2">
        {/* LAYER 1: SCIENTIFIC SIGNAL */}
        <div className="glass-stage rounded-3xl border border-cyan-400/30 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tech rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                Layer 1 · Scientific Signal
              </span>
              <span className="text-sm font-bold text-white">{recommendation.arm.name}</span>
            </div>
            <span className="font-mono-tech text-[11px] text-cyan-300">
              {recommendation.params.modulationHz} Hz · {recommendation.params.crossoverHz}Hz–{upperKhz}kHz
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-300">{recommendation.rationale}</p>

          {/* How this session was personalized for your profile */}
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
            Fused in real time with
          </div>
        </div>

        {/* LAYER 2: MUSIC CARRIER (Transparent Audio Source + 1-Tap Swap + Custom Vibe) */}
        <div className="glass-stage rounded-3xl border border-indigo-400/30 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tech rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-200">
                Layer 2 · Music Carrier
              </span>
              <span className="text-sm font-bold text-white">{activeGenreDisplay.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${sourceBadge.cls}`}>
                <Radio className="h-3 w-3" />
                {sourceBadge.label}
              </span>
              <span className="font-mono-tech rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-indigo-200">
                {energyInfo.label}
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-300">
            Preferred lyric-free aesthetics trigger striatal dopamine release (<em>Salimpoor et al. 2011</em>),
            sustaining attention longer while verbal working memory stays clear (<em>Perham &amp; Currie 2014</em>).
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

          {/* 1-Tap Layer 2 Swap (Core + Custom Vibe) */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-medium text-slate-400">
              Swap Layer 2 in 1 tap before playing:
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
                    if (e.key === 'Enter') applyCustomSwap();
                  }}
                  placeholder="e.g. chill reggae, synthwave, bossa nova..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyCustomSwap}
                  className="rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/20 px-4 py-2 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/30"
                >
                  Apply Vibe
                </button>
              </div>
            )}
            {customError && <p className="text-[11px] text-rose-300">{customError}</p>}
            {showCustomSwap && !customLiveGenAvailable && (
              <p className="text-[10px] text-slate-500">
                Searches our instant Community R2 Cache first; uncached vibes start smoothly on our closest studio match.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Shareable "NOOTROPIC AUDIO FORMULA FACTS" + Play CTA */}
      <div className="animate-rise delay-75 glass-stage rounded-3xl p-5 sm:p-7 space-y-5">
        <div className="overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#050812]/90">
          <div className="flex items-center justify-between border-b-2 border-cyan-400/35 bg-cyan-400/[0.07] px-4 py-3">
            <div>
              <div className="font-mono-tech text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                NOOTROPIC.FM · AUDIO FORMULA FACTS
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                Dose: {recommendation.plannedDurationMin} min · Output:{' '}
                {DEVICE_LABELS[recommendation.device]} · Cohort Fit:{' '}
                <span className="font-mono-tech text-emerald-300">{recommendation.confidencePct}%</span>
              </div>
            </div>
            <span className="font-mono-tech rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200">
              {energyInfo.label}
            </span>
          </div>

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

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/90 bg-slate-950/70 px-4 py-2.5 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-purple-400" />
              {recommendation.ephemeralMode
                ? 'Local-Only Mode (Zero Remote Tracking)'
                : recommendation.isExploration
                  ? 'Bandit Mode: Controlled Exploration Trial'
                  : `Bandit Mode: Optimal Fit (${recommendation.cohortTrials} cohort trials)`}
            </span>
            <span className="font-mono-tech text-[10px] text-cyan-300/80">
              3-Band LR4 · &lt;{recommendation.params.crossoverHz}Hz &amp; &gt;{upperKhz}kHz Pure
            </span>
          </div>
        </div>

        {/* Primary Play CTA */}
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
            onClick={onLaunchAudio}
            className="btn-aurora flex flex-1 w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-base font-bold text-slate-950"
          >
            <Play className="h-5 w-5 fill-slate-950" />
            Tune My Mind ({recommendation.plannedDurationMin} min · {activeGenreDisplay.label} ·{' '}
            {TARGET_LABELS[recommendation.targetState]})
          </button>
        </div>
      </div>

      {/* Core DSP Peer-Reviewed Studies (Verified External DOI Links) */}
      <div className="animate-rise delay-150 glass-card rounded-3xl p-5 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-cyan-300">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-base font-semibold text-white">
              Core Acoustic Science ({recommendation.studies.length} verified studies)
            </h2>
          </div>
          <span className="font-mono-tech rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
            Direct DOI Links · DSP-Linked
          </span>
        </div>

        <div className="space-y-3">
          {recommendation.studies.map((study) => (
            <div
              key={study.id}
              className="rounded-2xl border border-slate-800/90 bg-slate-950/65 p-4 space-y-2 transition hover:border-cyan-400/35"
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
                  <strong className="text-cyan-200">Applied in your audio:</strong> {study.soundEffect}
                </span>
              </div>

              <p className="text-xs leading-relaxed text-slate-400">{study.summary}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Live Dual-Source Literature (NIH PubMed + OpenAlex) with Verified External Links */}
      {livePapers.length > 0 && (
        <div className="animate-rise delay-225 glass-card rounded-3xl p-5 sm:p-7 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-indigo-300">
              <Cpu className="h-5 w-5" />
              <h2 className="text-base font-semibold text-white">
                Live Matched Literature (NIH PubMed &amp; OpenAlex)
              </h2>
            </div>
            <span className="font-mono-tech rounded-full border border-indigo-400/30 bg-indigo-500/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-200">
              Verified External Links
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {livePapers.map((p) => (
              <a
                key={p.pmid}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-950/60 p-4 space-y-2 transition hover:border-indigo-400/45"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-indigo-300">
                    <span className="font-mono-tech">
                      {p.source === 'openalex' ? 'OpenAlex · DOI' : `PubMed · ${p.pmid}`} · {p.year}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-slate-500 group-hover:text-indigo-300" />
                  </div>
                  <div className="mt-1.5 text-xs font-semibold leading-snug text-white group-hover:text-indigo-100">
                    {p.title}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {p.authors} · {p.journal}
                  </div>
                </div>
                {p.appliedMechanism && (
                  <div className="rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-100/90">
                    <strong className="text-indigo-200">Mechanism:</strong> {p.appliedMechanism}
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
