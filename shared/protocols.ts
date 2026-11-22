import { getStudiesByIds } from './studies';
import type {
  AcousticParams,
  AgeBand,
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
  UserProfile,
  WorkedRating,
} from './types';
import { ENERGY_LABELS, ENV_LABELS, GENRE_META, TARGET_LABELS } from './types';

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
      modulationDepth: 0.25,
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
      modulationDepth: 0.28,
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
      modulationDepth: 0.22,
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
      modulationDepth: 0.24,
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
      binauralOffsetHz: 4,
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
      modulationDepth: 0.18,
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
      modulationDepth: 0.14,
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
  targetState: TargetState
): string {
  return `${ageBand}|${environment}|${targetState}`;
}

export function formatCohortLabel(cohortKey: string): string {
  const [ageBand, env, target] = cohortKey.split('|') as [AgeBand, SessionEnvironment, TargetState];
  const envLabel = ENV_LABELS[env] ?? env;
  const targetLabel = TARGET_LABELS[target] ?? target;
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
}): { reward: number; delta: number } {
  const delta = input.postScore - input.baselineScore;
  const deltaSignal = Math.max(0, Math.min(1, 0.45 + delta * 0.18));
  const ratingSignal =
    input.workedRating === 'yes' ? 1.0 : input.workedRating === 'partial' ? 0.55 : 0.1;
  const completionSignal = Math.max(0.15, Math.min(1, input.completionRatio));
  const adjustPenalty = Math.min(0.12, input.liveAdjustments.length * 0.02);

  const reward = Math.max(
    0.05,
    Math.min(0.98, ratingSignal * 0.5 + deltaSignal * 0.35 + completionSignal * 0.15 - adjustPenalty)
  );
  return { reward: Number(reward.toFixed(3)), delta };
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
  'lofi_keys',
  'deep_electronic',
  'cinematic_strings',
  'jazz_rhodes',
  'acoustic_pluck',
  'nature_rain',
];

function getGenrePrior(
  genre: ResolvedGenre,
  targetState: TargetState,
  environment: SessionEnvironment,
  currentState: CurrentState,
  profile: UserProfile
): { alpha: number; beta: number } {
  const isDriving = environment === 'driving';
  let alpha = 2.0;
  const beta = 1.6;

  if (targetState === 'sleep_winddown') {
    if (genre === 'nature_rain') alpha = 3.8;
    else if (genre === 'cinematic_strings' || genre === 'acoustic_pluck') alpha = 3.1;
    else if (genre === 'lofi_keys') alpha = 2.4;
    else alpha = 1.2;
  } else if (targetState === 'calm_reset') {
    if (genre === 'nature_rain' || genre === 'acoustic_pluck') alpha = 3.5;
    else if (genre === 'cinematic_strings' || genre === 'lofi_keys') alpha = 3.0;
    else alpha = 1.8;
  } else if (isDriving || targetState === 'energy_lift') {
    if (genre === 'deep_electronic') alpha = 3.7;
    else if (genre === 'jazz_rhodes' || genre === 'lofi_keys') alpha = 3.1;
    else if (genre === 'acoustic_pluck') alpha = 2.5;
    else alpha = 1.4;
  } else if (targetState === 'deep_flow') {
    if (genre === 'lofi_keys' || genre === 'cinematic_strings') alpha = 3.5;
    else if (genre === 'deep_electronic' || genre === 'jazz_rhodes') alpha = 3.1;
    else alpha = 2.3;
  } else {
    // alert_focus
    if (environment === 'study' && genre === 'lofi_keys') alpha = 3.7;
    else if (currentState === 'fatigued' && genre === 'deep_electronic') alpha = 3.6;
    else if (genre === 'jazz_rhodes' || genre === 'lofi_keys' || genre === 'deep_electronic') alpha = 3.2;
    else alpha = 2.4;
  }

  // Soft personal texture alignment
  if (profile.role === 'creative' && genre === 'cinematic_strings') alpha += 0.5;
  if (profile.texturePref === 'warm_organic' && (genre === 'acoustic_pluck' || genre === 'jazz_rhodes')) alpha += 0.4;
  if (profile.texturePref === 'minimal_electronic' && genre === 'deep_electronic') alpha += 0.4;
  if (profile.texturePref === 'nature_drift' && genre === 'nature_rain') alpha += 0.4;

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
} {
  const req = input.requestedGenre ?? 'auto';
  const isDriving = input.environment === 'driving';

  if (req === 'auto') {
    const cohortMap = new Map((input.cohortGenreStats ?? []).map((s) => [s.armId, s]));
    const profileMap = new Map((input.profileGenreStats ?? []).map((s) => [s.armId, s]));

    // Exclude genres that conflict with road safety or sleep wind-down when Science picks Auto
    const eligible = ALL_GENRES.filter((g) => {
      if (isDriving && g === 'nature_rain') return false;
      if (input.targetState === 'sleep_winddown' && g === 'deep_electronic') return false;
      return true;
    });

    const scored = eligible.map((g) => {
      const prior = getGenrePrior(g, input.targetState, input.environment, input.currentState, input.profile);
      const c = cohortMap.get(g);
      const p = profileMap.get(g);

      const alpha =
        prior.alpha +
        (c ? Math.max(0, c.alpha - 2.5) : 0) +
        (p ? Math.max(0, p.alpha - 2.5) * 1.6 : 0);
      const beta =
        prior.beta +
        (c ? Math.max(0, c.beta - 1.5) : 0) +
        (p ? Math.max(0, p.beta - 1.5) * 1.6 : 0);

      const trials = (c?.trials ?? 0) + (p?.trials ?? 0);
      // If no real data yet for any candidate, keep deterministic scientific prior winner;
      // once real trials accumulate, use full Thompson Sampling to explore & optimize Layer 2!
      const score = trials > 0 ? sampleBeta(alpha, beta) : alpha / (alpha + beta);
      return { genre: g, score, trials };
    });

    const winner = scored.sort((a, b) => b.score - a.score)[0];
    return { genre: winner.genre, mode: 'auto', genreLearnedTrials: winner.trials };
  }

  // Smart Iso-Safety adaptation when user chooses a genre that could clash with goal/safety
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
  const genreLabel = GENRE_META[params.genre].label;
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
      compound: `${genreLabel} · ${energyInfo.label}`,
      dose:
        params.genreSelectionMode === 'auto'
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
 * Allows instant 1-tap Layer 2 Music swap directly on the Reveal card before pressing Play.
 */
export function swapRecommendationGenre(
  rec: ProtocolRecommendation,
  newGenre: ResolvedGenre
): ProtocolRecommendation {
  const isDriving = rec.safetyMode || rec.environment === 'driving';
  const nextParams: AcousticParams = {
    ...rec.params,
    genre: newGenre,
    genreSelectionMode: 'user_chosen',
  };
  let genreAdaptationNote: string | undefined = undefined;

  if ((rec.targetState === 'sleep_winddown' || rec.targetState === 'calm_reset') && newGenre === 'deep_electronic') {
    nextParams.genreSelectionMode = 'iso_adapted';
    nextParams.bpm = rec.targetState === 'sleep_winddown' ? 0 : 68;
    nextParams.pulseIntensity = rec.targetState === 'sleep_winddown' ? 0 : 0.16;
    nextParams.filterCutoffHz = Math.min(nextParams.filterCutoffHz, 860);
    genreAdaptationNote =
      'Kept your preferred Deep Electronic timbre, automatically routed to our Calm energy pool and low-pass softened for autonomic down-regulation (Iso-Principle).';
  } else if (isDriving && newGenre === 'nature_rain') {
    nextParams.genreSelectionMode = 'iso_adapted';
    genreAdaptationNote =
      'Kept your Nature & Rain aesthetic while strictly capping rain density and keeping road alertness frequencies open.';
  }

  return {
    ...rec,
    params: nextParams,
    genreAdaptationNote,
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
  baselineScore: number;
  targetState: TargetState;
  environment: SessionEnvironment;
  device: OutputDevice;
  durationMin: number;
  requestedGenre?: MusicGenreChoice;
  cohortStats: BanditStatRow[];
  profileStats: BanditStatRow[];
  cohortGenreStats?: BanditStatRow[];
  profileGenreStats?: BanditStatRow[];
  allowControlTrial?: boolean;
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
  const profileMap = new Map(input.profileStats.map((s) => [s.armId, s]));

  const scored = candidates.map((arm) => {
    const c = cohortMap.get(arm.id);
    const p = profileMap.get(arm.id);

    const alpha =
      arm.priorAlpha +
      (c ? Math.max(0, c.alpha - arm.priorAlpha) : 0) +
      (p ? Math.max(0, p.alpha - arm.priorAlpha) * 1.5 : 0);
    const beta =
      arm.priorBeta +
      (c ? Math.max(0, c.beta - arm.priorBeta) : 0) +
      (p ? Math.max(0, p.beta - arm.priorBeta) * 1.5 : 0);

    const expectedMean = alpha / (alpha + beta);
    const thompsonDraw = sampleBeta(alpha, beta);
    return {
      arm,
      alpha,
      beta,
      expectedMean,
      thompsonDraw,
      cohortTrials: c?.trials ?? 0,
      profileTrials: p?.trials ?? 0,
    };
  });

  const bestExploit = [...scored].sort((a, b) => b.expectedMean - a.expectedMean)[0];
  const thompsonWinner = [...scored].sort((a, b) => b.thompsonDraw - a.thompsonDraw)[0];

  const isExploration = thompsonWinner.arm.id !== bestExploit.arm.id;
  const chosen = thompsonWinner;

  const genreResolution = resolveGenreLayer({
    requestedGenre: input.requestedGenre,
    targetState: effectiveTarget,
    environment: input.environment,
    currentState: input.currentState,
    profile: input.profile,
    cohortGenreStats: input.cohortGenreStats,
    profileGenreStats: input.profileGenreStats,
  });

  const personalModMult = Math.max(0.65, Math.min(1.35, input.profile.preferredModMult ?? 1.0));

  const params: AcousticParams = {
    ...chosen.arm.baseParams,
    upperCrossoverHz: chosen.arm.baseParams.upperCrossoverHz ?? 4500,
    stereoAmSpread: !isDriving && effectiveDevice === 'headphones',
    genre: genreResolution.genre,
    genreSelectionMode: genreResolution.mode,
    energyTier,
  };

  params.modulationDepth = Number(
    Math.min(0.36, Math.max(0.1, params.modulationDepth * personalModMult)).toFixed(2)
  );

  if (input.profile.noiseSensitivity === 'high') {
    params.noiseLevel = Number((params.noiseLevel * 0.45).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.85);
    params.modulationDepth = Number(Math.max(0.12, params.modulationDepth * 0.88).toFixed(2));
  } else if (input.profile.noiseSensitivity === 'low') {
    params.noiseLevel = Number(Math.min(0.32, params.noiseLevel * 1.25).toFixed(2));
  }

  if (input.currentState === 'fatigued' && params.bpm > 0) {
    params.bpm = Math.min(120, params.bpm + 4);
    params.modulationDepth = Number(Math.min(0.34, params.modulationDepth + 0.03).toFixed(2));
  } else if (input.currentState === 'anxious' || input.currentState === 'stressed') {
    params.modulationDepth = Number(Math.max(0.12, params.modulationDepth - 0.04).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.88);
  }

  if (input.profile.age >= 40) {
    params.filterCutoffHz = Math.min(params.filterCutoffHz, 1850);
  }

  // Iso-adapt genre tempo if deep_electronic chosen for calm/sleep
  if (genreResolution.mode === 'iso_adapted' && params.genre === 'deep_electronic') {
    params.bpm = effectiveTarget === 'sleep_winddown' ? 0 : 68;
    params.pulseIntensity = effectiveTarget === 'sleep_winddown' ? 0 : 0.16;
    params.filterCutoffHz = Math.min(params.filterCutoffHz, 860);
  }

  const safetyWarnings: string[] = [];
  if (isDriving) {
    params.speakerSafeEQ = true;
    params.stereoAmSpread = false;
    params.binauralOffsetHz = 0;
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

  // Transparent Blind A/B Control (12% of consented sessions): engine delivers pure 3-Band studio music (AM = 0)
  // while keeping UI blinded until debrief so we can statistically prove real AM lift vs music alone!
  const isControlTrial =
    input.allowControlTrial !== false &&
    input.profile.researchConsent === true &&
    Math.random() < 0.12;

  const cohortKey = buildCohortKey(input.profile.ageBand, input.environment, effectiveTarget);
  const confidencePct = Math.round(chosen.expectedMean * 100);

  const formulaIngredients = buildFormulaIngredients({
    params,
    durationMin: input.durationMin,
    isDriving,
  });

  const evidenceNote =
    chosen.profileTrials > 0
      ? `Calibrated from ${chosen.profileTrials} of your past sessions and ${chosen.cohortTrials} cohort sessions.`
      : chosen.cohortTrials > 0
        ? `Selected from ${chosen.cohortTrials} real sessions in cohort "${formatCohortLabel(cohortKey)}" (${confidencePct}% estimated fit).`
        : `First session in this cohort: starting with our strongest peer-reviewed baseline and adapting from your outcome.`;

  const explorationNote = isExploration
    ? ' (Includes a controlled exploration trial so the engine can test whether a slightly different acoustic profile works even better for you.)'
    : '';

  return {
    sessionId: input.sessionId,
    cohortKey,
    cohortLabel: formatCohortLabel(cohortKey),
    arm: chosen.arm,
    params,
    isExploration,
    isControlTrial,
    safetyMode: isDriving,
    safetyWarnings,
    genreAdaptationNote: genreResolution.adaptationNote,
    formulaIngredients,
    rationale: `${chosen.arm.description} ${evidenceNote}${explorationNote}`,
    studies: getStudiesByIds(chosen.arm.studyIds),
    confidencePct,
    cohortTrials: chosen.cohortTrials,
    profileTrials: chosen.profileTrials,
    plannedDurationMin: input.durationMin,
    currentState: input.currentState,
    targetState: effectiveTarget,
    baselineScore: input.baselineScore,
    environment: input.environment,
    device: effectiveDevice,
  };
}
