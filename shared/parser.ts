import type {
  CurrentState,
  OutputDevice,
  ParsedCheckIn,
  SessionEnvironment,
  TargetState,
  UserProfile,
  UserRole,
} from './types';

function normalizeRo(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic Romanian + English natural-language context parser.
 * Zero API cost, instant latency, resilient to typos (e.g. "mistobuz", "sofer").
 */
export function parseNaturalCheckIn(
  rawText: string,
  profile?: Partial<UserProfile> | null
): ParsedCheckIn {
  const norm = normalizeRo(rawText);
  const detectedKeywords: string[] = [];

  // 1. Extract age (e.g., "am 40 de ani", "40 ani", "40yo")
  let extractedAge: number | undefined;
  const ageMatch = norm.match(/(?:am\s+)?(\d{2})\s*(?:de\s+)?(?:ani|yo|years)/);
  if (ageMatch) {
    const candidate = Number(ageMatch[1]);
    if (candidate >= 16 && candidate <= 90) {
      extractedAge = candidate;
      detectedKeywords.push(`${candidate} ani`);
    }
  }

  // 2. Extract duration (e.g., "40 de minute", "40 min", "o ora", "1 ora", "25m")
  let durationMin = 30;
  const minMatch = norm.match(/(\d{1,3})\s*(?:de\s+)?(?:minute|minut|min|m\b)/);
  const hourMatch = norm.match(/(?:(\d)\s*(?:ore|ora|h\b))|(?:o\s+ora)/);
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
    /\b(sofer|volan|conduc|condus|microbuz|mistobuz|autobuz|tir|camion|masina|drum|sosea|autostrada|driver|driving|commute)\b/;
  const studyRegex = /\b(studiu|invat|examen|citesc|citit|carte|facultate|tema|study|reading|exam)\b/;
  const homeSleepRegex = /\b(acasa|pat|culcare|dorm|somn|seara|noapte|relaxare|sleep|bed|home)\b/;
  const transitRegex = /\b(tren|avion|metrou|pasager|autobuz ca pasager|flight|train)\b/;

  if (drivingRegex.test(norm)) {
    environment = 'driving';
    extractedRole = 'driver';
    device = 'car_audio';
    detectedKeywords.push('La volan (Safety Mode)');
  } else if (studyRegex.test(norm)) {
    environment = 'study';
    extractedRole = 'student';
    detectedKeywords.push('Studiu');
  } else if (transitRegex.test(norm)) {
    environment = 'transit';
    detectedKeywords.push('Transport');
  } else if (homeSleepRegex.test(norm)) {
    environment = 'home_relax';
    detectedKeywords.push('Acasă');
  } else if (profile?.role === 'driver') {
    environment = 'driving';
    device = 'car_audio';
  }

  // Device override if explicitly mentioned (except driving stays car_audio for safety!)
  if (environment !== 'driving') {
    if (/\b(casti|airpods|headphones|earbuds)\b/.test(norm)) {
      device = 'headphones';
      detectedKeywords.push('Căști');
    } else if (/\b(boxe|boxa|difuzor|speaker|speakers)\b/.test(norm)) {
      device = 'speakers';
      detectedKeywords.push('Difuzoare');
    }
  }

  // 4. Current state
  let currentState: CurrentState = 'distracted';
  if (/\b(distrat|distras|imprastiat|nu ma pot concentra|adhd|zboara gandul|distracted|unfocused)\b/.test(norm)) {
    currentState = 'distracted';
    detectedKeywords.push('Stare: distrat');
  } else if (/\b(obosit|somnoros|fara energie|epuizat|slab|tired|sleepy|fatigued|drained)\b/.test(norm)) {
    currentState = 'fatigued';
    detectedKeywords.push('Stare: obosit');
  } else if (/\b(stresat|presat|tensionat|coplesit|nervos|stressed|overwhelmed)\b/.test(norm)) {
    currentState = 'stressed';
    detectedKeywords.push('Stare: stresat');
  } else if (/\b(anxios|nelinistit|agitat|panica|emotii|anxious|jittery)\b/.test(norm)) {
    currentState = 'anxious';
    detectedKeywords.push('Stare: agitat');
  } else if (/\b(plictisit|monoton|restless|bored)\b/.test(norm)) {
    currentState = 'restless';
    detectedKeywords.push('Stare: plictisit');
  } else if (/\b(ok|neutru|bine|calm|normal)\b/.test(norm)) {
    currentState = 'calm_neutral';
    detectedKeywords.push('Stare: neutru');
  }

  // 5. Target state
  let targetState: TargetState = 'alert_focus';
  if (/\b(somn|adorm|dorm|culcare|sleep|wind down)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'sleep_winddown';
    detectedKeywords.push(environment === 'driving' ? 'Țintă: Focus (siguranță volan)' : 'Țintă: Somn');
  } else if (/\b(calm|linist|relax|deconect|respir|fara stres)/.test(norm)) {
    targetState = environment === 'driving' ? 'alert_focus' : 'calm_reset';
    detectedKeywords.push('Țintă: Calmare');
  } else if (/\b(energie|treaz|vigilent|energic|boost|wake|energy|alert)/.test(norm)) {
    targetState = 'energy_lift';
    detectedKeywords.push('Țintă: Energie & vigilență');
  } else if (/\b(flow|profund|cod|programare|scriu|creativ|deep work|deep focus)/.test(norm)) {
    targetState = 'deep_flow';
    detectedKeywords.push('Țintă: Deep Flow');
  } else if (/\b(concentr|focus|atent|productiv|claritate)/.test(norm)) {
    targetState = 'alert_focus';
    detectedKeywords.push('Țintă: Focus alert');
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
