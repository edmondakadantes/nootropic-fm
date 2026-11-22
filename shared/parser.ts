import type {
  CurrentState,
  OutputDevice,
  ParsedCheckIn,
  SessionEnvironment,
  TargetState,
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

/**
 * Deterministic English + Romanian natural-language context parser.
 * Zero API cost, instant latency, resilient to typos.
 */
export function parseNaturalCheckIn(
  rawText: string,
  profile?: Partial<UserProfile> | null
): ParsedCheckIn {
  const norm = normalizeText(rawText);
  const detectedKeywords: string[] = [];

  // 1. Extract age (e.g., "40-year-old", "40 years old", "i am 40", "am 40 de ani", "40yo")
  let extractedAge: number | undefined;
  const ageMatch =
    norm.match(/(\d{2})\s*(?:-|\s)?(?:year|years|yr|yrs|yo)\b/) ||
    norm.match(/(?:i\s*am|i'm|im|age|am)\s+(\d{2})(?:\s*(?:de\s+)?ani)?\b/);
  if (ageMatch) {
    const candidate = Number(ageMatch[1]);
    if (candidate >= 16 && candidate <= 90) {
      extractedAge = candidate;
      detectedKeywords.push(`Age: ${candidate}`);
    }
  }

  // 2. Extract duration (e.g., "40 minutes", "40 min", "1 hour", "an hour", "25m")
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
    /\b(driver|driving|drive|minibus|bus|truck|car|highway|road|commute|van|uber|taxi|sofer|volan|conduc|microbuz|mistobuz|camion|masina)\b/;
  const studyRegex = /\b(study|studying|exam|reading|read|book|homework|college|university|studiu|invat|examen|citesc)\b/;
  const homeSleepRegex = /\b(home|bed|sleep|sleeping|bedtime|night|evening|couch|relaxing|acasa|pat|culcare|somn)\b/;
  const transitRegex = /\b(train|flight|plane|subway|metro|passenger|tren|avion|metrou|pasager)\b/;

  if (drivingRegex.test(norm)) {
    environment = 'driving';
    extractedRole = 'driver';
    device = 'car_audio';
    detectedKeywords.push('Driving (Safety Mode)');
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

  // Device override if explicitly mentioned (driving stays car_audio for safety!)
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
  if (/\b(distracted|unfocused|scattered|adhd|cant focus|can't focus|wandering|distrat|distras|imprastiat)/.test(norm)) {
    currentState = 'distracted';
    detectedKeywords.push('State: Distracted');
  } else if (/\b(tired|fatigued|sleepy|exhausted|drained|low energy|sluggish|obosit|somnoros|epuizat)/.test(norm)) {
    currentState = 'fatigued';
    detectedKeywords.push('State: Fatigued');
  } else if (/\b(stressed|overwhelmed|tense|burnout|pressured|stresat|tensionat|coplesit)/.test(norm)) {
    currentState = 'stressed';
    detectedKeywords.push('State: Stressed');
  } else if (/\b(anxious|jittery|nervous|racing mind|panic|worried|anxios|nelinistit|agitat)/.test(norm)) {
    currentState = 'anxious';
    detectedKeywords.push('State: Anxious');
  } else if (/\b(restless|bored|monotonous|fidgety|plictisit|monoton)/.test(norm)) {
    currentState = 'restless';
    detectedKeywords.push('State: Restless');
  } else if (/\b(neutral|fine|okay|ok|calm|steady|bine|neutru)/.test(norm)) {
    currentState = 'calm_neutral';
    detectedKeywords.push('State: Neutral');
  }

  // 5. Target state
  let targetState: TargetState = 'alert_focus';
  if (/\b(sleep|fall asleep|wind down|bedtime|insomnia|somn|adorm|culcare)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'sleep_winddown';
    detectedKeywords.push(
      environment === 'driving' ? 'Goal: Alert Focus (Driving Safety)' : 'Goal: Sleep Wind-Down'
    );
  } else if (/\b(calm|relax|de-stress|destress|unwind|breathe|peaceful|linist|calmez)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'calm_reset';
    detectedKeywords.push('Goal: Calm Reset');
  } else if (/\b(energy|energized|awake|alertness|boost|wake up|vigilant|energie|treaz|vigilent)/.test(norm)) {
    targetState = 'energy_lift';
    detectedKeywords.push('Goal: Energy Lift');
  } else if (/\b(flow|deep work|deep focus|coding|programming|writing|creative|profund)/.test(norm)) {
    targetState = 'deep_flow';
    detectedKeywords.push('Goal: Deep Flow');
  } else if (/\b(focus|focused|concentrate|concentrated|sharp|clarity|productive|attention|concentr|atent)/.test(norm)) {
    targetState = 'alert_focus';
    detectedKeywords.push('Goal: Alert Focus');
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
