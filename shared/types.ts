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

export type MusicGenreChoice =
  | 'auto'
  | 'lofi_keys'
  | 'deep_electronic'
  | 'cinematic_strings'
  | 'jazz_rhodes'
  | 'acoustic_pluck'
  | 'nature_rain';

export type ResolvedGenre = Exclude<MusicGenreChoice, 'auto'>;

export type EnergyTier = 'calm' | 'focus' | 'drive';

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
  preferredModMult?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AcousticParams {
  modulationHz: number;
  modulationDepth: number;
  crossoverHz: number; // Lower LR4 crossover (<190 Hz sub-bass stays 100% clean)
  upperCrossoverHz?: number; // Upper LR4 crossover (>4500 Hz air/sparkle stays 100% clean)
  stereoAmSpread?: boolean; // Gentle stereo phase-shifted AM shimmer on headphones (off in car/speakers)
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
  genre: ResolvedGenre;
  genreSelectionMode: 'auto' | 'user_chosen' | 'iso_adapted';
  energyTier: EnergyTier;
}

export interface ScientificStudy {
  id: string;
  authors: string;
  year: number;
  journal: string;
  title: string;
  mechanism: string;
  soundEffect: string;
  summary: string;
  caveat: string;
  doiOrUrl: string;
  applicableTargets: TargetState[];
  applicableEnvironments?: SessionEnvironment[];
}

export interface LivePubMedPaper {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  url: string;
}

export interface FormulaIngredient {
  role: string;
  compound: string;
  dose: string;
  evidenceTag: string;
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
  baseParams: Omit<AcousticParams, 'genre' | 'genreSelectionMode' | 'energyTier' | 'stereoAmSpread'>;
  studyIds: string[];
}

export interface LiveAdjustment {
  atSec: number;
  control: 'intensity' | 'modulation' | 'pulse' | 'noise' | 'genre';
  delta: number;
  note?: string;
}

export interface ParsedCheckIn {
  rawText: string;
  extractedAge?: number;
  extractedRole?: UserRole;
  extractedGenre?: ResolvedGenre;
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
  isControlTrial: boolean;
  safetyMode: boolean;
  safetyWarnings: string[];
  genreAdaptationNote?: string;
  formulaIngredients: FormulaIngredient[];
  rationale: string;
  studies: ScientificStudy[];
  livePubMedPapers?: LivePubMedPaper[];
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
  isControlTrial: boolean;
  energyTier: EnergyTier;
  musicGenre: ResolvedGenre;
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

export interface GenrePerformance {
  genre: ResolvedGenre;
  label: string;
  sessions: number;
  successRatePct: number;
  avgDelta: number;
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

export interface ABValidationStats {
  activeSessions: number;
  controlSessions: number;
  activeAvgDelta: number;
  controlAvgDelta: number;
  activeSuccessRatePct: number;
  controlSuccessRatePct: number;
  deltaLift: number;
  readyForStats: boolean;
}

export interface ResearchInsights {
  totalProfiles: number;
  totalSessions: number;
  completedDebriefs: number;
  pendingDebriefs: number;
  globalSuccessRatePct: number;
  globalAvgDelta: number;
  explorationSharePct: number;
  abValidation: ABValidationStats;
  cohorts: CohortPerformance[];
  personalArms: ArmPerformance[];
  genreLeaderboard: GenrePerformance[];
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

export const GENRE_META: Record<
  ResolvedGenre,
  { label: string; shortDesc: string; vibeTag: string }
> = {
  lofi_keys: {
    label: 'Lo-Fi Warm Keys',
    shortDesc: 'Dusty Rhodes chords & laid-back beat',
    vibeTag: 'Warm · Study · ADHD',
  },
  deep_electronic: {
    label: 'Deep Electronic',
    shortDesc: 'Clean sub-bass & hypnotic steady pulse',
    vibeTag: 'Driving · Energy · Code',
  },
  cinematic_strings: {
    label: 'Cinematic Strings',
    shortDesc: 'Sweeping wide harmonies & deep resonance',
    vibeTag: 'Deep Flow · Creative',
  },
  jazz_rhodes: {
    label: 'Jazz Rhodes',
    shortDesc: 'Warm 9th/11th keys & soft brush groove',
    vibeTag: 'Long Focus · Smooth',
  },
  acoustic_pluck: {
    label: 'Acoustic Pluck',
    shortDesc: 'Organic guitar/harp arpeggios & warmth',
    vibeTag: 'Reading · Grounded',
  },
  nature_rain: {
    label: 'Nature & Rain',
    shortDesc: 'Soft stereo rainfall & glass chimes',
    vibeTag: 'Calm · Reset · Sleep',
  },
};

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

export const ENERGY_LABELS: Record<EnergyTier, { label: string; bpmRange: string }> = {
  calm: { label: 'Calm / Slow', bpmRange: 'Beatless · 60–76 BPM' },
  focus: { label: 'Focus / Steady', bpmRange: '84–102 BPM' },
  drive: { label: 'Drive / Alert', bpmRange: '104–118 BPM' },
};
