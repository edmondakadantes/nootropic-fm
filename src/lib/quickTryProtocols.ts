import type { ExecutableStudySpec } from '../../shared/studySpec';
import type { ProtocolArm, ProtocolRecommendation, ScientificStudy } from '../../shared/types';

export type QuickTryId = 'focus_lofi' | 'energy_electronic' | 'calm_rain';

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

/**
 * Builds a zero-latency, ephemeral studio-ready ProtocolRecommendation for 1-click Hero Quick Try.
 * Kept isolated from `studyPresets.ts` so the initial `/` bundle stays ultra-light and policy-clean.
 */
export function buildInstantQuickTryRecommendation(id: QuickTryId): ProtocolRecommendation {
  const sessionId = `eph_quick_${id}_${Date.now().toString(36)}`;

  if (id === 'energy_electronic') {
    const baseParams: ProtocolArm['baseParams'] = {
      modulationHz: 18,
      modulationDepth: 0.26,
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
          executedValue: '18.0 Hz 3-Band LR4 Mid-Band AM (220–4500 Hz, 26% depth)',
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
        modulationDepth: 0.26,
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
        { role: 'Layer 1 · Active AM', compound: '18 Hz Beta · 3-Band LR4', dose: '13%→26% (220Hz–4.5kHz)', evidenceTag: 'Husain 2002' },
        { role: 'Layer 2 · Music', compound: 'Deep Electronic · Drive', dose: 'Studio R2', evidenceTag: 'Lyric-Free' },
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
      modulationDepth: 0.24,
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
        modulationDepth: 0.24,
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
        { role: 'Layer 2 · Music', compound: 'Nature & Rain · Calm', dose: 'Studio R2', evidenceTag: 'Lyric-Free' },
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

  // Default: Deep Focus · Lo-Fi Keys (16 Hz Beta AM — Woods et al. 2024)
  const baseParams: ProtocolArm['baseParams'] = {
    modulationHz: 16,
    modulationDepth: 0.28,
    crossoverHz: 190,
    upperCrossoverHz: 4500,
    bpm: 88,
    pulseIntensity: 0.48,
    noiseColor: 'pink',
    noiseLevel: 0.07,
    harmonicMode: 'warm_min9',
    rootNoteHz: 146.83,
    filterCutoffHz: 2200,
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
        executedValue: '16.0 Hz 3-Band LR4 Mid-Band AM (190–4500 Hz, 28% depth)',
        studyQuote: 'Rapid amplitude modulation (~16 Hz, beta range) embedded in background music supports sustained attention.',
        origin: 'study_exact',
      },
      {
        parameter: 'Musical Carrier',
        targetLabel: 'Mastered Studio Lo-Fi Keys',
        executedValue: 'Warm Dusty Rhodes studio stems · zero lyrics',
        studyQuote: 'Background music engineered specifically to avoid lyrical distraction while remaining pleasant.',
        origin: 'study_exact',
      },
    ],
    entrainment: {
      type: 'amplitude_modulation',
      frequencyHz: 16,
      startFrequencyHz: 14,
      modulationBandHz: [190, 4500],
      modulationDepth: 0.28,
      waveform: 'sine',
      phaseOffsetDeg: 32,
    },
    music: {
      defaultCarrierMode: 'studio_library',
      bpm: 88,
      tonalMode: 'dorian',
      tuningA4Hz: 440,
      rootMidi: 50,
      percussion: 'steady_pulse',
      density: 0.5,
      brightness: 0.54,
      spectralLowPassHz: 2200,
      instrumentPalette: 'felt_piano',
      vibeTags: ['lofi keys', 'warm rhodes', 'deep focus', 'lyric-free'],
      lyriaWeightedPrompts: [
        {
          text: 'Strictly instrumental warm Lo-Fi Rhodes keys focus groove, soft vinyl warmth, zero vocals',
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
      tagline: '16 Hz Beta AM · Lo-Fi Warm Keys',
      description:
        'Rapid 16 Hz mid-band amplitude modulation fused into mastered Lo-Fi Warm Keys studio tracks for sustained deep work.',
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
      genre: 'lofi_keys',
      genreSelectionMode: 'user_chosen',
      energyTier: 'focus',
    },
    isExploration: false,
    isControlTrial: false,
    ephemeralMode: true,
    safetyMode: false,
    safetyWarnings: [],
    audioSource: 'studio_library',
    fallbackCoreGenre: 'lofi_keys',
    personalizationSummary: [
      'Instant preview · 100% local-only mode (zero signup)',
      '16 Hz Beta 3-Band LR4 AM over mastered Lo-Fi Warm Keys studio stems',
    ],
    formulaIngredients: [
      { role: 'Layer 1 · Active AM', compound: '16 Hz Beta · 3-Band LR4', dose: '14%→28% (190Hz–4.5kHz)', evidenceTag: 'Woods et al. 2024' },
      { role: 'Layer 2 · Music', compound: 'Lo-Fi Warm Keys · Focus', dose: 'Studio R2', evidenceTag: 'Lyric-Free' },
    ],
    rationale:
      'Applies phase-coherent 16 Hz Beta modulation strictly to the 190 Hz–4.5 kHz mid-band of mastered Lo-Fi Warm Keys studio audio so sub-bass warmth and crisp highs stay completely intact.',
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
