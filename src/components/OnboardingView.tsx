import { useState } from 'react';
import { ArrowRight, CheckCircle2, Headphones, ShieldCheck, Sparkles, User } from 'lucide-react';
import type {
  NoiseSensitivity,
  OutputDevice,
  PrimaryChallenge,
  TexturePreference,
  UserProfile,
  UserRole,
} from '../../shared/types';
import { DEVICE_LABELS, ROLE_LABELS } from '../../shared/types';

interface OnboardingViewProps {
  initialProfile?: UserProfile | null;
  onComplete: (profileData: Partial<UserProfile>) => Promise<void>;
}

const TEXTURES: Array<{ id: TexturePreference; title: string; desc: string }> = [
  { id: 'warm_organic', title: 'Warm & Organic', desc: 'Soft harmonic pads, warm tone, zero harshness' },
  { id: 'rhythmic_pulse', title: 'Rhythmic Drive', desc: 'Subtle steady pulse that keeps you active and alert' },
  { id: 'minimal_electronic', title: 'Minimal Electronic', desc: 'Clean, modern, structured textures for deep focus' },
  { id: 'nature_drift', title: 'Ambient & Natural', desc: 'Slow, filtered flow inspired by rain and wind' },
];

const CHALLENGES: Array<{ id: PrimaryChallenge; label: string }> = [
  { id: 'distraction', label: 'Easily distracted / wandering mind' },
  { id: 'fatigue', label: 'Mental fatigue / monotony' },
  { id: 'stress', label: 'Stress / tension / racing thoughts' },
  { id: 'sleep', label: 'Hard to wind down / trouble sleeping' },
];

export function OnboardingView({ initialProfile, onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [age, setAge] = useState<number>(initialProfile?.age ?? 40);
  const [role, setRole] = useState<UserRole>(initialProfile?.role ?? 'driver');
  const [texturePref, setTexturePref] = useState<TexturePreference>(
    initialProfile?.texturePref ?? 'warm_organic'
  );
  const [noiseSensitivity, setNoiseSensitivity] = useState<NoiseSensitivity>(
    initialProfile?.noiseSensitivity ?? 'medium'
  );
  const [defaultDevice, setDefaultDevice] = useState<OutputDevice>(
    initialProfile?.defaultDevice ?? 'car_audio'
  );
  const [primaryChallenge, setPrimaryChallenge] = useState<PrimaryChallenge>(
    initialProfile?.primaryChallenge ?? 'distraction'
  );
  const [researchConsent, setResearchConsent] = useState<boolean>(
    initialProfile?.researchConsent ?? true
  );
  const [saving, setSaving] = useState(false);

  const handleFinish = async () => {
    setSaving(true);
    try {
      await onComplete({
        id: initialProfile?.id,
        age,
        role,
        texturePref,
        noiseSensitivity,
        defaultDevice,
        primaryChallenge,
        researchConsent,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-300">
          <Sparkles className="h-3.5 w-3.5" />
          Open Research Beta · 100% Free Year 1
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Calibrate <span className="text-cyan-400">nootropic.fm</span> to your mind
        </h1>
        <p className="mt-2 text-sm text-slate-400 sm:text-base">
          30 seconds once. The platform pairs peer-reviewed psychoacoustics with your real session
          outcomes so it learns exactly what works for you.
        </p>
      </div>

      <div className="mb-6 flex items-center justify-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1.5 w-20 rounded-full transition-all ${
              s <= step ? 'bg-cyan-400' : 'bg-slate-800'
            }`}
          />
        ))}
      </div>

      <div className="glass-card rounded-2xl p-6 sm:p-8">
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex items-center gap-2.5 text-cyan-300">
              <User className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-white">1. Who is listening?</h2>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-300">Your age</label>
                <span className="font-mono-tech rounded-lg bg-slate-800/90 px-2.5 py-1 text-sm font-semibold text-cyan-300">
                  {age} yrs
                </span>
              </div>
              <input
                type="range"
                min={16}
                max={80}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full cursor-pointer"
              />
              <p className="mt-1 text-xs text-slate-500">
                Used anonymously for high-frequency comfort calibration and age-cohort matching.
              </p>
            </div>

            <div>
              <label className="mb-2.5 block text-sm font-medium text-slate-300">
                Primary work or daily environment
              </label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRole(r);
                      if (r === 'driver') setDefaultDevice('car_audio');
                    }}
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                      role === r
                        ? 'border-cyan-400/70 bg-cyan-400/12 text-white shadow-sm shadow-cyan-500/10'
                        : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2.5 block text-sm font-medium text-slate-300">
                What is your biggest mental hurdle?
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CHALLENGES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPrimaryChallenge(c.id)}
                    className={`rounded-xl border px-3.5 py-2.5 text-left text-sm transition-all ${
                      primaryChallenge === c.id
                        ? 'border-indigo-400/70 bg-indigo-500/15 text-white'
                        : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center gap-2.5 text-cyan-300">
              <Headphones className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-white">2. Sensory Profile & Audio Output</h2>
            </div>

            <div>
              <label className="mb-2.5 block text-sm font-medium text-slate-300">
                Preferred sound texture
              </label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {TEXTURES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTexturePref(t.id)}
                    className={`rounded-xl border p-3.5 text-left transition-all ${
                      texturePref === t.id
                        ? 'border-cyan-400/70 bg-cyan-400/12 text-white'
                        : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2.5 block text-sm font-medium text-slate-300">
                Sensitivity to white/pink noise & high frequencies
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    ['low', 'Low', 'I enjoy sound masking'],
                    ['medium', 'Medium', 'Balanced'],
                    ['high', 'High', 'Keep tones very soft'],
                  ] as Array<[NoiseSensitivity, string, string]>
                ).map(([val, label, sub]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setNoiseSensitivity(val)}
                    className={`rounded-xl border p-3 text-center transition-all ${
                      noiseSensitivity === val
                        ? 'border-cyan-400/70 bg-cyan-400/12 text-white'
                        : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2.5 block text-sm font-medium text-slate-300">
                How do you usually listen?
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(DEVICE_LABELS) as OutputDevice[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDefaultDevice(d)}
                    className={`rounded-xl border px-3.5 py-3 text-sm transition-all ${
                      defaultDevice === d
                        ? 'border-indigo-400/70 bg-indigo-500/15 text-white'
                        : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {DEVICE_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Final step
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="flex items-center gap-2.5 text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-white">3. Open Research Pact (Free Year 1)</h2>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm leading-relaxed text-slate-300 space-y-2.5">
              <p>
                <strong className="text-white">How it works:</strong> you get full free access to
                personalized psychoacoustic protocols. All we ask is{' '}
                <span className="text-cyan-300 font-medium">10 seconds of feedback</span> after
                listening to tell us whether it worked.
              </p>
              <p>
                <strong className="text-white">Privacy by design:</strong> no email, name, or
                personal identity required. Your profile receives an anonymous ID; outcomes train our
                adaptive engine for both you and listeners with similar profiles.
              </p>
              <p className="text-xs text-amber-300/90">
                Transparency note: nootropic.fm is a cognitive wellness audio tool grounded in
                psychoacoustic literature — not a medical device, and never a substitute for sleep
                while driving.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4">
              <input
                type="checkbox"
                checked={researchConsent}
                onChange={(e) => setResearchConsent(e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-emerald-400"
              />
              <span className="text-sm text-slate-200">
                I agree that my anonymized session outcomes (before/after state, acoustic parameters,
                and effectiveness ratings) can improve nootropic.fm’s self-learning models.
              </span>
            </label>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleFinish}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {saving ? 'Saving profile...' : 'Save & enter studio'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
