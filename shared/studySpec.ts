import type {
  AcousticParams,
  EnergyTier,
  HarmonicMode,
  NoiseColor,
  OutputDevice,
  ResolvedGenre,
  SessionEnvironment,
  TargetState,
} from './types';

export type EntrainmentType =
  | 'none'
  | 'amplitude_modulation'
  | 'binaural_beat'
  | 'monaural_beat'
  | 'isochronic_pulse'
  | 'gamma_40hz_clicks'
  | 'hrv_breathing_swell';

export type EntrainmentWaveform =
  | 'sine'
  | 'raised_cosine'
  | 'trapezoid_isochronic'
  | 'gaussian_click_1ms';

export type TonalMode = 'major' | 'minor' | 'pentatonic' | 'suspended' | 'dorian' | 'drone';

export type InstrumentPalette =
  | 'felt_piano'
  | 'warm_rhodes'
  | 'nylon_acoustic'
  | 'cinematic_strings'
  | 'deep_electronic'
  | 'ambient_water';

export type PercussionMode = 'none' | 'minimal_soft' | 'steady_pulse';

export type CarrierEngineMode =
  | 'generative_live'
  | 'studio_library'
  | 'pure_stimulus'
  | 'lyria_realtime';

export type EvidenceOrigin = 'study_exact' | 'study_inferred' | 'clinical_safety_default';

export interface StudyEvidenceItem {
  parameter: string;
  targetLabel: string;
  executedValue: string;
  studyQuote: string;
  origin: EvidenceOrigin;
}

export interface StudyReferenceMeta {
  title: string;
  authors: string;
  year: string;
  journal: string;
  url: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  nctId?: string;
  source: 'core' | 'pubmed' | 'europepmc' | 'clinicaltrials' | 'custom_text';
}

export interface StudyEntrainmentSpec {
  type: EntrainmentType;
  frequencyHz: number;
  startFrequencyHz?: number;
  carrierLeftHz?: number;
  carrierRightHz?: number;
  modulationBandHz: [number, number];
  modulationDepth: number; // 0..1
  waveform: EntrainmentWaveform;
  dutyCycle?: number; // 0.02..0.85
  phaseOffsetDeg?: number;
  hrvBreathHz?: number; // e.g. 0.1 Hz = 6 breaths/min autonomic resonance
}

export interface StudyMusicSpec {
  defaultCarrierMode: CarrierEngineMode;
  bpm: number; // 0 = beatless
  bpmRamp?: { start: number; end: number };
  tonalMode: TonalMode;
  tuningA4Hz: 440 | 432;
  rootMidi: number; // e.g. 48 (C3), 50 (D3), 52 (E3), 55 (G3), 57 (A3)
  percussion: PercussionMode;
  density: number; // 0..1
  brightness: number; // 0..1
  spectralLowPassHz: number; // 480..16000
  instrumentPalette: InstrumentPalette;
  vibeTags: string[];
  lyriaWeightedPrompts: Array<{ text: string; weight: number }>;
}

export interface StudyNoiseSpec {
  color: NoiseColor;
  snrDb: number; // -36..+6 dB relative to music bed (-36 = silent/off)
  bandpassHz?: [number, number];
}

export interface StudyProtocolMeta {
  recommendedDurationMin: number;
  targetState: TargetState;
  requiresHeadphones: boolean;
  drivingSafe: boolean;
  safetyNotes: string[];
}

export interface ExecutableStudySpec {
  id: string;
  shortLabel: string;
  studyRef: StudyReferenceMeta;
  abstractExcerpt: string;
  compilerMode: 'verified_ground_truth' | 'deterministic_parser' | 'workers_ai_grounded';
  compliancePct: number;
  evidenceMap: StudyEvidenceItem[];
  entrainment: StudyEntrainmentSpec;
  music: StudyMusicSpec;
  noise: StudyNoiseSpec;
  protocol: StudyProtocolMeta;
}

export function midiToHz(midi: number, tuningA4Hz: 440 | 432 = 440): number {
  return Number((tuningA4Hz * Math.pow(2, (midi - 69) / 12)).toFixed(2));
}

export function snrDbToLinearGain(snrDb: number): number {
  if (snrDb <= -34) return 0;
  // Calibrated mapping: -18 dB -> ~0.12, -12 dB -> ~0.22, -6 dB -> ~0.34, 0 dB -> ~0.48
  const clamped = Math.max(-34, Math.min(6, snrDb));
  const linear = Math.pow(10, clamped / 20) * 0.48;
  return Number(Math.max(0.015, Math.min(0.62, linear)).toFixed(3));
}

export function paletteToResolvedGenre(palette: InstrumentPalette): ResolvedGenre {
  switch (palette) {
    case 'felt_piano':
    case 'warm_rhodes':
      return palette === 'warm_rhodes' ? 'jazz_rhodes' : 'lofi_keys';
    case 'nylon_acoustic':
      return 'acoustic_pluck';
    case 'cinematic_strings':
      return 'cinematic_strings';
    case 'ambient_water':
      return 'nature_rain';
    default:
      return 'deep_electronic';
  }
}

export function resolvedGenreToPalette(genre: ResolvedGenre): InstrumentPalette {
  switch (genre) {
    case 'lofi_keys':
    case 'solo_piano':
      return 'felt_piano';
    case 'jazz_rhodes':
    case 'dub_reggae':
      return 'warm_rhodes';
    case 'acoustic_pluck':
    case 'bossa_nova':
      return 'nylon_acoustic';
    case 'cinematic_strings':
      return 'cinematic_strings';
    case 'nature_rain':
    case 'ambient_space':
      return 'ambient_water';
    default:
      return 'deep_electronic';
  }
}

export function tonalModeToHarmonicMode(mode: TonalMode): HarmonicMode {
  switch (mode) {
    case 'major':
    case 'pentatonic':
      return 'bright_maj9';
    case 'minor':
    case 'dorian':
      return 'warm_min9';
    case 'drone':
      return 'deep_drone';
    default:
      return 'suspended_open';
  }
}

export function tonalModeToLyriaScale(mode: TonalMode, rootMidi: number): string {
  const pc = ((rootMidi % 12) + 12) % 12;
  // Lyria RealTime combines relative major/minor pairs
  const isMinor = mode === 'minor' || mode === 'dorian';
  const majorPc = isMinor ? (pc + 3) % 12 : pc;
  const scales: Record<number, string> = {
    0: 'C_MAJOR_A_MINOR',
    1: 'D_FLAT_MAJOR_B_FLAT_MINOR',
    2: 'D_MAJOR_B_MINOR',
    3: 'E_FLAT_MAJOR_C_MINOR',
    4: 'E_MAJOR_D_FLAT_MINOR',
    5: 'F_MAJOR_D_MINOR',
    6: 'G_FLAT_MAJOR_E_FLAT_MINOR',
    7: 'G_MAJOR_E_MINOR',
    8: 'A_FLAT_MAJOR_F_MINOR',
    9: 'A_MAJOR_G_FLAT_MINOR',
    10: 'B_FLAT_MAJOR_G_MINOR',
    11: 'B_MAJOR_A_FLAT_MINOR',
  };
  return scales[majorPc] ?? 'C_MAJOR_A_MINOR';
}

export function inferEnergyTierFromBpm(bpm: number, targetState: TargetState): EnergyTier {
  if (targetState === 'sleep_winddown' || targetState === 'calm_reset' || bpm <= 76) return 'calm';
  if (bpm >= 104 || targetState === 'energy_lift') return 'drive';
  return 'focus';
}

/**
 * Projects an ExecutableStudySpec into AcousticParams compatible with legacy telemetry,
 * D1 session persistence, and PsychoacousticEngine.
 */
export function studySpecToAcousticParams(
  spec: ExecutableStudySpec,
  overrides?: {
    device?: OutputDevice;
    environment?: SessionEnvironment;
    genre?: ResolvedGenre;
  }
): AcousticParams {
  const isDriving = overrides?.environment === 'driving' || overrides?.device === 'car_audio';
  const isSpeakers = overrides?.device === 'speakers' || isDriving;
  const genre = overrides?.genre ?? paletteToResolvedGenre(spec.music.instrumentPalette);
  const energyTier = inferEnergyTierFromBpm(spec.music.bpm, spec.protocol.targetState);

  const rawModHz =
    spec.entrainment.type === 'amplitude_modulation' ||
    spec.entrainment.type === 'isochronic_pulse' ||
    spec.entrainment.type === 'gamma_40hz_clicks' ||
    spec.entrainment.type === 'binaural_beat' ||
    spec.entrainment.type === 'monaural_beat'
      ? spec.entrainment.frequencyHz
      : spec.entrainment.hrvBreathHz ?? 0;

  const binauralHz =
    !isSpeakers && spec.entrainment.type === 'binaural_beat'
      ? Math.max(0.5, Math.min(40, spec.entrainment.frequencyHz))
      : 0;

  return {
    modulationHz: Number(rawModHz.toFixed(2)),
    modulationDepth: isDriving
      ? Math.min(0.28, spec.entrainment.modulationDepth)
      : Math.min(0.78, spec.entrainment.modulationDepth),
    crossoverHz: Math.max(20, Math.min(500, spec.entrainment.modulationBandHz[0])),
    upperCrossoverHz: Math.max(1200, Math.min(18000, spec.entrainment.modulationBandHz[1])),
    stereoAmSpread: !isSpeakers && (spec.entrainment.phaseOffsetDeg ?? 0) > 0,
    bpm: isDriving ? Math.max(92, Math.min(118, spec.music.bpm || 104)) : spec.music.bpm,
    pulseIntensity:
      spec.music.percussion === 'none'
        ? 0.08
        : spec.music.percussion === 'minimal_soft'
          ? 0.34
          : 0.62,
    noiseColor: spec.noise.color,
    noiseLevel: spec.noise.color === 'none' ? 0 : snrDbToLinearGain(spec.noise.snrDb),
    harmonicMode: tonalModeToHarmonicMode(spec.music.tonalMode),
    rootNoteHz: midiToHz(spec.music.rootMidi, spec.music.tuningA4Hz),
    filterCutoffHz: spec.music.spectralLowPassHz,
    speakerSafeEQ: isDriving,
    antiMonotonyCycleMin: isDriving ? 5 : 0,
    binauralOffsetHz: binauralHz,
    genre,
    genreSelectionMode: overrides?.genre ? 'user_chosen' : 'auto',
    energyTier,
  };
}

export const GENRE_LYRIA_PROMPTS: Record<
  ResolvedGenre,
  { prompts: Array<{ text: string; weight: number }>; muteDrums?: boolean }
> = {
  lofi_keys: {
    prompts: [
      { text: 'Instrumental Lo-Fi chillhop beats, warm dusty Rhodes electric piano, mellow vinyl groove, no vocals', weight: 1.0 },
      { text: 'Smooth study flow, soft sub-bass, gentle steady rhythm, strictly instrumental', weight: 0.5 },
    ],
  },
  deep_electronic: {
    prompts: [
      { text: 'Instrumental deep minimal electronic focus music, warm analog synth arpeggios, hypnotic clean bassline, no vocals', weight: 1.0 },
      { text: 'Steady productive flow, smooth warm filters, zero harsh drops, strictly instrumental', weight: 0.5 },
    ],
  },
  cinematic_strings: {
    prompts: [
      { text: 'Instrumental neoclassical chamber strings, warm cello and soft violins, legato evolving harmonies, no vocals', weight: 1.0 },
      { text: 'Spacious warm concert hall resonance, smooth dynamic flow, strictly instrumental', weight: 0.45 },
    ],
    muteDrums: true,
  },
  jazz_rhodes: {
    prompts: [
      { text: 'Instrumental late-night smooth jazz, warm Fender Rhodes chords, upright bass, soft brushed snare, no vocals', weight: 1.0 },
      { text: 'Cozy lounge focus atmosphere, rich 9th chords, strictly instrumental', weight: 0.5 },
    ],
  },
  acoustic_pluck: {
    prompts: [
      { text: 'Instrumental warm acoustic fingerstyle guitar, bright organic nylon strings, uplifting gentle arpeggios, no vocals', weight: 1.0 },
      { text: 'Warm sunlit studio tone, steady calm momentum, strictly instrumental', weight: 0.45 },
    ],
  },
  nature_rain: {
    prompts: [
      { text: 'Instrumental ambient rain soundscape with ultra-soft warm analog pads and delicate glass piano, no vocals', weight: 1.0 },
      { text: 'Tranquil beatless relaxation, smooth low-pass warmth, zero drums', weight: 0.6 },
    ],
    muteDrums: true,
  },
  dub_reggae: {
    prompts: [
      { text: 'Instrumental chill dub reggae, deep warm sub-bassline, clean rhythmic guitar skank, warm organ skanks, subtle spring reverb, no vocals', weight: 1.0 },
      { text: 'Relaxed sunny island groove, smooth cohesive dynamics, strictly instrumental, no singing', weight: 0.55 },
    ],
  },
  ambient_space: {
    prompts: [
      { text: 'Beatless deep space ambient soundscape, floating celestial synth pads, warm slow-evolving harmonic drones, zero percussion, no vocals', weight: 1.0 },
      { text: 'Serene meditative atmosphere, silky warm frequencies, strictly beatless instrumental', weight: 0.6 },
    ],
    muteDrums: true,
  },
  solo_piano: {
    prompts: [
      { text: 'Intimate solo felt piano instrumental, warm neoclassical piano melody, soft hammer tone, gentle sustained chords, no vocals', weight: 1.0 },
      { text: 'Peaceful studio recording, calm focus flow, zero drums, strictly solo piano', weight: 0.55 },
    ],
    muteDrums: true,
  },
  bossa_nova: {
    prompts: [
      { text: 'Instrumental Brazilian Bossa Nova jazz, warm nylon acoustic guitar syncopation, soft upright bass, subtle rimshot and shaker groove, no vocals', weight: 1.0 },
      { text: 'Sunny Rio cafe focus vibe, warm Rhodes touches, uplifting mood, strictly instrumental', weight: 0.55 },
    ],
  },
};

/**
 * Generates exact Google Lyria RealTime WebSocket parameters from an ExecutableStudySpec
 * and the listener's active curated genre.
 */
export function buildLyriaRealtimeConfig(
  spec: ExecutableStudySpec,
  genreOverride?: ResolvedGenre
): {
  weightedPrompts: Array<{ text: string; weight: number }>;
  config: {
    bpm: number;
    density: number;
    brightness: number;
    scale: string;
    muteBass: boolean;
    muteDrums: boolean;
    guidance: number;
  };
} {
  const bpm = Math.max(60, Math.min(160, Math.round(spec.music.bpm || 82)));
  const genrePreset = genreOverride ? GENRE_LYRIA_PROMPTS[genreOverride] : undefined;
  const weightedPrompts =
    genrePreset?.prompts ??
    (spec.music.lyriaWeightedPrompts.length > 0
      ? spec.music.lyriaWeightedPrompts
      : [
          {
            text: `Purely instrumental ${spec.music.vibeTags.join(', ') || 'warm ambient music'}, strictly no vocals, no lyrics, smooth dynamics`,
            weight: 1.0,
          },
        ]);

  return {
    weightedPrompts,
    config: {
      bpm,
      density: Number(Math.max(0.15, Math.min(0.88, spec.music.density)).toFixed(2)),
      brightness: Number(Math.max(0.18, Math.min(0.88, spec.music.brightness)).toFixed(2)),
      scale: tonalModeToLyriaScale(spec.music.tonalMode, spec.music.rootMidi),
      muteBass:
        (spec.music.tonalMode === 'drone' && spec.music.density < 0.25) ||
        genreOverride === 'solo_piano',
      muteDrums: Boolean(spec.music.percussion === 'none' || genrePreset?.muteDrums),
      guidance: 4.2,
    },
  };
}

export const ENTRAINMENT_LABELS: Record<EntrainmentType, string> = {
  none: 'Pure Musical Architecture',
  amplitude_modulation: 'Cortical Amplitude Modulation (AM)',
  binaural_beat: 'Precision Binaural Beat (L/R)',
  monaural_beat: 'Acoustic Monaural Beat',
  isochronic_pulse: 'Isochronic Gated Pulse',
  gamma_40hz_clicks: '40 Hz Gamma Acoustic Bursts (GENUS)',
  hrv_breathing_swell: '0.1 Hz HRV Vagal Breathing Swell',
};

export const CARRIER_MODE_LABELS: Record<CarrierEngineMode, { label: string; shortDesc: string }> = {
  generative_live: {
    label: 'Live Generative · Study-Locked ($0)',
    shortDesc: 'Composed live as-we-go obeying exact study BPM, key, tuning & ramps',
  },
  studio_library: {
    label: 'Studio R2 Library',
    shortDesc: 'Pre-mastered R2 stems routed through the exact psychoacoustic DSP rack',
  },
  pure_stimulus: {
    label: 'Pure Acoustic Signal',
    shortDesc: 'Raw study modulation & calibrated noise floor (zero background music)',
  },
  lyria_realtime: {
    label: 'Google Lyria RealTime AI',
    shortDesc: 'Live WebSocket AI music steered by study BPM, scale & drums lock',
  },
};
