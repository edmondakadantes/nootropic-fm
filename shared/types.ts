import type { ExecutableStudySpec } from './studySpec';

export type AgeBand = '18-24' | '25-34' | '35-44' | '45-54' | '55+';

export type UserGender = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';

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

export type NoiseColor = 'white' | 'pink' | 'brown' | 'soft_rain' | 'none';

export type HarmonicMode = 'bright_maj9' | 'warm_min9' | 'suspended_open' | 'deep_drone';

export type MusicGenreChoice =
  | 'auto'
  | 'lofi_keys'
  | 'deep_electronic'
  | 'cinematic_strings'
  | 'jazz_rhodes'
  | 'acoustic_pluck'
  | 'nature_rain'
  | 'dub_reggae'
  | 'ambient_space'
  | 'solo_piano'
  | 'bossa_nova';

export type ResolvedGenre = Exclude<MusicGenreChoice, 'auto'>;

export type EnergyTier = 'calm' | 'focus' | 'drive';

export type AudioSourceType =
  | 'generative_live'
  | 'studio_library'
  | 'community_cache'
  | 'live_generating'
  | 'lyria_realtime'
  | 'pure_stimulus'
  | 'procedural_fallback';

export interface UserProfile {
  id: string;
  displayName?: string;
  age: number;
  ageBand: AgeBand;
  gender?: UserGender;
  role: UserRole;
  occupationLabel?: string;
  texturePref: TexturePreference;
  noiseSensitivity: NoiseSensitivity;
  defaultDevice: OutputDevice;
  primaryChallenge: PrimaryChallenge;
  researchConsent: boolean;
  preferredModMult?: number;
  favoriteGenres?: ResolvedGenre[];
  sessionCount?: number;
  planTier?: 'free' | 'pro';
  proUntil?: string | null;
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
  genreSelectionMode: 'auto' | 'user_chosen' | 'iso_adapted' | 'custom_vibe';
  energyTier: EnergyTier;
  customGenreSlug?: string;
  customGenreLabel?: string;
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
  source?: 'pubmed' | 'openalex' | 'europepmc' | 'clinicaltrials';
  title: string;
  authors: string;
  journal: string;
  year: string;
  url: string;
  doiUrl?: string;
  abstractText?: string;
  appliedMechanism?: string;
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
  baseParams: Omit<AcousticParams, 'genre' | 'genreSelectionMode' | 'energyTier' | 'stereoAmSpread' | 'customGenreSlug' | 'customGenreLabel'>;
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
  extractedName?: string;
  extractedAge?: number;
  extractedGender?: UserGender;
  extractedRole?: UserRole;
  extractedOccupation?: string;
  extractedGenre?: ResolvedGenre;
  extractedCustomGenre?: string;
  currentState: CurrentState;
  microStateId?: string;
  microStateLabel?: string;
  arousalPct?: number;
  clarityPct?: number;
  targetState: TargetState;
  environment: SessionEnvironment;
  device: OutputDevice;
  durationMin: number;
  detectedKeywords: string[];
  usedGemini: boolean;
}

export interface CustomTrackInfo {
  id: string;
  genreSlug: string;
  displayLabel: string;
  energyTier: EnergyTier;
  url: string;
  provider: string;
  bpm: number;
  durationSec: number;
  sizeBytes: number;
  playCount: number;
}

export interface ProtocolRecommendation {
  sessionId: string;
  cohortKey: string;
  cohortLabel: string;
  arm: ProtocolArm;
  params: AcousticParams;
  isExploration: boolean;
  isControlTrial: boolean;
  ephemeralMode?: boolean;
  safetyMode: boolean;
  safetyWarnings: string[];
  genreAdaptationNote?: string;
  audioSource: AudioSourceType;
  fallbackCoreGenre: ResolvedGenre;
  customGenreSlug?: string;
  customGenreLabel?: string;
  customTrackUrl?: string;
  composedMusicPrompt?: string;
  personalizationSummary: string[];
  formulaIngredients: FormulaIngredient[];
  rationale: string;
  studies: ScientificStudy[];
  livePubMedPapers?: LivePubMedPaper[];
  executableSpec?: ExecutableStudySpec;
  confidencePct: number;
  cohortTrials: number;
  profileTrials: number;
  plannedDurationMin: number;
  currentState: CurrentState;
  microStateId?: string;
  microStateLabel?: string;
  arousalPct?: number;
  clarityPct?: number;
  targetState: TargetState;
  baselineScore: number;
  environment: SessionEnvironment;
  device: OutputDevice;
  returnBonusAwarded?: boolean;
}

export interface SessionRecord {
  id: string;
  profileId?: string;
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
  musicGenre: string;
  initialMusicGenre?: string;
  customGenreSlug?: string | null;
  audioSource?: AudioSourceType;
  retentionOutcome?: string | null;
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
  pvtPreMs?: number | null;
  pvtPostMs?: number | null;
  pvtLapsesPre?: number | null;
  pvtLapsesPost?: number | null;
  pvtPreInvRt?: number | null;
  pvtPostInvRt?: number | null;
  pvtTrialCount?: number | null;
  pvtRefreshHz?: number | null;
  pvtDecileSpreadMs?: number | null;
  blindingGuess?: 'active' | 'control' | 'unsure' | null;
  studySpecId?: string;
  studyTitle?: string;
  entrainmentType?: string;
  frequencyHz?: number;
}

export interface StudyLeaderboardEntry {
  studySpecId: string;
  studyTitle: string;
  entrainmentType: string;
  frequencyHz: number;
  sessions: number;
  successRatePct: number;
  avgDelta: number;
  pvtTrials: number;
  avgPvtDeltaMs: number | null;
}

export interface CohortIntelligenceCard {
  id: string;
  isLiveData: boolean;
  professionLabel: string;
  fromStateLabel: string;
  toStateLabel: string;
  studyLabel: string;
  sessions: number;
  successRatePct: number;
  fullFinishPct: number;
  // Partially blurred B2B intelligence preview fields
  retentionCurve: {
    pct25: number;
    pct50: number;
    pct75: number;
    pct90: number;
  };
  blurredPreview: {
    topGenreHint: string;
    modulationHint: string;
    avgPvtShiftMs: number | null;
    abLiftPct: number | null;
  };
}

export interface GlobalRetentionFunnel {
  measuredSessions: number;
  pct25: number;
  pct50: number;
  pct75: number;
  pct90: number;
  avgCompletionPct: number;
}

export interface DatasetInquiryPayload {
  email: string;
  organization: string;
  roleTitle?: string;
  cohortInterest?: string;
  useCase?: 'enterprise_wellness' | 'audio_hardware' | 'academic_research' | 'automotive_safety' | 'other';
  notes?: string;
}

export interface ArmPerformance {
  armId: string;
  armName: string;
  trials: number;
  explicitTrials?: number;
  implicitTrials?: number;
  successRatePct: number;
  avgDelta: number;
  avgCompletionPct: number;
  alpha: number;
  beta: number;
}

export interface GenrePerformance {
  genre: string;
  label: string;
  isCustom?: boolean;
  sessions: number;
  successRatePct: number;
  avgDelta: number;
  avgRetentionPct?: number;
}

export interface ArchetypeComboPerformance {
  cohortKey: string;
  cohortLabel: string;
  armName: string;
  genreSlug: string;
  genreLabel: string;
  sessions: number;
  avgDelta: number;
  avgRetentionPct: number;
  successRatePct: number;
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
  activeListenRetentionPct: number;
  controlListenRetentionPct: number;
  deltaLift: number;
  retentionLiftPct: number;
  readyForStats: boolean;
}

export interface RetentionMetrics {
  trackedSessions: number;
  avgListenRetentionPct: number;
  completionRatePct: number;
  earlyBounceRatePct: number;
  instantSwapRatePct: number;
  d1ReturnRatePct: number;
  d7ReturnRatePct: number;
  returningProfiles: number;
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
  retentionMetrics: RetentionMetrics;
  cohorts: CohortPerformance[];
  personalArms: ArmPerformance[];
  genreLeaderboard: GenrePerformance[];
  topArchetypeCombos: ArchetypeComboPerformance[];
  recentSessions: SessionRecord[];
}

export interface AppRuntimeConfig {
  regionRequiresOptIn: boolean;
  countryCode: string;
  customLiveGenAvailable: boolean;
  lyriaRealtimeAvailable?: boolean;
  workersAiCompilerAvailable?: boolean;
  stripeBillingAvailable?: boolean;
  musicProvider: string;
  dailyCapMax: number;
  dailyCapRemaining: number;
  popularCustomVibes: Array<{
    genreSlug: string;
    displayLabel: string;
    energyTier: EnergyTier;
    playCount: number;
  }>;
}

export function ageToBand(age: number): AgeBand {
  const safeAge = Math.max(18, age);
  if (safeAge < 25) return '18-24';
  if (safeAge < 35) return '25-34';
  if (safeAge < 45) return '35-44';
  if (safeAge < 55) return '45-54';
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
    label: 'Lo-Fi Beats',
    shortDesc: 'Dusty Rhodes chords & laid-back beat',
    vibeTag: 'Warm · Study · Deep Focus',
  },
  deep_electronic: {
    label: 'Deep Electronic',
    shortDesc: 'Clean analog synths & steady focus pulse',
    vibeTag: 'Driving · Energy · Code',
  },
  cinematic_strings: {
    label: 'Classical & Strings',
    shortDesc: 'Warm chamber strings & neoclassical flow',
    vibeTag: 'Deep Flow · Reading',
  },
  jazz_rhodes: {
    label: 'Late-Night Jazz',
    shortDesc: 'Warm Rhodes keys, upright bass & soft groove',
    vibeTag: 'Creative · Smooth',
  },
  acoustic_pluck: {
    label: 'Acoustic Guitar',
    shortDesc: 'Warm fingerstyle guitar & organic uplift',
    vibeTag: 'Mood Lift · Grounded',
  },
  nature_rain: {
    label: 'Soft Rain & Nature',
    shortDesc: 'Gentle stereo rainfall & warm ambient pads',
    vibeTag: 'Calm · Reset · Sleep',
  },
  dub_reggae: {
    label: 'Dub Reggae',
    shortDesc: 'Warm dub bass, clean skank guitar & chill groove',
    vibeTag: 'Good Mood · Relaxed Flow',
  },
  ambient_space: {
    label: 'Ambient & Space',
    shortDesc: 'Beatless floating celestial pads, zero drums',
    vibeTag: 'Deep Calm · Sleep · Meditation',
  },
  solo_piano: {
    label: 'Solo Felt Piano',
    shortDesc: 'Intimate soft neoclassical felt piano keys',
    vibeTag: 'Focus · Calm · 432 Hz Ready',
  },
  bossa_nova: {
    label: 'Bossa Nova',
    shortDesc: 'Sunny Brazilian nylon guitar & light groove',
    vibeTag: 'Uplifting · Cafe Focus',
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

export const GENDER_LABELS: Record<UserGender, string> = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
};

export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  knowledge_worker: 'Programmer / Tech',
  driver: 'Driver / Road',
  student: 'Student / Study',
  creative: 'Creative',
  entrepreneur: 'Founder / Lead',
  other: 'Other',
};

export function formatProfileSummary(p: {
  age: number;
  gender?: UserGender;
  role: UserRole;
  occupationLabel?: string;
}): string {
  const parts: string[] = [`${Math.max(18, Math.round(p.age))}yo`];
  if (p.gender && p.gender !== 'prefer_not_to_say') {
    parts.push(GENDER_LABELS[p.gender]);
  }
  const job = p.occupationLabel?.trim() || ROLE_SHORT_LABELS[p.role] || 'Listener';
  parts.push(job);
  return parts.join(' · ');
}

export const ENERGY_LABELS: Record<EnergyTier, { label: string; bpmRange: string }> = {
  calm: { label: 'Calm / Slow', bpmRange: 'Beatless · 60–76 BPM' },
  focus: { label: 'Focus / Steady', bpmRange: '84–102 BPM' },
  drive: { label: 'Drive / Alert', bpmRange: '104–118 BPM' },
};
