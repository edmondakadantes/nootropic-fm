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
  modulationHz: number;
  modulationDepth: number;
  bpm: number;
  pulseIntensity: number;
  noiseColor: NoiseColor;
  noiseLevel: number;
  harmonicMode: HarmonicMode;
  rootNoteHz: number;
  filterCutoffHz: number;
  speakerSafeEQ: boolean;
  antiMonotonyCycleMin: number;
  binauralOffsetHz: number;
}

export interface ScientificStudy {
  id: string;
  authors: string;
  year: number;
  journal: string;
  title: string;
  mechanism: string;
  summary: string;
  caveat: string;
  doiOrUrl: string;
  applicableTargets: TargetState[];
  applicableEnvironments?: SessionEnvironment[];
}

export interface ProtocolArm {
  id: string;
  name: string;
  tagline: string;
  description: string;
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
  cohortLabel: string;
  arm: ProtocolArm;
  params: AcousticParams;
  isExploration: boolean;
  safetyMode: boolean;
  safetyWarnings: string[];
  rationale: string;
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
  cohortLabel: string;
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

export const STATE_LABELS: Record<CurrentState, string> = {
  distracted: 'Distracted / scattered',
  fatigued: 'Fatigued / low energy',
  stressed: 'Stressed / tense',
  anxious: 'Anxious / jittery',
  calm_neutral: 'Neutral / steady',
  restless: 'Restless / bored',
};

export const TARGET_LABELS: Record<TargetState, string> = {
  alert_focus: 'Alert & Sustained Focus',
  deep_flow: 'Deep Flow State',
  calm_reset: 'Calm & Stress Reset',
  energy_lift: 'Energy & Clarity Lift',
  sleep_winddown: 'Sleep Wind-Down',
};

export const ENV_LABELS: Record<SessionEnvironment, string> = {
  driving: 'Driving (car / bus / truck)',
  office: 'Office / Desk Work',
  study: 'Studying / Reading',
  home_relax: 'Home / Relaxing',
  transit: 'Commuting / Transit',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  driver: 'Professional Driver / Transport',
  knowledge_worker: 'Office / Tech / Knowledge Work',
  student: 'Student / Researcher',
  creative: 'Creative / Design / Writing',
  entrepreneur: 'Founder / Management',
  other: 'Other Field',
};

export const DEVICE_LABELS: Record<OutputDevice, string> = {
  headphones: 'Headphones',
  speakers: 'Speakers',
  car_audio: 'Vehicle Speakers',
};
