import type { CurrentState, TargetState } from './types';

export interface NeuralCoords {
  /** Vertical axis (0 = Drained / Depleted, 100 = Wired / Hyper-Activated) */
  energy: number;
  /** Horizontal axis (0 = Foggy / Overloaded / Tense, 100 = Clear / Grounded / Open) */
  clarity: number;
}

export interface NeuralMicroState {
  id: string;
  label: string;
  shortLabel: string;
  energy: number;
  clarity: number;
  coreState: CurrentState;
  suggestedTarget: TargetState;
  defaultBaseline: number;
  keywords: RegExp;
  /** Verified PubMed/OpenAlex search terms tailored to this exact state */
  pubmedTerm: string;
  openAlexTerm: string;
  dspNote: string;
  /** Key visual landmarks shown directly on the 2D Neural Compass */
  landmark?: boolean;
}

/**
 * 19 peer-reviewed & real-world cognitive states mapped onto James Russell's
 * 2D Circumplex Model of Arousal (Energy) × Cognitive Clarity/Valence.
 */
export const NEURAL_MICRO_STATES: NeuralMicroState[] = [
  // ── TOP-LEFT: High Energy + Overloaded / Tense ──────────────────────────
  {
    id: 'overcaffeinated',
    label: 'Over-Caffeinated / Jittery',
    shortLabel: 'Jittery',
    energy: 92,
    clarity: 32,
    coreState: 'anxious',
    suggestedTarget: 'deep_flow',
    defaultBaseline: 2,
    keywords: /\b(coffee|caffeine|overcaffeinated|over-caffeinated|jittery|jitters|espresso|wired|shaking|cafea)\b/i,
    pubmedTerm: '(music[Title/Abstract] OR auditory[Title/Abstract]) AND (arousal[Title/Abstract] OR anxiety[Title/Abstract]) AND (alpha[Title/Abstract] OR autonomic[Title/Abstract])',
    openAlexTerm: 'music autonomic arousal regulation alpha modulation',
    dspNote: 'Caps entry AM softly (≤12 Hz Alpha→SMR) so caffeine jitters smooth out instead of spiking cortisol.',
    landmark: true,
  },
  {
    id: 'anxious_racing',
    label: 'Anxious / Racing Mind',
    shortLabel: 'Anxious',
    energy: 86,
    clarity: 16,
    coreState: 'anxious',
    suggestedTarget: 'calm_reset',
    defaultBaseline: 1,
    keywords: /\b(anxious|anxiety|racing|panic|worried|spiral|spiraling|heart racing|anxios|nelinistit|panica)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND anxiety[Title/Abstract] AND ("heart rate variability"[Title/Abstract] OR parasympathetic[Title/Abstract])',
    openAlexTerm: 'music anxiety heart rate variability autonomic',
    dspNote: 'Slow non-percussive Iso down-ramp gently unhooks racing thought loops.',
    landmark: true,
  },
  {
    id: 'overwhelmed',
    label: 'Overwhelmed / Cognitive Overload',
    shortLabel: 'Overwhelmed',
    energy: 76,
    clarity: 14,
    coreState: 'stressed',
    suggestedTarget: 'calm_reset',
    defaultBaseline: 1,
    keywords: /\b(overwhelmed|overload|too much|drowning|swamped|pressure|coplesit|prea mult)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("cognitive load"[Title/Abstract] OR stress[Title/Abstract]) AND recovery[Title/Abstract]',
    openAlexTerm: 'music cognitive overload stress recovery cortisol',
    dspNote: 'Strips dense rhythmic transients & applies warm low-pass filtering to drop cognitive load.',
  },
  {
    id: 'pre_performance',
    label: 'Pre-Meeting / Exam Nerves',
    shortLabel: 'Nerves',
    energy: 74,
    clarity: 38,
    coreState: 'stressed',
    suggestedTarget: 'alert_focus',
    defaultBaseline: 2,
    keywords: /\b(nervous|nerves|presentation|interview|meeting|exam|stage fright|emotii|examen|interviu)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("performance anxiety"[Title/Abstract] OR "test anxiety"[Title/Abstract] OR stress[Title/Abstract])',
    openAlexTerm: 'music performance anxiety cognitive focus',
    dspNote: 'Steady grounded 12 Hz SMR centers nerves while preserving crisp verbal recall.',
  },
  {
    id: 'frustrated_tense',
    label: 'Frustrated / Tense',
    shortLabel: 'Tense',
    energy: 64,
    clarity: 22,
    coreState: 'stressed',
    suggestedTarget: 'calm_reset',
    defaultBaseline: 2,
    keywords: /\b(frustrated|irritable|angry|annoyed|stressed|tense|tight|nervos|stresat|tensionat)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("stress recovery"[Title/Abstract] OR cortisol[Title/Abstract] OR autonomic[Title/Abstract])',
    openAlexTerm: 'music emotional regulation vagal tone stress recovery',
    dspNote: 'Warm harmonic resonance + soft 10 Hz Alpha eases sympathetic tension.',
  },

  // ── BOTTOM-LEFT: Low Energy + Foggy / Depleted ──────────────────────────
  {
    id: 'wired_but_tired',
    label: 'Wired but Tired',
    shortLabel: 'Wired & Tired',
    energy: 46,
    clarity: 16,
    coreState: 'stressed',
    suggestedTarget: 'calm_reset',
    defaultBaseline: 2,
    keywords: /\b(wired\s*but\s*tired|exhausted\s*but\s*can'?t\s*rest|tired\s*and\s*stressed|obosit\s*dar\s*agitat)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("mental fatigue"[Title/Abstract] OR exhaustion[Title/Abstract]) AND autonomic[Title/Abstract]',
    openAlexTerm: 'auditory stimulation mental fatigue autonomic recovery',
    dspNote: 'Uses gentle Alpha restoration (10 Hz) first so exhausted nervous systems recover cleanly.',
  },
  {
    id: 'brain_fog',
    label: 'Brain Fog / Heavy Head',
    shortLabel: 'Brain Fog',
    energy: 28,
    clarity: 20,
    coreState: 'fatigued',
    suggestedTarget: 'energy_lift',
    defaultBaseline: 2,
    keywords: /\b(brain\s*fog|foggy|cloudy|heavy\s*head|hazy|groggy|sluggish|ceata|cap\s*greu|ametit)\b/i,
    pubmedTerm: '(music[Title/Abstract] OR auditory[Title/Abstract]) AND (fatigue[Title/Abstract] OR alertness[Title/Abstract]) AND (beta[Title/Abstract] OR attention[Title/Abstract])',
    openAlexTerm: 'auditory beat stimulation beta frequency alertness fatigue',
    dspNote: 'Crisp 16 Hz Beta cortical AM + subtle pink stochastic floor clears mental haze.',
    landmark: true,
  },
  {
    id: 'burned_out',
    label: 'Burned Out / Mentally Drained',
    shortLabel: 'Burned Out',
    energy: 14,
    clarity: 14,
    coreState: 'fatigued',
    suggestedTarget: 'calm_reset',
    defaultBaseline: 1,
    keywords: /\b(burnout|burned\s*out|burnt\s*out|drained|exhausted|fried|depleted|epuizat|terminat)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("mental fatigue"[Title/Abstract] OR burnout[Title/Abstract]) AND recovery[Title/Abstract]',
    openAlexTerm: 'music mental fatigue burnout parasympathetic recovery',
    dspNote: 'Restorative low-demand acoustic envelope with zero jarring transients.',
    landmark: true,
  },
  {
    id: 'sleep_deprived',
    label: 'Sleep-Deprived / Tired',
    shortLabel: 'Tired',
    energy: 14,
    clarity: 32,
    coreState: 'fatigued',
    suggestedTarget: 'energy_lift',
    defaultBaseline: 2,
    keywords: /\b(sleep\s*deprived|no\s*sleep|tired|sleepy|drowsy|yawning|fatigue|fatigued|afternoon\s*slump|obosit|somnoros)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND (fatigue[Title/Abstract] OR sleepiness[Title/Abstract] OR vigilance[Title/Abstract]) AND alertness[Title/Abstract]',
    openAlexTerm: 'acoustic stimulation vigilance fatigue alertness',
    dspNote: 'Uplifting 16 Hz Beta pulse + calibrated tempo counters mid-day adenosine drag.',
  },
  {
    id: 'procrastinating',
    label: 'Unmotivated / Procrastinating',
    shortLabel: 'Procrastinating',
    energy: 32,
    clarity: 40,
    coreState: 'distracted',
    suggestedTarget: 'alert_focus',
    defaultBaseline: 2,
    keywords: /\b(procrastinat|unmotivated|no\s*motivation|lazy|can'?t\s*start|avoiding|friction|fara\s*chef|aman)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND (dopamine[Title/Abstract] OR motivation[Title/Abstract]) AND (attention[Title/Abstract] OR task[Title/Abstract])',
    openAlexTerm: 'background music dopamine motivation task performance',
    dspNote: 'Pairs rewarding rhythmic groove with 15 Hz Beta to lower task-initiation friction.',
    landmark: true,
  },
  {
    id: 'low_mood',
    label: 'Low Mood / Heavy',
    shortLabel: 'Low Mood',
    energy: 22,
    clarity: 34,
    coreState: 'fatigued',
    suggestedTarget: 'energy_lift',
    defaultBaseline: 2,
    keywords: /\b(sad|down|low\s*mood|melanchol|blue|lonely|flat|uninspired|trist|abatut)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND (dopamine[Title/Abstract] OR mood[Title/Abstract]) AND (striatum[Title/Abstract] OR reward[Title/Abstract])',
    openAlexTerm: 'instrumental music striatal dopamine mood elevation',
    dspNote: 'Warm major-9th harmonic voicings + preferred music aesthetics support striatal dopamine.',
  },

  // ── CENTER TRANSITION ZONE: Scattered / Stuck / Monotony ────────────────
  {
    id: 'distracted_scattered',
    label: 'Distracted / Mind Jumping',
    shortLabel: 'Distracted',
    energy: 56,
    clarity: 38,
    coreState: 'distracted',
    suggestedTarget: 'alert_focus',
    defaultBaseline: 2,
    keywords: /\b(distract|scattered|adhd|wandering|jumping|scrolling|unfocused|can'?t\s*focus|distrat|imprastiat)\b/i,
    pubmedTerm: '("amplitude modulation"[Title/Abstract] OR "background music"[Title/Abstract]) AND ("sustained attention"[Title/Abstract] OR ADHD[Title/Abstract])',
    openAlexTerm: 'amplitude modulated music sustained attention beta',
    dspNote: 'Iso-Adaptive 16 Hz Beta AM (190 Hz–4.5 kHz) anchors wandering cortical attention.',
    landmark: true,
  },
  {
    id: 'creative_block',
    label: 'Creative Block / Mentally Stuck',
    shortLabel: 'Creative Block',
    energy: 44,
    clarity: 52,
    coreState: 'restless',
    suggestedTarget: 'deep_flow',
    defaultBaseline: 3,
    keywords: /\b(creative\s*block|stuck|writer'?s?\s*block|blank|no\s*ideas|brainstorm|blocat|fara\s*idei)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND (creativity[Title/Abstract] OR "divergent thinking"[Title/Abstract]) AND (alpha[Title/Abstract] OR cognitive[Title/Abstract])',
    openAlexTerm: 'music divergent thinking creativity alpha rhythm',
    dspNote: 'Warm 10 Hz Alpha-border modulation & open suspended chords widen associative thinking.',
    landmark: true,
  },
  {
    id: 'screen_fatigue',
    label: 'Zoom / Screen Exhaustion',
    shortLabel: 'Screen Fatigue',
    energy: 34,
    clarity: 56,
    coreState: 'fatigued',
    suggestedTarget: 'calm_reset',
    defaultBaseline: 2,
    keywords: /\b(zoom|screen|calls|meetings|eyes\s*tired|computer\s*all\s*day|sedinte|ecran)\b/i,
    pubmedTerm: '("nature sounds"[Title/Abstract] OR music[Title/Abstract]) AND ("attention restoration"[Title/Abstract] OR "cognitive fatigue"[Title/Abstract])',
    openAlexTerm: 'nature sounds acoustic attention restoration cognitive fatigue',
    dspNote: 'Soft high-frequency roll-off & organic textures give over-stimulated visual/auditory pathways a break.',
  },
  {
    id: 'highway_monotony',
    label: 'Highway Monotony / Zone-Out',
    shortLabel: 'Monotony',
    energy: 26,
    clarity: 50,
    coreState: 'restless',
    suggestedTarget: 'alert_focus',
    defaultBaseline: 2,
    keywords: /\b(highway|monotony|monotonous|long\s*drive|boring\s*road|zone\s*out|autostrada|monoton|volan)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND (driving[Title/Abstract] OR monotony[Title/Abstract]) AND vigilance[Title/Abstract]',
    openAlexTerm: 'music driving vigilance monotony alertness traffic safety',
    dspNote: 'Activates 8-minute anti-monotony rhythmic lift + open 800–3500 Hz traffic cues.',
  },

  // ── TOP-RIGHT: High Energy + Clear / Activated ──────────────────────────
  {
    id: 'restless_channel',
    label: 'Restless / Energy to Channel',
    shortLabel: 'Restless',
    energy: 78,
    clarity: 66,
    coreState: 'restless',
    suggestedTarget: 'deep_flow',
    defaultBaseline: 3,
    keywords: /\b(restless|fidgety|bored|antsy|hyper|too\s*much\s*energy|plictisit|agitat)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND (rhythmic[Title/Abstract] OR tempo[Title/Abstract]) AND ("sustained attention"[Title/Abstract] OR flow[Title/Abstract])',
    openAlexTerm: 'rhythmic music sustained focus flow state beta',
    dspNote: 'Channels surplus motor restlessness into a steady 14 Hz SMR rhythmic groove.',
    landmark: true,
  },
  {
    id: 'sharp_high_drive',
    label: 'Alert / Ready to Lock In',
    shortLabel: 'Locked In',
    energy: 78,
    clarity: 86,
    coreState: 'calm_neutral',
    suggestedTarget: 'deep_flow',
    defaultBaseline: 4,
    keywords: /\b(locked\s*in|in\s*the\s*zone|energized|pumped|motivated|ready\s*to\s*crush|sharp|in\s*forma)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("flow state"[Title/Abstract] OR "sustained attention"[Title/Abstract]) AND instrumental[Title/Abstract]',
    openAlexTerm: 'instrumental music flow state sustained cognitive performance',
    dspNote: 'Maintains peak plateau stability without over-driving cortical arousal.',
    landmark: true,
  },

  // ── BOTTOM-RIGHT: Low Energy + Calm / Grounded ──────────────────────────
  {
    id: 'calm_steady',
    label: 'Calm & Grounded',
    shortLabel: 'Calm',
    energy: 42,
    clarity: 82,
    coreState: 'calm_neutral',
    suggestedTarget: 'deep_flow',
    defaultBaseline: 4,
    keywords: /\b(calm|steady|neutral|okay|ok|fine|grounded|peaceful|good|bine|calm|linistit)\b/i,
    pubmedTerm: '"background music"[Title/Abstract] AND ("working memory"[Title/Abstract] OR "cognitive performance"[Title/Abstract])',
    openAlexTerm: 'background music working memory steady cognitive performance',
    dspNote: 'Clean baseline — applies smooth 14 Hz SMR carrier to transition seamlessly into flow.',
    landmark: true,
  },
  {
    id: 'drowsy_bedtime',
    label: 'Unwinding / Ready for Sleep',
    shortLabel: 'Bedtime',
    energy: 16,
    clarity: 80,
    coreState: 'calm_neutral',
    suggestedTarget: 'sleep_winddown',
    defaultBaseline: 3,
    keywords: /\b(bedtime|ready\s*for\s*sleep|winding\s*down|before\s*bed|in\s*bed|culcare|somn)\b/i,
    pubmedTerm: 'music[Title/Abstract] AND ("sleep quality"[Title/Abstract] OR insomnia[Title/Abstract])',
    openAlexTerm: 'music sleep quality adults acoustic relaxation',
    dspNote: 'Ultra-slow beatless Theta-border fade guides gentle sleep onset.',
    landmark: true,
  },
];

export const TARGET_COORDS: Record<TargetState, NeuralCoords & { label: string }> = {
  energy_lift: { energy: 78, clarity: 82, label: 'Energized & Awake' },
  alert_focus: { energy: 70, clarity: 90, label: 'Sharp Alert Focus' },
  deep_flow: { energy: 58, clarity: 92, label: 'Deep Uninterrupted Flow' },
  calm_reset: { energy: 34, clarity: 84, label: 'Calm & Grounded' },
  sleep_winddown: { energy: 12, clarity: 82, label: 'Deep Rest / Sleep' },
};

export function getMicroStateById(id?: string | null): NeuralMicroState | undefined {
  if (!id) return undefined;
  return NEURAL_MICRO_STATES.find((s) => s.id === id);
}

export function findClosestMicroState(energy: number, clarity: number): NeuralMicroState {
  let best = NEURAL_MICRO_STATES[0];
  let bestDist = Infinity;
  for (const st of NEURAL_MICRO_STATES) {
    const de = st.energy - energy;
    const dc = st.clarity - clarity;
    const dist = de * de + dc * dc;
    if (dist < bestDist) {
      bestDist = dist;
      best = st;
    }
  }
  return best;
}

export function findNearbyMicroStates(
  energy: number,
  clarity: number,
  count = 5
): NeuralMicroState[] {
  return [...NEURAL_MICRO_STATES]
    .sort((a, b) => {
      const da = (a.energy - energy) ** 2 + (a.clarity - clarity) ** 2;
      const db = (b.energy - energy) ** 2 + (b.clarity - clarity) ** 2;
      return da - db;
    })
    .slice(0, count);
}

export function matchMicroStateFromText(rawText: string): NeuralMicroState | null {
  const norm = rawText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const st of NEURAL_MICRO_STATES) {
    if (st.keywords.test(norm)) {
      return st;
    }
  }
  return null;
}

/**
 * Computes a scientific 1–5 baseline readiness score from continuous (energy, clarity)
 * coordinates so users don't have to fill out an extra form field unless they want to tweak it.
 */
export function coordsToBaselineScore(energy: number, clarity: number): number {
  // Ideal grounded readiness zone centers near clarity ~85, energy ~55
  const clarityFactor = clarity / 100;
  const energyBalance = 1 - Math.min(1, Math.abs(energy - 58) / 65);
  const composite = clarityFactor * 0.68 + energyBalance * 0.32;
  if (composite < 0.24) return 1;
  if (composite < 0.44) return 2;
  if (composite < 0.65) return 3;
  if (composite < 0.84) return 4;
  return 5;
}

/**
 * Generates an honest, plain-English Iso-Principle trajectory summary describing
 * how the acoustic engine bridges current (energy, clarity) -> target (energy, clarity).
 */
export function describeIsoVector(
  from: NeuralCoords,
  target: TargetState,
  durationMin: number
): string {
  const dest = TARGET_COORDS[target];
  const dEnergy = Math.round(dest.energy - from.energy);
  const dClarity = Math.round(dest.clarity - from.clarity);

  const energyPhrase =
    dEnergy >= 18
      ? `lifting neural energy (+${dEnergy}%)`
      : dEnergy <= -18
        ? `down-regulating excess arousal (${dEnergy}%)`
        : 'stabilizing your current energy';

  const clarityPhrase =
    dClarity >= 18
      ? `clearing mental noise (+${dClarity}% clarity)`
      : 'keeping your clarity locked in';

  return `Iso-Principle bridge: ${energyPhrase} while ${clarityPhrase} over ${durationMin} min.`;
}
