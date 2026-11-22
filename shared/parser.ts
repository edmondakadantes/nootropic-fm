import type {
  CurrentState,
  NoiseSensitivity,
  OutputDevice,
  ParsedCheckIn,
  PrimaryChallenge,
  SessionEnvironment,
  TargetState,
  TexturePreference,
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
    combined.match(/(?:i\s*am|i'm|im|age|am)\s+(\d{2})(?:\s*(?:de\s+)?ani)?\b/) ||
    who.match(/\b(\d{2})\b/);
  if (ageMatch) {
    const n = Number(ageMatch[1]);
    if (n >= 16 && n <= 88) {
      age = n;
      detectedHints.push(`Age ${age}`);
    }
  }

  // 2. Role
  let role: UserRole = fallback?.role ?? 'knowledge_worker';
  if (/\b(driver|driving|minibus|bus|truck|van|taxi|uber|delivery|chauffeur|sofer|microbuz|mistobuz|camion)\b/.test(combined)) {
    role = 'driver';
    detectedHints.push('Driver / Road');
  } else if (/\b(student|study|studying|university|college|med|medical|exam|phd|school|student|facultate)\b/.test(combined)) {
    role = 'student';
    detectedHints.push('Student');
  } else if (/\b(creative|designer|design|writer|writing|artist|music|video|author|copywriter)\b/.test(combined)) {
    role = 'creative';
    detectedHints.push('Creative');
  } else if (/\b(founder|ceo|entrepreneur|manager|exec|executive|business|owner|antreprenor)\b/.test(combined)) {
    role = 'entrepreneur';
    detectedHints.push('Founder / Lead');
  } else if (/\b(engineer|developer|coder|coding|software|office|analyst|desk|remote|tech|finance|programator)\b/.test(combined)) {
    role = 'knowledge_worker';
    detectedHints.push('Desk / Deep Work');
  }

  // 3. Primary challenge
  let primaryChallenge: PrimaryChallenge = fallback?.primaryChallenge ?? 'distraction';
  if (/\b(sleep|insomnia|bedtime|cant sleep|can't sleep|night|somn|adorm)\b/.test(combined)) {
    primaryChallenge = 'sleep';
    detectedHints.push('Sleep');
  } else if (/\b(stress|stressed|anxious|anxiety|overwhelmed|burnout|tense|panic|stres|anxios)\b/.test(combined)) {
    primaryChallenge = 'stress';
    detectedHints.push('Stress Relief');
  } else if (/\b(tired|fatigue|fatigued|sleepy|monoton|afternoon slump|exhausted|low energy|obosit|monoton)\b/.test(combined)) {
    primaryChallenge = 'fatigue';
    detectedHints.push('Fatigue / Energy');
  } else if (/\b(distract|adhd|focus|scatter|wander|concentr|distrat|atent)\b/.test(combined)) {
    primaryChallenge = 'distraction';
    detectedHints.push('Attention / Focus');
  }

  // 4. Texture preference
  let texturePref: TexturePreference = fallback?.texturePref ?? 'warm_organic';
  if (/\b(rhythm|rhythmic|beat|pulse|groove|tempo|percuss|energetic|driving beat|ritm|puls)\b/.test(sound)) {
    texturePref = 'rhythmic_pulse';
    detectedHints.push('Rhythmic Drive');
  } else if (/\b(electronic|synth|minimal|techno|ambient tech|clean|sci-fi|modern)\b/.test(sound)) {
    texturePref = 'minimal_electronic';
    detectedHints.push('Minimal Electronic');
  } else if (/\b(nature|rain|wind|ocean|forest|water|ambient|drift|ploaie|natura)\b/.test(sound)) {
    texturePref = 'nature_drift';
    detectedHints.push('Ambient & Natural');
  } else if (/\b(warm|organic|soft|calm|piano|pad|gentle|smooth|mellow|cald)\b/.test(sound)) {
    texturePref = 'warm_organic';
    detectedHints.push('Warm & Organic');
  }

  // 5. Noise sensitivity
  let noiseSensitivity: NoiseSensitivity = fallback?.noiseSensitivity ?? 'medium';
  if (/\b(sensitive|no harsh|no sharp|hate white noise|no noise|very soft|gentle|quiet|mild|fara zgomot|sensibil)\b/.test(sound)) {
    noiseSensitivity = 'high';
    detectedHints.push('Soft EQ (High Sensitivity)');
  } else if (/\b(love white noise|pink noise|brown noise|masking|loud|intense|strong)\b/.test(sound)) {
    noiseSensitivity = 'low';
    detectedHints.push('Masking Friendly');
  }

  // 6. Default output device
  let defaultDevice: OutputDevice =
    role === 'driver' ? 'car_audio' : (fallback?.defaultDevice ?? 'headphones');
  if (/\b(car|vehicle|dashboard|bluetooth|cab|van|bus|truck|masina|microbuz)\b/.test(combined)) {
    defaultDevice = 'car_audio';
    detectedHints.push('Vehicle Speakers');
  } else if (/\b(speaker|speakers|room|desk speaker|boxe|difuzor)\b/.test(sound)) {
    defaultDevice = 'speakers';
    detectedHints.push('Speakers');
  } else if (/\b(headphone|headphones|earbud|earbuds|airpods|over-ear|in-ear|casti)\b/.test(sound)) {
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
    if (candidate >= 16 && candidate <= 90) {
      extractedAge = candidate;
      detectedKeywords.push(`Age ${candidate}`);
    }
  }

  // 2. Extract duration
  let durationMin = 30;
  const minMatch = norm.match(/(\d{1,3})\s*(?:de\s+)?(?:minutes|minute|mins|min|minut|m\b)/);
  const hourMatch = norm.match(/(?:(\d)\s*(?:hours|hour|hrs|hr|ore|ora|h\b))|(?:an?\s+hour)|(?:o\s+ora)/);
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
    /\b(driver|driving|drive|minibus|bus|truck|car|highway|road|commute|van|uber|taxi|route|wheel|sofer|volan|conduc|microbuz|mistobuz|camion|masina)\b/;
  const studyRegex = /\b(study|studying|exam|reading|read|book|homework|college|university|studiu|invat|examen|citesc)\b/;
  const homeSleepRegex = /\b(home|bed|sleep|sleeping|bedtime|night|evening|couch|relaxing|acasa|pat|culcare|somn)\b/;
  const transitRegex = /\b(train|flight|plane|subway|metro|passenger|tren|avion|metrou|pasager)\b/;

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
  } else if (profile?.role === 'driver') {
    environment = 'driving';
    device = 'car_audio';
  }

  if (environment !== 'driving') {
    if (/\b(headphones|earbuds|airpods|headset|casti)\b/.test(norm)) {
      device = 'headphones';
      detectedKeywords.push('Headphones');
    } else if (/\b(speakers|speaker|boxe|difuzor)\b/.test(norm)) {
      device = 'speakers';
      detectedKeywords.push('Speakers');
    }
  }

  // 4. Current state
  let currentState: CurrentState = 'distracted';
  if (/\b(distracted|unfocused|scattered|adhd|cant focus|can't focus|wandering|foggy|distrat|distras|imprastiat)/.test(norm)) {
    currentState = 'distracted';
    detectedKeywords.push('Distracted');
  } else if (/\b(tired|fatigued|sleepy|exhausted|drained|low energy|sluggish|slump|obosit|somnoros|epuizat)/.test(norm)) {
    currentState = 'fatigued';
    detectedKeywords.push('Fatigued');
  } else if (/\b(stressed|overwhelmed|tense|burnout|pressured|stresat|tensionat|coplesit)/.test(norm)) {
    currentState = 'stressed';
    detectedKeywords.push('Stressed');
  } else if (/\b(anxious|jittery|nervous|racing mind|panic|worried|anxios|nelinistit|agitat)/.test(norm)) {
    currentState = 'anxious';
    detectedKeywords.push('Anxious');
  } else if (/\b(restless|bored|monotonous|fidgety|plictisit|monoton)/.test(norm)) {
    currentState = 'restless';
    detectedKeywords.push('Restless');
  } else if (/\b(neutral|fine|okay|ok|calm|steady|bine|neutru)/.test(norm)) {
    currentState = 'calm_neutral';
    detectedKeywords.push('Neutral');
  }

  // 5. Target state
  let targetState: TargetState = 'alert_focus';
  if (/\b(sleep|fall asleep|wind down|bedtime|insomnia|somn|adorm|culcare)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'sleep_winddown';
    detectedKeywords.push(
      environment === 'driving' ? '→ Alert Focus (Road Safe)' : '→ Sleep Wind-Down'
    );
  } else if (/\b(calm|relax|de-stress|destress|unwind|breathe|peaceful|linist|calmez)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'calm_reset';
    detectedKeywords.push('→ Calm Reset');
  } else if (/\b(energy|energized|awake|alertness|boost|wake up|vigilant|energie|treaz|vigilent)/.test(norm)) {
    targetState = 'energy_lift';
    detectedKeywords.push('→ Energy Lift');
  } else if (/\b(flow|deep work|deep focus|coding|programming|writing|creative|profund)/.test(norm)) {
    targetState = 'deep_flow';
    detectedKeywords.push('→ Deep Flow');
  } else if (/\b(focus|focused|concentrate|concentrated|sharp|clarity|productive|attention|concentr|atent)/.test(norm)) {
    targetState = 'alert_focus';
    detectedKeywords.push('→ Alert Focus');
  }

  return {
    rawText,
    extractedAge,
    extractedRole,
    currentState,
    targetState,
    environment,
    device,
    durationMin,
    detectedKeywords,
    usedGemini: false,
  };
}
