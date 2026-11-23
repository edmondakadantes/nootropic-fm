import {
  CheckCircle2,
  Cpu,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Waves,
} from 'lucide-react';
import {
  ENTRAINMENT_LABELS,
  type EvidenceOrigin,
  type ExecutableStudySpec,
} from '../../shared/studySpec';

interface StudyFidelityMatrixProps {
  spec: ExecutableStudySpec;
  compact?: boolean;
}

const ORIGIN_BADGES: Record<EvidenceOrigin, { label: string; cls: string }> = {
  study_exact: {
    label: 'Exact from Study',
    cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
  },
  study_inferred: {
    label: 'Study-Aligned',
    cls: 'border-cyan-400/35 bg-cyan-400/12 text-cyan-200',
  },
  clinical_safety_default: {
    label: 'Safety Guard',
    cls: 'border-amber-400/35 bg-amber-500/12 text-amber-200',
  },
};

export function StudyFidelityMatrix({ spec, compact = false }: StudyFidelityMatrixProps) {
  const tempoText = spec.music.bpmRamp
    ? `${spec.music.bpmRamp.start} → ${spec.music.bpmRamp.end} BPM ramp`
    : spec.music.bpm > 0
      ? `${spec.music.bpm} BPM`
      : 'Beatless Ambient';

  const compilerBadge =
    spec.compilerMode === 'verified_ground_truth'
      ? 'Ground-Truth Verified Protocol'
      : spec.compilerMode === 'workers_ai_grounded'
        ? 'Quote-Verified AI + Physics Compiler'
        : 'Deterministic Scientific Parser';

  return (
    <div className="rounded-2xl border border-cyan-400/25 bg-[#050914]/90 p-4 sm:p-5 space-y-3.5">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2.5 py-0.5 font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
              <CheckCircle2 className="h-3 w-3" />
              {spec.compliancePct}% Study-to-Sound Fidelity
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 font-mono-tech text-[10px] text-cyan-200">
              <Cpu className="h-3 w-3" />
              {compilerBadge}
            </span>
          </div>
          <h3 className="text-sm font-bold leading-snug text-white">
            {spec.studyRef.title}
          </h3>
          <div className="text-[11px] text-slate-400">
            {spec.studyRef.authors} · <span className="text-slate-300">{spec.studyRef.journal}</span> ({spec.studyRef.year})
          </div>
        </div>

        <a
          href={spec.studyRef.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300 transition hover:border-cyan-400/50 hover:text-cyan-200"
        >
          <span>{spec.studyRef.pmid ? `PMID ${spec.studyRef.pmid}` : spec.studyRef.nctId ? spec.studyRef.nctId : 'Open Study'}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Executed Signal Summary Strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Medical Stimulus</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-cyan-300">
            {spec.entrainment.frequencyHz > 0
              ? `${spec.entrainment.frequencyHz} Hz`
              : spec.entrainment.hrvBreathHz
                ? `${spec.entrainment.hrvBreathHz} Hz HRV`
                : 'Pure Music'}
          </div>
          <div className="truncate text-[10px] text-slate-400">
            {ENTRAINMENT_LABELS[spec.entrainment.type]}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Tempo &amp; Drums</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-white">{tempoText}</div>
          <div className="truncate text-[10px] text-slate-400 capitalize">
            Percussion: {spec.music.percussion.replace('_', ' ')}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Tonality &amp; Tuning</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-indigo-200 capitalize">
            {spec.music.tonalMode} · A={spec.music.tuningA4Hz} Hz
          </div>
          <div className="truncate text-[10px] text-slate-400">
            LPF {spec.music.spectralLowPassHz} Hz · Zero lyrics
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Stochastic Noise</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-emerald-300 capitalize">
            {spec.noise.color === 'none' ? 'Off' : spec.noise.color.replace('_', ' ')}
          </div>
          <div className="truncate text-[10px] text-slate-400">
            {spec.noise.color === 'none' ? 'Clean musical floor' : `${spec.noise.snrDb} dB SNR · ${spec.protocol.recommendedDurationMin} min`}
          </div>
        </div>
      </div>

      {/* Line-by-Line Verbatim Study Quote -> Executed Sound Table */}
      {spec.evidenceMap.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-800/90 bg-slate-950/70">
          <div className="flex items-center justify-between border-b border-slate-800/90 bg-slate-900/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-cyan-300">
              <Waves className="h-3 w-3" />
              What the Study Requires ↔ What Plays Live in Your Ears
            </span>
            <span>{spec.evidenceMap.length} verified rules</span>
          </div>
          <div className="divide-y divide-slate-800/70">
            {(compact ? spec.evidenceMap.slice(0, 4) : spec.evidenceMap).map((row, idx) => {
              const badge = ORIGIN_BADGES[row.origin];
              return (
                <div
                  key={`${row.parameter}-${idx}`}
                  className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-12 sm:items-start"
                >
                  <div className="sm:col-span-3 space-y-1">
                    <div className="text-xs font-semibold text-white">{row.parameter}</div>
                    <span className={`inline-block rounded-md border px-1.5 py-0.5 font-mono-tech text-[9px] font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="sm:col-span-4 text-[11px] italic leading-relaxed text-slate-300">
                    “{row.studyQuote}”
                  </div>
                  <div className="sm:col-span-5 flex items-start gap-1.5 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.05] px-2.5 py-1.5 font-mono-tech text-[11px] text-cyan-200">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-cyan-400" />
                    <span>{row.executedValue}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Safety Guardrails */}
      {spec.protocol.safetyNotes.length > 0 && (
        <div className="space-y-1.5">
          {spec.protocol.safetyNotes.map((note) => (
            <div
              key={note}
              className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
