import { useState } from 'react';
import { CheckCircle2, Database, Lock, ShieldCheck, X } from 'lucide-react';
import type { DatasetInquiryPayload } from '../../shared/types';
import { api } from '../lib/api';

interface DatasetInquiryModalProps {
  initialCohortInterest?: string;
  onClose: () => void;
}

export function DatasetInquiryModal({
  initialCohortInterest = '',
  onClose,
}: DatasetInquiryModalProps) {
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [cohortInterest, setCohortInterest] = useState(initialCohortInterest);
  const [useCase, setUseCase] = useState<NonNullable<DatasetInquiryPayload['useCase']>>(
    'enterprise_wellness'
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitDatasetInquiry({
        email: email.trim(),
        organization: organization.trim(),
        roleTitle: roleTitle.trim() || undefined,
        cohortInterest: cohortInterest.trim() || undefined,
        useCase,
        notes: notes.trim() || undefined,
      });
      setSubmittedId(res.inquiryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit inquiry right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage my-auto w-full max-w-lg rounded-2xl border border-white/15 p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-0.5 font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#34D399]">
              <Database className="h-3 w-3" />
              Enterprise &amp; Research Data Licensing
            </div>
            <h3 className="text-base font-bold text-[#F3F1EC] sm:text-lg">
              Unlock Full Aggregated Cohort Datasets
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/10 hover:text-[#F3F1EC]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submittedId ? (
          <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-5 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-9 w-9 text-[#34D399]" />
            <div className="space-y-1">
              <div className="text-base font-bold text-[#F3F1EC]">Dataset Request Received</div>
              <p className="text-xs leading-relaxed text-[#D4D4CE]">
                Reference <code className="font-mono-tech text-[#34D399]">{submittedId}</code> has
                been logged. Our research data team will follow up at{' '}
                <strong className="text-[#F3F1EC]">{email}</strong> with cohort availability, retention
                curves, and licensing options.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-aurora w-full rounded-xl px-4 py-2.5 text-xs font-bold text-[#0A0B0C]"
            >
              Return to nootropic.fm
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3.5 py-2.5 text-[11px] leading-relaxed text-emerald-100/90 flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#34D399]" />
              <span>
                <strong>100% Anonymized · Zero PII:</strong> Licensed reports contain strictly
                aggregated cohort statistics (listening retention at 25%/50%/75%/90%+, exact DSP
                parameters, winning genres, PVT reaction-time deltas, and blinded A/B control
                lifts) for cohorts meeting k-anonymity thresholds.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#D4D4CE]">
                  Work or Research Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.com"
                  className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#D4D4CE]">
                  Organization / Lab *
                </label>
                <input
                  type="text"
                  required
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Company, University, or Brand"
                  className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#D4D4CE]">
                  Your Role (optional)
                </label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Head of R&D, Researcher"
                  className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#D4D4CE]">
                  Primary Use Case
                </label>
                <select
                  value={useCase}
                  onChange={(e) =>
                    setUseCase(e.target.value as NonNullable<DatasetInquiryPayload['useCase']>)
                  }
                  className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] focus:border-emerald-400 focus:outline-none"
                >
                  <option value="enterprise_wellness">Corporate / Workplace Wellness</option>
                  <option value="audio_hardware">Audio Hardware / Wearables</option>
                  <option value="academic_research">Academic / Scientific Research</option>
                  <option value="automotive_safety">Automotive / Fleet Alertness</option>
                  <option value="other">Other Commercial Licensing</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#D4D4CE]">
                Target Profession / State Cohort of Interest
              </label>
              <input
                type="text"
                value={cohortInterest}
                onChange={(e) => setCohortInterest(e.target.value)}
                placeholder="e.g. Stressed Doctors → Calm, Distracted Programmers → Deep Focus"
                className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#D4D4CE]">
                Specific Metrics Needed (optional)
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. 25/50/75/90% retention curves, optimal genre by age band, PVT ms delta CSV..."
                className="w-full resize-none rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-aurora flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-bold text-[#0A0B0C] disabled:opacity-60"
            >
              <Lock className="h-3.5 w-3.5" />
              {submitting ? 'Submitting Request...' : 'Request Full Dataset Access & Pricing'}
            </button>
            <p className="text-center text-[11px] text-[#8E8E88]">
              Prefer direct email? Write to{' '}
              <a
                href="mailto:research@nootropic.fm"
                className="font-medium text-[#34D399] underline-offset-2 hover:underline"
              >
                research@nootropic.fm
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
