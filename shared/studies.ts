import type { ScientificStudy } from './types';

/**
 * Curated, real peer-reviewed scientific literature base.
 * Used for deterministic grounded RAG — zero fabricated medical citations.
 */
export const SCIENTIFIC_STUDIES: ScientificStudy[] = [
  {
    id: 'woods-2024-am-attention',
    authors: 'Woods, K. J. P., Sampaio, G., James, T., Przysinda, E., Spencer, A., Morillon, B., & Loui, P.',
    year: 2024,
    journal: 'Communications Biology (Nature Portfolio)',
    title: 'Rapid modulation in music supports attention in listeners with attentional difficulties',
    mechanism: 'Modulație rapidă de amplitudine (AM ~16 Hz, banda Beta) integrată în muzică instrumentală',
    summaryRo:
      'Muzica instrumentală cu modulații rapide de amplitudine (~16 Hz) a îmbunătățit atenția susținută și a activat rețelele executiv-saliency, în special la ascultătorii predispuși la distragere.',
    caveatRo:
      'Efectul depinde de toleranța individuală la adâncimea modulației; reglarea personalizată optimizează confortul și retenția.',
    doiOrUrl: 'https://doi.org/10.1038/s42003-024-07026-3',
    applicableTargets: ['alert_focus', 'deep_flow', 'energy_lift'],
  },
  {
    id: 'soderlund-2010-stochastic-noise',
    authors: 'Söderlund, G. B. W., Sikström, S., Loftesnes, J. M., & Sonuga-Barke, E. J.',
    year: 2010,
    journal: 'Behavioral and Brain Functions',
    title: 'The effects of background white noise on memory performance in inattentive school children',
    mechanism: 'Rezonanță stocastică — zgomot calibrat de bandă largă (pink/white noise) la nivel moderat',
    summaryRo:
      'Un nivel moderat de zgomot ambiental calibrat poate ridica nivelul optim de activare corticală (arousal) la persoanele distrate sau sub-stimulate, ajutând performanța cognitivă.',
    caveatRo:
      'La volan, zgomotul trebuie menținut discret și filtrat ca să nu mascheze semnalele acustice din trafic (sirene, claxoane).',
    doiOrUrl: 'https://doi.org/10.1186/1744-9081-6-55',
    applicableTargets: ['alert_focus', 'deep_flow'],
  },
  {
    id: 'unal-2013-driving-audio',
    authors: 'Ünal, A. B., de Waard, D., Epstude, K., & Steg, L.',
    year: 2013,
    journal: 'Transportation Research Part F: Traffic Psychology and Behaviour',
    title: 'Driving with music: Effects on arousal and performance',
    mechanism: 'Reglarea vigilentei la volan prin tempo moderat, fără suprasolicitare cognitivă și fără monotonie hipnotică',
    summaryRo:
      'Audio-ul ales corect la volan ajută șoferii să își regleze nivelul de vigilență în condiții monotone fără să compromită performanța de condus, cu condiția să nu fie agresiv sau distractiv.',
    caveatRo:
      'Sunetul NU înlocuiește somnul sau pauza obligatorie; se redă exclusiv pe difuzoarele vehiculului, lăsând libere frecvențele de trafic.',
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
    mechanism: 'Eliminarea versurilor și a schimbărilor vocale bruște pentru reducerea încărcării memoriei de lucru',
    summaryRo:
      'Muzica cu versuri concurează cu procesarea verbală și atenția executivă; texturile pur instrumentale cu structură predictibilă reduc semnificativ interferența cognitivă.',
    caveatRo:
      'Predictibilitatea nu trebuie dusă până la monotonie absolută atunci când utilizatorul este deja obosit.',
    doiOrUrl: 'https://doi.org/10.1002/acp.2994',
    applicableTargets: ['alert_focus', 'deep_flow'],
  },
  {
    id: 'heiderscheit-2015-iso-principle',
    authors: 'Heiderscheit, A., & Madson, A.',
    year: 2015,
    journal: 'Music Therapy Perspectives',
    title: 'Use of the Iso Principle as a Central Method in Mood Management: A Music Psychotherapy Clinical Case Study',
    mechanism: 'Principiul Iso — aliniere inițială cu starea curentă, urmată de tranziție graduală spre starea țintă',
    summaryRo:
      'Schimbarea stării mentale funcționează mai eficient când sunetul pornește aproape de nivelul curent de agitație/energie și ghidează progresiv ascultătorul pe durata sesiunii.',
    caveatRo:
      'Durata fazei de tranziție diferă de la persoană la persoană; o ajustăm din semnalele tale comportamentale.',
    doiOrUrl: 'https://doi.org/10.1093/mtp/miu042',
    applicableTargets: ['alert_focus', 'deep_flow', 'calm_reset', 'energy_lift', 'sleep_winddown'],
  },
  {
    id: 'thoma-2013-music-stress-hpa',
    authors: 'Thoma, M. V., La Marca, R., Brönnimann, R., Finkel, L., Ehlert, U., & Nater, U. M.',
    year: 2013,
    journal: 'PLOS ONE',
    title: 'The Effect of Music on the Human Stress Response',
    mechanism: 'Armonii lente, non-ritmice (~60 BPM) și sunete naturale pentru recuperarea sistemului nervos autonom',
    summaryRo:
      'Ascultarea de audio relaxant înainte sau după factori de stres accelerează recuperarea autonomă (sistemul parasimpatic) și scade stresul perceput.',
    caveatRo:
      'Recomandat doar în medii sigure (nu la volan, unde relaxarea profundă poate scădea vigilența).',
    doiOrUrl: 'https://doi.org/10.1371/journal.pone.0070156',
    applicableTargets: ['calm_reset', 'sleep_winddown'],
  },
  {
    id: 'garcia-argibay-2019-binaural-meta',
    authors: 'Garcia-Argibay, M., Santed, M. A., & Reales, J. M.',
    year: 2019,
    journal: 'Psychological Research',
    title: 'Efficacy of binaural auditory beats in cognition, anxiety, and pain perception: a meta-analysis',
    mechanism: 'Analiză comparativă: bătaia binaurală necesită căști și are efecte modeste față de antrenamentul AM pe difuzoare',
    summaryRo:
      'Meta-analiza arată efecte modeste și dependente de context ale bătăilor binaurale (strict cu căști); de aceea nootropic.fm prioritizează modulația de amplitudine (AM), care funcționează și pe boxe.',
    caveatRo:
      'Binaural beats sunt dezactivate complet pe difuzoare sau la volan și folosite doar opțional, subtil, pe căști.',
    doiOrUrl: 'https://doi.org/10.1007/s00426-018-1066-8',
    applicableTargets: ['deep_flow', 'calm_reset', 'sleep_winddown'],
  },
];

export function getStudiesByIds(ids: string[]): ScientificStudy[] {
  const map = new Map(SCIENTIFIC_STUDIES.map((s) => [s.id, s]));
  return ids.map((id) => map.get(id)).filter((s): s is ScientificStudy => Boolean(s));
}
