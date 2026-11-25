import type { NeuralCoords } from './neuralStates';
import type { NoiseColor, HarmonicMode, TargetState } from './types';

export interface OpenGoalResolution {
  /** Canonical slug used for D1 Cohort Bandit learning (e.g. 'creative_ideation' or 'custom:public_speaking') */
  slug: string;
  /** Human-readable US English goal title */
  label: string;
  /** Short subtitle shown in live preview */
  subtitle: string;
  /** Underlying physiological safety/energy target bucket */
  coreTarget: TargetState;
  /** 2D Brain Map destination coordinates (Energy x Clarity) */
  coords: NeuralCoords;
  /** Default recommended duration in minutes */
  defaultMin: number;
  /** Optional study-backed DSP override for specialized goals */
  dspOverride?: {
    modulationHz: number;
    startFrequencyHz?: number;
    bpm?: number;
    harmonicMode?: HarmonicMode;
    noiseColor?: NoiseColor;
    noiseLevel?: number;
    filterCutoffHz?: number;
  };
  /** Tailored NIH PubMed query */
  pubmedQuery: string;
  /** Tailored OpenAlex search phrase */
  openAlexTerm: string;
  /** True when user typed an open-ended topic beyond our 10 curated categories */
  isOpenCustomTopic: boolean;
  /** Cleaned English topic phrase for Europe PMC / Study Compiler when isOpenCustomTopic is true */
  rawTopicQuery?: string;
}

export interface CuratedGoalPreset {
  slug: string;
  label: string;
  shortLabel: string;
  subtitle: string;
  hzBadge: string;
  coreTarget: TargetState;
  coords: NeuralCoords;
  defaultMin: number;
  keywords: string[];
  dspOverride?: OpenGoalResolution['dspOverride'];
  pubmedQuery: string;
  openAlexTerm: string;
}

export const CURATED_GOAL_PRESETS: CuratedGoalPreset[] = [
  {
    slug: 'energy_lift',
    label: 'Energy & Wakefulness Lift',
    shortLabel: 'Stop Feeling Tired · Energy Lift',
    subtitle: 'Shake off fatigue, brain fog & afternoon slump',
    hzBadge: '18 Hz Beta',
    coreTarget: 'energy_lift',
    coords: { energy: 78, clarity: 82 },
    defaultMin: 20,
    keywords: [
      'energy',
      'energized',
      'awake',
      'wake',
      'wakeful',
      'alertness',
      'vigilance',
      'vigilant',
      'boost',
      'slump',
      'drowsy',
    ],
    pubmedQuery:
      'music[Title/Abstract] AND (tempo[Title/Abstract] OR arousal[Title/Abstract]) AND (fatigue[Title/Abstract] OR alertness[Title/Abstract])',
    openAlexTerm: 'musical tempo arousal alertness fatigue vigilance',
  },
  {
    slug: 'alert_focus',
    label: 'Sharp Alert Focus',
    shortLabel: 'Sharp Alert Focus',
    subtitle: 'Clear sustained attention & zero mental drift',
    hzBadge: '16 Hz Beta',
    coreTarget: 'alert_focus',
    coords: { energy: 70, clarity: 90 },
    defaultMin: 30,
    keywords: [
      'focus',
      'focused',
      'concentrate',
      'concentration',
      'attention',
      'attentive',
      'sharp',
      'clarity',
      'productive',
      'productivity',
      'adhd',
      'hyperfocus',
    ],
    pubmedQuery:
      '("amplitude modulation"[Title/Abstract] OR "background music"[Title/Abstract]) AND ("sustained attention"[Title/Abstract] OR "cognitive performance"[Title/Abstract])',
    openAlexTerm: 'rapid amplitude modulation music sustained attention beta',
  },
  {
    slug: 'deep_flow',
    label: 'Deep Uninterrupted Flow',
    shortLabel: 'Deep Uninterrupted Flow',
    subtitle: 'Immersed coding, writing, analysis & deep work',
    hzBadge: '15 Hz SMR-Beta',
    coreTarget: 'deep_flow',
    coords: { energy: 58, clarity: 92 },
    defaultMin: 45,
    keywords: ['flow', 'immersed', 'immersion', 'coding', 'programming', 'deepwork', 'lockedin'],
    pubmedQuery:
      'music[Title/Abstract] AND ("flow state"[Title/Abstract] OR "sustained attention"[Title/Abstract]) AND instrumental[Title/Abstract]',
    openAlexTerm: 'instrumental music flow state sustained cognitive performance',
  },
  {
    slug: 'creative_ideation',
    label: 'Creative Flow & Ideation',
    shortLabel: 'Creative Flow & Brainstorming',
    subtitle: 'Unlock divergent thinking, imagination & fresh ideas',
    hzBadge: '10 Hz Alpha',
    coreTarget: 'deep_flow',
    coords: { energy: 56, clarity: 88 },
    defaultMin: 30,
    keywords: [
      'creative',
      'creativity',
      'brainstorm',
      'brainstorming',
      'ideation',
      'ideas',
      'divergent',
      'imagination',
      'imaginative',
      'inspired',
      'inspiration',
      'artistic',
      'designing',
      'storytelling',
      'inventive',
    ],
    dspOverride: {
      modulationHz: 10,
      startFrequencyHz: 10,
      bpm: 88,
      harmonicMode: 'suspended_open',
      noiseColor: 'pink',
      noiseLevel: 0.06,
      filterCutoffHz: 2400,
    },
    pubmedQuery:
      '(music[Title/Abstract] OR "auditory stimulation"[Title/Abstract] OR alpha[Title/Abstract]) AND ("divergent thinking"[Title/Abstract] OR creativity[Title/Abstract] OR ideation[Title/Abstract])',
    openAlexTerm: 'music alpha oscillations divergent thinking creativity ideation',
  },
  {
    slug: 'memory_learning',
    label: 'Memory & Study Retention',
    shortLabel: 'Memory & Study Retention',
    subtitle: 'Encode facts, exam prep, reading & working memory',
    hzBadge: '14 Hz SMR / 40 Hz',
    coreTarget: 'alert_focus',
    coords: { energy: 64, clarity: 92 },
    defaultMin: 35,
    keywords: [
      'memory',
      'memorize',
      'memorizing',
      'remember',
      'retention',
      'recall',
      'learning',
      'learn',
      'studying',
      'exam',
      'flashcards',
      'comprehension',
      'gamma',
    ],
    dspOverride: {
      modulationHz: 14,
      startFrequencyHz: 12,
      bpm: 92,
      harmonicMode: 'warm_min9',
      noiseColor: 'pink',
      noiseLevel: 0.07,
      filterCutoffHz: 2100,
    },
    pubmedQuery:
      '("auditory stimulation"[Title/Abstract] OR binaural[Title/Abstract] OR gamma[Title/Abstract] OR music[Title/Abstract]) AND ("working memory"[Title/Abstract] OR "memory consolidation"[Title/Abstract] OR recall[Title/Abstract])',
    openAlexTerm: 'auditory stimulation working memory retention recall learning',
  },
  {
    slug: 'mood_dopamine',
    label: 'Mood & Dopamine Uplift',
    shortLabel: 'Mood & Dopamine Lift',
    subtitle: 'Shift low mood into warm optimism & motivation',
    hzBadge: '12 Hz Major',
    coreTarget: 'energy_lift',
    coords: { energy: 72, clarity: 85 },
    defaultMin: 20,
    keywords: [
      'happy',
      'happiness',
      'joy',
      'joyful',
      'uplift',
      'uplifted',
      'uplifting',
      'mood',
      'optimistic',
      'positive',
      'dopamine',
      'cheerful',
      'motivated',
      'motivation',
      'confident',
      'confidence',
    ],
    dspOverride: {
      modulationHz: 12,
      startFrequencyHz: 10,
      bpm: 110,
      harmonicMode: 'bright_maj9',
      noiseColor: 'pink',
      noiseLevel: 0.04,
      filterCutoffHz: 2800,
    },
    pubmedQuery:
      'music[Title/Abstract] AND (dopamine[Title/Abstract] OR "positive affect"[Title/Abstract] OR mood[Title/Abstract]) AND (arousal[Title/Abstract] OR reward[Title/Abstract])',
    openAlexTerm: 'instrumental music striatal dopamine mood elevation positive affect',
  },
  {
    slug: 'calm_reset',
    label: 'Calm & Autonomic Reset',
    shortLabel: 'Calm Down & Reset',
    subtitle: 'Lower tension, cortisol & racing thoughts',
    hzBadge: '10 Hz / 0.1 Hz HRV',
    coreTarget: 'calm_reset',
    coords: { energy: 34, clarity: 84 },
    defaultMin: 20,
    keywords: [
      'calm',
      'calmer',
      'relax',
      'relaxed',
      'relaxation',
      'unwind',
      'destress',
      'peaceful',
      'serene',
      'grounded',
      'meditate',
      'meditation',
      'mindfulness',
      'breathe',
      'zen',
    ],
    pubmedQuery:
      'music[Title/Abstract] AND (cortisol[Title/Abstract] OR autonomic[Title/Abstract] OR "stress recovery"[Title/Abstract] OR "heart rate variability"[Title/Abstract])',
    openAlexTerm: 'music stress recovery autonomic cortisol heart rate variability',
  },
  {
    slug: 'sleep_winddown',
    label: 'Sleep Wind-Down',
    shortLabel: 'Wind Down for Sleep',
    subtitle: 'Quiet nocturnal thoughts gently before bed',
    hzBadge: '6 Hz Theta',
    coreTarget: 'sleep_winddown',
    coords: { energy: 12, clarity: 82 },
    defaultMin: 30,
    keywords: ['sleep', 'sleeping', 'asleep', 'bedtime', 'insomnia', 'nap', 'rest', 'slumber'],
    pubmedQuery:
      'music[Title/Abstract] AND ("sleep quality"[Title/Abstract] OR insomnia[Title/Abstract] OR "sleep onset"[Title/Abstract])',
    openAlexTerm: 'music sleep quality insomnia relaxation theta',
  },
];

/** Bounded Levenshtein edit distance for typo-tolerant US English matching (e.g. "creaitve" -> "creative") */
function editDistanceWithin(a: string, b: string, maxDist: number): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;
  if (a === b) return true;
  const m = a.length;
  const n = b.length;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost
      );
      prev = temp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > maxDist) return false;
  }
  return dp[n] <= maxDist;
}

const STOP_WORDS = new Set([
  'i', 'im', 'am', 'want', 'wanna', 'would', 'like', 'need', 'to', 'feel', 'feeling', 'be', 'being',
  'get', 'getting', 'more', 'less', 'very', 'really', 'super', 'for', 'the', 'next', 'in', 'my',
  'a', 'an', 'and', 'or', 'of', 'with', 'on', 'at', 'right', 'now', 'today', 'tonight', 'please',
  'help', 'me', 'make', 'reach', 'enter', 'into', 'state', 'mode', 'session', 'minutes', 'minute',
  'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'stop', 'not', 'no', 'longer', 'without',
]);

function titleCaseWords(words: string[]): string {
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function getCuratedGoalBySlug(slug?: string | null): CuratedGoalPreset | undefined {
  if (!slug) return undefined;
  return CURATED_GOAL_PRESETS.find((g) => g.slug === slug);
}

/**
 * Resolves ANY free-form US English goal sentence (including typos like "creaitve" AND
 * completely custom scientific topics like "tinnitus relief", "post-workout recovery",
 * "public speaking", "reading speed", "migraine comfort") into a structured OpenGoalResolution!
 */
export function resolveOpenGoalIntent(
  rawText: string,
  isDriving = false
): OpenGoalResolution | null {
  const cleaned = rawText
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 3) return null;

  // 1. Check negated fatigue ("stop feeling tired", "not sleepy") first -> energy_lift
  if (
    /\b(stop|not|no\s+longer|beat|shake\s+off)\s+(?:feeling\s+|being\s+)?(tired|sleepy|fatigued|drained|sluggish|exhausted|foggy)\b/.test(
      cleaned
    )
  ) {
    const preset = CURATED_GOAL_PRESETS[0];
    return {
      slug: preset.slug,
      label: preset.label,
      subtitle: preset.subtitle,
      coreTarget: preset.coreTarget,
      coords: preset.coords,
      defaultMin: preset.defaultMin,
      dspOverride: preset.dspOverride,
      pubmedQuery: preset.pubmedQuery,
      openAlexTerm: preset.openAlexTerm,
      isOpenCustomTopic: false,
    };
  }

  // 2. Exact or typo-tolerant (Levenshtein <= 2 on words >= 5 chars) match against our 8 curated scientific categories
  const rawTokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));

  // Prioritize specialized goals (creative, memory, mood, sleep, calm) before generic focus/flow
  const orderedPresets = [
    CURATED_GOAL_PRESETS[3], // creative_ideation
    CURATED_GOAL_PRESETS[4], // memory_learning
    CURATED_GOAL_PRESETS[5], // mood_dopamine
    CURATED_GOAL_PRESETS[7], // sleep_winddown
    CURATED_GOAL_PRESETS[6], // calm_reset
    CURATED_GOAL_PRESETS[0], // energy_lift
    CURATED_GOAL_PRESETS[2], // deep_flow
    CURATED_GOAL_PRESETS[1], // alert_focus
  ];

  // Exact keyword / prefix match pass first
  for (const preset of orderedPresets) {
    for (const token of rawTokens) {
      if (STOP_WORDS.has(token)) continue;
      for (const kw of preset.keywords) {
        if (
          token === kw ||
          (token.length >= 5 && kw.startsWith(token)) ||
          (kw.length >= 5 && token.startsWith(kw))
        ) {
          const safePreset =
            isDriving && (preset.coreTarget === 'sleep_winddown' || preset.coreTarget === 'calm_reset')
              ? CURATED_GOAL_PRESETS[1]
              : preset;
          return {
            slug: safePreset.slug,
            label: safePreset.label,
            subtitle: safePreset.subtitle,
            coreTarget: safePreset.coreTarget,
            coords: safePreset.coords,
            defaultMin: safePreset.defaultMin,
            dspOverride: isDriving ? undefined : safePreset.dspOverride,
            pubmedQuery: safePreset.pubmedQuery,
            openAlexTerm: safePreset.openAlexTerm,
            isOpenCustomTopic: false,
          };
        }
      }
    }
  }

  // Typo-tolerant Levenshtein pass (catches "creaitve", "creaitv", "meditaiton", "memroy", "motivaiton", etc.)
  for (const preset of orderedPresets) {
    for (const token of rawTokens) {
      if (STOP_WORDS.has(token) || token.length < 5) continue;
      for (const kw of preset.keywords) {
        if (kw.length < 5) continue;
        const maxDist = token.length >= 7 && kw.length >= 7 ? 2 : 1;
        if (editDistanceWithin(token, kw, maxDist)) {
          const safePreset =
            isDriving && (preset.coreTarget === 'sleep_winddown' || preset.coreTarget === 'calm_reset')
              ? CURATED_GOAL_PRESETS[1]
              : preset;
          return {
            slug: safePreset.slug,
            label: safePreset.label,
            subtitle: safePreset.subtitle,
            coreTarget: safePreset.coreTarget,
            coords: safePreset.coords,
            defaultMin: safePreset.defaultMin,
            dspOverride: isDriving ? undefined : safePreset.dspOverride,
            pubmedQuery: safePreset.pubmedQuery,
            openAlexTerm: safePreset.openAlexTerm,
            isOpenCustomTopic: false,
          };
        }
      }
    }
  }

  // 3. OPEN SCIENTIFIC TOPIC DISCOVERY: Any other meaningful English goal (e.g. "public speaking",
  //    "tinnitus masking", "post-workout recovery", "migraine relief", "speed reading", "math problem solving")
  const topicWords = rawTokens.filter((w) => !STOP_WORDS.has(w) && w.length >= 3).slice(0, 4);
  if (topicWords.length === 0) return null;

  const topicPhrase = topicWords.join(' ');
  const topicLabel = titleCaseWords(topicWords);
  const slugSuffix = topicWords
    .join('_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);

  // Infer calm vs active quadrant from open-topic semantics
  const isCalmTopic =
    !isDriving &&
    /\b(pain|migraine|headache|tinnitus|recovery|heal|healing|grief|anger|heart|blood|pressure|breath|rest|gentle|soothe|comfort)\b/.test(
      topicPhrase
    );
  const isHighArousalTopic =
    /\b(sport|workout|run|running|exercise|gym|cardio|sprint|reaction|gaming|esports|compete|competition)\b/.test(
      topicPhrase
    );

  const coreTarget: TargetState = isCalmTopic
    ? 'calm_reset'
    : isHighArousalTopic
      ? 'energy_lift'
      : 'deep_flow';
  const coords: NeuralCoords = isCalmTopic
    ? { energy: 36, clarity: 82 }
    : isHighArousalTopic
      ? { energy: 80, clarity: 86 }
      : { energy: 62, clarity: 89 };

  const pubmedTerms = topicWords.map((w) => `${w}[Title/Abstract]`).join(' AND ');
  const pubmedQuery = `(music[Title/Abstract] OR "auditory stimulation"[Title/Abstract] OR acoustic[Title/Abstract]) AND (${pubmedTerms})`;
  const openAlexTerm = `music auditory stimulation ${topicPhrase}`;

  return {
    slug: `custom:${slugSuffix}`,
    label: topicLabel,
    subtitle: `Live PubMed, Europe PMC & OpenAlex search for "${topicLabel}"`,
    coreTarget,
    coords,
    defaultMin: 25,
    pubmedQuery,
    openAlexTerm,
    isOpenCustomTopic: true,
    rawTopicQuery: `music auditory stimulation ${topicPhrase}`,
  };
}
