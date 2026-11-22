import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Mic,
  MicOff,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { parseNaturalCheckIn, parseOnboardingAnswers } from '../../shared/parser';
import type {
  CurrentState,
  OutputDevice,
  SessionEnvironment,
  TargetState,
  UserProfile,
} from '../../shared/types';
import type { FieldMood } from './AmbientField';
import { SonicOrb } from './SonicOrb';

interface OnboardingViewProps {
  initialProfile?: UserProfile | null;
  onComplete: (
    profileData: Partial<UserProfile>,
    firstSession?: {
      rawInputText: string;
      currentState: CurrentState;
      baselineScore: number;
      targetState: TargetState;
      environment: SessionEnvironment;
      device: OutputDevice;
      durationMin: number;
      ageOverride?: number;
    }
  ) => Promise<void>;
  onMoodChange?: (mood: FieldMood) => void;
}

const WHO_HINTS = [
  '40-year-old minibus driver, easily distracted on long routes',
  '32yo software engineer doing deep desk work',
  '22yo medical student studying late at night',
  '37yo founder juggling stress and focus',
  '28yo writer looking for creative flow',
];

const SOUND_HINTS = [
  'Warm organic pads, vehicle speakers, nothing harsh',
  'Steady rhythmic pulse that keeps me sharp',
  'Minimal electronic on headphones',
  'Soft rain & gentle ambient textures',
  'Sensitive to sharp highs, keep noise soft',
];

const INTENT_HINTS = [
  'Distracted right now — need sharp focus for 40 minutes while driving',
  'Afternoon slump — need energy and clarity for 30 minutes',
  'Stressed and tense — want to calm down in 20 minutes',
  'Scattered mind — need deep flow for 50 minutes',
  'Racing thoughts — help me wind down for sleep (30 min)',
];

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function OnboardingView({ initialProfile, onComplete, onMoodChange }: OnboardingViewProps) {
  const isEditing = Boolean(initialProfile);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [whoText, setWhoText] = useState(
    initialProfile ? `Age ${initialProfile.age}, ${initialProfile.role.replace('_', ' ')}` : ''
  );
  const [soundText, setSoundText] = useState(
    initialProfile
      ? `${initialProfile.texturePref.replace('_', ' ')}, ${initialProfile.defaultDevice.replace('_', ' ')}`
      : ''
  );
  const [intentText, setIntentText] = useState('');
  const [baselineScore, setBaselineScore] = useState<number>(2);
  const [researchConsent, setResearchConsent] = useState<boolean>(
    initialProfile?.researchConsent ?? true
  );
  const [listeningField, setListeningField] = useState<1 | 2 | 3 | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parsedProfile = useMemo(
    () => parseOnboardingAnswers(whoText, soundText, initialProfile),
    [whoText, soundText, initialProfile]
  );

  const parsedIntent = useMemo(() => {
    const combined = `${whoText}. ${soundText}. ${intentText}`.trim();
    return parseNaturalCheckIn(combined, {
      age: parsedProfile.age,
      role: parsedProfile.role,
      defaultDevice: parsedProfile.defaultDevice,
    });
  }, [whoText, soundText, intentText, parsedProfile]);

  const currentMood: FieldMood = useMemo(() => {
    if (parsedIntent.environment === 'driving' || parsedProfile.role === 'driver') return 'driving';
    if (parsedIntent.targetState === 'calm_reset') return 'calm';
    if (parsedIntent.targetState === 'deep_flow') return 'flow';
    if (parsedIntent.targetState === 'sleep_winddown') return 'sleep';
    if (step === 3) return 'focus';
    return 'default';
  }, [parsedIntent, parsedProfile.role, step]);

  // Keep ambient field mood synced smoothly
  useEffect(() => {
    onMoodChange?.(currentMood);
  }, [currentMood, onMoodChange]);

  const startVoice = (targetStep: 1 | 2 | 3) => {
    const Win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Rec = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!Rec) return;

    const rec = new Rec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListeningField(targetStep);

    rec.onresult = (e) => {
      const t = e.results[0]?.[0]?.transcript ?? '';
      if (!t) return;
      if (targetStep === 1) setWhoText((prev) => (prev ? `${prev}, ${t}` : t));
      if (targetStep === 2) setSoundText((prev) => (prev ? `${prev}, ${t}` : t));
      if (targetStep === 3) setIntentText((prev) => (prev ? `${prev}, ${t}` : t));
    };
    rec.onerror = () => setListeningField(null);
    rec.onend = () => setListeningField(null);
    rec.start();
  };

  const appendHint = (current: string, setter: (v: string) => void, hint: string) => {
    if (!current.trim()) {
      setter(hint);
    } else if (!current.toLowerCase().includes(hint.toLowerCase().slice(0, 14))) {
      setter(`${current.trim()}, ${hint.toLowerCase()}`);
    }
  };

  const handleComplete = async (launchSession: boolean) => {
    setSubmitting(true);
    try {
      const profilePayload: Partial<UserProfile> = {
        id: initialProfile?.id,
        age: parsedIntent.extractedAge ?? parsedProfile.age,
        role: parsedIntent.extractedRole ?? parsedProfile.role,
        texturePref: parsedProfile.texturePref,
        noiseSensitivity: parsedProfile.noiseSensitivity,
        defaultDevice: parsedProfile.defaultDevice,
        primaryChallenge: parsedProfile.primaryChallenge,
        researchConsent,
      };

      if (launchSession) {
        await onComplete(profilePayload, {
          rawInputText: intentText.trim() || `${whoText} · ${soundText}`.trim(),
          currentState: parsedIntent.currentState,
          baselineScore,
          targetState: parsedIntent.targetState,
          environment: parsedIntent.environment,
          device: parsedIntent.device,
          durationMin: parsedIntent.durationMin,
          ageOverride: parsedIntent.extractedAge ?? parsedProfile.age,
        });
      } else {
        await onComplete(profilePayload);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const totalSteps = isEditing ? 2 : 3;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center">
      {/* First 2 seconds Hero — Animated Sonic Resonance Orb + Shimmer Editorial Headline */}
      <div className="animate-rise flex flex-col items-center text-center">
        <SonicOrb
          mood={currentMood}
          size={isEditing ? 'sm' : 'lg'}
          label={
            currentMood === 'driving'
              ? 'Driving Safety Calibration'
              : currentMood === 'calm'
                ? 'Autonomic Calm Field'
                : currentMood === 'flow'
                  ? 'Deep Flow Resonance'
                  : 'Open Research Beta · Free Year 1'
          }
        />

        <h1 className="animate-rise delay-75 mt-5 text-3xl font-bold tracking-tight text-white sm:text-5xl leading-[1.08]">
          {isEditing ? (
            <>
              Refine your <span className="text-aurora">acoustic profile</span>
            </>
          ) : (
            <>
              Sound that <span className="text-aurora">learns your mind.</span>
            </>
          )}
        </h1>

        <p className="animate-rise delay-150 mt-3 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base">
          Answer in your own words. We synthesize real-time psychoacoustic audio from peer-reviewed
          science — and adapt from every session you rate.
        </p>
      </div>

      {/* Minimal glowing step dots */}
      <div className="animate-rise delay-225 mt-6 mb-5 flex items-center gap-2.5">
        {Array.from({ length: totalSteps }, (_, idx) => idx + 1).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s as 1 | 2 | 3)}
            aria-label={`Step ${s}`}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              s === step
                ? 'w-10 bg-gradient-to-r from-cyan-400 to-indigo-400 shadow-[0_0_14px_rgba(34,211,238,0.65)]'
                : s < step
                  ? 'w-5 bg-cyan-400/50'
                  : 'w-5 bg-slate-800'
            }`}
          />
        ))}
      </div>

      {/* Conversational Free-Response Stage */}
      <div className="animate-rise delay-300 glass-stage w-full rounded-3xl p-6 sm:p-8">
        {step === 1 && (
          <div key="step-1" className="animate-step space-y-5">
            <div className="flex items-center justify-between">
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
                01 / {String(totalSteps).padStart(2, '0')} · Listener
              </span>
              <span className="text-[11px] text-slate-500">Type freely or speak</span>
            </div>

            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              Who is tuning in today?
            </h2>

            <div className="glow-input-wrap">
              <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
                <textarea
                  rows={2}
                  autoFocus
                  value={whoText}
                  onChange={(e) => setWhoText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      setStep(2);
                    }
                  }}
                  placeholder="Write freely — e.g. I'm a 40-year-old minibus driver who gets distracted on long routes..."
                  className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => startVoice(1)}
                  title="Speak your answer"
                  className={`absolute right-2.5 top-2.5 flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                    listeningField === 1
                      ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
                  }`}
                >
                  {listeningField === 1 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Subtle, whisper-soft suggested answers */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-slate-500">
                Or tap a subtle inspiration:
              </div>
              <div className="flex flex-wrap gap-2">
                {WHO_HINTS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => setWhoText(hint)}
                    className="subtle-chip rounded-full px-3 py-1.5 text-xs text-left"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>

            {/* Live subtle signal extraction */}
            {whoText.trim().length > 2 && parsedProfile.detectedHints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Cpu className="h-3 w-3 text-cyan-400/80" /> Calibrating:
                </span>
                {parsedProfile.detectedHints.slice(0, 4).map((h) => (
                  <span
                    key={h}
                    className="font-mono-tech rounded-md border border-cyan-400/20 bg-cyan-400/8 px-2 py-0.5 text-[11px] text-cyan-200/90"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-500">
                Anonymous · No account or email required
              </span>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-aurora inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-slate-950"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div key="step-2" className="animate-step space-y-5">
            <div className="flex items-center justify-between">
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
                02 / {String(totalSteps).padStart(2, '0')} · Soundscape & Output
              </span>
              <span className="text-[11px] text-slate-500">Your ears, your rules</span>
            </div>

            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              What kind of sound feels best — and how do you listen?
            </h2>

            <div className="glow-input-wrap">
              <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
                <textarea
                  rows={2}
                  autoFocus
                  value={soundText}
                  onChange={(e) => setSoundText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (isEditing) void handleComplete(false);
                      else setStep(3);
                    }
                  }}
                  placeholder="e.g. Warm smooth beats on vehicle speakers, no piercing highs or harsh static..."
                  className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => startVoice(2)}
                  title="Speak your preference"
                  className={`absolute right-2.5 top-2.5 flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                    listeningField === 2
                      ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
                  }`}
                >
                  {listeningField === 2 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-slate-500">
                Subtle suggestions (tap to add):
              </div>
              <div className="flex flex-wrap gap-2">
                {SOUND_HINTS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => appendHint(soundText, setSoundText, hint)}
                    className="subtle-chip rounded-full px-3 py-1.5 text-xs text-left"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>

            {parsedProfile.detectedHints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Sparkles className="h-3 w-3 text-indigo-400" /> Profile DNA:
                </span>
                {parsedProfile.detectedHints.map((h) => (
                  <span
                    key={h}
                    className="font-mono-tech rounded-md border border-indigo-400/25 bg-indigo-500/10 px-2 py-0.5 text-[11px] text-indigo-200"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>

              {isEditing ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleComplete(false)}
                  className="btn-aurora inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {submitting ? 'Saving...' : 'Save Profile'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="btn-aurora inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-slate-950"
                >
                  One last thing
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {step === 3 && !isEditing && (
          <div key="step-3" className="animate-step space-y-5">
            <div className="flex items-center justify-between">
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
                03 / 03 · Instant Session
              </span>
              <span className="text-[11px] text-slate-500">Ready to tune</span>
            </div>

            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              How do you feel right now — and where do you want to be?
            </h2>

            <div className="glow-input-wrap">
              <div className="relative flex items-start rounded-[1rem] bg-[#060a14]/95">
                <textarea
                  rows={2}
                  autoFocus
                  value={intentText}
                  onChange={(e) => setIntentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleComplete(true);
                    }
                  }}
                  placeholder="e.g. I feel distracted right now and want sharp focus for the next 40 minutes..."
                  className="w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-sm text-white placeholder-slate-500/80 focus:outline-none sm:text-base"
                />
                <button
                  type="button"
                  onClick={() => startVoice(3)}
                  title="Speak your current state"
                  className={`absolute right-2.5 top-2.5 flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                    listeningField === 3
                      ? 'animate-pulse border-rose-400 bg-rose-500/20 text-rose-300'
                      : 'border-slate-700/70 bg-slate-900/80 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/10'
                  }`}
                >
                  {listeningField === 3 ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-slate-500">Subtle ideas:</div>
              <div className="flex flex-wrap gap-2">
                {INTENT_HINTS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => setIntentText(hint)}
                    className="subtle-chip rounded-full px-3 py-1.5 text-xs text-left"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>

            {/* Sleek Baseline Rating Bar */}
            <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/55 px-4 py-3 sm:flex-row sm:items-center">
              <div>
                <div className="text-xs font-medium text-slate-300">Current baseline (1–5)</div>
                <div className="text-[11px] text-slate-500">So we measure your real Δ shift after</div>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBaselineScore(n)}
                    className={`h-9 w-9 rounded-xl border font-mono-tech text-xs font-bold transition-all ${
                      baselineScore === n
                        ? 'scale-105 border-cyan-400 bg-cyan-400/20 text-white shadow-[0_0_18px_rgba(34,211,238,0.35)]'
                        : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Live detected session tags */}
            {parsedIntent.detectedKeywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Cpu className="h-3 w-3 text-cyan-400" /> Protocol blueprint:
                </span>
                {parsedIntent.detectedKeywords.map((k) => (
                  <span
                    key={k}
                    className="font-mono-tech rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}

            {/* Ultra-clean inline Open Research consent */}
            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={researchConsent}
                onChange={(e) => setResearchConsent(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-cyan-400"
              />
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
              <span>
                Free during Year 1 Open Research — allow my anonymous session outcomes to train the
                engine.
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleComplete(true)}
                className="btn-aurora inline-flex flex-1 items-center justify-center gap-2.5 rounded-xl px-6 py-3.5 text-sm font-bold text-slate-950 sm:flex-initial disabled:opacity-60"
              >
                <Play className="h-4 w-4 fill-slate-950" />
                {submitting
                  ? 'Synthesizing protocol...'
                  : `Generate & Play (${parsedIntent.durationMin} min)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
