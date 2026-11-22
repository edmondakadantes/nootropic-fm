import type { ScientificStudy } from './types';

/**
 * Curated, peer-reviewed scientific literature base.
 * Used for grounded, transparent protocol citations — zero fabricated references.
 */
export const SCIENTIFIC_STUDIES: ScientificStudy[] = [
  {
    id: 'woods-2024-am-attention',
    authors: 'Woods, K. J. P., Sampaio, G., James, T., Przysinda, E., Spencer, A., Morillon, B., & Loui, P.',
    year: 2024,
    journal: 'Communications Biology (Nature Portfolio)',
    title: 'Rapid modulation in music supports attention in listeners with attentional difficulties',
    mechanism: 'Rapid amplitude modulation (AM ~16 Hz, Beta band) embedded within instrumental music',
    summary:
      'Instrumental music embedded with rapid amplitude modulation (~16 Hz) improved sustained attention and engaged executive-salience networks, particularly in listeners prone to attentional distraction.',
    caveat:
      'Individual sensitivity to modulation depth varies; personalized feedback calibrates comfort and effectiveness.',
    doiOrUrl: 'https://doi.org/10.1038/s42003-024-07026-3',
    applicableTargets: ['alert_focus', 'deep_flow', 'energy_lift'],
  },
  {
    id: 'soderlund-2010-stochastic-noise',
    authors: 'Söderlund, G. B. W., Sikström, S., Loftesnes, J. M., & Sonuga-Barke, E. J.',
    year: 2010,
    journal: 'Behavioral and Brain Functions',
    title: 'The effects of background white noise on memory performance in inattentive school children',
    mechanism: 'Stochastic resonance — moderate calibrated broadband colored noise (pink/white)',
    summary:
      'Moderate calibrated background noise can help regulate optimal cortical arousal in distracted or under-stimulated listeners, supporting cognitive performance.',
    caveat:
      'While driving, background noise is strictly capped and frequency-shaped so external traffic cues (sirens, horns) remain clearly audible.',
    doiOrUrl: 'https://doi.org/10.1186/1744-9081-6-55',
    applicableTargets: ['alert_focus', 'deep_flow'],
  },
  {
    id: 'unal-2013-driving-audio',
    authors: 'Ünal, A. B., de Waard, D., Epstude, K., & Steg, L.',
    year: 2013,
    journal: 'Transportation Research Part F: Traffic Psychology and Behaviour',
    title: 'Driving with music: Effects on arousal and performance',
    mechanism: 'Regulating driving vigilance via moderate tempo, low cognitive load, and anti-monotony variation',
    summary:
      'Appropriately calibrated in-vehicle audio helps drivers maintain healthy arousal in monotonous road conditions without impairing driving performance, provided it avoids aggressive or distracting elements.',
    caveat:
      'Audio never replaces sleep or rest stops; always play through vehicle speakers (never headphones) while keeping ambient traffic frequencies open.',
    doiOrUrl: 'https://doi.org/10.1016/j.trf.2013.09.004',
    applicableTargets: ['alert_focus', 'energy_lift'],
    applicableEnvironments: ['driving'],
  },
  {
    id: 'perham-2014-lyric-interference',
    authors: 'Perham, N., & Currie, H.',
    year: 2014,
    journal: 'Applied Cognitive Psychology',
    title: 'Does listening to preferred music improve reading comprehension performance?',
    mechanism: 'Lyric-free, predictable instrumental architecture minimizing phonological working-memory interference',
    summary:
      'Music containing lyrics competes with verbal processing and executive attention; purely instrumental, structured soundscapes significantly reduce cognitive load.',
    caveat:
      'Predictability is balanced with gentle micro-variations when fatigue is present to prevent drowsiness.',
    doiOrUrl: 'https://doi.org/10.1002/acp.2994',
    applicableTargets: ['alert_focus', 'deep_flow'],
  },
  {
    id: 'heiderscheit-2015-iso-principle',
    authors: 'Heiderscheit, A., & Madson, A.',
    year: 2015,
    journal: 'Music Therapy Perspectives',
    title: 'Use of the Iso Principle as a Central Method in Mood Management: A Music Psychotherapy Clinical Case Study',
    mechanism: 'Iso-Principle — initially matching current arousal before gradually guiding toward the target state',
    summary:
      'Mental state transitions are more effective when audio starts closer to the listener’s current state and smoothly entrains toward the target intensity across the session duration.',
    caveat:
      'Optimal transition pacing varies individually and adapts over time from your live session signals.',
    doiOrUrl: 'https://doi.org/10.1093/mtp/miu042',
    applicableTargets: ['alert_focus', 'deep_flow', 'calm_reset', 'energy_lift', 'sleep_winddown'],
  },
  {
    id: 'thoma-2013-music-stress-hpa',
    authors: 'Thoma, M. V., La Marca, R., Brönnimann, R., Finkel, L., Ehlert, U., & Nater, U. M.',
    year: 2013,
    journal: 'PLOS ONE',
    title: 'The Effect of Music on the Human Stress Response',
    mechanism: 'Slow, non-percussive harmonies (~60 BPM) and organic textures supporting autonomic recovery',
    summary:
      'Listening to calming acoustic textures accelerates autonomic nervous system recovery (parasympathetic activation) and lowers perceived stress.',
    caveat:
      'Intended only in safe, stationary environments — automatically disabled in Driving Safety Mode.',
    doiOrUrl: 'https://doi.org/10.1371/journal.pone.0070156',
    applicableTargets: ['calm_reset', 'sleep_winddown'],
  },
  {
    id: 'garcia-argibay-2019-binaural-meta',
    authors: 'Garcia-Argibay, M., Santed, M. A., & Reales, J. M.',
    year: 2019,
    journal: 'Psychological Research',
    title: 'Efficacy of binaural auditory beats in cognition, anxiety, and pain perception: a meta-analysis',
    mechanism: 'Comparative meta-analysis: binaural beats require headphones and show modest context-dependent effects',
    summary:
      'Meta-analytic evidence shows modest, headphone-dependent effects for binaural beats; therefore nootropic.fm prioritizes amplitude modulation (AM), which also works reliably on speakers.',
    caveat:
      'Binaural offsets are strictly disabled on speakers or while driving, and kept ultra-subtle on headphones.',
    doiOrUrl: 'https://doi.org/10.1007/s00426-018-1066-8',
    applicableTargets: ['deep_flow', 'calm_reset', 'sleep_winddown'],
  },
];

export function getStudiesByIds(ids: string[]): ScientificStudy[] {
  const map = new Map(SCIENTIFIC_STUDIES.map((s) => [s.id, s]));
  return ids.map((id) => map.get(id)).filter((s): s is ScientificStudy => Boolean(s));
}
