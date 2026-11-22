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
import { ENV_LABELS_RO, TARGET_LABELS_RO } from './types';

/**
 * Candidate acoustic arms (protocols) explored & optimized by the Contextual Bandit.
 * Each arm defines an explicit, auditable psychoacoustic vector.
 */
export const PROTOCOL_ARMS: ProtocolArm[] = [
  {
    id: 'beta-drive-16hz',
    name: 'Beta-Drive 16 Hz',
    taglineRo: 'Modulație beta 16 Hz + puls cald anti-monotonie',
    descriptionRo:
      'Protocol creat pentru atenție susținută în medii reale: modulație AM de 16 Hz (Woods et al. 2024), puls ritmic discret la 106 BPM și filtrare sigură pentru sunetele ambientale.',
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
    taglineRo: 'Modulație high-beta 18 Hz + dinamică energizantă',
    descriptionRo:
      'Stimulare ușor mai energică (18 Hz AM, 114 BPM) cu variații subtile la fiecare 4 minute pentru combaterea distrasului și a monotoniei pe drum sau după-amiaza.',
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
    taglineRo: 'SMR/Low-Beta 14 Hz calm + groove discret fără oboseală',
    descriptionRo:
      'Ideal pentru ascultătorii sensibili la sunete intense: modulație joasă 14 Hz, armonii calde, zgomot minim și ritm stabil de 96 BPM pentru concentrare fără tensiune.',
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
    taglineRo: 'Rezonanță stocastică (pink noise) + 15 Hz AM pentru Deep Work',
    descriptionRo:
      'Conceput pentru concentrare profundă la birou sau studiu: combină pink noise calibrat (Söderlund et al.) cu un pat armonic minimalist și modulație 15 Hz.',
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
    taglineRo: 'Armonii lente + puls respirator 10 Hz pentru reducerea stresului',
    descriptionRo:
      'Fără percuție agresivă: texturi organice calde, modulație fină în banda Alpha (10 Hz) și filtrare blândă pentru tranziția din agitație în claritate calmă.',
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
    taglineRo: 'Armonii joase, brown noise catifelat și coborâre lentă spre somn',
    descriptionRo:
      'Reducere progresivă a stimulării pe principiul Iso: frecvențe joase calde, brown noise catifelat și modulație ultra-blândă de 6 Hz pentru pregătirea somnului.',
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

export function formatCohortLabelRo(cohortKey: string): string {
  const [ageBand, env, target] = cohortKey.split('|') as [AgeBand, SessionEnvironment, TargetState];
  const envLabel = ENV_LABELS_RO[env] ?? env;
  const targetLabel = TARGET_LABELS_RO[target] ?? target;
  return `${ageBand} ani · ${envLabel} · ${targetLabel}`;
}

/**
 * Sample from Beta(alpha, beta) using Marsaglia-Tsang Gamma approximation.
 * Enables genuine Thompson Sampling in both Worker and client.
 */
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

/**
 * Computes bounded [0, 1] reward score from explicit debrief + implicit behavioral signals.
 */
export function computeSessionReward(input: {
  baselineScore: number;
  postScore: number;
  workedRating: WorkedRating;
  completionRatio: number;
  liveAdjustments: LiveAdjustment[];
}): { reward: number; delta: number } {
  const delta = input.postScore - input.baselineScore;
  // Normalize delta from [-4, +4] into [0, 1], centered at 0.45 for neutral
  const deltaSignal = Math.max(0, Math.min(1, 0.45 + delta * 0.18));
  const ratingSignal =
    input.workedRating === 'yes' ? 1.0 : input.workedRating === 'partial' ? 0.55 : 0.1;
  const completionSignal = Math.max(0.15, Math.min(1, input.completionRatio));

  // Too many frantic manual adjustments slightly penalize out-of-the-box fit
  const adjustPenalty = Math.min(0.12, input.liveAdjustments.length * 0.02);

  const reward = Math.max(
    0.05,
    Math.min(0.98, ratingSignal * 0.5 + deltaSignal * 0.35 + completionSignal * 0.15 - adjustPenalty)
  );
  return { reward: Number(reward.toFixed(3)), delta };
}

/**
 * Selects an arm via Contextual Thompson Sampling (blending scientific prior + cohort evidence + personal evidence)
 * and tailors AcousticParams with strict safety guardrails & individual sensory calibration.
 */
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

  // Filter candidate arms safely
  let candidates = PROTOCOL_ARMS.filter((arm) => {
    if (isDriving && !arm.drivingSafe) return false;
    return arm.targetStates.includes(effectiveTarget);
  });
  if (candidates.length === 0) {
    candidates = PROTOCOL_ARMS.filter((arm) => (isDriving ? arm.drivingSafe : true));
  }

  const cohortMap = new Map(input.cohortStats.map((s) => [s.armId, s]));
  const profileMap = new Map(input.profileStats.map((s) => [s.armId, s]));

  // Score each candidate with blended Beta posterior (Prior + Cohort + 1.5x Personal)
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

  // Best exploit arm by posterior mean vs Thompson-sampled winner
  const bestExploit = [...scored].sort((a, b) => b.expectedMean - a.expectedMean)[0];
  const thompsonWinner = [...scored].sort((a, b) => b.thompsonDraw - a.thompsonDraw)[0];

  // Controlled exploration (~20% when Thompson selects a non-top arm or explicit cold-start discovery)
  const isExploration = thompsonWinner.arm.id !== bestExploit.arm.id;
  const chosen = thompsonWinner;

  // Tailor base acoustic parameters to user sensory profile, age band & safety mode
  const params: AcousticParams = { ...chosen.arm.baseParams };

  // Sensory noise calibration
  if (input.profile.noiseSensitivity === 'high') {
    params.noiseLevel = Number((params.noiseLevel * 0.45).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.85);
  } else if (input.profile.noiseSensitivity === 'low') {
    params.noiseLevel = Number(Math.min(0.32, params.noiseLevel * 1.25).toFixed(2));
  }

  // Texture preference nudges
  if (input.profile.texturePref === 'rhythmic_pulse' && params.bpm > 0) {
    params.pulseIntensity = Number(Math.min(0.8, params.pulseIntensity + 0.14).toFixed(2));
  } else if (input.profile.texturePref === 'warm_organic') {
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.9);
  }

  // Current state calibration (Iso-principle starting adjustment)
  if (input.currentState === 'fatigued' && params.bpm > 0) {
    params.bpm = Math.min(120, params.bpm + 4);
    params.modulationDepth = Number(Math.min(0.4, params.modulationDepth + 0.04).toFixed(2));
  } else if (input.currentState === 'anxious' || input.currentState === 'stressed') {
    params.modulationDepth = Number(Math.max(0.12, params.modulationDepth - 0.05).toFixed(2));
    params.filterCutoffHz = Math.round(params.filterCutoffHz * 0.88);
  }

  // Age-aware high-frequency warmth (subtle psychoacoustic comfort curve)
  if (input.profile.age >= 40) {
    params.filterCutoffHz = Math.min(params.filterCutoffHz, 1850);
  }

  // Strict safety guardrails for driving or speakers
  const safetyWarningsRo: string[] = [];
  if (isDriving) {
    params.speakerSafeEQ = true;
    params.binauralOffsetHz = 0;
    params.noiseLevel = Math.min(params.noiseLevel, 0.07);
    params.antiMonotonyCycleMin = params.antiMonotonyCycleMin > 0 ? params.antiMonotonyCycleMin : 5;
    safetyWarningsRo.push(
      'Driving Safety Mode activ: redare exclusiv pe difuzoare (fără căști), frecvențele de trafic (sirene/claxoane) rămân libere și sunt activate micro-variații anti-monotonie.'
    );
    safetyWarningsRo.push(
      'Acest audio susține atenția, dar NU înlocuiește odihna. Dacă simți somnolență accentuată, oprește într-un loc sigur pentru o pauză.'
    );
  } else if (effectiveDevice !== 'headphones') {
    params.binauralOffsetHz = 0;
    params.speakerSafeEQ = true;
  }

  const cohortKey = buildCohortKey(input.profile.ageBand, input.environment, effectiveTarget);
  const confidencePct = Math.round(chosen.expectedMean * 100);

  const evidenceNote =
    chosen.profileTrials > 0
      ? `Calibrat din ${chosen.profileTrials} sesiuni personale anterioare și ${chosen.cohortTrials} sesiuni din cohorta ta.`
      : chosen.cohortTrials > 0
        ? `Ales pe baza a ${chosen.cohortTrials} sesiuni reale din cohorta «${formatCohortLabelRo(cohortKey)}» (${confidencePct}% scor estimat).`
        : `Prima sesiune în această cohortă: pornim de la protocolul cu cea mai solidă bază științifică și învățăm din rezultatul tău.`;

  const explorationNote = isExploration
    ? ' (Include o variație controlată de explorare ca platforma să descopere dacă un profil ușor diferit îți merge și mai bine.)'
    : '';

  return {
    sessionId: input.sessionId,
    cohortKey,
    cohortLabelRo: formatCohortLabelRo(cohortKey),
    arm: chosen.arm,
    params,
    isExploration,
    safetyMode: isDriving,
    safetyWarningsRo,
    rationaleRo: `${chosen.arm.descriptionRo} ${evidenceNote}${explorationNote}`,
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
