import { useState } from 'react';
import { ArrowLeft, CheckCircle2, ShieldCheck, UserCheck } from 'lucide-react';
import {
  DEVICE_LABELS,
  GENDER_LABELS,
  ROLE_SHORT_LABELS,
  type NoiseSensitivity,
  type OutputDevice,
  type UserGender,
  type UserProfile,
  type UserRole,
} from '../../shared/types';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';

interface OnboardingViewProps {
  initialProfile?: UserProfile | null;
  themeMode?: 'daylight' | 'night';
  onComplete: (profileData: Partial<UserProfile>) => Promise<void>;
  onCancel?: () => void;
  onMoodChange?: (mood: FieldMood) => void;
}

export function OnboardingView({
  initialProfile,
  themeMode = 'night',
  onComplete,
  onCancel,
}: OnboardingViewProps) {
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? '');
  const [age, setAge] = useState<number>(Math.max(18, initialProfile?.age ?? 34));
  const [ageError, setAgeError] = useState<string | null>(null);
  const [gender, setGender] = useState<UserGender>(initialProfile?.gender ?? 'prefer_not_to_say');
  const [role, setRole] = useState<UserRole>(initialProfile?.role ?? 'knowledge_worker');
  const [occupationLabel, setOccupationLabel] = useState(initialProfile?.occupationLabel ?? '');
  const [defaultDevice, setDefaultDevice] = useState<OutputDevice>(
    initialProfile?.defaultDevice ?? 'headphones'
  );
  const [noiseSensitivity, setNoiseSensitivity] = useState<NoiseSensitivity>(
    initialProfile?.noiseSensitivity ?? 'medium'
  );
  const [researchConsent, setResearchConsent] = useState<boolean>(
    initialProfile?.researchConsent ?? false
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (!Number.isFinite(age) || age < 18 || age > 95) {
      setAgeError('nootropic.fm is restricted to listeners aged 18+.');
      return;
    }
    if (role === 'other' && occupationLabel.trim().length < 2) {
      setSaveError('Please type your profession or craft to continue.');
      return;
    }
    setAgeError(null);
    setSaveError(null);
    setSubmitting(true);
    try {
      await onComplete({
        id: initialProfile?.id,
        displayName: displayName.trim() || undefined,
        age: Math.round(age),
        gender,
        role,
        occupationLabel: occupationLabel.trim() || undefined,
        defaultDevice,
        noiseSensitivity,
        texturePref: initialProfile?.texturePref ?? 'warm_organic',
        primaryChallenge: initialProfile?.primaryChallenge ?? 'distraction',
        researchConsent,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save profile changes right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center space-y-6">
      <div className="animate-rise flex flex-col items-center text-center">
        <SonicOrb mood="focus" size="sm" label="Neural Identity" themeMode={themeMode} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-[#F3F1EC] sm:text-3xl">
          Refine your <span className="text-[#34D399]">Neural Identity</span>
        </h1>
        <p className="mt-1.5 max-w-md text-xs text-[#A3A39E] sm:text-sm">
          Updates apply to future recommendations and keep all your learned Bandit session history intact.
        </p>
      </div>

      <div className="animate-step glass-stage w-full rounded-2xl p-5 sm:p-8 space-y-5">
        <div className="flex items-center gap-2 text-[#34D399]">
          <UserCheck className="h-4 w-4" />
          <span className="font-mono-tech text-[11px] uppercase tracking-[0.16em]">
            Profile Details (18+)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <label htmlFor="onb-display-name" className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
              First name / Nickname (optional)
            </label>
            <input
              id="onb-display-name"
              type="text"
              maxLength={28}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="onb-age" className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
              Age (18+)
            </label>
            <input
              id="onb-age"
              type="number"
              min={18}
              max={95}
              value={age}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAge(v);
                if (v >= 18 && v <= 95) setAgeError(null);
              }}
              className="font-mono-tech w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="onb-occupation" className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
              Occupation (optional)
            </label>
            <input
              id="onb-occupation"
              type="text"
              maxLength={40}
              value={occupationLabel}
              onChange={(e) => {
                setOccupationLabel(e.target.value);
                setSaveError(null);
              }}
              placeholder="e.g. Programmer, Driver"
              className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-[#A3A39E]">Gender (optional)</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(['male', 'female', 'non_binary', 'prefer_not_to_say'] as UserGender[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  gender === g
                    ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                    : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/25 hover:text-[#F3F1EC]'
                }`}
              >
                {GENDER_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-[#A3A39E]">Primary Field / Role</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {(Object.keys(ROLE_SHORT_LABELS) as UserRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRole(r);
                  setSaveError(null);
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  role === r
                    ? 'border-emerald-400/60 bg-emerald-400/15 text-[#F3F1EC]'
                    : 'border-white/[0.08] bg-[#131417] text-[#A3A39E] hover:border-white/25 hover:text-[#F3F1EC]'
                }`}
              >
                {ROLE_SHORT_LABELS[r]}
              </button>
            ))}
          </div>
          {role === 'other' && (
            <div className="animate-step rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] p-3 space-y-1.5">
              <label htmlFor="onb-custom-role" className="block text-[11px] font-semibold text-[#34D399]">
                Type your profession or craft:
              </label>
              <input
                id="onb-custom-role"
                type="text"
                autoFocus
                maxLength={40}
                value={occupationLabel}
                onChange={(e) => {
                  setOccupationLabel(e.target.value);
                  setSaveError(null);
                }}
                placeholder="e.g. Architect, Surgeon, Pilot, Chef, Trader, Musician..."
                className="w-full rounded-xl border border-white/15 bg-[#0B0C0E] px-3 py-2 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="onb-default-device" className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
              Default Output
            </label>
            <select
              id="onb-default-device"
              value={defaultDevice}
              onChange={(e) => setDefaultDevice(e.target.value as OutputDevice)}
              className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] focus:border-emerald-400 focus:outline-none"
            >
              {(Object.keys(DEVICE_LABELS) as OutputDevice[]).map((d) => (
                <option key={d} value={d}>
                  {DEVICE_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="onb-sensitivity" className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
              Sound Sensitivity
            </label>
            <select
              id="onb-sensitivity"
              value={noiseSensitivity}
              onChange={(e) => setNoiseSensitivity(e.target.value as NoiseSensitivity)}
              className="w-full rounded-xl border border-white/12 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] focus:border-emerald-400 focus:outline-none"
            >
              <option value="low">Low (loves rich pulse)</option>
              <option value="medium">Balanced</option>
              <option value="high">Sensitive (keep soft)</option>
            </select>
          </div>
        </div>

        {ageError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
            {ageError}
          </div>
        )}
        {saveError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
            {saveError}
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#D4D4CE]">
          <input
            type="checkbox"
            checked={researchConsent}
            onChange={(e) => setResearchConsent(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded accent-emerald-400"
          />
          <span>
            <strong className="inline-flex items-center gap-1 text-[#34D399]">
              <ShieldCheck className="h-3.5 w-3.5" /> Open Research &amp; Retention Learning:
            </strong>{' '}
            Allow this Neural Identity to learn from your explicit debriefs, behavioral listen
            retention, and occasional blind pure-music control trials.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#14161A] px-4 py-3.5 text-xs font-medium text-[#D4D4CE] hover:border-white/25 hover:text-[#F3F1EC]"
            >
              <ArrowLeft className="h-4 w-4" />
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSave()}
            className="btn-aurora flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 py-3.5 text-sm font-bold text-[#0A0B0C] disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {submitting ? 'Saving Neural Identity...' : 'Save Profile Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
