export type AgeBand = '18-24' | '25-34' | '35-44' | '45-54' | '55+';

export type UserRole =
  | 'driver'
  | 'knowledge_worker'
  | 'student'
  | 'creative'
  | 'entrepreneur'
  | 'other';

export type TexturePreference = 'warm_organic' | 'minimal_electronic' | 'nature_drift' | 'rhythmic_pulse';

export type NoiseSensitivity = 'low' | 'medium' | 'high';

export type OutputDevice = 'headphones' | 'speakers' | 'car_audio';

export type PrimaryChallenge = 'distraction' | 'fatigue' | 'stress' | 'sleep';

export type CurrentState =
  | 'distracted'
  | 'fatigued'
  | 'stressed'
  | 'anxious'
  | 'calm_neutral'
  | 'restless';

export type TargetState =
  | 'alert_focus'
  | 'deep_flow'
  | 'calm_reset'
  | 'energy_lift'
  | 'sleep_winddown';

export type SessionEnvironment =
  | 'driving'
  | 'office'
  | 'study'
  | 'home_relax'
  | 'transit';

export type WorkedRating = 'yes' | 'partial' | 'no';

export type TimeOfDayBucket = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export type NoiseColor = 'pink' | 'brown' | 'soft_rain' | 'none';

export type HarmonicMode = 'bright_maj9' | 'warm_min9' | 'suspended_open' | 'deep_drone';

export interface UserProfile {
  id: string;
  age: number;
  ageBand: AgeBand;
  role: UserRole;
  texturePref: TexturePreference;
  noiseSensitivity: NoiseSensitivity;
  defaultDevice: OutputDevice;
  primaryChallenge: PrimaryChallenge;
  researchConsent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AcousticParams {
  modulationHz: number;        // e.g. 16 Hz (Beta) for sustained attention, 10 Hz (Alpha) for calm
  modulationDepth: number;     // 0.0 - 0.55 subtle rhythmic amplitude modulation
  bpm: number;                 // 0 (no pulse) or 60 - 124 BPM
  pulseIntensity: number;      // 0.0 - 1.0 percussive groove presence
  noiseColor: NoiseColor;
  noiseLevel: number;          // 0.0 - 0.45 calibrated broadband masking level
  harmonicMode: HarmonicMode;
  rootNoteHz: number;          // Musical tonic e.g. 146.83 (D3), 130.81 (C3), 110 (A2)
  filterCutoffHz: number;      // Low-pass warmth cutoff
  speakerSafeEQ: boolean;      // Preserves traffic/ambient midrange cues (800-3500 Hz) & disables binaural
  antiMonotonyCycleMin: number; // Subtle timbral/energy lift interval to prevent highway hypnosis (0 = off)
  binauralOffsetHz: number;    // 0 when speakers/driving; subtle only when headphones + calm/flow
}

export interface ScientificStudy {
  id: string;
  authors: string;
  year: number;
  journal: string;
  title: string;
  mechanism: string;
  summaryRo: string;
  caveatRo: string;
  doiOrUrl: string;
  applicableTargets: TargetState[];
  applicableEnvironments?: SessionEnvironment[];
}

export interface ProtocolArm {
  id: string;
  name: string;
  taglineRo: string;
  descriptionRo: string;
  targetStates: TargetState[];
  drivingSafe: boolean;
  priorAlpha: number;
  priorBeta: number;
  baseParams: AcousticParams;
  studyIds: string[];
}

export interface LiveAdjustment {
  atSec: number;
  control: 'intensity' | 'modulation' | 'pulse' | 'noise';
  delta: number;
}

export interface ParsedCheckIn {
  rawText: string;
  extractedAge?: number;
  extractedRole?: UserRole;
  currentState: CurrentState;
  targetState: TargetState;
  environment: SessionEnvironment;
  device: OutputDevice;
  durationMin: number;
  detectedKeywords: string[];
  usedGemini: boolean;
}

export interface ProtocolRecommendation {
  sessionId: string;
  cohortKey: string;
  cohortLabelRo: string;
  arm: ProtocolArm;
  params: AcousticParams;
  isExploration: boolean;
  safetyMode: boolean;
  safetyWarningsRo: string[];
  rationaleRo: string;
  studies: ScientificStudy[];
  confidencePct: number;
  cohortTrials: number;
  profileTrials: number;
  plannedDurationMin: number;
  currentState: CurrentState;
  targetState: TargetState;
  baselineScore: number;
  environment: SessionEnvironment;
  device: OutputDevice;
}

export interface SessionRecord {
  id: string;
  profileId: string;
  cohortKey: string;
  rawInputText: string;
  currentState: CurrentState;
  baselineScore: number;
  targetState: TargetState;
  environment: SessionEnvironment;
  device: OutputDevice;
  safetyMode: boolean;
  plannedDurationMin: number;
  actualDurationSec: number;
  completionRatio: number;
  armId: string;
  armName: string;
  isExploration: boolean;
  acousticParams: AcousticParams;
  citedStudyIds: string[];
  liveAdjustments: LiveAdjustment[];
  timeOfDayBucket: TimeOfDayBucket;
  status: 'active' | 'pending_debrief' | 'completed' | 'abandoned';
  postScore: number | null;
  deltaScore: number | null;
  workedRating: WorkedRating | null;
  feedbackTags: string[];
  rewardScore: number | null;
  notes: string;
  createdAt: string;
  completedAt: string | null;
}

export interface DebriefPayload {
  sessionId: string;
  actualDurationSec: number;
  postScore: number;
  workedRating: WorkedRating;
  feedbackTags: string[];
  liveAdjustments: LiveAdjustment[];
  notes?: string;
}

export interface ArmPerformance {
  armId: string;
  armName: string;
  trials: number;
  successRatePct: number;
  avgDelta: number;
  avgCompletionPct: number;
  alpha: number;
  beta: number;
}

export interface CohortPerformance {
  cohortKey: string;
  cohortLabelRo: string;
  totalSessions: number;
  completedSessions: number;
  avgDelta: number;
  successRatePct: number;
  topArmName: string;
  arms: ArmPerformance[];
}

export interface ResearchInsights {
  totalProfiles: number;
  totalSessions: number;
  completedDebriefs: number;
  pendingDebriefs: number;
  globalSuccessRatePct: number;
  globalAvgDelta: number;
  explorationSharePct: number;
  cohorts: CohortPerformance[];
  personalArms: ArmPerformance[];
  recentSessions: SessionRecord[];
}

export function ageToBand(age: number): AgeBand {
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  return '55+';
}

export function getTimeOfDayBucket(date = new Date()): TimeOfDayBucket {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

export const STATE_LABELS_RO: Record<CurrentState, string> = {
  distracted: 'Distrat / împrăștiat',
  fatigued: 'Obosit / fără energie',
  stressed: 'Stresat / tensionat',
  anxious: 'Neliniștit / agitat',
  calm_neutral: 'Neutru / stabil',
  restless: 'Neliniște fizică / plictisit',
};

export const TARGET_LABELS_RO: Record<TargetState, string> = {
  alert_focus: 'Focus alert & susținut',
  deep_flow: 'Concentrare profundă (Flow)',
  calm_reset: 'Calmare & reducere stres',
  energy_lift: 'Activare & claritate',
  sleep_winddown: 'Relaxare spre somn',
};

export const ENV_LABELS_RO: Record<SessionEnvironment, string> = {
  driving: 'La volan (mașină / microbuz)',
  office: 'Birou / lucru la calculator',
  study: 'Studiu / citit',
  home_relax: 'Acasă / relaxare',
  transit: 'În mișcare / transport',
};

export const ROLE_LABELS_RO: Record<UserRole, string> = {
  driver: 'Șofer profesionist / transport',
  knowledge_worker: 'Muncă de birou / IT / analiză',
  student: 'Student / învățare',
  creative: 'Creativ / design / scris',
  entrepreneur: 'Antreprenor / management',
  other: 'Alt domeniu',
};

export const DEVICE_LABELS_RO: Record<OutputDevice, string> = {
  headphones: 'Căști',
  speakers: 'Boxe / difuzor',
  car_audio: 'Audio mașină (difuzoare)',
};
