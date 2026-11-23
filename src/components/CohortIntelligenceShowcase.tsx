import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Database, Lock, Sparkles, TrendingUp } from 'lucide-react';
import type { CohortIntelligenceCard, GlobalRetentionFunnel } from '../../shared/types';
import { api } from '../lib/api';
import { DatasetInquiryModal } from './DatasetInquiryModal';

interface CohortIntelligenceShowcaseProps {
  mode?: 'compact' | 'full';
}

/**
 * Transparent Sample Report Format previews shown alongside/until live D1 cohorts reach k-anonymity (n >= 5).
 * Always clearly badged "SAMPLE REPORT FORMAT" so visitors and B2B buyers see the exact structure with zero deception.
 */
const SAMPLE_REPORT_CARDS: CohortIntelligenceCard[] = [
  {
    id: 'sample_doctors_calm',
    isLiveData: false,
    professionLabel: 'Doctors & Clinicians',
    fromStateLabel: 'Stressed',
    toStateLabel: 'Calm Reset',
    studyLabel: 'Lehrer 2014 · 0.1 Hz HRV Tide',
    sessions: 0,
    successRatePct: 80,
    fullFinishPct: 74,
    retentionCurve: { pct25: 94, pct50: 86, pct75: 79, pct90: 74 },
    blurredPreview: {
      topGenreHint: 'Rain & Felt Piano (60 BPM)',
      modulationHint: '0.10 Hz · 24% depth · -18 dB SNR',
      avgPvtShiftMs: -24,
      abLiftPct: 19,
    },
  },
  {
    id: 'sample_devs_focus',
    isLiveData: false,
    professionLabel: 'Software Engineers',
    fromStateLabel: 'Brain Fog',
    toStateLabel: 'Deep Flow',
    studyLabel: 'Woods 2024 · 16 Hz Beta AM',
    sessions: 0,
    successRatePct: 84,
    fullFinishPct: 79,
    retentionCurve: { pct25: 96, pct50: 88, pct75: 83, pct90: 79 },
    blurredPreview: {
      topGenreHint: 'Lo-Fi Warm Keys / Synthwave',
      modulationHint: '16.0 Hz · 190–4500 Hz LR4 · 28%',
      avgPvtShiftMs: -36,
      abLiftPct: 22,
    },
  },
  {
    id: 'sample_students_uplift',
    isLiveData: false,
    professionLabel: 'University Students',
    fromStateLabel: 'Sad / Low Mood',
    toStateLabel: 'Happy & Awake',
    studyLabel: 'Husain 2002 · Major Tempo Uplift',
    sessions: 0,
    successRatePct: 77,
    fullFinishPct: 71,
    retentionCurve: { pct25: 92, pct50: 82, pct75: 75, pct90: 71 },
    blurredPreview: {
      topGenreHint: 'Acoustic Guitar / Reggae Groove',
      modulationHint: '114 BPM Major · 12 Hz SMR Lift',
      avgPvtShiftMs: -29,
      abLiftPct: 16,
    },
  },
];

export function CohortIntelligenceShowcase({ mode = 'compact' }: CohortIntelligenceShowcaseProps) {
  const [liveCohorts, setLiveCohorts] = useState<CohortIntelligenceCard[]>([]);
  const [globalRetention, setGlobalRetention] = useState<GlobalRetentionFunnel | null>(null);
  const [selectedCohortForModal, setSelectedCohortForModal] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getCohortIntelligence()
      .then((res) => {
        if (!active) return;
        setLiveCohorts(res.cohorts ?? []);
        setGlobalRetention(res.globalRetention ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const maxCards = mode === 'compact' ? 3 : 9;
  const displayCards: CohortIntelligenceCard[] =
    liveCohorts.length >= 3
      ? liveCohorts.slice(0, maxCards)
      : [...liveCohorts, ...SAMPLE_REPORT_CARDS.slice(0, Math.max(0, 3 - liveCohorts.length))];

  return (
    <section className="w-full space-y-4">
      <div className="glass-stage rounded-3xl border border-indigo-400/25 p-5 sm:p-6 space-y-5">
        {/* Header introducing Psychoacoustic Cohort Intelligence (B2B Data Licensing) */}
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/35 bg-indigo-500/12 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-200">
              <Database className="h-3 w-3" />
              Psychoacoustic Cohort Intelligence · Research &amp; Enterprise Data
            </div>
            <h2 className="text-lg font-bold text-white sm:text-xl">
              Real-world state shifts &amp; listening retention —{' '}
              <span className="text-aurora">measured by profession.</span>
            </h2>
            <p className="max-w-2xl text-xs leading-relaxed text-slate-400">
              Every opted-in anonymous session tracks how far each profession listens (25% → halfway
              → 75% → full finish) and whether the sound shifted their state. Organizations and labs
              can license full k-anonymized cohort reports (zero personal data).
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSelectedCohortForModal('Full Multi-Cohort Psychoacoustic Dataset')}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyan-400/45 bg-cyan-400/12 px-4 py-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/22"
          >
            <Lock className="h-3.5 w-3.5" />
            License Full Dataset
          </button>
        </div>

        {/* Live Global Retention Funnel Strip (always 100% real D1 data) */}
        {globalRetention && globalRetention.measuredSessions > 0 && (
          <div className="rounded-2xl border border-slate-800/90 bg-slate-950/75 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                <BarChart3 className="h-3.5 w-3.5" />
                Live Platform Listening Retention Funnel ({globalRetention.measuredSessions} measured
                sessions)
              </span>
              <span className="font-mono-tech text-[11px] text-slate-400">
                Avg completion: <strong className="text-white">{globalRetention.avgCompletionPct}%</strong>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Stayed 25%+', val: globalRetention.pct25, color: 'text-cyan-300' },
                { label: 'Reached Halfway (50%+)', val: globalRetention.pct50, color: 'text-indigo-300' },
                { label: 'Deep Listen (75%+)', val: globalRetention.pct75, color: 'text-purple-300' },
                { label: 'Finished Full (90%+)', val: globalRetention.pct90, color: 'text-emerald-300' },
              ].map((step) => (
                <div
                  key={step.label}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-center"
                >
                  <div className={`font-mono-tech text-lg font-bold ${step.color}`}>
                    {step.val}%
                  </div>
                  <div className="text-[10px] leading-tight text-slate-400">{step.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Partially Blurred Cohort Intelligence Cards */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {displayCards.map((card) => {
            const cohortTitle = `${card.fromStateLabel} ${card.professionLabel} → ${card.toStateLabel} (${card.studyLabel})`;
            return (
              <div
                key={card.id}
                className="glass-card flex flex-col justify-between rounded-2xl border border-white/[0.09] p-4 space-y-3"
              >
                {/* VISIBLE TEASER TOP HALF */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono-tech text-[9px] font-semibold uppercase tracking-wider ${
                        card.isLiveData
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                          : 'border-amber-400/35 bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      {card.isLiveData
                        ? `Live D1 · n=${card.sessions}`
                        : 'Sample Report Format'}
                    </span>
                    <span className="font-mono-tech text-[10px] text-slate-400 truncate">
                      {card.studyLabel.split('·')[0].trim()}
                    </span>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-white leading-snug">
                      {card.fromStateLabel} {card.professionLabel}
                    </div>
                    <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-cyan-300">
                      <ArrowRight className="h-3 w-3" />
                      <span>{card.toStateLabel}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-2.5 py-2">
                      <div className="font-mono-tech text-xl font-bold text-emerald-300">
                        {card.successRatePct}%
                      </div>
                      <div className="text-[10px] text-slate-400">Reported state shift</div>
                    </div>
                    <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-2">
                      <div className="font-mono-tech text-xl font-bold text-cyan-200">
                        {card.fullFinishPct}%
                      </div>
                      <div className="text-[10px] text-slate-400">Stayed to finish</div>
                    </div>
                  </div>
                </div>

                {/* PARTIALLY BLURRED LOCKED B2B DETAILS BOTTOM HALF */}
                <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/85 p-3">
                  <div
                    aria-hidden="true"
                    className="select-none space-y-1.5 blur-[4.5px] opacity-75 pointer-events-none"
                  >
                    <div className="flex items-center justify-between font-mono-tech text-[10px] text-slate-300">
                      <span>25%→50%→75%→90%</span>
                      <span>
                        {card.retentionCurve.pct25}% / {card.retentionCurve.pct50}% /{' '}
                        {card.retentionCurve.pct75}% / {card.retentionCurve.pct90}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-cyan-200">
                      <span>Winning genre:</span>
                      <span className="font-semibold">{card.blurredPreview.topGenreHint}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono-tech text-[10px] text-indigo-200">
                      <span>Exact DSP:</span>
                      <span>{card.blurredPreview.modulationHint}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono-tech text-[10px] text-emerald-300">
                      <span>PVT &amp; Control Lift:</span>
                      <span>
                        {card.blurredPreview.avgPvtShiftMs ?? -28} ms · +
                        {card.blurredPreview.abLiftPct ?? 18}% vs control
                      </span>
                    </div>
                  </div>

                  {/* Overlay CTA */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/35 backdrop-blur-[1px] p-2 text-center">
                    <button
                      type="button"
                      onClick={() => setSelectedCohortForModal(cohortTitle)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-[#070b15]/95 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.2)] transition hover:border-cyan-300 hover:bg-cyan-400/20"
                    >
                      <Lock className="h-3 w-3 text-cyan-300" />
                      Unlock Full Cohort Report
                    </button>
                    <span className="mt-1 text-[9px] text-slate-400">
                      Retention curve · DSP params · Winning genre
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Live cohorts unlock automatically from real opted-in sessions at{' '}
            <code className="font-mono-tech text-slate-300">n ≥ 5</code> (strict k-anonymity, zero
            PII).
          </span>
          <span className="font-mono-tech text-[10px] text-slate-500">
            Active live cohorts: {liveCohorts.length}
          </span>
        </div>
      </div>

      {selectedCohortForModal !== null && (
        <DatasetInquiryModal
          initialCohortInterest={selectedCohortForModal}
          onClose={() => setSelectedCohortForModal(null)}
        />
      )}
    </section>
  );
}
