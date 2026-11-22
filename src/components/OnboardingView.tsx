import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Headphones,
  Mic,
  MicOff,
  Music2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { parseNaturalCheckIn, parseOnboardingAnswers } from '../../shared/parser';
import type {
  CurrentState,
  MusicGenreChoice,
  OutputDevice,
  ResolvedGenre,
  SessionEnvironment,
  TargetState,
  UserProfile,
} from '../../shared/types';
import { DEVICE_LABELS, GENRE_META } from '../../shared/types';
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
      requestedGenre?: MusicGenreChoice;
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
  const [step, setStep] = useState<1 | 2>(1);

  const [whoText, setWhoText] = useState(
    initialProfile ? `Age ${initialProfile.age}, ${initialProfile.role.replace('_', ' ')}` : ''
  );
  const [intentText, setIntentText] = useState('');
  const [soundNote, setSoundNote] = useState('');
  const [showSoundNote, setShowSoundNote] = useState(false);
  const [genreChoice, setGenreChoice] = useState<MusicGenreChoice>('auto');
  const [deviceOverride, setDeviceOverride] = useState<OutputDevice | null>(
    initialProfile?.defaultDevice ?? null
  );
  const [baselineScore, setBaselineScore] = useState<number>(2);
  const [researchConsent, setResearchConsent] = useState<boolean>(
    initialProfile?.researchConsent ?? true
  );
  const [listeningField, setListeningField] = useState<1 | 2 | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parsedProfile = useMemo(
    () => parseOnboardingAnswers(whoText, soundNote, initialProfile),
    [whoText, soundNote, initialProfile]
  );

  const parsedIntent = useMemo(() => {
    const combined = `${whoText}. ${intentText}. ${soundNote}`.trim();
    return parseNaturalCheckIn(combined, {
      age: parsedProfile.age,
      role: parsedProfile.role,
      defaultDevice: deviceOverride ?? parsedProfile.defaultDevice,
    });
  }, [whoText, intentText, soundNote, parsedProfile, deviceOverride]);

  const effectiveDevice: OutputDevice =
    parsedIntent.environment === 'driving'
      ? 'car_audio'
      : (deviceOverride ?? parsedIntent.device);

  const currentMood: FieldMood = useMemo(() => {
    if (parsedIntent.environment === 'driving' || parsedProfile.role === 'driver') return 'driving';
    if (parsedIntent.targetState === 'calm_reset') return 'calm';
    if (parsedIntent.targetState === 'deep_flow') return 'flow';
    if (parsedIntent.targetState === 'sleep_winddown') return 'sleep';
    if (step === 2) return 'focus';
    return 'default';
  }, [parsedIntent, parsedProfile.role, step]);

  useEffect(() => {
    onMoodChange?.(currentMood);
  }, [currentMood, onMoodChange]);

  const startVoice = (targetStep: 1 | 2) => {
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
      if (targetStep === 2) setIntentText((prev) => (prev ? `${prev}, ${t}` : t));
    };
    rec.onerror = () => setListeningField(null);
    rec.onend = () => setListeningField(null);
    rec.start();
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
        defaultDevice: effectiveDevice,
        primaryChallenge: parsedProfile.primaryChallenge,
        researchConsent,
      };

      if (launchSession) {
        await onComplete(profilePayload, {
          rawInputText: intentText.trim() || whoText.trim(),
          currentState: parsedIntent.currentState,
          baselineScore,
          targetState: parsedIntent.targetState,
          environment: parsedIntent.environment,
          device: effectiveDevice,
          durationMin: parsedIntent.durationMin,
          ageOverride: parsedIntent.extractedAge ?? parsedProfile.age,
          requestedGenre: genreChoice === 'auto' ? (parsedIntent.extractedGenre ?? 'auto') : genreChoice,
        });
      } else {
        await onComplete(profilePayload);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
              Refine your <span className="text-aurora">listener profile</span>
            </>
          ) : (
            <>
              Sound that <span className="text-aurora">learns your mind.</span>
            </>
          )}
        </h1>

        <p className="animate-rise delay-150 mt-3 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base">
          Tell us who you are and how you want to feel — <strong className="text-slate-200">nootropic.fm</strong>{' '}
          searches peer-reviewed studies and chooses the optimal psychoacoustic sound automatically.
        </p>
      </div>

      {/* Minimal glowing step dots (just 2 steps!) */}
      {!isEditing && (
        <div className="animate-rise delay-225 mt-6 mb-5 flex items-center gap-2.5">
          {[1, 2].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s as 1 | 2)}
              aria-label={`Step ${s}`}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                s === step
                  ? 'w-12 bg-gradient-to-r from-cyan-400 to-indigo-400 shadow-[0_0_14px_rgba(34,211,238,0.65)]'
                  : 'w-6 bg-cyan-400/35'
              }`}
            />
          ))}
        </div>
      )}

      {/* Conversational Free-Response Stage */}
      <div className="animate-rise delay-300 glass-stage mt-4 w-full rounded-3xl p-6 sm:p-8">
        {step === 1 && (
          <div key="step-1" className="animate-step space-y-5">
            <div className="flex items-center justify-between">
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
                {isEditing ? 'Listener Profile' : '01 / 02 · Listener'}
              </span>
              <span className="text-[11px] text-slate-500">Write freely or speak</span>
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
                      if (isEditing) void handleComplete(false);
                      else setStep(2);
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

            {whoText.trim().length > 2 && parsedProfile.detectedHints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Cpu className="h-3 w-3 text-cyan-400/80" /> Understood:
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
                  onClick={() => setStep(2)}
                  className="btn-aurora inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-slate-950"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {step === 2 && !isEditing && (
          <div key="step-2" className="animate-step space-y-5">
            <div className="flex items-center justify-between">
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
                02 / 02 · Mental State & Science Match
              </span>
              <span className="text-[11px] text-emerald-300/90">Auto-sound enabled</span>
            </div>

            <h2 className="text-xl font-semibold text-white sm:text-2xl">
              How do you feel right now — and what state do you want?
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
                  onClick={() => startVoice(2)}
                  title="Speak your current state"
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

            {/* Music Layer (Taste Carrier) + Output Device */}
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-cyan-200">
                  <Music2 className="h-4 w-4 text-cyan-300" />
                  <span>Music layer wrapped around the science (optional)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSoundNote((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-200"
                >
                  Any sound dislikes?
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${showSoundNote ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setGenreChoice('auto')}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    genreChoice === 'auto'
                      ? 'border-cyan-400/80 bg-cyan-400/20 text-white shadow-[0_0_16px_rgba(34,211,238,0.25)]'
                      : 'subtle-chip'
                  }`}
                >
                  <Sparkles className="h-3 w-3 text-cyan-300" />
                  Auto (Science picks)
                </button>
                {(Object.keys(GENRE_META) as ResolvedGenre[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenreChoice(g)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      genreChoice === g
                        ? 'border-indigo-400/80 bg-indigo-500/22 text-white shadow-[0_0_16px_rgba(129,140,248,0.28)]'
                        : 'subtle-chip'
                    }`}
                  >
                    {GENRE_META[g].label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
                  <Headphones className="h-3.5 w-3.5" /> Listening on:
                </span>
                {(['headphones', 'speakers', 'car_audio'] as OutputDevice[]).map((d) => {
                  const lockedByDriving = parsedIntent.environment === 'driving' && d !== 'car_audio';
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={lockedByDriving}
                      onClick={() => setDeviceOverride(d)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                        effectiveDevice === d
                          ? 'border-cyan-400/70 bg-cyan-400/20 text-white'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                      } ${lockedByDriving ? 'opacity-30 cursor-not-allowed' : ''}`}
                    >
                      {DEVICE_LABELS[d]}
                    </button>
                  );
                })}
              </div>

              {showSoundNote && (
                <input
                  type="text"
                  value={soundNote}
                  onChange={(e) => setSoundNote(e.target.value)}
                  placeholder="Optional — e.g. sensitive to high pitch, no rain, prefer deep bass..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none"
                />
              )}
            </div>

            {/* Baseline 1–5 */}
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

            {parsedIntent.detectedKeywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <Cpu className="h-3 w-3 text-cyan-400" /> Research query:
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

            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={researchConsent}
                onChange={(e) => setResearchConsent(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-cyan-400"
              />
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
              <span>
                Free during Year 1 Open Research — allow my anonymous outcomes to improve the engine.
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep(1)}
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
                <Sparkles className="h-4 w-4" />
                {submitting
                  ? 'Searching science...'
                  : `Search Science & Build Protocol (${parsedIntent.durationMin}m)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
