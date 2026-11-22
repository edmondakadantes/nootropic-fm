import { getStudiesByIds } from './studies';
import type {
  AcousticParams,
  AgeBand,
  CurrentState,
  LiveAdjustment,
  OutputDevice,
  ProtocolArm,
  ProtocolRecommendation,
  SessionEnvironment,
  TargetState,
  UserProfile,
  WorkedRating,
} from './types';
import { ENV_LABELS, TARGET_LABELS } from './types';

/**
 * Candidate acoustic arms (protocols) explored & optimized by the Contextual Bandit.
 * Each arm defines an explicit, auditable psychoacoustic parameter vector.
 */
export const PROTOCOL_ARMS: ProtocolArm[] = [
  {
    id: 'beta-drive-16hz',
    name: 'Beta-Drive 16 Hz',
    tagline: '16 Hz Beta amplitude modulation + warm anti-monotony pulse',
    description:
      'Engineered for sustained real-world attention: 16 Hz amplitude modulation (Woods et al. 2024), gentle 106 BPM rhythmic anchor, and traffic-safe frequency shaping.',
    targetStates: ['alert_focus', 'energy_lift'],
    drivingSafe: true,
    priorAlpha: 3.4,
    priorBeta: 1.2,
    baseParams: {
      modulationHz: 16,
      modulationDepth: 0.28,
      bpm: 106,
      pulseIntensity: 0.52,
      noiseColor: 'pink',
      noiseLevel: 0.08,
      harmonicMode: 'bright_maj9',
      rootNoteHz: 146.83, // D3
      filterCutoffHz: 1650,
      speakerSafeEQ: true,
      antiMonotonyCycleMin: 5,
      binauralOffsetHz: 0,
    },
    studyIds: ['woods-2024-am-attention', 'unal-2013-driving-audio', 'perham-2014-lyric-interference', 'heiderscheit-2015-iso-principle'],
  },
  {
    id: 'crisp-vigilance-18hz',
    name: 'Crisp Vigilance 18 Hz',
    tagline: '18 Hz high-beta modulation + uplifting alertness dynamics',
    description:
      'Slightly brighter vigilance profile (18 Hz AM, 114 BPM) with subtle 4-minute anti-monotony lifts to counter afternoon fatigue and road distraction.',
    targetStates: ['alert_focus', 'energy_lift'],
    drivingSafe: true,
    priorAlpha: 2.8,
    priorBeta: 1.4,
    baseParams: {
      modulationHz: 18,
      modulationDepth: 0.34,
      bpm: 114,
      pulseIntensity: 0.65,
      noiseColor: 'pink',
      noiseLevel: 0.06,
      harmonicMode: 'suspended_open',
      rootNoteHz: 164.81, // E3
      filterCutoffHz: 2100,
      speakerSafeEQ: true,
      antiMonotonyCycleMin: 4,
      binauralOffsetHz: 0,
    },
    studyIds: ['woods-2024-am-attention', 'unal-2013-driving-audio', 'heiderscheit-2015-iso-principle'],
  },
  {
    id: 'steady-horizon-14hz',
    name: 'Steady Horizon 14 Hz',
    tagline: 'Calm 14 Hz SMR/Low-Beta modulation + smooth groove',
    description:
      'Tailored for listeners sensitive to intense stimulation: gentle 14 Hz AM, warm harmonies, minimal noise floor, and a steady 96 BPM pulse for tension-free focus.',
    targetStates: ['alert_focus', 'deep_flow'],
    drivingSafe: true,
    priorAlpha: 3.0,
    priorBeta: 1.3,
    baseParams: {
      modulationHz: 14,
      modulationDepth: 0.22,
      bpm: 96,
      pulseIntensity: 0.36,
      noiseColor: 'brown',
      noiseLevel: 0.1,
      harmonicMode: 'warm_min9',
      rootNoteHz: 130.81, // C3
      filterCutoffHz: 1350,
      speakerSafeEQ: true,
      antiMonotonyCycleMin: 6,
      binauralOffsetHz: 0,
    },
    studyIds: ['woods-2024-am-attention', 'soderlund-2010-stochastic-noise', 'perham-2014-lyric-interference'],
  },
  {
    id: 'deep-stochastic-flow',
    name: 'Deep Stochastic Flow 15 Hz',
    tagline: 'Stochastic pink-noise masking + 15 Hz AM for Deep Work',
    description:
      'Built for uninterrupted desk work and study: pairs calibrated pink noise (Söderlund et al.) with minimal warm chord voicings and 15 Hz amplitude modulation.',
    targetStates: ['deep_flow', 'alert_focus'],
    drivingSafe: false,
    priorAlpha: 3.2,
    priorBeta: 1.2,
    baseParams: {
      modulationHz: 15,
      modulationDepth: 0.26,
      bpm: 90,
      pulseIntensity: 0.28,
      noiseColor: 'pink',
      noiseLevel: 0.22,
      harmonicMode: 'warm_min9',
      rootNoteHz: 110.0, // A2
      filterCutoffHz: 1200,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 4,
    },
    studyIds: ['woods-2024-am-attention', 'soderlund-2010-stochastic-noise', 'perham-2014-lyric-interference', 'garcia-argibay-2019-binaural-meta'],
  },
  {
    id: 'alpha-parasympathetic-10hz',
    name: 'Alpha Reset 10 Hz',
    tagline: 'Slow harmonies + 10 Hz Alpha cadence for autonomic calm',
    description:
      'Zero harsh percussion: warm organic voicings, subtle 10 Hz Alpha modulation, and soft rain-filtered texture to transition smoothly from tension into calm clarity.',
    targetStates: ['calm_reset', 'deep_flow'],
    drivingSafe: false,
    priorAlpha: 3.3,
    priorBeta: 1.1,
    baseParams: {
      modulationHz: 10,
      modulationDepth: 0.18,
      bpm: 64,
      pulseIntensity: 0.12,
      noiseColor: 'soft_rain',
      noiseLevel: 0.16,
      harmonicMode: 'suspended_open',
      rootNoteHz: 130.81, // C3
      filterCutoffHz: 980,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 3,
    },
    studyIds: ['thoma-2013-music-stress-hpa', 'heiderscheit-2015-iso-principle', 'garcia-argibay-2019-binaural-meta'],
  },
  {
    id: 'theta-drift-6hz',
    name: 'Theta Wind-Down 6 Hz',
    tagline: 'Deep warm harmonies, velvety brown noise & 6 Hz drift',
    description:
      'Gradual Iso-Principle down-regulation: warm low-pass harmonies, soft brown noise, and ultra-gentle 6 Hz modulation designed for pre-sleep decompression.',
    targetStates: ['sleep_winddown', 'calm_reset'],
    drivingSafe: false,
    priorAlpha: 3.1,
    priorBeta: 1.2,
    baseParams: {
      modulationHz: 6,
      modulationDepth: 0.14,
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
    studyIds: ['thoma-2013-music-stress-hpa', 'heiderscheit-2015-iso-principle', 'garcia-argibay-2019-binaural-meta'],
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

export function selectProtocolRecommendation(input: {
  sessionId: string;
  profile: UserProfile;
  currentState: CurrentState;
  baselineScore: number;
  targetState: TargetState;
  environment: SessionEnvironment;
  device: OutputDevice;
  durationMin: number;
  cohortStats: BanditStatRow[];
  profileStats: BanditStatRow[];
}): ProtocolRecommendation {
  const isDriving = input.environment === 'driving';
  const effectiveTarget: TargetState =
    isDriving && (input.targetState === 'sleep_winddown' || input.targetState === 'calm_reset')
      ? 'alert_focus'
      : input.targetState;
  const effectiveDevice: OutputDevice = isDriving ? 'car_audio' : input.device;

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

  const params: AcousticParams = { ...chosen.arm.baseParams };

  if (input.profile.noiseSensitivity === 'high') {
    params.noiseLevel = Number((params.noiseLevel * 0.45).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.85);
  } else if (input.profile.noiseSensitivity === 'low') {
    params.noiseLevel = Number(Math.min(0.32, params.noiseLevel * 1.25).toFixed(2));
  }

  if (input.profile.texturePref === 'rhythmic_pulse' && params.bpm > 0) {
    params.pulseIntensity = Number(Math.min(0.8, params.pulseIntensity + 0.14).toFixed(2));
  } else if (input.profile.texturePref === 'warm_organic') {
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.9);
  }

  if (input.currentState === 'fatigued' && params.bpm > 0) {
    params.bpm = Math.min(120, params.bpm + 4);
    params.modulationDepth = Number(Math.min(0.4, params.modulationDepth + 0.04).toFixed(2));
  } else if (input.currentState === 'anxious' || input.currentState === 'stressed') {
    params.modulationDepth = Number(Math.max(0.12, params.modulationDepth - 0.05).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.88);
  }

  if (input.profile.age >= 40) {
    params.filterCutoffHz = Math.min(params.filterCutoffHz, 1850);
  }

  const safetyWarnings: string[] = [];
  if (isDriving) {
    params.speakerSafeEQ = true;
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
  }

  const cohortKey = buildCohortKey(input.profile.ageBand, input.environment, effectiveTarget);
  const confidencePct = Math.round(chosen.expectedMean * 100);

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
    safetyMode: isDriving,
    safetyWarnings,
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
