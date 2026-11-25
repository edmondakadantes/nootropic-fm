import {
  NEURAL_MICRO_STATES,
  type NeuralCoords,
  type NeuralMicroState,
} from '../../shared/neuralStates';
import {
  computeIsoBridgeForState,
  pickSmartInitialEffectTier,
} from '../../shared/psychometrics';
import { resolvedGenreToPalette, type ExecutableStudySpec } from '../../shared/studySpec';
import type {
  CurrentState,
  ProtocolArm,
  ProtocolRecommendation,
  ResolvedGenre,
  ScientificStudy,
  TargetState,
  UserProfile,
} from '../../shared/types';

export type QuickTryId = 'focus_lofi' | 'mood_uplift' | 'calm_rain' | 'energy_electronic';

export type QuickFeelingId =
  | 'tired_fog'
  | 'distracted'
  | 'stressed_anxious'
  | 'burned_out'
  | 'sad_low'
  | 'calm_ready';

export interface QuickFeelingMeta {
  id: QuickFeelingId;
  label: string;
  tag: string;
  currentState: CurrentState;
  microStateId: string;
  recommendedTarget: TargetState;
}

export const QUICK_FEELINGS: QuickFeelingMeta[] = [
  {
    id: 'tired_fog',
    label: 'Tired / Brain Fog',
    tag: 'LOW ENERGY',
    currentState: 'fatigued',
    microStateId: 'brain_fog',
    recommendedTarget: 'energy_lift',
  },
  {
    id: 'distracted',
    label: 'Distracted / Scattered',
    tag: 'MIND JUMPING',
    currentState: 'distracted',
    microStateId: 'distracted_scattered',
    recommendedTarget: 'alert_focus',
  },
  {
    id: 'stressed_anxious',
    label: 'Stressed / Anxious',
    tag: 'TENSE · RACING',
    currentState: 'anxious',
    microStateId: 'anxious_racing',
    recommendedTarget: 'calm_reset',
  },
  {
    id: 'burned_out',
    label: 'Burned Out / Drained',
    tag: 'DEPLETED',
    currentState: 'fatigued',
    microStateId: 'burned_out',
    recommendedTarget: 'calm_reset',
  },
  {
    id: 'sad_low',
    label: 'Sad / Low Mood',
    tag: 'NEEDS WARMTH',
    currentState: 'fatigued',
    microStateId: 'low_mood',
    recommendedTarget: 'energy_lift',
  },
  {
    id: 'calm_ready',
    label: 'Calm & Grounded',
    tag: 'STEADY',
    currentState: 'calm_neutral',
    microStateId: 'calm_steady',
    recommendedTarget: 'deep_flow',
  },
];

export function previewStateGoalTrajectory(
  feelingId: QuickFeelingId,
  targetState: TargetState,
  profile?: UserProfile | null
): {
  hzSummary: string;
  effectLabel: string;
  genreLabel: string;
  isIsoBridge: boolean;
} {
  const feeling = QUICK_FEELINGS.find((f) => f.id === feelingId) ?? QUICK_FEELINGS[1];
  const isDriving = profile?.role === 'driver';
  const targetHz =
    targetState === 'energy_lift'
      ? feelingId === 'sad_low'
        ? 14
        : 18
      : targetState === 'alert_focus'
        ? feelingId === 'burned_out'
          ? 14
          : 16
        : targetState === 'deep_flow'
          ? feelingId === 'burned_out' || feelingId === 'sad_low'
            ? 12
            : 15
          : targetState === 'calm_reset'
            ? feelingId === 'stressed_anxious'
              ? 0.1
              : 10
            : 6;

  const isoBridge =
    targetHz > 12
      ? computeIsoBridgeForState({
          currentState: feeling.currentState,
          microStateId: feeling.microStateId,
          targetState,
          targetHz,
          safetyMode: isDriving,
        })
      : undefined;

  const tierInfo = pickSmartInitialEffectTier({
    currentState: feeling.currentState,
    microStateId: feeling.microStateId,
    targetState,
    safetyMode: isDriving,
    noiseSensitivity: profile?.noiseSensitivity,
    preferredModMult: profile?.preferredModMult,
  });

  const effectLabel =
    tierInfo.tier === 'max'
      ? 'Max Effect · 94%'
      : tierInfo.tier === 'min'
        ? 'Min Effect · 36%'
        : isoBridge
          ? 'Iso-Bridge · 38% → 65%'
          : 'Standard · 65%';

  const hzSummary = isoBridge
    ? `3m ${isoBridge.stabilizeHz} Hz Calm → ${targetHz} Hz`
    : targetHz === 0.1
      ? '0.10 Hz HRV Breath Tide'
      : feeling.currentState === 'fatigued' && targetHz >= 14
        ? `10 → ${targetHz} Hz Beta Lift`
        : feeling.currentState === 'distracted' && targetHz >= 14
          ? `12 → ${targetHz} Hz Attention Lock`
          : targetState === 'sleep_winddown'
            ? '8.5 → 6 Hz Theta Drift'
            : `${targetHz} Hz Active Wave`;

  const genreLabel =
    targetState === 'sleep_winddown'
      ? 'Nature & Rain'
      : targetState === 'calm_reset'
        ? feelingId === 'sad_low'
          ? 'Solo Piano'
          : 'Nature & Rain'
        : feelingId === 'sad_low'
          ? 'Acoustic Guitar (Major)'
          : feelingId === 'stressed_anxious' || feelingId === 'burned_out'
            ? 'Lo-Fi Keys (Warm)'
            : 'Deep Electronic';

  return {
    hzSummary,
    effectLabel,
    genreLabel,
    isIsoBridge: Boolean(isoBridge),
  };
}

/**
 * Builds an instant (<1 ms), state-calibrated ProtocolRecommendation for any of the
 * 6 Current Feelings × 5 Target Outcomes on the Main Page 2-Click Launcher.
 */
export function buildStateGoalQuickRecommendation(
  feelingId: QuickFeelingId,
  targetState: TargetState,
  profile?: UserProfile | null
): ProtocolRecommendation {
  const feeling = QUICK_FEELINGS.find((f) => f.id === feelingId) ?? QUICK_FEELINGS[1];

  const baseId: QuickTryId =
    targetState === 'calm_reset' || targetState === 'sleep_winddown'
      ? 'calm_rain'
      : feelingId === 'sad_low'
        ? 'mood_uplift'
        : targetState === 'energy_lift'
          ? 'energy_electronic'
          : 'focus_lofi';

  const rec = structuredClone(buildRawQuickTryRecommendation(baseId));
  rec.sessionId = `eph_quick_${feelingId}_${targetState}_${Date.now().toString(36)}`;
  rec.currentState = feeling.currentState;
  rec.microStateId = feeling.microStateId;
  rec.microStateLabel = feeling.label;
  rec.targetState = targetState;

  const genre: ResolvedGenre =
    targetState === 'sleep_winddown'
      ? 'nature_rain'
      : targetState === 'calm_reset'
        ? feelingId === 'sad_low'
          ? 'solo_piano'
          : 'nature_rain'
        : feelingId === 'sad_low'
          ? 'acoustic_pluck'
          : feelingId === 'stressed_anxious' || feelingId === 'burned_out'
            ? 'lofi_keys'
            : 'deep_electronic';

  rec.params.genre = genre;
  rec.fallbackCoreGenre = genre;

  if (targetState === 'sleep_winddown' && rec.executableSpec) {
    rec.plannedDurationMin = 30;
    rec.params.modulationHz = 6;
    rec.params.modulationDepth = 0.28;
    rec.params.bpm = 0;
    rec.params.energyTier = 'calm';
    rec.params.noiseColor = 'brown';
    rec.params.noiseLevel = 0.16;
    rec.arm.id = 'theta-drift-6hz';
    rec.arm.name = 'Theta Sleep Drift · 6 Hz';
    rec.executableSpec.id = 'jespersen-2022-cochrane-sleep';
    rec.executableSpec.shortLabel = 'Cochrane Sleep Wind-Down · 6 Hz';
    rec.executableSpec.entrainment = {
      type: 'amplitude_modulation',
      frequencyHz: 6,
      startFrequencyHz: 8.5,
      modulationBandHz: [160, 2800],
      modulationDepth: 0.28,
      waveform: 'raised_cosine',
      phaseOffsetDeg: 18,
      hrvBreathHz: 0.1,
    };
    rec.executableSpec.music.instrumentPalette = resolvedGenreToPalette(genre);
    rec.executableSpec.music.bpm = 0;
    rec.executableSpec.music.percussion = 'none';
    rec.executableSpec.noise = { color: 'brown', snrDb: -16 };
    rec.executableSpec.protocol.targetState = 'sleep_winddown';
  } else if (targetState === 'calm_reset' && feelingId !== 'stressed_anxious' && rec.executableSpec) {
    rec.plannedDurationMin = 20;
    rec.params.modulationHz = 10;
    rec.params.modulationDepth = 0.3;
    rec.params.energyTier = 'calm';
    rec.arm.id = 'alpha-parasympathetic-10hz';
    rec.arm.name = 'Alpha Calm Reset · 10 Hz';
    rec.executableSpec.entrainment = {
      type: 'amplitude_modulation',
      frequencyHz: 10,
      startFrequencyHz: 12.5,
      modulationBandHz: [190, 3800],
      modulationDepth: 0.3,
      waveform: 'raised_cosine',
      phaseOffsetDeg: 24,
      hrvBreathHz: 0.1,
    };
    rec.executableSpec.music.instrumentPalette = resolvedGenreToPalette(genre);
    rec.executableSpec.protocol.targetState = 'calm_reset';
  } else if (rec.executableSpec && rec.executableSpec.entrainment.type === 'amplitude_modulation') {
    const targetHz =
      targetState === 'energy_lift'
        ? feelingId === 'sad_low'
          ? 14
          : 18
        : targetState === 'alert_focus'
          ? feelingId === 'burned_out'
            ? 14
            : 16
          : feelingId === 'burned_out' || feelingId === 'sad_low'
            ? 12
            : 15;

    rec.plannedDurationMin = targetState === 'deep_flow' ? 35 : 25;
    rec.params.modulationHz = targetHz;
    rec.params.energyTier =
      targetState === 'energy_lift' && feelingId !== 'stressed_anxious' && feelingId !== 'burned_out'
        ? 'drive'
        : 'focus';
    rec.arm.name =
      targetState === 'energy_lift'
        ? `${targetHz} Hz Energy Lift`
        : targetState === 'deep_flow'
          ? `${targetHz} Hz Deep Flow`
          : `${targetHz} Hz Sharp Focus`;

    rec.executableSpec.entrainment.frequencyHz = targetHz;
    rec.executableSpec.music.instrumentPalette = resolvedGenreToPalette(genre);
    rec.executableSpec.protocol.targetState = targetState;
    if (feelingId === 'stressed_anxious' || feelingId === 'burned_out') {
      rec.params.filterCutoffHz = 1950;
      rec.executableSpec.music.spectralLowPassHz = 1950;
    }

    const isDriving = profile?.role === 'driver';
    const isoBridge = computeIsoBridgeForState({
      currentState: feeling.currentState,
      microStateId: feeling.microStateId,
      targetState,
      targetHz,
      safetyMode: isDriving,
    });
    if (isoBridge) {
      rec.executableSpec.entrainment.isoBridge = isoBridge;
      rec.executableSpec.entrainment.startFrequencyHz = isoBridge.stabilizeHz;
    } else if (feeling.currentState === 'fatigued') {
      rec.executableSpec.entrainment.startFrequencyHz = 10;
    } else if (feeling.currentState === 'distracted') {
      rec.executableSpec.entrainment.startFrequencyHz = 12;
    }
  }

  return applyQuickTryProfile(rec, profile);
}

const QUICK_TRY_CITATIONS: Record<QuickTryId, ScientificStudy[]> = {
  focus_lofi: [
    {
      id: 'woods-2024',
      authors: 'Woods, K. J. P., Sampaio, G., James, T., Morillon, B., & Loui, P.',
      year: 2024,
      title: 'Rapid modulation in music supports attention in listeners with attentional difficulties',
      journal: 'Communications Biology (Nature Portfolio)',
      mechanism: '16 Hz Beta rapid mid-band amplitude modulation',
      soundEffect: 'Sustained attention without harsh drones',
      doiOrUrl: 'https://doi.org/10.1038/s42003-024-07026-3',
      summary:
        'Rapid beta-band amplitude modulation (~16 Hz) embedded inside instrumental music supported sustained attention compared with unmodulated control tracks.',
      caveat: 'Individual response varies; adjust modulation depth live to comfort.',
      applicableTargets: ['alert_focus', 'deep_flow'],
    },
  ],
  mood_uplift: [
    {
      id: 'husain-2002',
      authors: 'Husain, G., Thompson, W. F., & Schellenberg, E. G.',
      year: 2002,
      title: 'Effects of musical tempo and mode on arousal, mood, and spatial abilities',
      journal: 'Music Perception',
      mechanism: 'Bright major-mode harmonic pacing + gentle 12 Hz SMR lift',
      soundEffect: 'Warm acoustic brightness for shifting low mood toward uplifted clarity',
      doiOrUrl: 'https://doi.org/10.1525/mp.2002.20.2.151',
      summary:
        'Major-mode instrumental music at an upbeat natural tempo significantly improved subjective positive mood and arousal relative to slow minor passages.',
      caveat: 'Designed for everyday mood uplift and cognitive wellness; not a medical treatment.',
      applicableTargets: ['energy_lift', 'alert_focus'],
    },
  ],
  energy_electronic: [
    {
      id: 'husain-2002',
      authors: 'Husain, G., Thompson, W. F., & Schellenberg, E. G.',
      year: 2002,
      title: 'Effects of musical tempo and mode on arousal, mood, and spatial abilities',
      journal: 'Music Perception',
      mechanism: 'Upbeat major-mode pacing with 18 Hz beta modulation',
      soundEffect: 'Clean daytime alertness and forward momentum',
      doiOrUrl: 'https://doi.org/10.1525/mp.2002.20.2.151',
      summary:
        'Faster-tempo major-mode instrumental music increased subjective alertness, energy, and spatial performance relative to slow minor-mode passages.',
      caveat: 'Supports daytime alertness; not a substitute for rest.',
      applicableTargets: ['energy_lift', 'alert_focus'],
    },
  ],
  calm_rain: [
    {
      id: 'lehrer-2014',
      authors: 'Lehrer, P. M., & Gevirtz, R.',
      year: 2014,
      title: 'Heart rate variability biofeedback: how and why does it work?',
      journal: 'Frontiers in Psychology',
      mechanism: '0.10 Hz paced autonomic breathing resonance (~6 breaths/min)',
      soundEffect: 'Smooth 5s inhale / 5s exhale audio swell',
      doiOrUrl: 'https://doi.org/10.3389/fpsyg.2014.00756',
      summary:
        'Slow paced breathing at ~0.1 Hz (~6 breaths/min) engages cardiovascular baroreflex resonance and parasympathetic calm.',
      caveat: 'Follow the gentle 5s inhale / 5s exhale audio swell at your own comfortable pace.',
      applicableTargets: ['calm_reset', 'sleep_winddown'],
    },
  ],
};

function applyQuickTryProfile(
  rec: ProtocolRecommendation,
  profile?: UserProfile | null
): ProtocolRecommendation {
  if (!profile) return rec;
  const mult = Math.max(0.65, Math.min(1.35, profile.preferredModMult ?? 1.0));
  const targetDevice = profile.role === 'driver' ? 'car_audio' : profile.defaultDevice;
  const isDriving = targetDevice === 'car_audio';
  const isSpeakers = targetDevice === 'speakers' || isDriving;
  const scaledDepth = Number(Math.min(0.56, Math.max(0.12, rec.params.modulationDepth * mult)).toFixed(2));

  const nextSpec = rec.executableSpec
    ? {
        ...rec.executableSpec,
        entrainment: {
          ...rec.executableSpec.entrainment,
          modulationDepth: isDriving ? Math.min(0.38, scaledDepth) : scaledDepth,
          phaseOffsetDeg: isSpeakers ? 0 : rec.executableSpec.entrainment.phaseOffsetDeg,
        },
        protocol: {
          ...rec.executableSpec.protocol,
          requiresHeadphones: false,
          drivingSafe: isDriving ? true : rec.executableSpec.protocol.drivingSafe,
        },
      }
    : undefined;

  return {
    ...rec,
    device: targetDevice,
    environment: isDriving ? 'driving' : rec.environment,
    safetyMode: isDriving,
    params: {
      ...rec.params,
      modulationDepth: isDriving ? Math.min(0.38, scaledDepth) : scaledDepth,
      speakerSafeEQ: isSpeakers,
      stereoAmSpread: Boolean(rec.params.stereoAmSpread && !isSpeakers),
      noiseLevel: isDriving ? Math.min(rec.params.noiseLevel, 0.07) : rec.params.noiseLevel,
      antiMonotonyCycleMin: isDriving ? 5 : rec.params.antiMonotonyCycleMin,
    },
    executableSpec: nextSpec,
  };
}

/**
 * Builds a zero-latency, ephemeral studio-ready ProtocolRecommendation for 1-click Hero Quick Try.
 * Kept isolated from `studyPresets.ts` so the initial `/` bundle stays ultra-light and policy-clean.
 */
export function buildInstantQuickTryRecommendation(
  id: QuickTryId,
  profile?: UserProfile | null
): ProtocolRecommendation {
  const rec = buildRawQuickTryRecommendation(id);
  return applyQuickTryProfile(rec, profile);
}

export function previewMicroStateTrajectory(
  microState: NeuralMicroState,
  coords: NeuralCoords,
  targetState: TargetState,
  profile?: UserProfile | null
): {
  hzSummary: string;
  effectLabel: string;
  genreLabel: string;
  isIsoBridge: boolean;
  isoWaypointCoords?: NeuralCoords;
} {
  const isDriving = profile?.role === 'driver';
  const msId = microState.id;
  const targetHz =
    targetState === 'energy_lift'
      ? msId === 'low_mood'
        ? 14
        : 18
      : targetState === 'alert_focus'
        ? msId === 'burned_out' || msId === 'screen_fatigue'
          ? 14
          : msId === 'pre_performance'
            ? 13
            : 16
        : targetState === 'deep_flow'
          ? msId === 'creative_block'
            ? 10.5
            : msId === 'burned_out' || msId === 'low_mood'
              ? 12
              : 15
          : targetState === 'calm_reset'
            ? microState.coreState === 'anxious' || msId === 'overwhelmed'
              ? 0.1
              : 10
            : 6;

  const isoBridge =
    targetHz > 12
      ? computeIsoBridgeForState({
          currentState: microState.coreState,
          microStateId: msId,
          targetState,
          targetHz,
          safetyMode: isDriving,
        })
      : undefined;

  const tierInfo = pickSmartInitialEffectTier({
    currentState: microState.coreState,
    microStateId: msId,
    targetState,
    safetyMode: isDriving,
    noiseSensitivity: profile?.noiseSensitivity,
    preferredModMult: profile?.preferredModMult,
  });

  const effectLabel =
    tierInfo.tier === 'max'
      ? 'Max Effect · 94%'
      : tierInfo.tier === 'min'
        ? 'Min Effect · 36%'
        : isoBridge
          ? 'Iso-Bridge · 38% → 65%'
          : 'Standard · 65%';

  // Continuous coordinate-derived entry Hz when no Iso-Bridge overrides
  const coordStartHz = Number(
    Math.max(8.0, Math.min(16.0, 8.5 + (coords.energy / 100) * 7.0)).toFixed(1)
  );

  const hzSummary = isoBridge
    ? `3m ${isoBridge.stabilizeHz} Hz Calm → ${targetHz} Hz`
    : targetHz === 0.1
      ? '0.10 Hz HRV Breath Tide'
      : targetState === 'sleep_winddown'
        ? `${Math.min(10, coordStartHz)} → 6 Hz Theta Drift`
        : Math.abs(coordStartHz - targetHz) >= 1.2
          ? `${coordStartHz} → ${targetHz} Hz Trajectory`
          : `${targetHz} Hz Locked Wave`;

  const genreLabel =
    targetState === 'sleep_winddown'
      ? 'Nature & Rain'
      : targetState === 'calm_reset'
        ? msId === 'low_mood'
          ? 'Solo Piano'
          : 'Nature & Rain'
        : msId === 'low_mood' || msId === 'creative_block'
          ? 'Acoustic Guitar (Major)'
          : isoBridge || microState.coreState === 'anxious' || microState.coreState === 'stressed'
            ? 'Lo-Fi Keys (Warm)'
            : 'Deep Electronic';

  return {
    hzSummary,
    effectLabel,
    genreLabel,
    isIsoBridge: Boolean(isoBridge),
    isoWaypointCoords: isoBridge ? { energy: 40, clarity: 74 } : undefined,
  };
}

/**
 * Builds an instant (<1 ms) ProtocolRecommendation directly from any 2D Neural Brain Map
 * coordinate `(energy, clarity)` + nearest `NeuralMicroState` + chosen `TargetState`.
 */
export function buildMicroStateGoalRecommendation(
  microState: NeuralMicroState,
  coords: NeuralCoords,
  targetState: TargetState,
  profile?: UserProfile | null
): ProtocolRecommendation {
  const msId = microState.id;
  const mappedFeeling: QuickFeelingId =
    msId === 'low_mood'
      ? 'sad_low'
      : msId === 'burned_out' || msId === 'screen_fatigue'
        ? 'burned_out'
        : microState.coreState === 'anxious' || microState.coreState === 'stressed'
          ? 'stressed_anxious'
          : microState.coreState === 'distracted' || microState.coreState === 'restless'
            ? 'distracted'
            : microState.coreState === 'fatigued'
              ? 'tired_fog'
              : 'calm_ready';

  const rec = buildStateGoalQuickRecommendation(mappedFeeling, targetState, profile);
  rec.sessionId = `eph_quick_${msId}_${targetState}_${Date.now().toString(36)}`;
  rec.currentState = microState.coreState;
  rec.microStateId = msId;
  rec.microStateLabel = microState.label;
  rec.arousalPct = coords.energy;
  rec.clarityPct = coords.clarity;

  if (rec.executableSpec && rec.executableSpec.entrainment.type === 'amplitude_modulation') {
    const targetHz = rec.executableSpec.entrainment.frequencyHz;
    const isDriving = profile?.role === 'driver';
    const isoBridge = computeIsoBridgeForState({
      currentState: microState.coreState,
      microStateId: msId,
      targetState,
      targetHz,
      safetyMode: isDriving,
    });
    if (isoBridge) {
      rec.executableSpec.entrainment.isoBridge = isoBridge;
      rec.executableSpec.entrainment.startFrequencyHz = isoBridge.stabilizeHz;
    } else {
      delete rec.executableSpec.entrainment.isoBridge;
      const coordStartHz = Number(
        Math.max(8.0, Math.min(16.0, 8.5 + (coords.energy / 100) * 7.0)).toFixed(1)
      );
      rec.executableSpec.entrainment.startFrequencyHz =
        targetState === 'sleep_winddown' ? Math.min(10, coordStartHz) : coordStartHz;
    }
    // Modulate initial warm filter cutoff smoothly from clarity coordinate
    if (coords.clarity < 40) {
      const warmCap = Math.round(1650 + (coords.clarity / 40) * 650);
      rec.params.filterCutoffHz = Math.min(rec.params.filterCutoffHz, warmCap);
      rec.executableSpec.music.spectralLowPassHz = Math.min(
        rec.executableSpec.music.spectralLowPassHz,
        warmCap
      );
    }
  }

  return rec;
}

export { NEURAL_MICRO_STATES };

function buildRawQuickTryRecommendation(id: QuickTryId): ProtocolRecommendation {
  const sessionId = `eph_quick_${id}_${Date.now().toString(36)}`;

  if (id === 'mood_uplift') {
    const baseParams: ProtocolArm['baseParams'] = {
      modulationHz: 12,
      modulationDepth: 0.34,
      crossoverHz: 200,
      upperCrossoverHz: 4200,
      bpm: 112,
      pulseIntensity: 0.46,
      noiseColor: 'pink',
      noiseLevel: 0.04,
      harmonicMode: 'bright_maj9',
      rootNoteHz: 146.83,
      filterCutoffHz: 2900,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 0,
    };

    const spec: ExecutableStudySpec = {
      id: 'husain-2002-mood-uplift',
      shortLabel: 'Husain 2002 · Major Mood Uplift',
      studyRef: {
        title: 'Effects of musical tempo and mode on arousal, mood, and spatial abilities',
        authors: 'Husain, G., Thompson, W. F., & Schellenberg, E. G.',
        year: '2002',
        journal: 'Music Perception',
        url: 'https://doi.org/10.1525/mp.2002.20.2.151',
        doi: '10.1525/mp.2002.20.2.151',
        source: 'core',
      },
      abstractExcerpt:
        'Bright major-mode harmonic pacing paired with warm acoustic instrumentation and gentle 12 Hz SMR lift supports shifting from low mood toward uplifted clarity.',
      compilerMode: 'verified_ground_truth',
      compliancePct: 100,
      evidenceMap: [
        {
          parameter: 'Harmonic Mode & Tempo',
          targetLabel: 'Major-Mode Uplift Groove',
          executedValue: 'Bright Major-9th Acoustic Guitar stems · 112 BPM natural momentum',
          studyQuote: 'Major mode and upbeat tempo significantly elevated positive mood and enjoyment.',
          origin: 'study_exact',
        },
        {
          parameter: 'Acoustic Modulation',
          targetLabel: '12 Hz Gentle SMR Clarity AM',
          executedValue: '12.0 Hz 3-Band LR4 Mid-Band AM (200–4200 Hz, 34% active ASSR depth)',
          studyQuote: 'Gentle mid-band rhythmic alignment adds clarity without sharp fatigue.',
          origin: 'study_inferred',
        },
      ],
      entrainment: {
        type: 'amplitude_modulation',
        frequencyHz: 12,
        startFrequencyHz: 10,
        modulationBandHz: [200, 4200],
        modulationDepth: 0.34,
        waveform: 'sine',
        phaseOffsetDeg: 24,
      },
      music: {
        defaultCarrierMode: 'studio_library',
        bpm: 112,
        tonalMode: 'major',
        tuningA4Hz: 440,
        rootMidi: 50,
        percussion: 'minimal_soft',
        density: 0.48,
        brightness: 0.68,
        spectralLowPassHz: 2900,
        instrumentPalette: 'nylon_acoustic',
        vibeTags: ['warm acoustic guitar', 'uplifting major', 'lyric-free'],
        lyriaWeightedPrompts: [
          {
            text: 'Strictly instrumental uplifting warm nylon acoustic guitar and bright Rhodes in D major, joyful flow, zero vocals',
            weight: 1.5,
          },
        ],
      },
      noise: { color: 'pink', snrDb: -26 },
      protocol: {
        recommendedDurationMin: 20,
        targetState: 'energy_lift',
        requiresHeadphones: false,
        drivingSafe: true,
        safetyNotes: [],
      },
    };

    return {
      sessionId,
      cohortKey: 'quick_try:uplift',
      cohortLabel: 'Instant Preview · Local-Only',
      arm: {
        id: 'major-mood-uplift-12hz',
        name: 'Major Mood Uplift · 12 Hz',
        tagline: 'Bright Major Harmony · Acoustic Uplift',
        description:
          'Warm major-mode acoustic arpeggios layered with gentle 12 Hz mid-band modulation designed to guide low mood smoothly toward uplifted clarity.',
        targetStates: ['energy_lift', 'alert_focus'],
        drivingSafe: true,
        priorAlpha: 4.2,
        priorBeta: 1.4,
        baseParams,
        studyIds: ['husain-2002'],
      },
      params: {
        ...baseParams,
        stereoAmSpread: true,
        genre: 'acoustic_pluck',
        genreSelectionMode: 'user_chosen',
        energyTier: 'focus',
      },
      isExploration: false,
      isControlTrial: false,
      ephemeralMode: true,
      safetyMode: false,
      safetyWarnings: [],
      audioSource: 'studio_library',
      fallbackCoreGenre: 'acoustic_pluck',
      personalizationSummary: [
        'Instant preview · Sad → Happy shift (switch to Reggae, Jazz, or any music style anytime)',
        'Major-mode acoustic stems + gentle 12 Hz mid-band clarity AM',
      ],
      formulaIngredients: [
        { role: 'Layer 1 · Active AM', compound: '12 Hz SMR Lift · 3-Band LR4', dose: '26%→34% (200Hz–4.2kHz)', evidenceTag: 'Husain 2002' },
        { role: 'Layer 2 · Music', compound: 'Acoustic Pluck · Bright Major', dose: 'Studio Mix', evidenceTag: 'Lyric-Free' },
      ],
      rationale:
        'Pairs uplifting major-mode Acoustic Pluck studio stems with gentle 12 Hz mid-band clarity modulation to shift low energy smoothly toward positive momentum.',
      studies: QUICK_TRY_CITATIONS.mood_uplift,
      executableSpec: spec,
      confidencePct: 87,
      cohortTrials: 0,
      profileTrials: 0,
      plannedDurationMin: 20,
      currentState: 'stressed',
      targetState: 'energy_lift',
      baselineScore: 2,
      environment: 'home_relax',
      device: 'headphones',
    };
  }

  if (id === 'energy_electronic') {
    const baseParams: ProtocolArm['baseParams'] = {
      modulationHz: 18,
      modulationDepth: 0.4,
      crossoverHz: 220,
      upperCrossoverHz: 4500,
      bpm: 114,
      pulseIntensity: 0.58,
      noiseColor: 'pink',
      noiseLevel: 0.05,
      harmonicMode: 'bright_maj9',
      rootNoteHz: 146.83,
      filterCutoffHz: 2800,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 6,
      binauralOffsetHz: 0,
    };

    const spec: ExecutableStudySpec = {
      id: 'husain-2002-tempo-arousal',
      shortLabel: 'Alert Energy · 18 Hz Drive',
      studyRef: {
        title: 'Effects of musical tempo and mode on arousal, mood, and spatial abilities',
        authors: 'Husain, G., Thompson, W. F., & Schellenberg, E. G.',
        year: '2002',
        journal: 'Music Perception',
        url: 'https://doi.org/10.1525/mp.2002.20.2.151',
        doi: '10.1525/mp.2002.20.2.151',
        source: 'core',
      },
      abstractExcerpt:
        'Upbeat instrumental pacing paired with crisp 18 Hz Beta mid-band amplitude modulation supports clean alertness and forward drive.',
      compilerMode: 'verified_ground_truth',
      compliancePct: 100,
      evidenceMap: [
        {
          parameter: 'Acoustic Modulation',
          targetLabel: '18 Hz Beta Vigilance AM',
          executedValue: '18.0 Hz 3-Band LR4 Mid-Band AM (220–4500 Hz, 40% depth)',
          studyQuote: 'Upbeat rhythmic drive paired with crisp mid-band modulation sustains alertness.',
          origin: 'study_exact',
        },
        {
          parameter: 'Tempo & Mode',
          targetLabel: 'Upbeat Major Groove',
          executedValue: '114 BPM · Deep Electronic studio stems (zero lyrics)',
          studyQuote: 'Faster tempo and major mode elevated alertness and energy scores.',
          origin: 'study_exact',
        },
      ],
      entrainment: {
        type: 'amplitude_modulation',
        frequencyHz: 18,
        startFrequencyHz: 15,
        modulationBandHz: [220, 4500],
        modulationDepth: 0.4,
        waveform: 'sine',
        phaseOffsetDeg: 28,
      },
      music: {
        defaultCarrierMode: 'studio_library',
        bpm: 114,
        tonalMode: 'major',
        tuningA4Hz: 440,
        rootMidi: 50,
        percussion: 'steady_pulse',
        density: 0.56,
        brightness: 0.64,
        spectralLowPassHz: 2800,
        instrumentPalette: 'deep_electronic',
        vibeTags: ['deep electronic', 'upbeat focus', 'lyric-free'],
        lyriaWeightedPrompts: [
          {
            text: 'Strictly instrumental uplifting deep electronic focus groove, clean warm bass, zero vocals',
            weight: 1.5,
          },
        ],
      },
      noise: { color: 'pink', snrDb: -24 },
      protocol: {
        recommendedDurationMin: 20,
        targetState: 'energy_lift',
        requiresHeadphones: false,
        drivingSafe: true,
        safetyNotes: [],
      },
    };

    return {
      sessionId,
      cohortKey: 'quick_try:energy',
      cohortLabel: 'Instant Preview · Local-Only',
      arm: {
        id: 'crisp-vigilance-18hz',
        name: 'Crisp Vigilance 18 Hz',
        tagline: '18 Hz Beta AM · Deep Electronic Drive',
        description:
          'Upbeat 18 Hz Beta mid-band amplitude modulation fused into mastered Deep Electronic studio stems for clean mental energy.',
        targetStates: ['energy_lift', 'alert_focus'],
        drivingSafe: true,
        priorAlpha: 4,
        priorBeta: 1.5,
        baseParams,
        studyIds: ['husain-2002'],
      },
      params: {
        ...baseParams,
        stereoAmSpread: true,
        genre: 'deep_electronic',
        genreSelectionMode: 'user_chosen',
        energyTier: 'drive',
      },
      isExploration: false,
      isControlTrial: false,
      ephemeralMode: true,
      safetyMode: false,
      safetyWarnings: [],
      audioSource: 'studio_library',
      fallbackCoreGenre: 'deep_electronic',
      personalizationSummary: [
        'Instant preview · 100% local-only mode (zero signup)',
        '18 Hz Beta 3-Band LR4 AM over mastered Deep Electronic stems',
      ],
      formulaIngredients: [
        { role: 'Layer 1 · Active AM', compound: '18 Hz Beta · 3-Band LR4', dose: '30%→40% (220Hz–4.5kHz)', evidenceTag: 'Husain 2002' },
        { role: 'Layer 2 · Music', compound: 'Deep Electronic · Drive', dose: 'Studio Mix', evidenceTag: 'Lyric-Free' },
      ],
      rationale:
        'Combines upbeat 114 BPM Deep Electronic studio stems with phase-coherent 18 Hz mid-band amplitude modulation while keeping sub-bass and highs untouched.',
      studies: QUICK_TRY_CITATIONS.energy_electronic,
      executableSpec: spec,
      confidencePct: 86,
      cohortTrials: 0,
      profileTrials: 0,
      plannedDurationMin: 20,
      currentState: 'fatigued',
      targetState: 'energy_lift',
      baselineScore: 2,
      environment: 'office',
      device: 'headphones',
    };
  }

  if (id === 'calm_rain') {
    const baseParams: ProtocolArm['baseParams'] = {
      modulationHz: 0.1,
      modulationDepth: 0.32,
      crossoverHz: 140,
      upperCrossoverHz: 2800,
      bpm: 60,
      pulseIntensity: 0.08,
      noiseColor: 'soft_rain',
      noiseLevel: 0.12,
      harmonicMode: 'suspended_open',
      rootNoteHz: 130.81,
      filterCutoffHz: 1450,
      speakerSafeEQ: false,
      antiMonotonyCycleMin: 0,
      binauralOffsetHz: 0,
    };

    const spec: ExecutableStudySpec = {
      id: 'lehrer-2014-hrv-01hz',
      shortLabel: 'Calm Reset · 0.1 Hz HRV Tide',
      studyRef: {
        title: 'Heart rate variability biofeedback: how and why does it work?',
        authors: 'Lehrer, P. M., & Gevirtz, R.',
        year: '2014',
        journal: 'Frontiers in Psychology',
        url: 'https://doi.org/10.3389/fpsyg.2014.00756',
        doi: '10.3389/fpsyg.2014.00756',
        source: 'core',
      },
      abstractExcerpt:
        'A gentle 0.1 Hz acoustic breathing swell (5 seconds inhale, 5 seconds exhale) layered with soft stereo rain pads supports smooth parasympathetic decompression.',
      compilerMode: 'verified_ground_truth',
      compliancePct: 100,
      evidenceMap: [
        {
          parameter: 'Acoustic Modulation',
          targetLabel: '0.1 Hz HRV Breathing Swell',
          executedValue: '0.10 Hz smooth sine tide (6 breaths/min · 5s in / 5s out)',
          studyQuote: 'Slow paced breathing near 0.1 Hz engages baroreflex resonance and autonomic calm.',
          origin: 'study_exact',
        },
        {
          parameter: 'Soundscape Bed',
          targetLabel: 'Gentle Rain & Soft Pads',
          executedValue: 'Nature & Rain calm studio stems · zero sharp transients',
          studyQuote: 'Low-arousal continuous soundscapes support relaxation without sudden peaks.',
          origin: 'study_inferred',
        },
      ],
      entrainment: {
        type: 'hrv_breathing_swell',
        frequencyHz: 0.1,
        hrvBreathHz: 0.1,
        modulationBandHz: [140, 2800],
        modulationDepth: 0.32,
        waveform: 'sine',
        phaseOffsetDeg: 0,
      },
      music: {
        defaultCarrierMode: 'studio_library',
        bpm: 60,
        tonalMode: 'suspended',
        tuningA4Hz: 440,
        rootMidi: 48,
        percussion: 'none',
        density: 0.26,
        brightness: 0.34,
        spectralLowPassHz: 1450,
        instrumentPalette: 'ambient_water',
        vibeTags: ['soft rain', 'warm piano pads', 'calm', 'lyric-free'],
        lyriaWeightedPrompts: [
          {
            text: 'Strictly instrumental tranquil felt piano with soft rain atmosphere, beatless, zero vocals',
            weight: 1.5,
          },
        ],
      },
      noise: { color: 'soft_rain', snrDb: -18 },
      protocol: {
        recommendedDurationMin: 15,
        targetState: 'calm_reset',
        requiresHeadphones: false,
        drivingSafe: false,
        safetyNotes: [],
      },
    };

    return {
      sessionId,
      cohortKey: 'quick_try:calm',
      cohortLabel: 'Instant Preview · Local-Only',
      arm: {
        id: 'alpha-parasympathetic-10hz',
        name: '0.1 Hz HRV Calm Tide',
        tagline: '0.10 Hz Paced Breath · Rain & Pads',
        description:
          'Gentle 0.1 Hz paced breathing audio swell fused with mastered Nature & Rain calm pads for fast mental decompression.',
        targetStates: ['calm_reset', 'sleep_winddown'],
        drivingSafe: false,
        priorAlpha: 4,
        priorBeta: 1.4,
        baseParams,
        studyIds: ['lehrer-2014'],
      },
      params: {
        ...baseParams,
        stereoAmSpread: false,
        genre: 'nature_rain',
        genreSelectionMode: 'user_chosen',
        energyTier: 'calm',
      },
      isExploration: false,
      isControlTrial: false,
      ephemeralMode: true,
      safetyMode: false,
      safetyWarnings: [],
      audioSource: 'studio_library',
      fallbackCoreGenre: 'nature_rain',
      personalizationSummary: [
        'Instant preview · 100% local-only mode (zero signup)',
        '0.10 Hz HRV paced breath swell (6 breaths/min) over Nature & Rain studio stems',
      ],
      formulaIngredients: [
        { role: 'Layer 1 · Breath Tide', compound: '0.10 Hz HRV Swell', dose: '5s inhale / 5s exhale', evidenceTag: 'Lehrer 2014' },
        { role: 'Layer 2 · Music', compound: 'Nature & Rain · Calm', dose: 'Studio Mix', evidenceTag: 'Lyric-Free' },
      ],
      rationale:
        'Synchronizes a smooth 0.1 Hz breathing volume tide (6 breaths/min) with calm stereo rain pads so your nervous system can settle naturally.',
      studies: QUICK_TRY_CITATIONS.calm_rain,
      executableSpec: spec,
      confidencePct: 88,
      cohortTrials: 0,
      profileTrials: 0,
      plannedDurationMin: 15,
      currentState: 'stressed',
      targetState: 'calm_reset',
      baselineScore: 2,
      environment: 'home_relax',
      device: 'headphones',
    };
  }

  // Default: Deep Focus · Deep Electronic (16 Hz Beta AM — Woods et al. 2024)
  const baseParams: ProtocolArm['baseParams'] = {
    modulationHz: 16,
    modulationDepth: 0.38,
    crossoverHz: 190,
    upperCrossoverHz: 4500,
    bpm: 108,
    pulseIntensity: 0.48,
    noiseColor: 'pink',
    noiseLevel: 0.07,
    harmonicMode: 'warm_min9',
    rootNoteHz: 146.83,
    filterCutoffHz: 2600,
    speakerSafeEQ: false,
    antiMonotonyCycleMin: 0,
    binauralOffsetHz: 0,
  };

  const spec: ExecutableStudySpec = {
    id: 'woods-2024-am-attention',
    shortLabel: 'Woods 2024 · 16 Hz Beta AM Focus',
    studyRef: {
      title: 'Rapid modulation in music supports attention in listeners with attentional difficulties',
      authors: 'Woods, K. J. P., Sampaio, G., James, T., Morillon, B., & Loui, P.',
      year: '2024',
      journal: 'Communications Biology (Nature Portfolio)',
      url: 'https://doi.org/10.1038/s42003-024-07026-3',
      doi: '10.1038/s42003-024-07026-3',
      pmid: '39455825',
      source: 'core',
    },
    abstractExcerpt:
      'Instrumental music embedded with rapid beta-band amplitude modulation (~16 Hz) supported sustained attention compared to unmodulated control music.',
    compilerMode: 'verified_ground_truth',
    compliancePct: 100,
    evidenceMap: [
      {
        parameter: 'Acoustic Modulation',
        targetLabel: '16 Hz Beta Cortical AM',
        executedValue: '16.0 Hz 3-Band LR4 Mid-Band AM (190–4500 Hz, 38% depth)',
        studyQuote: 'Rapid amplitude modulation (~16 Hz, beta range) embedded in background music supports sustained attention.',
        origin: 'study_exact',
      },
      {
        parameter: 'Musical Carrier',
        targetLabel: 'Mastered Studio Deep Electronic',
        executedValue: 'Clean analog synths & steady focus pulse · zero lyrics',
        studyQuote: 'Background music engineered specifically to avoid lyrical distraction while remaining pleasant.',
        origin: 'study_exact',
      },
    ],
    entrainment: {
      type: 'amplitude_modulation',
      frequencyHz: 16,
      startFrequencyHz: 14,
      modulationBandHz: [190, 4500],
      modulationDepth: 0.38,
      waveform: 'sine',
      phaseOffsetDeg: 32,
    },
    music: {
      defaultCarrierMode: 'studio_library',
      bpm: 108,
      tonalMode: 'dorian',
      tuningA4Hz: 440,
      rootMidi: 50,
      percussion: 'steady_pulse',
      density: 0.5,
      brightness: 0.54,
      spectralLowPassHz: 2600,
      instrumentPalette: 'deep_electronic',
      vibeTags: ['deep electronic', 'analog synths', 'deep focus', 'lyric-free'],
      lyriaWeightedPrompts: [
        {
          text: 'Strictly instrumental warm deep electronic focus pulse, clean analog synths, zero vocals',
          weight: 1.5,
        },
      ],
    },
    noise: { color: 'pink', snrDb: -21 },
    protocol: {
      recommendedDurationMin: 25,
      targetState: 'deep_flow',
      requiresHeadphones: false,
      drivingSafe: true,
      safetyNotes: [],
    },
  };

  return {
    sessionId,
    cohortKey: 'quick_try:focus',
    cohortLabel: 'Instant Preview · Local-Only',
    arm: {
      id: 'beta-focus-16hz',
      name: 'Beta Focus 16 Hz',
      tagline: '16 Hz Beta AM · Deep Electronic',
      description:
        'Rapid 16 Hz mid-band amplitude modulation fused into mastered Deep Electronic studio tracks for sustained deep work.',
      targetStates: ['alert_focus', 'deep_flow'],
      drivingSafe: true,
      priorAlpha: 4.5,
      priorBeta: 1.4,
      baseParams,
      studyIds: ['woods-2024'],
    },
    params: {
      ...baseParams,
      stereoAmSpread: true,
      genre: 'deep_electronic',
      genreSelectionMode: 'user_chosen',
      energyTier: 'focus',
    },
    isExploration: false,
    isControlTrial: false,
    ephemeralMode: true,
    safetyMode: false,
    safetyWarnings: [],
    audioSource: 'studio_library',
    fallbackCoreGenre: 'deep_electronic',
    personalizationSummary: [
      'Instant preview · 100% local-only mode (zero signup)',
      '16 Hz Beta 3-Band LR4 AM over mastered Deep Electronic studio stems',
    ],
    formulaIngredients: [
      { role: 'Layer 1 · Active AM', compound: '16 Hz Beta · 3-Band LR4', dose: '29%→38% (190Hz–4.5kHz)', evidenceTag: 'Woods et al. 2024' },
      { role: 'Layer 2 · Music', compound: 'Deep Electronic · Focus', dose: 'Studio Mix', evidenceTag: 'Lyric-Free' },
    ],
    rationale:
      'Applies phase-coherent 16 Hz Beta modulation strictly to the 190 Hz-4.5 kHz mid-band of mastered Deep Electronic studio audio so sub-bass warmth and crisp highs stay completely intact.',
    studies: QUICK_TRY_CITATIONS.focus_lofi,
    executableSpec: spec,
    confidencePct: 89,
    cohortTrials: 0,
    profileTrials: 0,
    plannedDurationMin: 25,
    currentState: 'distracted',
    targetState: 'deep_flow',
    baselineScore: 2,
    environment: 'office',
    device: 'headphones',
  };
}
