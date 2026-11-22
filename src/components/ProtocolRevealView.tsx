import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FlaskConical,
  Loader2,
  Music2,
  Play,
  ShieldAlert,
  Sparkles,
  Waves,
} from 'lucide-react';
import type { ProtocolRecommendation } from '../../shared/types';
import { DEVICE_LABELS, GENRE_META, TARGET_LABELS } from '../../shared/types';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';

interface ProtocolRevealViewProps {
  loading: boolean;
  recommendation: ProtocolRecommendation | null;
  mood: FieldMood;
  onLaunchAudio: () => void;
  onBack: () => void;
}

const RESEARCH_STEPS = [
  'Analyzing listener profile, baseline & safety guardrails',
  'Searching peer-reviewed psychoacoustics & live PubMed (NIH)',
  'Fusing Taste Carrier genre with Multiband AM (>190 Hz) crossover',
  'Weighing collective cohort outcomes in Research Brain',
];

export function ProtocolRevealView({
  loading,
  recommendation,
  mood,
  onLaunchAudio,
  onBack,
}: ProtocolRevealViewProps) {
  const [animStep, setAnimStep] = useState(0);
  const [revealReady, setRevealReady] = useState(false);

  useEffect(() => {
    setAnimStep(0);
    setRevealReady(false);
    const t1 = window.setTimeout(() => setAnimStep(1), 450);
    const t2 = window.setTimeout(() => setAnimStep(2), 1050);
    const t3 = window.setTimeout(() => setAnimStep(3), 1650);
    const t4 = window.setTimeout(() => setRevealReady(true), 2250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [loading]);

  const isScanning = loading || !recommendation || !revealReady;

  if (isScanning) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-6 text-center">
        <SonicOrb mood={mood} size="lg" label="Compounding Audio Formula" />

        <h1 className="animate-rise mt-6 text-2xl font-bold text-white sm:text-3xl">
          Compounding your <span className="text-aurora">nootropic audio formula...</span>
        </h1>
        <p className="mt-2 text-xs text-slate-400 sm:text-sm">
          Matching peer-reviewed neuroscience with your musical carrier and safety constraints.
        </p>

        <div className="glass-stage mt-7 w-full rounded-3xl p-5 sm:p-6 space-y-3 text-left">
          {RESEARCH_STEPS.map((label, idx) => {
            const done = idx < animStep || (!loading && Boolean(recommendation) && idx <= animStep);
            const active = idx === animStep && !done;
            return (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-xs transition-all duration-500 ${
                  done
                    ? 'border-emerald-400/25 bg-emerald-500/8 text-emerald-200'
                    : active
                      ? 'border-cyan-400/40 bg-cyan-400/10 text-white'
                      : 'border-slate-800/70 bg-slate-900/40 text-slate-500'
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-300" />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-700 ml-1 mr-1" />
                )}
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const genreMeta = GENRE_META[recommendation.params.genre];
  const livePapers = recommendation.livePubMedPapers ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Iconic "NOOTROPIC AUDIO FORMULA" Supplement-Facts Prescription Card */}
      <div className="animate-rise glass-stage rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-3 py-1 text-[11px] font-semibold text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Custom Formula Synthesized · {recommendation.arm.name}
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-4xl">
            Your <span className="text-aurora">Nootropic Audio Formula</span>
          </h1>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400 sm:text-sm">
            Active neuroacoustic modulation fused directly inside{' '}
            <strong className="text-cyan-200">{genreMeta.label}</strong> (100% lyric-free) for{' '}
            <span className="text-slate-200">{recommendation.cohortLabel}</span>.
          </p>
        </div>

        {/* Driving Safety Notice */}
        {recommendation.safetyMode && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
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

        {/* Smart Iso-Adaptation Note if user's chosen genre was adapted for goal/safety */}
        {recommendation.genreAdaptationNote && (
          <div className="flex items-start gap-3 rounded-2xl border border-indigo-400/35 bg-indigo-500/10 p-3.5 text-xs text-indigo-100">
            <Music2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
            <div>
              <strong className="text-indigo-200">Iso-Principle Genre Adaptation:</strong>{' '}
              {recommendation.genreAdaptationNote}
            </div>
          </div>
        )}

        {/* Supplement-Facts Style Formula Table (Built to be iconic & shareable!) */}
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
              {recommendation.params.bpm > 0 ? `${recommendation.params.bpm} BPM` : 'Beatless'}
            </span>
          </div>

          <div className="divide-y divide-slate-800/80">
            {recommendation.formulaIngredients.map((ing) => (
              <div
                key={ing.role}
                className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-12 sm:items-center sm:gap-2"
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
              {recommendation.isExploration
                ? 'Bandit Mode: Controlled Exploration Trial'
                : `Bandit Mode: Optimal Fit (${recommendation.cohortTrials} cohort trials)`}
            </span>
            <span className="font-mono-tech text-[10px] text-cyan-300/80">
              Sub-bass &lt;{recommendation.params.crossoverHz}Hz Clean · Mid-High AM Active
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
            Play My Audio Formula ({recommendation.plannedDurationMin} min ·{' '}
            {TARGET_LABELS[recommendation.targetState]})
          </button>
        </div>
      </div>

      {/* How Each Peer-Reviewed Study Shapes Your Music */}
      <div className="animate-rise delay-150 glass-card rounded-3xl p-5 sm:p-7 space-y-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <BookOpen className="h-5 w-5" />
          <h2 className="text-base font-semibold text-white">
            Peer-reviewed studies powering this formula ({recommendation.studies.length})
          </h2>
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
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200"
                >
                  DOI
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/8 px-3 py-2 text-xs text-cyan-100">
                <Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                <span>
                  <strong className="text-cyan-200">In your music:</strong> {study.soundEffect}
                </span>
              </div>

              <p className="text-xs leading-relaxed text-slate-400">{study.summary}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Live NIH PubMed Peer-Reviewed Literature */}
      {livePapers.length > 0 && (
        <div className="animate-rise delay-225 glass-card rounded-3xl p-5 sm:p-7 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-indigo-300">
              <Cpu className="h-5 w-5" />
              <h2 className="text-base font-semibold text-white">
                Live PubMed (NIH) Research Matched to Your State
              </h2>
            </div>
            <span className="font-mono-tech rounded-full border border-indigo-400/30 bg-indigo-500/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-200">
              Queried Live · NIH E-Utilities
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {livePapers.map((p) => (
              <a
                key={p.pmid}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border border-slate-800/90 bg-slate-950/60 p-4 transition hover:border-indigo-400/45"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-indigo-300">
                  <span className="font-mono-tech">PMID {p.pmid} · {p.year}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-500 group-hover:text-indigo-300" />
                </div>
                <div className="mt-1.5 text-xs font-semibold leading-snug text-white group-hover:text-indigo-100">
                  {p.title}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {p.authors} · {p.journal}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
