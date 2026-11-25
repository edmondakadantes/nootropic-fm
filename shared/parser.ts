import type {
  CurrentState,
  NoiseSensitivity,
  OutputDevice,
  ParsedCheckIn,
  PrimaryChallenge,
  ResolvedGenre,
  SessionEnvironment,
  TargetState,
  TexturePreference,
  UserGender,
  UserProfile,
  UserRole,
} from './types';

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCasePhrase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractGender(norm: string): UserGender | undefined {
  if (/\b(non-binary|nonbinary|non binary|nb|enby)\b/.test(norm)) return 'non_binary';
  if (/\b(female|woman|girl|lady|she\/her)\b/.test(norm)) return 'female';
  if (/\b(male|man|guy|he\/him)\b/.test(norm)) return 'male';
  return undefined;
}

const OCCUPATION_PATTERNS: Array<{ rx: RegExp; label: string; role: UserRole }> = [
  { rx: /\b(minibus\s*driver|bus\s*driver|shuttle\s*driver)\b/, label: 'Bus Driver', role: 'driver' },
  { rx: /\b(truck\s*driver|trucker|cdl\s*driver)\b/, label: 'Truck Driver', role: 'driver' },
  { rx: /\b(delivery\s*driver|uber\s*driver|lyft\s*driver|taxi\s*driver|chauffeur|driver)\b/, label: 'Driver', role: 'driver' },
  { rx: /\b(software\s*engineer|software\s*developer)\b/, label: 'Software Engineer', role: 'knowledge_worker' },
  { rx: /\b(programmer)\b/, label: 'Programmer', role: 'knowledge_worker' },
  { rx: /\b(developer|coder|web\s*dev|devops|data\s*scientist)\b/, label: 'Developer', role: 'knowledge_worker' },
  { rx: /\b(engineer|architect|analyst|accountant|lawyer|doctor|physician|nurse|consultant)\b/, label: '', role: 'knowledge_worker' },
  { rx: /\b(medical\s*student|med\s*student)\b/, label: 'Medical Student', role: 'student' },
  { rx: /\b(phd\s*student|grad\s*student|researcher|student)\b/, label: 'Student', role: 'student' },
  { rx: /\b(designer|ux\s*designer|ui\s*designer|graphic\s*designer)\b/, label: 'Designer', role: 'creative' },
  { rx: /\b(writer|author|copywriter|journalist|editor|filmmaker|musician|artist|creative)\b/, label: '', role: 'creative' },
  { rx: /\b(founder|co-founder|ceo|entrepreneur|business\s*owner|manager|director)\b/, label: '', role: 'entrepreneur' },
];

function extractOccupationAndRole(norm: string): { role?: UserRole; occupationLabel?: string } {
  for (const entry of OCCUPATION_PATTERNS) {
    const m = norm.match(entry.rx);
    if (m) {
      return {
        role: entry.role,
        occupationLabel: entry.label || titleCasePhrase(m[1]),
      };
    }
  }
  return {};
}

export interface ParsedProfileSentence {
  displayName?: string;
  age?: number;
  gender?: UserGender;
  role?: UserRole;
  occupationLabel?: string;
  detectedHints: string[];
}

/**
 * Parses Beat 1 natural self-introduction (e.g. "I'm Alex, 40 years old male, programmer")
 * into structured Neural Identity fields in zero milliseconds.
 */
export function parseProfileSentence(rawText: string): ParsedProfileSentence {
  const norm = normalizeText(rawText);
  const detectedHints: string[] = [];

  // Optional first name ("I'm Alex", "My name is Sara", "Call me Dan")
  let displayName: string | undefined;
  const nameMatch = rawText.match(
    /(?:my\s+name\s+is|call\s+me|i['’]?m|i\s+am)\s+([A-Z][a-z]{1,18})(?=\s*(?:,|\.|and|\d|a\s|an\s|$))/i
  );
  if (nameMatch) {
    const candidate = nameMatch[1].trim();
    const stopWords = new Set([
      'male', 'female', 'tired', 'distracted', 'stressed', 'anxious', 'driving', 'studying',
      'working', 'looking', 'feeling', 'here', 'ready', 'years', 'old', 'from', 'just',
      'programmer', 'developer', 'engineer', 'driver', 'student', 'founder', 'designer', 'creative',
    ]);
    if (!stopWords.has(candidate.toLowerCase())) {
      displayName = titleCasePhrase(candidate);
      detectedHints.push(`Name: ${displayName}`);
    }
  }

  // Age (18–95 strictly)
  let age: number | undefined;
  const ageMatch =
    norm.match(/(\d{2})\s*(?:-|\s)?(?:year|years|yr|yrs|yo)\b/) ||
    norm.match(/(?:age|am)\s+(\d{2})(?:\s*(?:de\s+)?ani)?\b/) ||
    norm.match(/\b(\d{2})\b/);
  if (ageMatch) {
    const candidate = Number(ageMatch[1]);
    if (candidate >= 18 && candidate <= 95) {
      age = candidate;
      detectedHints.push(`Age ${candidate}`);
    }
  }

  // Gender
  const gender = extractGender(norm);
  if (gender) {
    detectedHints.push(gender === 'non_binary' ? 'Non-binary' : titleCasePhrase(gender));
  }

  // Occupation & Role
  const { role, occupationLabel } = extractOccupationAndRole(norm);
  if (occupationLabel) {
    detectedHints.push(occupationLabel);
  }

  return {
    displayName,
    age,
    gender,
    role,
    occupationLabel,
    detectedHints,
  };
}

export interface ParsedOnboarding {
  age: number;
  role: UserRole;
  primaryChallenge: PrimaryChallenge;
  texturePref: TexturePreference;
  noiseSensitivity: NoiseSensitivity;
  defaultDevice: OutputDevice;
  detectedHints: string[];
}

/**
 * Extracts structured psychoacoustic profile features from free-form visitor answers.
 * Visitors can type anything in their own words — subtle hints are purely optional.
 */
export function parseOnboardingAnswers(
  whoText: string,
  soundText: string,
  fallback?: Partial<UserProfile> | null
): ParsedOnboarding {
  const who = normalizeText(whoText);
  const sound = normalizeText(soundText);
  const combined = `${who} ${sound}`.trim();
  const detectedHints: string[] = [];

  // 1. Age
  let age = fallback?.age ?? 34;
  const ageMatch =
    combined.match(/(\d{2})\s*(?:-|\s)?(?:year|years|yr|yrs|yo)\b/) ||
    combined.match(/(?:i\s*am|i'm|im|age)\s+(\d{2})\b/) ||
    who.match(/\b(\d{2})\b/);
  if (ageMatch) {
    const n = Number(ageMatch[1]);
    if (n >= 18 && n <= 90) {
      age = n;
      detectedHints.push(`Age ${age}`);
    }
  }

  // 2. Role
  let role: UserRole = fallback?.role ?? 'knowledge_worker';
  if (/\b(driver|driving|minibus|bus|truck|van|taxi|uber|lyft|delivery|chauffeur)\b/.test(combined)) {
    role = 'driver';
    detectedHints.push('Driver / Road');
  } else if (/\b(student|study|studying|university|college|med|medical|exam|phd|school)\b/.test(combined)) {
    role = 'student';
    detectedHints.push('Student');
  } else if (/\b(creative|designer|design|writer|writing|artist|music|video|author|copywriter)\b/.test(combined)) {
    role = 'creative';
    detectedHints.push('Creative');
  } else if (/\b(founder|ceo|entrepreneur|manager|exec|executive|business|owner)\b/.test(combined)) {
    role = 'entrepreneur';
    detectedHints.push('Founder / Lead');
  } else if (/\b(engineer|developer|coder|coding|software|office|analyst|desk|remote|tech|finance|programmer)\b/.test(combined)) {
    role = 'knowledge_worker';
    detectedHints.push('Desk / Deep Work');
  }

  // 3. Primary challenge
  let primaryChallenge: PrimaryChallenge = fallback?.primaryChallenge ?? 'distraction';
  if (/\b(sleep|insomnia|bedtime|cant sleep|can't sleep|night)\b/.test(combined)) {
    primaryChallenge = 'sleep';
    detectedHints.push('Sleep');
  } else if (/\b(stress|stressed|anxious|anxiety|overwhelmed|burnout|tense|panic)\b/.test(combined)) {
    primaryChallenge = 'stress';
    detectedHints.push('Stress Relief');
  } else if (/\b(tired|fatigue|fatigued|sleepy|monoton|afternoon slump|exhausted|low energy)\b/.test(combined)) {
    primaryChallenge = 'fatigue';
    detectedHints.push('Fatigue / Energy');
  } else if (/\b(distract|adhd|focus|scatter|wander|concentr)\b/.test(combined)) {
    primaryChallenge = 'distraction';
    detectedHints.push('Attention / Focus');
  }

  // 4. Texture preference
  let texturePref: TexturePreference = fallback?.texturePref ?? 'warm_organic';
  if (/\b(rhythm|rhythmic|beat|pulse|groove|tempo|percuss|energetic|driving beat)\b/.test(sound)) {
    texturePref = 'rhythmic_pulse';
    detectedHints.push('Rhythmic Drive');
  } else if (/\b(electronic|synth|minimal|techno|ambient tech|clean|sci-fi|modern)\b/.test(sound)) {
    texturePref = 'minimal_electronic';
    detectedHints.push('Minimal Electronic');
  } else if (/\b(nature|rain|wind|ocean|forest|water|ambient|drift)\b/.test(sound)) {
    texturePref = 'nature_drift';
    detectedHints.push('Ambient & Natural');
  } else if (/\b(warm|organic|soft|calm|piano|pad|gentle|smooth|mellow)\b/.test(sound)) {
    texturePref = 'warm_organic';
    detectedHints.push('Warm & Organic');
  }

  // 5. Noise sensitivity
  let noiseSensitivity: NoiseSensitivity = fallback?.noiseSensitivity ?? 'medium';
  if (/\b(sensitive|no harsh|no sharp|hate white noise|no noise|very soft|gentle|quiet|mild)\b/.test(sound)) {
    noiseSensitivity = 'high';
    detectedHints.push('Soft EQ (High Sensitivity)');
  } else if (/\b(love white noise|pink noise|brown noise|masking|loud|intense|strong)\b/.test(sound)) {
    noiseSensitivity = 'low';
    detectedHints.push('Masking Friendly');
  }

  // 6. Default output device
  let defaultDevice: OutputDevice =
    role === 'driver' ? 'car_audio' : (fallback?.defaultDevice ?? 'headphones');
  if (/\b(car|vehicle|dashboard|bluetooth|cab|van|bus|truck)\b/.test(combined)) {
    defaultDevice = 'car_audio';
    detectedHints.push('Vehicle Speakers');
  } else if (/\b(speaker|speakers|room|desk speaker)\b/.test(sound)) {
    defaultDevice = 'speakers';
    detectedHints.push('Speakers');
  } else if (/\b(headphone|headphones|earbud|earbuds|airpods|over-ear|in-ear)\b/.test(sound)) {
    defaultDevice = role === 'driver' ? 'car_audio' : 'headphones';
    if (defaultDevice === 'headphones') detectedHints.push('Headphones');
  }

  return {
    age,
    role,
    primaryChallenge,
    texturePref,
    noiseSensitivity,
    defaultDevice,
    detectedHints,
  };
}

/**
 * Deterministic English + Romanian natural-language session parser.
 * Zero API cost, instant latency, resilient to typos.
 */
export function parseNaturalCheckIn(
  rawText: string,
  profile?: Partial<UserProfile> | null
): ParsedCheckIn {
  const norm = normalizeText(rawText);
  const detectedKeywords: string[] = [];

  // 1. Extract age
  let extractedAge: number | undefined;
  const ageMatch =
    norm.match(/(\d{2})\s*(?:-|\s)?(?:year|years|yr|yrs|yo)\b/) ||
    norm.match(/(?:i\s*am|i'm|im|age|am)\s+(\d{2})(?:\s*(?:de\s+)?ani)?\b/);
  if (ageMatch) {
    const candidate = Number(ageMatch[1]);
    if (candidate >= 18 && candidate <= 90) {
      extractedAge = candidate;
      detectedKeywords.push(`Age ${candidate}`);
    }
  }

  // 2. Extract duration
  let durationMin = 30;
  const minMatch = norm.match(/(\d{1,3})\s*(?:minutes|minute|mins|min|m\b)/);
  const hourMatch = norm.match(/(?:(\d)\s*(?:hours|hour|hrs|hr|h\b))|(?:an?\s+hour)/);
  if (minMatch) {
    durationMin = Math.max(5, Math.min(120, Number(minMatch[1])));
    detectedKeywords.push(`${durationMin} min`);
  } else if (hourMatch) {
    const hrs = hourMatch[1] ? Number(hourMatch[1]) : 1;
    durationMin = Math.max(15, Math.min(120, hrs * 60));
    detectedKeywords.push(`${durationMin} min`);
  }

  // 3. Extract environment & role
  let environment: SessionEnvironment = 'office';
  let extractedRole: UserRole | undefined;
  let device: OutputDevice = profile?.defaultDevice ?? 'headphones';

  const drivingRegex =
    /\b(driver|driving|drive|minibus|bus|truck|car|highway|road|commute|van|uber|lyft|taxi|route|wheel)\b/;
  const studyRegex = /\b(study|studying|exam|reading|read|book|homework|college|university)\b/;
  const homeSleepRegex = /\b(home|bed|sleep|sleeping|bedtime|night|evening|couch|relaxing)\b/;
  const transitRegex = /\b(train|flight|plane|subway|metro|passenger)\b/;

  if (drivingRegex.test(norm)) {
    environment = 'driving';
    extractedRole = 'driver';
    device = 'car_audio';
    detectedKeywords.push('Driving · Safety Mode');
  } else if (studyRegex.test(norm)) {
    environment = 'study';
    extractedRole = 'student';
    detectedKeywords.push('Studying');
  } else if (transitRegex.test(norm)) {
    environment = 'transit';
    detectedKeywords.push('Transit');
  } else if (homeSleepRegex.test(norm)) {
    environment = 'home_relax';
    detectedKeywords.push('Home');
  } else if (/\b(developer|engineer|coder|coding|software|programmer|analyst)\b/.test(norm)) {
    environment = 'office';
    extractedRole = 'knowledge_worker';
    detectedKeywords.push('Desk / Deep Work');
  } else if (profile?.role === 'driver') {
    environment = 'driving';
    device = 'car_audio';
  }

  if (environment !== 'driving') {
    if (/\b(headphones|earbuds|airpods|headset)\b/.test(norm)) {
      device = 'headphones';
      detectedKeywords.push('Headphones');
    } else if (/\b(speakers|speaker)\b/.test(norm)) {
      device = 'speakers';
      detectedKeywords.push('Speakers');
    }
  }

  // 4. Current state
  let currentState: CurrentState = 'distracted';
  if (/\b(distracted|unfocused|scattered|adhd|cant focus|can't focus|wandering|foggy)/.test(norm)) {
    currentState = 'distracted';
    detectedKeywords.push('Distracted');
  } else if (/\b(tired|fatigued|sleepy|exhausted|drained|low energy|sluggish|slump)/.test(norm)) {
    currentState = 'fatigued';
    detectedKeywords.push('Fatigued');
  } else if (/\b(stressed|overwhelmed|tense|burnout|pressured)/.test(norm)) {
    currentState = 'stressed';
    detectedKeywords.push('Stressed');
  } else if (/\b(anxious|jittery|nervous|racing mind|panic|worried)/.test(norm)) {
    currentState = 'anxious';
    detectedKeywords.push('Anxious');
  } else if (/\b(restless|bored|monotonous|fidgety)/.test(norm)) {
    currentState = 'restless';
    detectedKeywords.push('Restless');
  } else if (/\b(neutral|fine|okay|ok|calm|steady)/.test(norm)) {
    currentState = 'calm_neutral';
    detectedKeywords.push('Neutral');
  }

  // 5. Target state (handle negated fatigue like "stop feeling tired" -> energy_lift!)
  let targetState: TargetState = 'alert_focus';
  if (
    /\b(stop\s+(?:feeling\s+|being\s+)?(?:tired|sleepy|fatigued|drained)|not\s+(?:feel\s+|be\s+)?(?:tired|sleepy|fatigued)|no\s+longer\s+(?:tired|sleepy|fatigued)|don['’]?t\s+want\s+to\s+(?:feel\s+|be\s+)?(?:tired|sleepy)|shake\s+off\s+(?:fatigue|tiredness|sleepiness)|beat\s+(?:fatigue|tiredness|sleepiness|the\s+slump)|energy|energized|awake|alertness|boost|wake\s+up|vigilant)\b/.test(
      norm
    )
  ) {
    targetState = 'energy_lift';
    detectedKeywords.push('→ Energy Lift');
  } else if (/\b(sleep|fall asleep|wind down|bedtime|insomnia)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'sleep_winddown';
    detectedKeywords.push(
      environment === 'driving' ? '→ Alert Focus (Road Safe)' : '→ Sleep Wind-Down'
    );
  } else if (/\b(calm|relax|de-stress|destress|unwind|breathe|peaceful|meditate|meditation|mindfulness)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'calm_reset';
    detectedKeywords.push('→ Calm Reset');
  } else if (/\b(flow|deep work|deep focus|coding|programming|writing|creative|creativity|brainstorm|ideation|imagination)/.test(norm)) {
    targetState = 'deep_flow';
    detectedKeywords.push('→ Deep Flow');
  } else if (/\b(focus|focused|concentrate|concentrated|sharp|clarity|productive|attention|memory|memorize|retention)/.test(norm)) {
    targetState = 'alert_focus';
    detectedKeywords.push('→ Alert Focus');
  }

  const extractedGender = extractGender(norm);
  const occInfo = extractOccupationAndRole(norm);
  if (!extractedRole && occInfo.role) {
    extractedRole = occInfo.role;
  }

  // 6. Curated Musical Genre detection from free text (maps directly to our 10 verified studio genres)
  let extractedGenre: ResolvedGenre | undefined;
  let extractedCustomGenre: string | undefined;

  if (/\b(dub reggae|chill reggae|reggae|dub)\b/.test(norm)) {
    extractedGenre = 'dub_reggae';
    detectedKeywords.push('Genre: Dub Reggae');
  } else if (/\b(bossa nova|bosanova|bossa|brazilian)\b/.test(norm)) {
    extractedGenre = 'bossa_nova';
    detectedKeywords.push('Genre: Bossa Nova');
  } else if (/\b(solo piano|felt piano|classical piano|piano)\b/.test(norm)) {
    extractedGenre = 'solo_piano';
    detectedKeywords.push('Genre: Solo Felt Piano');
  } else if (/\b(space ambient|ambient space|ambient|space|beatless|meditation|drone)\b/.test(norm)) {
    extractedGenre = 'ambient_space';
    detectedKeywords.push('Genre: Ambient & Space');
  } else if (/\b(lofi|lo-fi|lo fi|chillhop|dusty|beats to study)\b/.test(norm)) {
    extractedGenre = 'lofi_keys';
    detectedKeywords.push('Genre: Lo-Fi Beats');
  } else if (/\b(electronic|techno|house|trance|edm|club|groove|synthwave)\b/.test(norm)) {
    extractedGenre = 'deep_electronic';
    detectedKeywords.push('Genre: Deep Electronic');
  } else if (/\b(classical|cinematic|orchestra|orchestral|interstellar|strings|movie|epic|soundtrack)\b/.test(norm)) {
    extractedGenre = 'cinematic_strings';
    detectedKeywords.push('Genre: Classical & Strings');
  } else if (/\b(jazz|rhodes|soul|lounge|blues)\b/.test(norm)) {
    extractedGenre = 'jazz_rhodes';
    detectedKeywords.push('Genre: Late-Night Jazz');
  } else if (/\b(acoustic|guitar|harp|folk|indie|instrumental rock)\b/.test(norm)) {
    extractedGenre = 'acoustic_pluck';
    detectedKeywords.push('Genre: Acoustic Guitar');
  } else if (/\b(rain|nature|ocean|forest|wind|storm|water)\b/.test(norm)) {
    extractedGenre = 'nature_rain';
    detectedKeywords.push('Genre: Soft Rain & Nature');
  }

  return {
    rawText,
    extractedAge,
    extractedGender,
    extractedRole,
    extractedOccupation: occInfo.occupationLabel,
    extractedGenre,
    extractedCustomGenre,
    currentState,
    targetState,
    environment,
    device,
    durationMin,
    detectedKeywords,
    usedGemini: false,
  };
}
