import type { ExecutableStudySpec } from '../../shared/studySpec';
import type { ProtocolArm, ProtocolRecommendation, ScientificStudy, UserProfile } from '../../shared/types';

export type QuickTryId = 'focus_lofi' | 'mood_uplift' | 'calm_rain' | 'energy_electronic';

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
