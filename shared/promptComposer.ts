import type {
  AcousticParams,
  EnergyTier,
  HarmonicMode,
  NoiseSensitivity,
  ResolvedGenre,
  TargetState,
} from './types';
import { GENRE_META } from './types';

export interface SanitizedCustomVibe {
  slug: string;
  displayLabel: string;
  rejectedReason?: string;
}

const CORE_GENRE_KEYS = new Set<string>(Object.keys(GENRE_META));

/**
 * Common non-native / phonetic spellings & typos mapped to canonical instrumental genres
 * so users typing "reghe", "regee", "clasical", "techo", "bosanova", "ploaie" always hit
 * the exact right R2 cached track or clean Lyria prompt.
 */
const GENRE_TYPO_ALIASES: Record<string, string> = {
  reghe: 'reggae',
  regee: 'reggae',
  regea: 'reggae',
  regae: 'reggae',
  regga: 'reggae',
  reggay: 'reggae',
  reggie: 'reggae',
  raggae: 'reggae',
  'chill reghe': 'chill reggae',
  'dub reghe': 'dub reggae',
  bosanova: 'bossa nova',
  'bosa nova': 'bossa nova',
  techo: 'techno',
  tekno: 'techno',
  tehno: 'techno',
  clasical: 'classical',
  clasic: 'classical',
  clasica: 'classical',
  sintwave: 'synthwave',
  sinthwave: 'synthwave',
  synth: 'synthwave',
  hiphop: 'hip hop',
  'hip-hop': 'hip hop',
  jaz: 'jazz',
  acustic: 'acoustic',
  acustica: 'acoustic',
  rok: 'rock',
  lofi: 'lo-fi',
  'lo fi': 'lo-fi',
  ploaie: 'nature rain',
  'sunet de ploaie': 'nature rain',
  'sunete de ploaie': 'nature rain',
  'rain sounds': 'nature rain',
};

/**
 * If a user types a built-in Studio R2 genre (e.g. "rain", "ploaie", "nature rain", "lo-fi")
 * into the Custom Vibe field, map it straight to our instant Studio R2 genre instead of wasting
 * a custom AI generation slot.
 */
export function matchCoreGenreAlias(rawInput: string | undefined | null): ResolvedGenre | null {
  if (!rawInput) return null;
  const norm = rawInput
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return null;
  const canonical = GENRE_TYPO_ALIASES[norm] ?? norm;

  if (/^(nootropicfm|nootropicfm mode|nootropic fm|nootropic fm mode|nootropic mode|tunnel vision|hypnotic trance|trance lock)$/.test(canonical)) {
    return 'nootropic_trance';
  }
  if (/^(rain|nature|nature rain|nature & rain|nature and rain|soft rain|rain piano|rain & piano|ploaie|soft rain & nature)$/.test(canonical)) {
    return 'nature_rain';
  }
  if (/^(lo-fi|lofi|lofi keys|lo-fi keys|lo-fi warm keys|lo-fi beats|lofi beats|chill lofi|chill lo-fi)$/.test(canonical)) {
    return 'lofi_keys';
  }
  if (/^(deep electronic|electronic|upbeat electronic)$/.test(canonical)) {
    return 'deep_electronic';
  }
  if (/^(jazz|jazz rhodes|rhodes|warm jazz|late-night jazz|late night jazz)$/.test(canonical)) {
    return 'jazz_rhodes';
  }
  if (/^(acoustic|acoustic pluck|acoustic guitar|warm guitar|warm acoustic)$/.test(canonical)) {
    return 'acoustic_pluck';
  }
  if (/^(classical|classical & strings|classical strings|cinematic strings|cinematic)$/.test(canonical)) {
    return 'cinematic_strings';
  }
  if (/^(reggae|dub reggae|chill reggae|dub)$/.test(canonical)) {
    return 'dub_reggae';
  }
  if (/^(ambient|ambient space|ambient & space|space ambient|deep space|space)$/.test(canonical)) {
    return 'ambient_space';
  }
  if (/^(piano|solo piano|felt piano|solo felt piano|neoclassical piano|classical piano)$/.test(canonical)) {
    return 'solo_piano';
  }
  if (/^(bossa|bossa nova|brazilian jazz)$/.test(canonical)) {
    return 'bossa_nova';
  }
  return null;
}

const FORBIDDEN_PATTERNS = [
  /\b(lyrics?|vocals?|singing|singer|rap|rapper|spoken\s*word|speech|choir|chant|scream|shout)\b/i,
  /\b(ignore\s+previous|system\s+prompt|jailbreak|override|http:\/\/|https:\/\/)\b/i,
  /\b(drake|taylor\s*swift|beyonce|eminem|billie\s*eilish|weeknd|bad\s*bunny|kanye|rihanna|bob\s*marley|hans\s*zimmer|daft\s*punk|beatles|coldplay|radiohead|nirvana|metallica|pink\s*floyd)\b/i,
];

function toTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Sanitizes and canonicalizes any free-form user vibe (e.g., "chill reggae" -> "chill_reggae",
 * "reghe" -> "reggae"). Rejects vocal/lyric requests, prompt injections, and artist names.
 */
export function sanitizeCustomVibe(rawInput: string | undefined | null): SanitizedCustomVibe | null {
  if (!rawInput) return null;
  const cleanedRaw = rawInput
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);

  if (cleanedRaw.length < 2) return null;

  const lower = cleanedRaw.toLowerCase();
  const cleaned = GENRE_TYPO_ALIASES[lower] ?? cleanedRaw;

  for (const rx of FORBIDDEN_PATTERNS) {
    if (rx.test(cleaned)) {
      return {
        slug: '',
        displayLabel: '',
        rejectedReason:
          'Custom vibes must be purely instrumental genres (no vocals, artist names, or URLs).',
      };
    }
  }

  const slug = cleaned
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);

  if (slug.length < 2) return null;

  return {
    slug,
    displayLabel: toTitleCase(cleaned),
  };
}

/**
 * Maps any custom genre slug to the closest of our 6 instant R2 Studio genres
 * so playback starts in <0.5s while the custom vibe generates in the background.
 */
export function pickClosestCoreGenre(slug: string, energyTier: EnergyTier): ResolvedGenre {
  const s = slug.toLowerCase();
  if (CORE_GENRE_KEYS.has(s)) return s as ResolvedGenre;

  if (/(rain|ocean|forest|nature|water|wind)/.test(s)) {
    return 'nature_rain';
  }
  if (/(space|ambient|sleep|zen|meditat|drone|tibetan|bowl|spa)/.test(s)) {
    return 'ambient_space';
  }
  if (/(reggae|dub)/.test(s)) {
    return 'dub_reggae';
  }
  if (/(bossa)/.test(s)) {
    return 'bossa_nova';
  }
  if (/(piano|felt_piano|keys)/.test(s)) {
    return 'solo_piano';
  }
  if (/(synthwave|techno|house|trance|edm|dnb|drum_and_bass|cyberpunk|electro|dubstep|progressive|minimal|vaporwave|retrowave)/.test(s)) {
    return 'deep_electronic';
  }
  if (/(classical|orchestra|cello|violin|neoclassical|ambient_film|cinematic|epic|baroque|score|strings)/.test(s)) {
    return 'cinematic_strings';
  }
  if (/(jazz|rhodes|soul|funk|neo_soul|lounge|blues|swing|smooth)/.test(s)) {
    return 'jazz_rhodes';
  }
  if (/(acoustic|folk|guitar|flamenco|harp|koto|sitar|kalimba|ukulele|indie_folk|celtic|country)/.test(s)) {
    return 'acoustic_pluck';
  }
  if (/(chillhop|lofi|lo_fi|hip_hop|boom_bap|downtempo|trip_hop|afrobeat)/.test(s)) {
    return energyTier === 'drive' ? 'deep_electronic' : 'lofi_keys';
  }

  if (energyTier === 'calm') return 'nature_rain';
  if (energyTier === 'drive') return 'deep_electronic';
  return 'lofi_keys';
}

export function getGenreDisplayMeta(
  genreSlug: string,
  customLabel?: string | null
): { label: string; shortDesc: string; vibeTag: string; isCustom: boolean } {
  if (genreSlug in GENRE_META) {
    const core = GENRE_META[genreSlug as ResolvedGenre];
    return { ...core, isCustom: false };
  }
  const label =
    customLabel?.trim() ||
    toTitleCase(genreSlug.replace(/^custom\//, '').replace(/[_-]+/g, ' '));
  return {
    label,
    shortDesc: 'Custom instrumental vibe · Community R2 Cache',
    vibeTag: 'Custom · Lyric-Free · 3-Band LR4',
    isCustom: true,
  };
}

const HARMONIC_DESCRIPTORS: Record<HarmonicMode, string> = {
  bright_maj9: 'uplifting warm major-9th harmonies in D major',
  warm_min9: 'grounded cozy minor-9th harmonies in A minor',
  suspended_open: 'spacious open suspended chords in C major',
  deep_drone: 'ultra-warm low-frequency harmonic drone in G major',
};

/**
 * Deterministic ($0) Scientific Prompt Composer (Layer 1 Studies -> Layer 2 Music Prompt).
 * Guarantees instrumental lyric-free aesthetic aligned with target BPM, energy tier, and safety EQ.
 * Note: Exact neuro-modulation (14-18 Hz / 10 Hz / 6 Hz) is ALWAYS applied mathematically by our
 * 3-Band Linkwitz-Riley (LR4) DSP engine — never claimed from the text prompt alone.
 */
export function composeScientificMusicPrompt(input: {
  customGenreLabel: string;
  energyTier: EnergyTier;
  targetState: TargetState;
  params: Pick<AcousticParams, 'bpm' | 'harmonicMode' | 'speakerSafeEQ'>;
  noiseSensitivity: NoiseSensitivity;
}): string {
  const { customGenreLabel, energyTier, targetState, params, noiseSensitivity } = input;
  const harmonicDesc = HARMONIC_DESCRIPTORS[params.harmonicMode];

  const tempoClause =
    targetState === 'sleep_winddown' || energyTier === 'calm'
      ? 'beatless or ultra-slow 62-70 BPM pulse with zero harsh drums'
      : params.bpm > 0
        ? `steady continuous ${params.bpm} BPM rhythmic groove`
        : 'steady hypnotic 92 BPM rhythmic pulse';

  const textureClause =
    noiseSensitivity === 'high'
      ? 'velvety warm low-pass mastering with zero piercing highs or harsh percussion'
      : params.speakerSafeEQ
        ? 'clear warm studio mastering with open mid-range space, no siren-like synths, no startling horn blasts, and smooth forward momentum suitable for vehicle speakers'
        : 'rich warm analog studio production with solid clean sub-bass and smooth mid-range body';

  const goalClause =
    targetState === 'sleep_winddown'
      ? 'designed for tranquil nocturnal pre-sleep decompression'
      : targetState === 'calm_reset'
        ? 'designed for parasympathetic stress recovery and calm clarity'
        : targetState === 'deep_flow'
          ? 'designed for uninterrupted deep work and sustained cognitive flow'
          : targetState === 'energy_lift'
            ? 'designed for clean mental alertness and afternoon clarity'
            : 'designed for steady sustained executive attention';

  return [
    `Strictly instrumental ${customGenreLabel} music track. Instrumental only, no vocals, no lyrics.`,
    `Authentic studio ${customGenreLabel} instrumentation with ${tempoClause}, ${harmonicDesc}, and ${textureClause}.`,
    `Carve subtle warm space in the 1.2-2.8 kHz inner-voice thinking band with soft analog harmonics and zero harsh transients below 10 ms.`,
    `[0:00 - 0:20] Decompression Intro: Warm airlock pad with clean sub-bass entering softly to clear mental static.`,
    `[0:20 - 1:15] Hypnotic Ignition Groove: Syncopated forward pocket pulse with 85% steady familiarity and 15% organic melodic drift, ${goalClause}.`,
    `[1:15 - 1:45] Striatal Rise & Flow-Lock Drop: Gentle suspended filter swell resolving cleanly onto the root chord on Beat 1.`,
    `[1:45 - 2:00] Outro: Seamless warm instrumental resolution ideal for continuous looping.`,
    `Instrumental only, strictly no vocals, no singing, no humming, no choir, no spoken words.`,
  ].join(' ');
}
