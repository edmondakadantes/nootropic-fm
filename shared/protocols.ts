import { getMicroStateById } from './neuralStates';
import { getCuratedGoalBySlug } from './openGoals';
import {
  composeScientificMusicPrompt,
  getGenreDisplayMeta,
  pickClosestCoreGenre,
  sanitizeCustomVibe,
} from './promptComposer';
import { getStudiesByIds } from './studies';
import {
  NEURAL_EFFECT_MULT,
  assignStratifiedShamControl,
  computeHierarchicalArmPosterior,
  computeIsoBridgeForState,
  pickSmartInitialEffectTier,
  sampleHierarchicalThompson,
  type ComputedIsoBridge,
  type NeuralEffectTier,
} from './psychometrics';

export {
  NEURAL_EFFECT_MULT,
  computeIsoBridgeForState,
  pickSmartInitialEffectTier,
  type ComputedIsoBridge,
  type NeuralEffectTier,
};
import { buildCheckInExecutableSpec } from './studyPresets';
import { resolvedGenreToPalette, type ExecutableStudySpec } from './studySpec';
import type {
  AcousticParams,
  AgeBand,
  AudioSourceType,
  CurrentState,
  EnergyTier,
  FormulaIngredient,
  LiveAdjustment,
  MusicGenreChoice,
  OutputDevice,
  ProtocolArm,
  ProtocolRecommendation,
  ResolvedGenre,
  SessionEnvironment,
  TargetState,
  TimeOfDayBucket,
  UserProfile,
  UserRole,
  WorkedRating,
} from './types';
import { ENERGY_LABELS, ENV_LABELS, ROLE_SHORT_LABELS, STATE_LABELS, TARGET_LABELS } from './types';

/**
 * Candidate acoustic arms (protocols) explored & optimized by the Contextual Bandit.
 * 3-Band Linkwitz-Riley (LR4) crossover keeps sub-bass (<190 Hz) and air (>4.5 kHz) 100% clean,
 * while applying organic Iso-Adaptive AM strictly in the 190 Hz–4.5 kHz cortical band.
 */
export const PROTOCOL_ARMS: ProtocolArm[] = [
  {
    id: 'beta-drive-16hz',
    name: 'Beta-Drive 16 Hz',
    tagline: '16 Hz Beta 3-Band LR4 AM + warm anti-monotony pulse',
    description:
      'Engineered for sustained real-world attention: 16 Hz mid-band cortical amplitude modulation (Woods et al. 2024), gentle 106 BPM rhythmic anchor, and traffic-safe frequency shaping.',
    targetStates: ['alert_focus', 'energy_lift'],
    drivingSafe: true,
    priorAlpha: 3.4,
    priorBeta: 1.2,
    baseParams: {
      modulationHz: 16,
      modulationDepth: 0.38,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 106,
      pulseIntensity: 0.54,
      noiseColor: 'pink',
      noiseLevel: 0.08,
      harmonicMode: 'bright_maj9',
      rootNoteHz: 146.83, // D3
      filterCutoffHz: 1700,
      speakerSafeEQ: true,
      antiMonotonyCycleMin: 5,
      binauralOffsetHz: 0,
    },
    studyIds: [
      'woods-2024-am-attention',
      'salimpoor-2011-dopamine-preference',
      'unal-2013-driving-audio',
      'perham-2014-lyric-interference',
      'heiderscheit-2015-iso-principle',
    ],
  },
  {
    id: 'crisp-vigilance-18hz',
    name: 'Crisp Vigilance 18 Hz',
    tagline: '18 Hz high-beta 3-Band LR4 AM + uplifting alertness dynamics',
    description:
      'Slightly brighter vigilance profile (18 Hz AM, 114 BPM) with subtle 4-minute anti-monotony lifts to counter afternoon fatigue and road distraction.',
    targetStates: ['alert_focus', 'energy_lift'],
    drivingSafe: true,
    priorAlpha: 2.8,
    priorBeta: 1.4,
    baseParams: {
      modulationHz: 18,
      modulationDepth: 0.4,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 114,
      pulseIntensity: 0.66,
      noiseColor: 'pink',
      noiseLevel: 0.06,
      harmonicMode: 'suspended_open',
      rootNoteHz: 164.81, // E3
      filterCutoffHz: 2100,
      speakerSafeEQ: true,
      antiMonotonyCycleMin: 4,
      binauralOffsetHz: 0,
    },
    studyIds: [
      'woods-2024-am-attention',
      'salimpoor-2011-dopamine-preference',
      'unal-2013-driving-audio',
      'husain-2002-tempo-arousal',
      'heiderscheit-2015-iso-principle',
    ],
  },
  {
    id: 'steady-horizon-14hz',
    name: 'Steady Horizon 14 Hz',
    tagline: 'Calm 14 Hz SMR/Low-Beta 3-Band AM + smooth groove',
    description:
      'Tailored for listeners sensitive to intense stimulation: gentle 14 Hz mid-band AM, warm harmonies, minimal noise floor, and a steady 96 BPM pulse for tension-free focus.',
    targetStates: ['alert_focus', 'deep_flow'],
    drivingSafe: true,
    priorAlpha: 3.0,
    priorBeta: 1.3,
    baseParams: {
      modulationHz: 14,
      modulationDepth: 0.34,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 96,
      pulseIntensity: 0.38,
      noiseColor: 'brown',
      noiseLevel: 0.1,
      harmonicMode: 'warm_min9',
      rootNoteHz: 130.81, // C3
      filterCutoffHz: 1400,
      speakerSafeEQ: true,
      antiMonotonyCycleMin: 6,
      binauralOffsetHz: 0,
    },
    studyIds: [
      'woods-2024-am-attention',
      'salimpoor-2011-dopamine-preference',
      'soderlund-2010-stochastic-noise',
      'perham-2014-lyric-interference',
    ],
  },
  {
    id: 'deep-stochastic-flow',
    name: 'Deep Stochastic Flow 15 Hz',
    tagline: 'Stochastic pink-noise masking + 15 Hz 3-Band AM for Deep Work',
    description:
      'Built for uninterrupted desk work and study: pairs calibrated pink noise (Söderlund et al.) with rich instrumental voicings and 15 Hz mid-band cortical AM.',
    targetStates: ['deep_flow', 'alert_focus'],
    drivingSafe: false,
    priorAlpha: 3.2,
    priorBeta: 1.2,
    baseParams: {
      modulationHz: 15,
      modulationDepth: 0.36,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 90,
      pulseIntensity: 0.3,
      noiseColor: 'pink',
      noiseLevel: 0.2,
      harmonicMode: 'warm_min9',
      rootNoteHz: 110.0, // A2
      filterCutoffHz: 1250,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 0,
    },
    studyIds: [
      'woods-2024-am-attention',
      'salimpoor-2011-dopamine-preference',
      'soderlund-2010-stochastic-noise',
      'perham-2014-lyric-interference',
      'garcia-argibay-2019-binaural-meta',
    ],
  },
  {
    id: 'alpha-parasympathetic-10hz',
    name: 'Alpha Reset 10 Hz',
    tagline: 'Slow harmonies + 10 Hz Alpha cadence for autonomic calm',
    description:
      'Zero harsh percussion: warm organic voicings, gentle 10 Hz mid-band Alpha modulation, and soft filtered texture to transition smoothly from tension into calm clarity.',
    targetStates: ['calm_reset', 'deep_flow'],
    drivingSafe: false,
    priorAlpha: 3.3,
    priorBeta: 1.1,
    baseParams: {
      modulationHz: 10,
      modulationDepth: 0.24,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 66,
      pulseIntensity: 0.14,
      noiseColor: 'soft_rain',
      noiseLevel: 0.16,
      harmonicMode: 'suspended_open',
      rootNoteHz: 130.81, // C3
      filterCutoffHz: 980,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 3,
    },
    studyIds: [
      'thoma-2013-music-stress-hpa',
      'salimpoor-2011-dopamine-preference',
      'heiderscheit-2015-iso-principle',
      'garcia-argibay-2019-binaural-meta',
    ],
  },
  {
    id: 'theta-drift-6hz',
    name: 'Theta Wind-Down 6 Hz',
    tagline: 'Slow pre-sleep harmonies, velvety brown noise & 6 Hz drift',
    description:
      'Gradual Iso-Principle nocturnal down-regulation: beatless/slow warm harmonies grounded in Cochrane sleep-music evidence (Jespersen et al. 2022) and ultra-gentle 6 Hz drift.',
    targetStates: ['sleep_winddown', 'calm_reset'],
    drivingSafe: false,
    priorAlpha: 3.1,
    priorBeta: 1.2,
    baseParams: {
      modulationHz: 6,
      modulationDepth: 0.2,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 0,
      pulseIntensity: 0,
      noiseColor: 'brown',
      noiseLevel: 0.24,
      harmonicMode: 'deep_drone',
      rootNoteHz: 98.0, // G2
      filterCutoffHz: 680,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 2.5,
    },
    studyIds: [
      'jespersen-2022-cochrane-sleep',
      'thoma-2013-music-stress-hpa',
      'salimpoor-2011-dopamine-preference',
      'heiderscheit-2015-iso-principle',
    ],
  },
  {
    id: 'nootropic-trance-6x40hz',
    name: 'NootropicFM Trance Lock 6×40 Hz',
    tagline: '14→6 Hz Theta × 40 Hz Gamma CFC + 120 BPM polyrhythmic sub-harmonic tunnel',
    description:
      'Signature absorptive trance architecture: glides from 14 Hz Beta capture into 6.0 Hz frontal-midline Theta nesting 40.0 Hz Gamma bursts (Lisman & Jensen 2013), locked to a 120.000 BPM (2.0 Hz) polyrhythmic dub-trance pulse.',
    targetStates: ['deep_flow', 'alert_focus'],
    drivingSafe: false,
    priorAlpha: 3.9,
    priorBeta: 1.1,
    baseParams: {
      modulationHz: 6,
      modulationDepth: 0.42,
      crossoverHz: 190,
      upperCrossoverHz: 4500,
      bpm: 120,
      pulseIntensity: 0.58,
      noiseColor: 'brown',
      noiseLevel: 0.08,
      harmonicMode: 'suspended_open',
      rootNoteHz: 146.83, // D3
      filterCutoffHz: 2200,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 0,
    },
    studyIds: [
      'lisman-jensen-2013-theta-gamma-cfc',
      'salimpoor-2011-dopamine-preference',
      'heiderscheit-2015-iso-principle',
      'perham-2014-lyric-interference',
    ],
  },
];

export interface BanditStatRow {
  armId: string;
  alpha: number;
  beta: number;
  trials: number;
  avgDelta: number;
  avgCompletion: number;
}

export function buildCohortKey(
  ageBand: AgeBand,
  environment: SessionEnvironment,
  targetState: TargetState,
  role?: UserRole,
  currentState?: CurrentState,
  customGoalSlug?: string
): string {
  const goalKey = customGoalSlug || targetState;
  if (role && currentState) {
    return `${ageBand}|${role}|${currentState}|${goalKey}|${environment}`;
  }
  return `${ageBand}|${environment}|${goalKey}`;
}

export function formatCohortLabel(cohortKey: string): string {
  const formatGoal = (g: string): string => {
    const curated = getCuratedGoalBySlug(g);
    if (curated) return curated.label;
    if (g in TARGET_LABELS) return TARGET_LABELS[g as TargetState];
    if (g.startsWith('custom:')) {
      return g
        .slice(7)
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
    return g;
  };

  const parts = cohortKey.split('|');
  if (parts.length >= 5) {
    const [ageBand, role, currentState, goalKey, env] = parts as [
      AgeBand,
      UserRole,
      CurrentState,
      string,
      SessionEnvironment,
    ];
    const roleLabel = ROLE_SHORT_LABELS[role] ?? role;
    const stateShort = (STATE_LABELS[currentState] ?? currentState).split(' / ')[0];
    const targetLabel = formatGoal(goalKey);
    const envShort = env === 'driving' ? ' · Driving' : '';
    return `Age ${ageBand} · ${roleLabel}${envShort} · ${stateShort} → ${targetLabel}`;
  }
  const [ageBand, env, goalKey] = parts as [AgeBand, SessionEnvironment, string];
  const envLabel = ENV_LABELS[env] ?? env;
  const targetLabel = formatGoal(goalKey);
  return `Age ${ageBand} · ${envLabel} · ${targetLabel}`;
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      const u1 = Math.max(1e-9, Math.random());
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(Math.max(0.1, alpha));
  const y = sampleGamma(Math.max(0.1, beta));
  return x / (x + y);
}

export function computeSessionReward(input: {
  baselineScore: number;
  postScore: number;
  workedRating: WorkedRating;
  completionRatio: number;
  liveAdjustments: LiveAdjustment[];
  pvtDeltaInvRt?: number | null;
  pvtTrialCount?: number | null;
}): { reward: number; delta: number } {
  const delta = input.postScore - input.baselineScore;
  const deltaSignal = Math.max(0, Math.min(1, 0.45 + delta * 0.18));
  const ratingSignal =
    input.workedRating === 'yes' ? 1.0 : input.workedRating === 'partial' ? 0.55 : 0.1;
  const completionSignal = Math.max(0.15, Math.min(1, input.completionRatio));
  const adjustPenalty = Math.min(0.12, input.liveAdjustments.length * 0.02);

  const subjReward = Math.max(
    0.05,
    Math.min(0.98, ratingSignal * 0.5 + deltaSignal * 0.35 + completionSignal * 0.15 - adjustPenalty)
  );

  let reward = subjReward;
  if (
    (input.pvtTrialCount ?? 0) >= 15 &&
    typeof input.pvtDeltaInvRt === 'number' &&
    Number.isFinite(input.pvtDeltaInvRt)
  ) {
    const pvtSignal = Math.max(0.1, Math.min(0.95, 0.5 + input.pvtDeltaInvRt * 0.45));
    reward = Math.max(0.05, Math.min(0.98, subjReward * 0.85 + pvtSignal * 0.15));
  }

  return { reward: Number(reward.toFixed(3)), delta };
}

export function buildFactorizedMarginalScopes(input: {
  targetState: TargetState;
  customGoalSlug?: string;
  currentState?: CurrentState;
  environment: SessionEnvironment;
  role?: UserRole;
}): Array<{ scopeType: 'marginal_goal_state' | 'marginal_goal_env' | 'marginal_goal_role'; scopeId: string }> {
  const goalKey = input.customGoalSlug || input.targetState;
  const out: Array<{
    scopeType: 'marginal_goal_state' | 'marginal_goal_env' | 'marginal_goal_role';
    scopeId: string;
  }> = [{ scopeType: 'marginal_goal_env', scopeId: `${goalKey}|${input.environment}` }];
  if (input.currentState) {
    out.unshift({ scopeType: 'marginal_goal_state', scopeId: `${goalKey}|${input.currentState}` });
  }
  if (input.role) {
    out.push({ scopeType: 'marginal_goal_role', scopeId: `${goalKey}|${input.role}` });
  }
  return out;
}

/**
 * Implicit behavioral retention reward (weight 0.45) — learns automatically even when
 * a user closes the tab without submitting explicit 10s debrief, and penalizes <25% early aborts
 * to eliminate survivorship bias!
 */
export function computeImplicitReward(input: {
  actualDurationSec: number;
  completionRatio: number;
  isEarlyBounce: boolean;
  instantGenreSwapped: boolean;
}): { reward: number; outcome: 'completed_retention' | 'steady_listen' | 'early_bounce' | 'instant_swap' } {
  if (input.instantGenreSwapped) {
    return { reward: 0.2, outcome: 'instant_swap' };
  }
  if (
    input.isEarlyBounce ||
    input.actualDurationSec < 90 ||
    (input.completionRatio < 0.25 && input.actualDurationSec < 600)
  ) {
    const abortReward =
      input.actualDurationSec < 90
        ? 0.16
        : Number((0.18 + Math.max(0, input.completionRatio) * 0.28).toFixed(3));
    return { reward: abortReward, outcome: 'early_bounce' };
  }
  if (input.completionRatio >= 0.75) {
    return { reward: 0.84, outcome: 'completed_retention' };
  }
  // Partial listen (>= 25% completion or >= 10m) -> neutral-positive scaled cleanly
  const scaled = 0.48 + Math.min(0.32, input.completionRatio * 0.42);
  return { reward: Number(scaled.toFixed(3)), outcome: 'steady_listen' };
}

export function resolveEnergyTier(
  targetState: TargetState,
  environment: SessionEnvironment,
  currentState: CurrentState
): EnergyTier {
  if (targetState === 'sleep_winddown' || targetState === 'calm_reset') return 'calm';
  if (environment === 'driving' || targetState === 'energy_lift') return 'drive';
  if (currentState === 'fatigued' && targetState === 'alert_focus') return 'drive';
  return 'focus';
}

const ALL_GENRES: ResolvedGenre[] = [
  'nootropic_trance',
  'deep_electronic',
  'lofi_keys',
  'cinematic_strings',
  'jazz_rhodes',
  'acoustic_pluck',
  'nature_rain',
  'dub_reggae',
  'ambient_space',
  'solo_piano',
  'bossa_nova',
];

function getGenrePrior(
  genre: ResolvedGenre,
  targetState: TargetState,
  environment: SessionEnvironment,
  _currentState: CurrentState,
  profile: UserProfile
): { alpha: number; beta: number } {
  const isDriving = environment === 'driving';
  let alpha = 2.0;
  const beta = 1.6;

  if (targetState === 'sleep_winddown') {
    if (genre === 'nature_rain' || genre === 'ambient_space') alpha = 3.8;
    else if (genre === 'solo_piano' || genre === 'cinematic_strings' || genre === 'acoustic_pluck') alpha = 3.2;
    else if (genre === 'lofi_keys') alpha = 2.3;
    else alpha = 1.2;
  } else if (targetState === 'calm_reset') {
    if (genre === 'nature_rain' || genre === 'ambient_space' || genre === 'solo_piano') alpha = 3.6;
    else if (genre === 'acoustic_pluck' || genre === 'cinematic_strings' || genre === 'lofi_keys') alpha = 3.1;
    else if (genre === 'dub_reggae' || genre === 'bossa_nova') alpha = 2.7;
    else alpha = 1.8;
  } else if (isDriving || targetState === 'energy_lift') {
    if (genre === 'deep_electronic') alpha = 3.7;
    else if (genre === 'bossa_nova' || genre === 'dub_reggae' || genre === 'jazz_rhodes' || genre === 'lofi_keys') alpha = 3.2;
    else if (genre === 'acoustic_pluck') alpha = 2.6;
    else alpha = 1.4;
  } else if (targetState === 'deep_flow') {
    if (genre === 'nootropic_trance') alpha = 3.8;
    else if (genre === 'deep_electronic') alpha = 3.6;
    else if (genre === 'lofi_keys' || genre === 'cinematic_strings' || genre === 'solo_piano') alpha = 3.4;
    else if (genre === 'jazz_rhodes' || genre === 'dub_reggae') alpha = 3.1;
    else if (genre === 'bossa_nova' || genre === 'ambient_space') alpha = 2.8;
    else alpha = 2.3;
  } else {
    // alert_focus
    if (environment === 'study' && (genre === 'lofi_keys' || genre === 'solo_piano')) alpha = 3.7;
    else if (genre === 'deep_electronic') alpha = 3.6;
    else if (genre === 'jazz_rhodes' || genre === 'lofi_keys' || genre === 'bossa_nova') alpha = 3.2;
    else alpha = 2.5;
  }

  // Soft personal texture alignment
  if (profile.role === 'creative' && (genre === 'cinematic_strings' || genre === 'bossa_nova')) alpha += 0.5;
  if (profile.texturePref === 'warm_organic' && (genre === 'acoustic_pluck' || genre === 'jazz_rhodes' || genre === 'solo_piano' || genre === 'bossa_nova')) alpha += 0.4;
  if (profile.texturePref === 'minimal_electronic' && (genre === 'deep_electronic' || genre === 'ambient_space')) alpha += 0.4;
  if (profile.texturePref === 'nature_drift' && (genre === 'nature_rain' || genre === 'ambient_space')) alpha += 0.4;
  if (profile.texturePref === 'rhythmic_pulse' && (genre === 'dub_reggae' || genre === 'deep_electronic')) alpha += 0.4;

  return { alpha, beta };
}

/**
 * Selects optimal Musical Genre Carrier via Joint Contextual Thompson Sampling (Layer 1 x Layer 2)
 * when set to Auto, or smartly Iso-adapts user's preferred genre so it honors taste without
 * sabotaging cognitive goals or road safety.
 */
function resolveGenreLayer(input: {
  requestedGenre?: MusicGenreChoice;
  targetState: TargetState;
  environment: SessionEnvironment;
  currentState: CurrentState;
  profile: UserProfile;
  cohortGenreStats?: BanditStatRow[];
  profileGenreStats?: BanditStatRow[];
}): {
  genre: ResolvedGenre;
  mode: 'auto' | 'user_chosen' | 'iso_adapted';
  adaptationNote?: string;
  genreLearnedTrials?: number;
  personalGenreTrials?: number;
} {
  const req = input.requestedGenre ?? 'auto';
  const isDriving = input.environment === 'driving';

  if (req === 'auto') {
    const cohortMap = new Map((input.cohortGenreStats ?? []).map((s) => [s.armId, s]));
    const profileMap = new Map((input.profileGenreStats ?? []).map((s) => [s.armId, s]));

    // Exclude genres that conflict with road safety or sleep wind-down when Science picks Auto
    const eligible = ALL_GENRES.filter((g) => {
      if (isDriving && (g === 'nature_rain' || g === 'ambient_space' || g === 'nootropic_trance')) return false;
      if (
        input.targetState === 'sleep_winddown' &&
        (g === 'deep_electronic' || g === 'bossa_nova' || g === 'nootropic_trance')
      ) {
        return false;
      }
      return true;
    });

    const scored = eligible.map((g) => {
      const prior = getGenrePrior(g, input.targetState, input.environment, input.currentState, input.profile);
      const c = cohortMap.get(g);
      const p = profileMap.get(g);

      const alpha =
        prior.alpha +
        (c ? Math.max(0, c.alpha - 2.5) : 0) +
        (p ? Math.max(0, p.alpha - 2.5) * 2.6 : 0);
      const beta =
        prior.beta +
        (c ? Math.max(0, c.beta - 1.5) : 0) +
        (p ? Math.max(0, p.beta - 1.5) * 2.6 : 0);

      const personalTrials = p?.trials ?? 0;
      const trials = (c?.trials ?? 0) + personalTrials;
      const posteriorMean = alpha / (alpha + beta);
      // Balanced exploitation + gentle exploration so learned personal favorites reliably win Auto mode
      const score =
        personalTrials >= 1
          ? posteriorMean * 0.72 + sampleBeta(alpha, beta) * 0.28
          : trials > 0
            ? posteriorMean * 0.45 + sampleBeta(alpha, beta) * 0.55
            : posteriorMean;
      return { genre: g, score, trials, personalTrials };
    });

    const winner = scored.sort((a, b) => b.score - a.score)[0];
    return {
      genre: winner.genre,
      mode: 'auto',
      genreLearnedTrials: winner.trials,
      personalGenreTrials: winner.personalTrials,
    };
  }

  // Smart Iso-Safety adaptation when user chooses a genre that could clash with goal/safety
  if (isDriving && req === 'nootropic_trance') {
    return {
      genre: 'nootropic_trance',
      mode: 'iso_adapted',
      adaptationNote:
        'Driving Safety Lock: Kept the 120 BPM NootropicFM pulse while shifting neural entrainment from 6 Hz Theta trance to 16 Hz Beta road alertness.',
    };
  }

  if (input.targetState === 'sleep_winddown' && req === 'nootropic_trance') {
    return {
      genre: 'nootropic_trance',
      mode: 'iso_adapted',
      adaptationNote:
        'Softened NootropicFM Mode low-pass spectrum and down-regulated tempo for nocturnal sleep wind-down.',
    };
  }

  if ((input.targetState === 'sleep_winddown' || input.targetState === 'calm_reset') && req === 'deep_electronic') {
    return {
      genre: 'deep_electronic',
      mode: 'iso_adapted',
      adaptationNote:
        'Kept your preferred Deep Electronic timbre, automatically routed to our Calm energy pool and low-pass softened for autonomic down-regulation (Iso-Principle).',
    };
  }

  if (isDriving && req === 'nature_rain') {
    return {
      genre: 'nature_rain',
      mode: 'iso_adapted',
      adaptationNote:
        'Kept your Nature & Rain aesthetic while strictly capping rain density and keeping road alertness frequencies open.',
    };
  }

  return { genre: req, mode: 'user_chosen' };
}

export function buildFormulaIngredients(input: {
  params: AcousticParams;
  durationMin: number;
  isDriving: boolean;
}): FormulaIngredient[] {
  const { params, durationMin, isDriving } = input;
  const genreDisplay = getGenreDisplayMeta(
    params.customGenreSlug ?? params.genre,
    params.customGenreLabel
  );
  const energyInfo = ENERGY_LABELS[params.energyTier];
  const upperHz = params.upperCrossoverHz ?? 4500;
  const bandName =
    params.modulationHz >= 14
      ? 'Beta'
      : params.modulationHz >= 8
        ? 'Alpha'
        : 'Theta';
  const entryPct = Math.round(params.modulationDepth * 0.48 * 100);
  const peakPct = Math.round(params.modulationDepth * 100);

  const ingredients: FormulaIngredient[] = [
    {
      role: 'Layer 1 · Active AM',
      compound: `${params.modulationHz} Hz ${bandName} · 3-Band LR4`,
      dose: `${entryPct}%→${peakPct}% (${params.crossoverHz}Hz–${(upperHz / 1000).toFixed(1)}kHz)`,
      evidenceTag: params.modulationHz >= 14 ? 'Woods et al. 2024' : 'Neural Entrainment',
    },
    {
      role: 'Layer 2 · Music',
      compound: `${genreDisplay.label} · ${energyInfo.label}`,
      dose:
        params.genreSelectionMode === 'custom_vibe'
          ? 'Custom Vibe'
          : params.genreSelectionMode === 'auto'
            ? 'Auto by Bandit'
            : params.genreSelectionMode === 'iso_adapted'
              ? 'Iso-Adapted'
              : 'Your Taste',
      evidenceTag: 'Salimpoor 2011 · Perham 2014',
    },
    {
      role: 'Stochastic Floor',
      compound:
        params.noiseColor === 'none'
          ? 'Clean Spectral Floor'
          : `${params.noiseColor.replace('_', ' ')} noise`,
      dose: `${Math.round(params.noiseLevel * 100)}% calibrated`,
      evidenceTag: 'Söderlund et al. 2010',
    },
    {
      role: 'Iso Trajectory',
      compound: 'Entry → Peak → Landing',
      dose: `${durationMin}m (${energyInfo.bpmRange})`,
      evidenceTag: 'Heiderscheit 2015',
    },
  ];

  if (isDriving) {
    ingredients.push({
      role: 'Safety Shield',
      compound: 'Traffic-Safe EQ + Anti-Monotony',
      dose: `800–3500 Hz open · ${params.antiMonotonyCycleMin}m lift`,
      evidenceTag: 'Ünal et al. 2013',
    });
  }

  return ingredients;
}

/**
 * Allows instant 1-tap Layer 2 Music swap (core genre OR custom vibe) directly on the Reveal card.
 */
export function swapRecommendationGenre(
  rec: ProtocolRecommendation,
  newGenre: ResolvedGenre,
  customVibe?: {
    slug: string;
    label: string;
    cachedUrl?: string;
    liveGenAvailable?: boolean;
    noiseSensitivity?: 'low' | 'medium' | 'high';
  }
): ProtocolRecommendation {
  const isDriving = rec.safetyMode || rec.environment === 'driving';
  const fallbackCore = customVibe
    ? pickClosestCoreGenre(customVibe.slug, rec.params.energyTier)
    : newGenre;

  const nextParams: AcousticParams = {
    ...rec.params,
    genre: fallbackCore,
    genreSelectionMode: customVibe ? 'custom_vibe' : 'user_chosen',
    customGenreSlug: customVibe?.slug,
    customGenreLabel: customVibe?.label,
  };
  let genreAdaptationNote: string | undefined = undefined;

  if (
    !customVibe &&
    (rec.targetState === 'sleep_winddown' || rec.targetState === 'calm_reset') &&
    newGenre === 'deep_electronic'
  ) {
    nextParams.genreSelectionMode = 'iso_adapted';
    genreAdaptationNote =
      'Kept your Layer 1 scientific parameters 100% locked while routing Deep Electronic to our Calm energy pool.';
  } else if (!customVibe && isDriving && newGenre === 'nature_rain') {
    nextParams.genreSelectionMode = 'iso_adapted';
    genreAdaptationNote =
      'Kept your Layer 1 scientific parameters 100% locked while keeping road alertness frequencies open.';
  }

  const audioSource: AudioSourceType = customVibe
    ? customVibe.cachedUrl
      ? 'community_cache'
      : customVibe.liveGenAvailable
        ? 'live_generating'
        : 'studio_library'
    : rec.audioSource === 'generative_live' || rec.audioSource === 'pure_stimulus'
      ? rec.audioSource
      : 'studio_library';

  const composedMusicPrompt = customVibe
    ? composeScientificMusicPrompt({
        customGenreLabel: customVibe.label,
        energyTier: nextParams.energyTier,
        targetState: rec.targetState,
        params: nextParams,
        noiseSensitivity: customVibe.noiseSensitivity ?? 'medium',
      })
    : undefined;

  const updatedExecSpec = rec.executableSpec
    ? {
        ...rec.executableSpec,
        music: {
          ...rec.executableSpec.music,
          instrumentPalette: resolvedGenreToPalette(fallbackCore),
          ...(customVibe
            ? {
                vibeTags: [customVibe.label.toLowerCase(), 'lyric-free', 'instrumental'],
                lyriaWeightedPrompts: [
                  {
                    text: `Strictly instrumental ${customVibe.label}, authentic studio arrangement, zero vocals, no lyrics`,
                    weight: 1.5,
                  },
                  {
                    text: `${ENERGY_LABELS[nextParams.energyTier].label} groove, warm analog studio mastering, smooth continuous dynamics`,
                    weight: 0.85,
                  },
                ],
              }
            : {}),
        },
      }
    : undefined;

  return {
    ...rec,
    params: nextParams,
    executableSpec: updatedExecSpec,
    genreAdaptationNote,
    audioSource,
    fallbackCoreGenre: fallbackCore,
    customGenreSlug: customVibe?.slug,
    customGenreLabel: customVibe?.label,
    customTrackUrl: customVibe?.cachedUrl,
    composedMusicPrompt,
    formulaIngredients: buildFormulaIngredients({
      params: nextParams,
      durationMin: rec.plannedDurationMin,
      isDriving,
    }),
  };
}

export function selectProtocolRecommendation(input: {
  sessionId: string;
  profile: UserProfile;
  currentState: CurrentState;
  microStateId?: string;
  microStateLabel?: string;
  arousalPct?: number;
  clarityPct?: number;
  baselineScore: number;
  targetState: TargetState;
  customGoalSlug?: string;
  customGoalLabel?: string;
  compiledCustomSpec?: ExecutableStudySpec | null;
  environment: SessionEnvironment;
  device: OutputDevice;
  durationMin: number;
  requestedGenre?: MusicGenreChoice;
  customGenreInput?: string;
  cachedCustomTrackUrl?: string;
  liveGenAvailable?: boolean;
  ephemeralMode?: boolean;
  cohortStats: BanditStatRow[];
  marginalStats?: BanditStatRow[][];
  profileStats: BanditStatRow[];
  profileChronoStats?: BanditStatRow[];
  timeOfDayBucket?: TimeOfDayBucket;
  cohortGenreStats?: BanditStatRow[];
  profileGenreStats?: BanditStatRow[];
  cohortArmGenreStats?: BanditStatRow[];
  recentControlFlags?: boolean[];
  allowControlTrial?: boolean;
  returnBonusAwarded?: boolean;
}): ProtocolRecommendation {
  const isDriving = input.environment === 'driving';
  const effectiveTarget: TargetState =
    isDriving && (input.targetState === 'sleep_winddown' || input.targetState === 'calm_reset')
      ? 'alert_focus'
      : input.targetState;
  const effectiveDevice: OutputDevice = isDriving ? 'car_audio' : input.device;
  const energyTier = resolveEnergyTier(effectiveTarget, input.environment, input.currentState);

  let candidates = PROTOCOL_ARMS.filter((arm) => {
    if (isDriving && !arm.drivingSafe) return false;
    return arm.targetStates.includes(effectiveTarget);
  });
  if (candidates.length === 0) {
    candidates = PROTOCOL_ARMS.filter((arm) => (isDriving ? arm.drivingSafe : true));
  }

  const cohortMap = new Map(input.cohortStats.map((s) => [s.armId, s]));
  const marginalMaps = (input.marginalStats ?? []).map(
    (rows) => new Map(rows.map((s) => [s.armId, s]))
  );
  const profileMap = new Map(input.profileStats.map((s) => [s.armId, s]));
  const profileChronoMap = new Map((input.profileChronoStats ?? []).map((s) => [s.armId, s]));
  const armGenreMap = new Map((input.cohortArmGenreStats ?? []).map((s) => [s.armId, s]));

  const scored = candidates.map((arm) => {
    const c = cohortMap.get(arm.id);
    const p = profileMap.get(arm.id);
    const pc = profileChronoMap.get(arm.id);
    const ag = armGenreMap.get(arm.id);
    const marginals = marginalMaps
      .map((m, idx) => {
        const row = m.get(arm.id);
        return row
          ? {
              alpha: row.alpha,
              beta: row.beta,
              trials: row.trials,
              weight: idx === 0 ? 0.42 : 0.32,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    // Blend individual circadian profile evidence with overall profile evidence when present
    const blendedProfileAlpha =
      p && pc
        ? Number((p.alpha + Math.max(0, pc.alpha - arm.priorAlpha) * 0.65).toFixed(3))
        : p?.alpha ?? pc?.alpha;
    const blendedProfileBeta =
      p && pc
        ? Number((p.beta + Math.max(0, pc.beta - arm.priorBeta) * 0.65).toFixed(3))
        : p?.beta ?? pc?.beta;
    const blendedProfileTrials = (p?.trials ?? 0) + Math.round((pc?.trials ?? 0) * 0.65);

    const posterior = computeHierarchicalArmPosterior({
      priorAlpha: arm.priorAlpha,
      priorBeta: arm.priorBeta,
      cohortAlpha: c?.alpha,
      cohortBeta: c?.beta,
      cohortTrials: c?.trials,
      marginals,
      armGenreAlpha: ag?.alpha,
      armGenreBeta: ag?.beta,
      armGenreTrials: ag?.trials,
      profileAlpha: blendedProfileAlpha,
      profileBeta: blendedProfileBeta,
      profileTrials: blendedProfileTrials,
    });
    const pooledMarginalTrials = marginals.reduce((acc, m) => acc + m.trials, 0);
    const thompsonDraw = sampleHierarchicalThompson(posterior);
    return {
      arm,
      expectedMean: posterior.mean,
      thompsonDraw,
      cohortTrials: (c?.trials ?? 0) || Math.round(pooledMarginalTrials * 0.5),
      profileTrials: p?.trials ?? 0,
    };
  });

  const bestExploit = [...scored].sort((a, b) => b.expectedMean - a.expectedMean)[0];
  const thompsonWinner = [...scored].sort((a, b) => b.thompsonDraw - a.thompsonDraw)[0];

  const directTranceArm =
    !isDriving &&
    effectiveTarget !== 'sleep_winddown' &&
    (input.requestedGenre === 'nootropic_trance' || input.customGoalSlug === 'trance_lock')
      ? PROTOCOL_ARMS.find((a) => a.id === 'nootropic-trance-6x40hz')
      : undefined;

  const tranceArmEntry = directTranceArm
    ? scored.find((s) => s.arm.id === 'nootropic-trance-6x40hz') ?? {
        arm: directTranceArm,
        expectedMean: directTranceArm.priorAlpha / (directTranceArm.priorAlpha + directTranceArm.priorBeta),
        thompsonDraw: 0.99,
        cohortTrials: 0,
        profileTrials: 0,
      }
    : undefined;

  const isExploration = tranceArmEntry ? false : thompsonWinner.arm.id !== bestExploit.arm.id;
  const chosen = tranceArmEntry ?? thompsonWinner;

  const sanitizedCustom = sanitizeCustomVibe(input.customGenreInput);
  const validCustom = sanitizedCustom && !sanitizedCustom.rejectedReason ? sanitizedCustom : null;

  const genreResolution = validCustom
    ? {
        genre: pickClosestCoreGenre(validCustom.slug, energyTier),
        mode: 'custom_vibe' as const,
        adaptationNote: input.cachedCustomTrackUrl
          ? undefined
          : input.liveGenAvailable
            ? `Starting immediately on our closest studio carrier while your custom instrumental ${validCustom.displayLabel} track generates and crossfades in seamlessly.`
            : `Custom live generation is warming up — matched you immediately with our closest studio carrier (${getGenreDisplayMeta(pickClosestCoreGenre(validCustom.slug, energyTier)).label}) for zero wait.`,
      }
    : resolveGenreLayer({
        requestedGenre: input.requestedGenre,
        targetState: effectiveTarget,
        environment: input.environment,
        currentState: input.currentState,
        profile: input.profile,
        cohortGenreStats: input.cohortGenreStats,
        profileGenreStats: input.profileGenreStats,
      });

  const isCalmTarget = effectiveTarget === 'calm_reset' || effectiveTarget === 'sleep_winddown';
  const neuralMem = input.profile.neuralMemory;
  const rawPersonalModMult = neuralMem
    ? isCalmTarget
      ? neuralMem.calmModMult
      : neuralMem.focusModMult
    : input.profile.preferredModMult ?? 1.0;
  const personalModMult = Math.max(0.65, Math.min(1.35, rawPersonalModMult));

  const params: AcousticParams = {
    ...chosen.arm.baseParams,
    upperCrossoverHz: chosen.arm.baseParams.upperCrossoverHz ?? 4500,
    stereoAmSpread: !isDriving && effectiveDevice === 'headphones',
    genre: genreResolution.genre,
    genreSelectionMode: genreResolution.mode,
    energyTier,
    customGenreSlug: validCustom?.slug,
    customGenreLabel: validCustom?.displayLabel,
  };

  params.modulationDepth = Number(
    Math.min(0.56, Math.max(0.12, params.modulationDepth * personalModMult)).toFixed(2)
  );
  if (neuralMem && typeof neuralMem.preferredNoiseMult === 'number' && neuralMem.preferredNoiseMult !== 1.0) {
    params.noiseLevel = Number(
      Math.max(0.03, Math.min(0.32, params.noiseLevel * neuralMem.preferredNoiseMult)).toFixed(2)
    );
  }

  if (input.profile.noiseSensitivity === 'high') {
    params.noiseLevel = Number((params.noiseLevel * 0.45).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.85);
    params.modulationDepth = Number(Math.max(0.12, params.modulationDepth * 0.88).toFixed(2));
  } else if (input.profile.noiseSensitivity === 'low') {
    params.noiseLevel = Number(Math.min(0.32, params.noiseLevel * 1.25).toFixed(2));
  }

  if (input.currentState === 'fatigued' && params.bpm > 0) {
    params.bpm = Math.min(120, params.bpm + 4);
    params.modulationDepth = Number(Math.min(0.56, params.modulationDepth + 0.03).toFixed(2));
  } else if (input.currentState === 'anxious' || input.currentState === 'stressed') {
    params.modulationDepth = Number(Math.max(0.12, params.modulationDepth - 0.04).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.88);
  }

  if (input.profile.age >= 40) {
    params.filterCutoffHz = Math.min(params.filterCutoffHz, 1850);
  }

  if (genreResolution.mode === 'iso_adapted' && params.genre === 'deep_electronic') {
    params.bpm = effectiveTarget === 'sleep_winddown' ? 0 : 75;
    params.pulseIntensity = effectiveTarget === 'sleep_winddown' ? 0 : 0.28;
    params.filterCutoffHz = Math.min(params.filterCutoffHz, 1650);
  }

  const safetyWarnings: string[] = [];
  if (isDriving) {
    params.speakerSafeEQ = true;
    params.stereoAmSpread = false;
    params.binauralOffsetHz = 0;
    params.modulationDepth = Math.min(0.38, params.modulationDepth);
    params.noiseLevel = Math.min(params.noiseLevel, 0.07);
    params.antiMonotonyCycleMin = params.antiMonotonyCycleMin > 0 ? params.antiMonotonyCycleMin : 5;
    safetyWarnings.push(
      'Driving Safety Mode active: vehicle speakers only (never wear headphones), traffic siren/horn frequencies remain unobstructed, and anti-monotony micro-variations are enabled.'
    );
    safetyWarnings.push(
      'Audio supports alertness but NEVER replaces rest. If you feel drowsy behind the wheel, pull over safely and take a break.'
    );
  } else if (effectiveDevice !== 'headphones') {
    params.binauralOffsetHz = 0;
    params.speakerSafeEQ = true;
    params.stereoAmSpread = false;
  }

  // Real psychoacoustic micro-state calibration (Russell Circumplex Arousal × Clarity nuance!)
  const microState = getMicroStateById(input.microStateId);
  if (microState) {
    if (
      microState.id === 'overcaffeinated' ||
      microState.id === 'wired_but_tired' ||
      microState.id === 'anxious_racing'
    ) {
      // If aiming for calm/sleep keep <=12 Hz; if aiming for focus/energy, keep 15–16 Hz plateau while 2-Stage Iso-Bridge stabilizes at 10–11.5 Hz for the first 3 min!
      if (effectiveTarget === 'calm_reset' || effectiveTarget === 'sleep_winddown') {
        params.modulationHz = Math.min(params.modulationHz, 12.0);
      } else {
        params.modulationHz = Math.min(params.modulationHz, 16.0);
      }
      params.modulationDepth = Number(Math.max(0.16, params.modulationDepth * 0.88).toFixed(2));
      params.filterCutoffHz = Math.min(params.filterCutoffHz, 2100);
    } else if (microState.id === 'creative_block') {
      // Open associative alpha-border modulation & spacious suspended harmony
      params.modulationHz = Math.min(params.modulationHz, 10.5);
      params.harmonicMode = 'suspended_open';
    } else if (microState.id === 'screen_fatigue' || microState.id === 'burned_out') {
      // Gentle upper roll-off for tired visual/auditory cortex
      params.filterCutoffHz = Math.min(params.filterCutoffHz, 1750);
      params.noiseLevel = Math.min(params.noiseLevel, 0.08);
    } else if (microState.id === 'highway_monotony') {
      params.antiMonotonyCycleMin = Math.min(params.antiMonotonyCycleMin || 8, 6);
    }
  }

  // Apply specialized curated goal DSP overrides (e.g. Creative Ideation 10 Hz Alpha, Memory 14 Hz SMR, Mood 12 Hz Major)
  // or live compiled PubMed/EuropePMC paper Hz when user searched an open scientific goal!
  const curatedGoal = !isDriving ? getCuratedGoalBySlug(input.customGoalSlug) : undefined;
  if (curatedGoal?.dspOverride) {
    const ov = curatedGoal.dspOverride;
    params.modulationHz = ov.modulationHz;
    if (typeof ov.bpm === 'number') params.bpm = ov.bpm;
    if (ov.harmonicMode) params.harmonicMode = ov.harmonicMode;
    if (ov.noiseColor) params.noiseColor = ov.noiseColor;
    if (typeof ov.noiseLevel === 'number') params.noiseLevel = ov.noiseLevel;
    if (typeof ov.filterCutoffHz === 'number') params.filterCutoffHz = ov.filterCutoffHz;
  } else if (!isDriving && input.compiledCustomSpec && input.compiledCustomSpec.entrainment.frequencyHz > 0) {
    params.modulationHz = input.compiledCustomSpec.entrainment.frequencyHz;
    if (input.compiledCustomSpec.music.bpm >= 0) {
      params.bpm = input.compiledCustomSpec.music.bpm;
    }
  }

  // Apply continuous per-brain micro-frequency tuning (never overrides Signature 6x40 Hz integer lock or Driving Safety)
  const baseSpecHzBeforeTuning = params.modulationHz;
  let freqTunedNote: string | null = null;
  if (!isDriving && neuralMem && chosen.arm.id !== 'nootropic-trance-6x40hz') {
    if (baseSpecHzBeforeTuning >= 13 && baseSpecHzBeforeTuning <= 22 && Math.abs(neuralMem.focusOffsetHz) >= 0.1) {
      params.modulationHz = Number(
        Math.max(12.5, Math.min(22.0, baseSpecHzBeforeTuning + neuralMem.focusOffsetHz)).toFixed(1)
      );
      freqTunedNote = `Micro-tuned ${baseSpecHzBeforeTuning} Hz -> ${params.modulationHz} Hz for your brain`;
    } else if (baseSpecHzBeforeTuning >= 8 && baseSpecHzBeforeTuning <= 12 && neuralMem.personalIafHz > 0) {
      params.modulationHz = Number(neuralMem.personalIafHz.toFixed(1));
      freqTunedNote = `Matched to your ${params.modulationHz} Hz Individual Alpha Peak`;
    }
  }

  // Stratified 25% Blind A/B Control strictly gated on explicit Research Consent (1 sham per 4-session block)
  // Standalone NootropicFM Mode (`nootropic-trance-6x40hz`) NEVER runs sham control so the 6x40 Hz lock hits at 100% strength!
  const isControlTrial =
    chosen.arm.id === 'nootropic-trance-6x40hz'
      ? false
      : assignStratifiedShamControl({
          recentControlFlags: input.recentControlFlags ?? [],
          researchConsent: input.profile.researchConsent === true,
          allowControlTrial: input.allowControlTrial,
          ephemeralMode: Boolean(input.ephemeralMode),
          blockSize: 4,
        });

  const cohortKey = buildCohortKey(
    input.profile.ageBand,
    input.environment,
    effectiveTarget,
    input.profile.role,
    input.currentState,
    input.customGoalSlug
  );
  const confidencePct = Math.round(chosen.expectedMean * 100);

  const audioSource: AudioSourceType = validCustom
    ? input.cachedCustomTrackUrl
      ? 'community_cache'
      : input.liveGenAvailable
        ? 'live_generating'
        : 'studio_library'
    : 'studio_library';

  const composedMusicPrompt = validCustom
    ? composeScientificMusicPrompt({
        customGenreLabel: validCustom.displayLabel,
        energyTier,
        targetState: effectiveTarget,
        params,
        noiseSensitivity: input.profile.noiseSensitivity,
      })
    : undefined;

  const formulaIngredients = buildFormulaIngredients({
    params,
    durationMin: input.durationMin,
    isDriving,
  });

  const personalizationSummary: string[] = [];
  if (input.ephemeralMode || !input.profile.researchConsent) {
    personalizationSummary.push('Local-only privacy mode (no behavioral tracking or remote profile writes)');
  } else if (chosen.profileTrials > 0) {
    personalizationSummary.push(`Personalized from ${chosen.profileTrials} of your past sessions`);
  } else if (chosen.cohortTrials > 0) {
    personalizationSummary.push(`Matched to ${chosen.cohortTrials} sessions in your cohort (${confidencePct}% fit)`);
  } else {
    personalizationSummary.push('Peer-reviewed scientific baseline (calibrating from your response)');
  }
  if (personalModMult !== 1.0) {
    personalizationSummary.push(`Personal AM depth calibrated to ${Math.round(personalModMult * 100)}%`);
  }
  if (genreResolution.mode === 'auto' && 'personalGenreTrials' in genreResolution && (genreResolution.personalGenreTrials ?? 0) > 0) {
    personalizationSummary.push('Music style matched to your highest-rated past sessions');
  }
  if (isDriving) {
    personalizationSummary.push('Driving Safety EQ open (800–3500 Hz traffic cues protected)');
  } else if (params.stereoAmSpread) {
    personalizationSummary.push('Headphone +32° organic stereo AM shimmer enabled');
  }
  if (microState) {
    personalizationSummary.push(`Neural state tuned: ${microState.label} — ${microState.dspNote}`);
  }
  if (input.returnBonusAwarded) {
    personalizationSummary.push('Welcome back · your return strengthened your previous formula score');
  }
  if (freqTunedNote) {
    personalizationSummary.unshift(freqTunedNote);
  }
  const chronoAdapted = Boolean(
    neuralMem?.dipChronoBucket &&
      input.timeOfDayBucket &&
      neuralMem.dipChronoBucket === input.timeOfDayBucket
  );
  if (chronoAdapted && input.timeOfDayBucket) {
    personalizationSummary.push(`Circadian protection active for your ${input.timeOfDayBucket} energy dip window`);
  }

  const evidenceNote =
    chosen.profileTrials > 0
      ? `Calibrated from ${chosen.profileTrials} of your past sessions and ${chosen.cohortTrials} cohort sessions.`
      : chosen.cohortTrials > 0
        ? `Selected from ${chosen.cohortTrials} real sessions in cohort "${formatCohortLabel(cohortKey)}" (${confidencePct}% estimated fit).`
        : `First session in this cohort: starting with our strongest peer-reviewed baseline and adapting from your outcome.`;

  const explorationNote = isExploration
    ? ' (Includes a controlled exploration trial so the engine can test whether a slightly different acoustic profile works even better for you.)'
    : '';

  const baseExecutableSpec =
    !isDriving && input.compiledCustomSpec
      ? {
          ...input.compiledCustomSpec,
          music: {
            ...input.compiledCustomSpec.music,
            instrumentPalette: resolvedGenreToPalette(params.genre),
          },
        }
      : buildCheckInExecutableSpec({
          armId: chosen.arm.id,
          currentState: input.currentState,
          targetState: effectiveTarget,
          bpm: params.bpm,
          modulationHz: params.modulationHz,
          modulationDepth: params.modulationDepth,
          noiseColor: params.noiseColor,
          noiseLevel: params.noiseLevel,
          genre: params.genre,
          durationMin: input.durationMin,
          device: effectiveDevice,
          environment: input.environment,
          microStateId: microState?.id ?? input.microStateId,
        });

  const coreStudies = getStudiesByIds(chosen.arm.studyIds);
  const compiledTopStudy =
    input.compiledCustomSpec && input.compiledCustomSpec.studyRef.source !== 'core'
      ? [
          {
            id: input.compiledCustomSpec.id,
            authors: input.compiledCustomSpec.studyRef.authors,
            year: Number(input.compiledCustomSpec.studyRef.year) || 2024,
            journal: input.compiledCustomSpec.studyRef.journal,
            title: input.compiledCustomSpec.studyRef.title,
            mechanism: `${input.compiledCustomSpec.entrainment.frequencyHz || params.modulationHz} Hz ${input.compiledCustomSpec.entrainment.type.replace(/_/g, ' ')}`,
            soundEffect:
              input.compiledCustomSpec.evidenceMap[0]?.executedValue ??
              `Compiled ${params.modulationHz} Hz acoustic stimulus for ${input.customGoalLabel ?? 'your custom goal'}`,
            summary: input.compiledCustomSpec.abstractExcerpt,
            caveat: 'Compiled live from peer-reviewed literature; adjust intensity to comfort.',
            doiOrUrl: input.compiledCustomSpec.studyRef.url,
            applicableTargets: [effectiveTarget],
          },
        ]
      : [];

  let resolvedExecSpec = validCustom
    ? {
        ...baseExecutableSpec,
        music: {
          ...baseExecutableSpec.music,
          vibeTags: [validCustom.displayLabel.toLowerCase(), 'lyric-free', 'instrumental'],
          lyriaWeightedPrompts: [
            {
              text: `Strictly instrumental ${validCustom.displayLabel}, authentic studio arrangement, zero vocals, no lyrics`,
              weight: 1.5,
            },
            {
              text: `${ENERGY_LABELS[energyTier].label} groove, warm analog studio mastering, smooth continuous dynamics`,
              weight: 0.85,
            },
          ],
        },
      }
    : baseExecutableSpec;

  if (
    resolvedExecSpec &&
    resolvedExecSpec.entrainment.type === 'amplitude_modulation' &&
    chosen.arm.id !== 'nootropic-trance-6x40hz' &&
    resolvedExecSpec.entrainment.frequencyHz !== 40
  ) {
    resolvedExecSpec = {
      ...resolvedExecSpec,
      entrainment: {
        ...resolvedExecSpec.entrainment,
        frequencyHz: params.modulationHz,
        ...(chronoAdapted && !resolvedExecSpec.entrainment.isoBridge && !isDriving && !isCalmTarget && neuralMem
          ? {
              isoBridge: {
                stabilizeHz: Number(neuralMem.personalIafHz.toFixed(1)),
                stabilizeDurationSec: 45,
                rampDurationSec: 35,
                stabilizeEffectScale: 0.68,
                reasonLabel: `Personal Circadian Dip Stabilizer (${neuralMem.personalIafHz.toFixed(1)} -> ${params.modulationHz} Hz)`,
              },
            }
          : {}),
      },
    };
  }

  const executableSpec = resolvedExecSpec;
  const appliedNeuralTuning =
    neuralMem && (neuralMem.learnedSessions > 0 || freqTunedNote || chronoAdapted)
      ? {
          calibrationPct: neuralMem.calibrationPct,
          tunedHz: params.modulationHz,
          baseHz: baseSpecHzBeforeTuning,
          appliedModMult: personalModMult,
          appliedNoiseMult: neuralMem.preferredNoiseMult,
          proactiveLiftMinute: neuralMem.fatigueDipMinute
            ? Math.max(4, neuralMem.fatigueDipMinute - 2)
            : null,
          chronoAdapted,
          summaryLine:
            freqTunedNote ||
            (chronoAdapted
              ? `Circadian dip stabilizer armed at ${neuralMem.personalIafHz.toFixed(1)} Hz`
              : neuralMem.lastInsightLine || `Calibrated across ${neuralMem.learnedSessions} learned sessions`),
        }
      : undefined;

  return {
    sessionId: input.sessionId,
    cohortKey,
    cohortLabel: formatCohortLabel(cohortKey),
    arm: chosen.arm,
    params,
    isExploration,
    isControlTrial,
    ephemeralMode: Boolean(input.ephemeralMode || !input.profile.researchConsent),
    safetyMode: isDriving,
    safetyWarnings,
    genreAdaptationNote: genreResolution.adaptationNote,
    audioSource,
    fallbackCoreGenre: genreResolution.genre,
    customGenreSlug: validCustom?.slug,
    customGenreLabel: validCustom?.displayLabel,
    customTrackUrl: input.cachedCustomTrackUrl,
    composedMusicPrompt,
    personalizationSummary,
    formulaIngredients,
    rationale: `${chosen.arm.description} ${evidenceNote}${explorationNote}`,
    studies: [...compiledTopStudy, ...coreStudies],
    executableSpec,
    confidencePct,
    cohortTrials: chosen.cohortTrials,
    profileTrials: chosen.profileTrials,
    ...(appliedNeuralTuning ? { appliedNeuralTuning } : {}),
    plannedDurationMin: input.durationMin,
    currentState: input.currentState,
    microStateId: microState?.id ?? input.microStateId,
    microStateLabel: microState?.label ?? input.microStateLabel,
    arousalPct: input.arousalPct ?? microState?.energy,
    clarityPct: input.clarityPct ?? microState?.clarity,
    targetState: effectiveTarget,
    customGoalSlug: input.customGoalSlug,
    customGoalLabel: input.customGoalLabel ?? curatedGoal?.label,
    baselineScore: input.baselineScore,
    environment: input.environment,
    device: effectiveDevice,
    returnBonusAwarded: input.returnBonusAwarded,
  };
}
