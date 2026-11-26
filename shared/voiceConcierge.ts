import {
  type CurrentState,
  type OutputDevice,
  type ResolvedGenre,
  type TargetState,
  type TimeOfDayBucket,
} from './types';

export type VoiceCueType = 'intro_full' | 'intro_short' | 'outro_landing';

export interface VoiceConciergeRequest {
  cueType: VoiceCueType;
  firstName?: string | null;
  currentState: CurrentState;
  targetState: TargetState;
  armId: string;
  modulationHz: number;
  genre: ResolvedGenre;
  isDriving: boolean;
  device?: OutputDevice;
  timeBucket?: TimeOfDayBucket;
  durationMin?: number;
}

export interface VoiceConciergePlan {
  cueType: VoiceCueType;
  cleanFirstName: string | null;
  greetingText: string;
  bodyText: string;
  fullTranscript: string;
  greetingCacheSlug: string;
  bodyCacheSlug: string;
  breathPauseMs: number;
}

const RESERVED_PLACEHOLDER_NAMES = new Set([
  'anon',
  'anonymous',
  'user',
  'guest',
  'listener',
  'member',
  'test',
  'tester',
  'admin',
  'null',
  'undefined',
  'none',
]);

/**
 * Extracts a safe, natural spoken first name from `displayName` (or returns `null` when anonymous).
 * Blocks numbers, URLs, prompt injections, and generic placeholder labels so the voice never sounds robotic.
 */
export function sanitizeSpokenFirstName(rawName?: string | null): string | null {
  if (!rawName) return null;
  const trimmed = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!trimmed) return null;

  const firstToken = trimmed.split(/[\s,._/]+/)[0] ?? '';
  const clean = firstToken.replace(/[^A-Za-z'-]/g, '').replace(/^['-]+|['-]+$/g, '');
  if (clean.length < 2 || clean.length > 18) return null;
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(clean)) return null;
  if (!/[aeiouyAEIOUY]/.test(clean)) return null;
  if (RESERVED_PLACEHOLDER_NAMES.has(clean.toLowerCase())) return null;

  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function getSpokenGenrePhrase(genre: ResolvedGenre): string {
  switch (genre) {
    case 'nootropic_trance':
      return 'Nootropic F M pulse';
    case 'lofi_keys':
      return 'warm Lo-Fi keys';
    case 'deep_electronic':
      return 'Deep Electronic groove';
    case 'cinematic_strings':
      return 'warm chamber strings';
    case 'jazz_rhodes':
      return 'Late-Night Jazz Rhodes';
    case 'acoustic_pluck':
      return 'warm acoustic guitar';
    case 'nature_rain':
      return 'soft rain soundscape';
    case 'dub_reggae':
      return 'warm Dub Reggae groove';
    case 'ambient_space':
      return 'deep space ambient bed';
    case 'solo_piano':
      return 'soft felt piano';
    case 'bossa_nova':
      return 'warm Bossa Nova groove';
    default:
      return 'instrumental mix';
  }
}

function getStateEmpathyLead(state: CurrentState): string {
  switch (state) {
    case 'stressed':
      return 'Take one slow breath in... Let the tension drop from your shoulders.';
    case 'anxious':
      return "Take a gentle breath in... You're safe to slow everything down right here.";
    case 'distracted':
      return 'Take one slow breath in... We feel that mental scatter,';
    case 'fatigued':
      return "Take a steady breath in... Let's gently clear away that heavy fog,";
    case 'restless':
      return "Take one calm breath in... Let's channel that restless energy,";
    case 'calm_neutral':
    default:
      return 'Settle in and take one slow breath...';
  }
}

/**
 * Builds the 2-part breath-stitched Voice Concierge script:
 *  - Part 1 (`greetingText`): ~1.2s personalized name greeting (cached ONCE per first name in R2!)
 *  - Part 2 (`bodyText`): ~5–7s empathetic state + peer-reviewed science + genre bridge (cached ONCE per scenario in R2!)
 */
export function buildVoiceConciergePlan(req: VoiceConciergeRequest): VoiceConciergePlan {
  const cleanFirstName = sanitizeSpokenFirstName(req.firstName);
  const timeBucket: TimeOfDayBucket = req.timeBucket ?? 'afternoon';
  const hz = Math.max(1, Math.min(40, Math.round(req.modulationHz || 16)));
  const spokenGenre = getSpokenGenrePhrase(req.genre);

  // 1. Personalized Greeting Segment (~1.2s)
  let greetingText: string;
  let greetingBucketKey: string;

  if (req.cueType === 'outro_landing') {
    const mins = req.durationMin && req.durationMin >= 5 ? Math.round(req.durationMin) : null;
    if (mins && cleanFirstName) {
      greetingText = `${mins} minutes complete, ${cleanFirstName}.`;
      greetingBucketKey = `outro_${mins}_${cleanFirstName.toLowerCase()}`;
    } else if (cleanFirstName) {
      greetingText = `Session complete, ${cleanFirstName}.`;
      greetingBucketKey = `outro_gen_${cleanFirstName.toLowerCase()}`;
    } else if (mins) {
      greetingText = `${mins} minutes complete.`;
      greetingBucketKey = `outro_${mins}_anon`;
    } else {
      greetingText = 'Session complete.';
      greetingBucketKey = 'outro_gen_anon';
    }
  } else if (req.isDriving) {
    greetingText = cleanFirstName ? `Eyes on the road, ${cleanFirstName}.` : 'Eyes on the road.';
    greetingBucketKey = `drive_${cleanFirstName ? cleanFirstName.toLowerCase() : 'anon'}`;
  } else if (req.cueType === 'intro_short') {
    greetingText = cleanFirstName ? `Welcome back, ${cleanFirstName}.` : 'Welcome back.';
    greetingBucketKey = `short_${cleanFirstName ? cleanFirstName.toLowerCase() : 'anon'}`;
  } else if (timeBucket === 'morning') {
    greetingText = cleanFirstName ? `Good morning, ${cleanFirstName}.` : 'Good morning.';
    greetingBucketKey = `morning_${cleanFirstName ? cleanFirstName.toLowerCase() : 'anon'}`;
  } else if (timeBucket === 'evening' || timeBucket === 'night') {
    greetingText = cleanFirstName ? `Good evening, ${cleanFirstName}.` : 'Good evening.';
    greetingBucketKey = `evening_${cleanFirstName ? cleanFirstName.toLowerCase() : 'anon'}`;
  } else {
    greetingText = cleanFirstName ? `Hey ${cleanFirstName}.` : 'Welcome in.';
    greetingBucketKey = `day_${cleanFirstName ? cleanFirstName.toLowerCase() : 'anon'}`;
  }

  // 2. Scenario Body Segment (~4–7s, 100% shared across all listeners on the same state+arm+genre!)
  let bodyText: string;
  let bodyBucketKey: string;

  if (req.cueType === 'outro_landing') {
    bodyText =
      req.targetState === 'sleep_winddown'
        ? 'Rest deeply... and have a peaceful night.'
        : 'Take one soft breath... and gently bring your focus back to the room.';
    bodyBucketKey = `outro_${req.targetState === 'sleep_winddown' ? 'sleep' : 'awake'}`;
  } else if (req.isDriving) {
    bodyText = `Traffic frequencies stay wide open, with a crisp ${hz}-hertz alertness lift inside your ${spokenGenre}. Drive safe.`;
    bodyBucketKey = `drive_${hz}_${req.genre}`;
  } else if (req.cueType === 'intro_short') {
    const modeWord =
      req.targetState === 'calm_reset'
        ? 'calm reset'
        : req.targetState === 'sleep_winddown'
          ? 'sleep drift'
          : req.armId === 'nootropic-trance-6x40hz' || req.genre === 'nootropic_trance'
            ? 'trance tunnel'
            : 'focus flow';
    bodyText = `We're locking in your ${spokenGenre} ${modeWord}... Relax, we've got you from here.`;
    bodyBucketKey = `short_${modeWord.replace(/\s+/g, '_')}_${req.genre}`;
  } else {
    const lead = getStateEmpathyLead(req.currentState);
    const joiner = lead.endsWith(',') ? ' so' : ' We';
    const speakerCue =
      req.device === 'speakers'
        ? ' Slip both earbuds in whenever you can for full stereo lock.'
        : '';
    const devSlug = req.device === 'speakers' ? '_spk' : '';
    if (req.armId === 'nootropic-trance-6x40hz' || (req.genre === 'nootropic_trance' && req.modulationHz === 6)) {
      const earbudBridge =
        req.device === 'speakers'
          ? 'Pop both earbuds in for full stereo depth, as we weave'
          : 'With both earbuds gently sealed in, we have woven';
      bodyText = lead.endsWith(',')
        ? `${lead} so with both earbuds sealed in, we've woven a six-by-forty hertz trance rhythm right inside your ${spokenGenre}. Unclench your jaw... and let us take care of the rest.`
        : `${lead} ${earbudBridge} a six-by-forty hertz trance rhythm right inside your ${spokenGenre}. Unclench your jaw... and let us take care of the rest.`;
      bodyBucketKey = `full_${req.currentState}_trance6x40_${req.genre}${devSlug}`;
    } else if (req.targetState === 'sleep_winddown') {
      bodyText = lead.endsWith(',')
        ? `${lead} so we're guiding your mind down with a soft ${hz}-hertz sleep drift over ${spokenGenre}.${speakerCue} Close your eyes... and let go.`
        : `${lead}${joiner}'re guiding your mind down with a soft ${hz}-hertz sleep drift over ${spokenGenre}.${speakerCue} Close your eyes... and let go.`;
      bodyBucketKey = `full_${req.currentState}_sleep_${hz}_${req.genre}${devSlug}`;
    } else if (req.targetState === 'calm_reset') {
      bodyText = lead.endsWith(',')
        ? `${lead} so we've wrapped a soothing ${hz}-hertz calm wave inside your ${spokenGenre}.${speakerCue} Relax your shoulders... and let us take care of you.`
        : `${lead}${joiner}'ve wrapped a soothing ${hz}-hertz calm wave inside your ${spokenGenre}.${speakerCue} Relax your shoulders... and let us take care of you.`;
      bodyBucketKey = `full_${req.currentState}_calm_${hz}_${req.genre}${devSlug}`;
    } else {
      bodyText = lead.endsWith(',')
        ? `${lead} so we've blended a peer-reviewed ${hz}-hertz focus rhythm right inside your ${spokenGenre}.${speakerCue} Soften your gaze... and let us take care of the rest.`
        : `${lead}${joiner}'ve blended a peer-reviewed ${hz}-hertz focus rhythm right inside your ${spokenGenre}.${speakerCue} Soften your gaze... and let us take care of the rest.`;
      bodyBucketKey = `full_${req.currentState}_focus_${hz}_${req.genre}${devSlug}`;
    }
  }

  return {
    cueType: req.cueType,
    cleanFirstName,
    greetingText,
    bodyText,
    fullTranscript: `${greetingText} ${bodyText}`,
    greetingCacheSlug: greetingBucketKey.replace(/[^a-z0-9_-]/g, ''),
    bodyCacheSlug: bodyBucketKey.replace(/[^a-z0-9_-]/g, ''),
    breathPauseMs: req.cueType === 'intro_short' ? 180 : 250,
  };
}
