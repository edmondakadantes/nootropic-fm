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
    cls: 'border-emerald-400/40 bg-emerald-500/15 text-[#34D399]',
  },
  study_inferred: {
    label: 'Study-Aligned',
    cls: 'border-white/15 bg-white/[0.06] text-[#D4D4CE]',
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
    <div className="rounded-2xl border border-white/10 bg-[#0B0C0E] p-4 sm:p-5 space-y-3.5">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2.5 py-0.5 font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
              <CheckCircle2 className="h-3 w-3" />
              {spec.compliancePct}% Study-to-Sound Fidelity
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-[#14161A] px-2.5 py-0.5 font-mono-tech text-[10px] text-[#D4D4CE]">
              <Cpu className="h-3 w-3 text-[#34D399]" />
              {compilerBadge}
            </span>
          </div>
          <h3 className="text-sm font-bold leading-snug text-[#F3F1EC]">
            {spec.studyRef.title}
          </h3>
          <div className="text-[11px] text-[#8E8E88]">
            {spec.studyRef.authors} · <span className="text-[#D4D4CE]">{spec.studyRef.journal}</span> ({spec.studyRef.year})
          </div>
        </div>

        <a
          href={spec.studyRef.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-xl border border-white/12 bg-[#14161A] px-2.5 py-1.5 text-[11px] font-medium text-[#34D399] transition hover:border-emerald-400/50 hover:text-emerald-200"
        >
          <span>{spec.studyRef.pmid ? `PMID ${spec.studyRef.pmid}` : spec.studyRef.nctId ? spec.studyRef.nctId : 'Open Study'}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Executed Signal Summary Strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-white/[0.08] bg-[#131519] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Acoustic Modulation</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-[#34D399]">
            {spec.entrainment.frequencyHz > 0
              ? `${spec.entrainment.frequencyHz} Hz`
              : spec.entrainment.hrvBreathHz
                ? `${spec.entrainment.hrvBreathHz} Hz HRV`
                : 'Pure Music'}
          </div>
          <div className="truncate text-[10px] text-[#A3A39E]">
            {ENTRAINMENT_LABELS[spec.entrainment.type]}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#131519] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Tempo &amp; Drums</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-[#F3F1EC]">{tempoText}</div>
          <div className="truncate text-[10px] text-[#A3A39E] capitalize">
            Percussion: {spec.music.percussion.replace('_', ' ')}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#131519] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Tonality &amp; Tuning</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-[#D4D4CE] capitalize">
            {spec.music.tonalMode} · A={spec.music.tuningA4Hz} Hz
          </div>
          <div className="truncate text-[10px] text-[#A3A39E]">
            LPF {spec.music.spectralLowPassHz} Hz · Zero lyrics
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#131519] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-[#7E7E78]">Stochastic Noise</div>
          <div className="font-mono-tech mt-0.5 text-xs font-bold text-[#34D399] capitalize">
            {spec.noise.color === 'none' ? 'Off' : spec.noise.color.replace('_', ' ')}
          </div>
          <div className="truncate text-[10px] text-[#A3A39E]">
            {spec.noise.color === 'none' ? 'Clean musical floor' : `${spec.noise.snrDb} dB SNR · ${spec.protocol.recommendedDurationMin} min`}
          </div>
        </div>
      </div>

      {/* Line-by-Line Verbatim Study Quote -> Executed Sound Table */}
      {spec.evidenceMap.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0F1013]">
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#14161A] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#8E8E88]">
            <span className="inline-flex items-center gap-1.5 text-[#34D399]">
              <Waves className="h-3 w-3" />
              What the Study Requires ↔ What Plays Live in Your Ears
            </span>
            <span>{spec.evidenceMap.length} verified rules</span>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {(compact ? spec.evidenceMap.slice(0, 4) : spec.evidenceMap).map((row, idx) => {
              const badge = ORIGIN_BADGES[row.origin];
              return (
                <div
                  key={`${row.parameter}-${idx}`}
                  className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-12 sm:items-start"
                >
                  <div className="sm:col-span-3 space-y-1">
                    <div className="text-xs font-semibold text-[#F3F1EC]">{row.parameter}</div>
                    <span className={`inline-block rounded-md border px-1.5 py-0.5 font-mono-tech text-[9px] font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="sm:col-span-4 text-[11px] italic leading-relaxed text-[#A3A39E]">
                    “{row.studyQuote}”
                  </div>
                  <div className="sm:col-span-5 flex items-start gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] px-2.5 py-1.5 font-mono-tech text-[11px] text-[#34D399]">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-[#34D399]" />
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
