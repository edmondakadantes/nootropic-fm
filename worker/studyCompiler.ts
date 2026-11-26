import {
  EUROPEPMC_HUMAN_AUDITORY_EXCLUSION,
  appendPubMedHumanAuditoryGuard,
  isNonAuditoryOrAnimalStudy,
} from '../shared/openGoals';
import {
  applySafetyAndDeviceGuardrails,
  compileStudyTextDeterministically,
  verifyAndMergeAiExtraction,
  type AiExtractedStudyPatch,
} from '../shared/studyCompilerCore';
import { getPresetStudySpecById, VERIFIED_STUDY_PRESETS } from '../shared/studyPresets';
import type { ExecutableStudySpec, StudyReferenceMeta } from '../shared/studySpec';
import type { OutputDevice, ResolvedGenre, SessionEnvironment } from '../shared/types';
import type { D1Database, Env } from './env';

const STUDY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in D1

export interface LiveStudySearchResult {
  id: string;
  source: 'core' | 'pubmed' | 'europepmc' | 'clinicaltrials';
  title: string;
  authors: string;
  journal: string;
  year: string;
  url: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  nctId?: string;
  abstractText: string;
  hasFullAbstract: boolean;
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? stripXmlTags(m[1]) : '';
}

function extractAllXmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const cleaned = stripXmlTags(m[1]);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/**
 * Fetches full PubMed article title, authors, journal, year, DOI, and complete AbstractText via NIH efetch XML.
 */
async function fetchPubMedFullByPmid(
  env: Env,
  pmid: string
): Promise<{ ref: StudyReferenceMeta; fullText: string } | null> {
  const cleanId = pmid.replace(/[^0-9]/g, '');
  if (!cleanId) return null;
  const apiKeyParam = env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(env.NCBI_API_KEY)}` : '';
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${cleanId}&retmode=xml${apiKeyParam}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      headers: { 'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)' },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const title = extractXmlTag(xml, 'ArticleTitle').replace(/\.$/, '');
    if (!title) return null;

    const abstractParts = extractAllXmlTags(xml, 'AbstractText');
    const abstractText = abstractParts.join(' ');
    const journal = extractXmlTag(xml, 'Title') || extractXmlTag(xml, 'ISOAbbreviation') || 'PubMed Indexed Journal';
    const yearMatch = xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/i) || xml.match(/<Year>(\d{4})<\/Year>/i);
    const year = yearMatch ? yearMatch[1] : 'Peer-Reviewed';

    const lastNames = extractAllXmlTags(xml, 'LastName');
    const authors =
      lastNames.length > 1
        ? `${lastNames[0]} et al.`
        : lastNames[0] || 'Research Team';

    const doiMatch = xml.match(/<ArticleId\s+IdType="doi"[^>]*>([^<]+)<\/ArticleId>/i);
    const pmcMatch = xml.match(/<ArticleId\s+IdType="pmc"[^>]*>([^<]+)<\/ArticleId>/i);
    const doi = doiMatch ? doiMatch[1].trim() : undefined;
    const pmcid = pmcMatch ? pmcMatch[1].trim() : undefined;

    let methodsExtra = '';
    if (pmcid) {
      methodsExtra = await fetchEuropePmcMethodsSnippet(pmcid);
    }

    return {
      ref: {
        title,
        authors,
        year,
        journal,
        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${cleanId}/`,
        doi,
        pmid: cleanId,
        pmcid,
        source: 'pubmed',
      },
      fullText: [abstractText, methodsExtra].filter(Boolean).join(' '),
    };
  } catch {
    return null;
  }
}

/**
 * Fetches Open-Access Methods section excerpt from Europe PMC full-text XML when a PMCID is available.
 */
async function fetchEuropePmcMethodsSnippet(pmcid: string): Promise<string> {
  const cleanPmc = pmcid.toUpperCase().startsWith('PMC') ? pmcid.toUpperCase() : `PMC${pmcid}`;
  try {
    const res = await fetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(cleanPmc)}/fullTextXML`,
      {
        signal: AbortSignal.timeout(3500),
        headers: { 'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)' },
      }
    );
    if (!res.ok) return '';
    const xml = await res.text();
    // Extract Methods / Stimuli / Auditory section only (keeps CPU tiny for Workers Free Tier!)
    const secRegex = /<sec[^>]*>[\s\S]*?<title[^>]*>([^<]*(?:method|stimul|audio|music|acoustic|procedure|protocol|intervention)[^<]*)<\/title>([\s\S]{80,6000}?)<\/sec>/gi;
    const chunks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = secRegex.exec(xml)) !== null && chunks.length < 2) {
      chunks.push(stripXmlTags(m[2]).slice(0, 1400));
    }
    return chunks.join(' ').slice(0, 2400);
  } catch {
    return '';
  }
}

/**
 * Fetches full study metadata + abstract from Europe PMC REST API (free, no key) by DOI or query.
 */
async function fetchEuropePmcByQuery(
  query: string,
  pageSize = 6
): Promise<LiveStudySearchResult[]> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&pageSize=${pageSize}&format=json`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5500),
      headers: {
        accept: 'application/json',
        'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          id?: string;
          pmid?: string;
          pmcid?: string;
          doi?: string;
          title?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
          abstractText?: string;
        }>;
      };
    };

    const out: LiveStudySearchResult[] = [];
    for (const r of data.resultList?.result ?? []) {
      if (!r.title) continue;
      const cleanTitle = stripXmlTags(r.title).replace(/\.$/, '');
      const cleanAbstract = r.abstractText ? stripXmlTags(r.abstractText) : '';
      const doiUrl = r.doi ? `https://doi.org/${r.doi.replace(/^https?:\/\/doi\.org\//i, '')}` : undefined;
      const urlFinal =
        doiUrl ??
        (r.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
          : `https://europepmc.org/article/MED/${r.id ?? ''}`);
      out.push({
        id: r.pmid ? `pmid:${r.pmid}` : r.doi ? `doi:${r.doi}` : `epmc:${r.id ?? cleanTitle.slice(0, 24)}`,
        source: 'europepmc',
        title: cleanTitle,
        authors: (r.authorString ?? 'Research Team').split(',').slice(0, 2).join(', '),
        journal: r.journalTitle ?? 'Europe PMC Indexed Journal',
        year: r.pubYear ?? 'Peer-Reviewed',
        url: urlFinal,
        doi: r.doi,
        pmid: r.pmid,
        pmcid: r.pmcid,
        abstractText: cleanAbstract,
        hasFullAbstract: cleanAbstract.length > 60,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fetches ClinicalTrials.gov v2 study (free, no key) by NCT ID or search term.
 */
async function fetchClinicalTrialByNct(
  nctId: string
): Promise<{ ref: StudyReferenceMeta; fullText: string } | null> {
  const cleanNct = nctId.toUpperCase().match(/NCT\d{6,10}/)?.[0];
  if (!cleanNct) return null;
  try {
    const res = await fetch(`https://clinicaltrials.gov/api/v2/studies/${cleanNct}`, {
      signal: AbortSignal.timeout(4000),
      headers: {
        accept: 'application/json',
        'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      protocolSection?: {
        identificationModule?: { briefTitle?: string; officialTitle?: string; organization?: { fullName?: string } };
        statusModule?: { startDateStruct?: { date?: string } };
        descriptionModule?: { briefSummary?: string; detailedDescription?: string };
        armsInterventionsModule?: {
          interventions?: Array<{ name?: string; description?: string }>;
        };
      };
    };
    const p = data.protocolSection;
    const title = p?.identificationModule?.briefTitle || p?.identificationModule?.officialTitle;
    if (!title) return null;
    const year = p?.statusModule?.startDateStruct?.date?.slice(0, 4) || 'Clinical Trial';
    const org = p?.identificationModule?.organization?.fullName || 'ClinicalTrials.gov';
    const interventions = (p?.armsInterventionsModule?.interventions ?? [])
      .map((i) => `${i.name ?? ''}: ${i.description ?? ''}`.trim())
      .join(' ');
    const fullText = [
      p?.descriptionModule?.briefSummary ?? '',
      p?.descriptionModule?.detailedDescription ?? '',
      interventions,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      ref: {
        title,
        authors: org,
        year,
        journal: `ClinicalTrials.gov · ${cleanNct}`,
        url: `https://clinicaltrials.gov/study/${cleanNct}`,
        nctId: cleanNct,
        source: 'clinicaltrials',
      },
      fullText,
    };
  } catch {
    return null;
  }
}

async function searchClinicalTrials(query: string, limit = 2): Promise<LiveStudySearchResult[]> {
  try {
    const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=${limit}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3500),
      headers: { accept: 'application/json', 'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      studies?: Array<{
        protocolSection?: {
          identificationModule?: { nctId?: string; briefTitle?: string; organization?: { fullName?: string } };
          statusModule?: { startDateStruct?: { date?: string } };
          descriptionModule?: { briefSummary?: string };
          armsInterventionsModule?: { interventions?: Array<{ name?: string; description?: string }> };
        };
      }>;
    };
    const out: LiveStudySearchResult[] = [];
    for (const st of data.studies ?? []) {
      const idMod = st.protocolSection?.identificationModule;
      if (!idMod?.nctId || !idMod?.briefTitle) continue;
      const desc = st.protocolSection?.descriptionModule?.briefSummary ?? '';
      const intr = (st.protocolSection?.armsInterventionsModule?.interventions ?? [])
        .map((i) => `${i.name ?? ''} ${i.description ?? ''}`)
        .join(' ');
      const abstractText = `${desc} ${intr}`.replace(/\s+/g, ' ').trim();
      out.push({
        id: `nct:${idMod.nctId}`,
        source: 'clinicaltrials',
        title: idMod.briefTitle,
        authors: idMod.organization?.fullName ?? 'Clinical Trial',
        journal: `ClinicalTrials.gov · ${idMod.nctId}`,
        year: st.protocolSection?.statusModule?.startDateStruct?.date?.slice(0, 4) ?? 'Trial',
        url: `https://clinicaltrials.gov/study/${idMod.nctId}`,
        nctId: idMod.nctId,
        abstractText,
        hasFullAbstract: abstractText.length > 40,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fast NIH PubMed search (esearch -> single batched efetch XML) returning full titles, abstracts, journals & DOIs
 * without bursting NCBI's 3 req/sec unkeyed rate limit.
 */
async function searchPubMedDirect(env: Env, query: string, maxResults = 3): Promise<LiveStudySearchResult[]> {
  const apiKeyParam = env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(env.NCBI_API_KEY)}` : '';
  try {
    const searchRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&sort=relevance&term=${encodeURIComponent(query)}${apiKeyParam}`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { 'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)' },
      }
    );
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const cleanIds = (searchData.esearchresult?.idlist ?? [])
      .map((id) => id.replace(/[^0-9]/g, ''))
      .filter(Boolean)
      .slice(0, maxResults);
    if (cleanIds.length === 0) return [];

    const efetchRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${cleanIds.join(',')}&retmode=xml${apiKeyParam}`,
      {
        signal: AbortSignal.timeout(4500),
        headers: { 'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)' },
      }
    );
    if (!efetchRes.ok) return [];
    const batchXml = await efetchRes.text();
    const articleBlocks = batchXml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi) ?? [batchXml];

    const out: LiveStudySearchResult[] = [];
    for (const xml of articleBlocks) {
      const title = extractXmlTag(xml, 'ArticleTitle').replace(/\.$/, '');
      if (!title) continue;
      const pmid = extractXmlTag(xml, 'PMID') || undefined;
      const abstractText = extractAllXmlTags(xml, 'AbstractText').join(' ');
      const journal =
        extractXmlTag(xml, 'Title') ||
        extractXmlTag(xml, 'ISOAbbreviation') ||
        'PubMed Indexed Journal';
      const yearMatch =
        xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/i) || xml.match(/<Year>(\d{4})<\/Year>/i);
      const year = yearMatch ? yearMatch[1] : 'Peer-Reviewed';
      const lastNames = extractAllXmlTags(xml, 'LastName');
      const authors =
        lastNames.length > 1 ? `${lastNames[0]} et al.` : lastNames[0] || 'Research Team';
      const doiMatch = xml.match(/<ArticleId\s+IdType="doi"[^>]*>([^<]+)<\/ArticleId>/i);
      const pmcMatch = xml.match(/<ArticleId\s+IdType="pmc"[^>]*>([^<]+)<\/ArticleId>/i);
      const doi = doiMatch ? doiMatch[1].trim() : undefined;
      const pmcid = pmcMatch ? pmcMatch[1].trim() : undefined;
      const url = doi
        ? `https://doi.org/${doi}`
        : pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
          : 'https://pubmed.ncbi.nlm.nih.gov/';

      out.push({
        id: pmid ? `pmid:${pmid}` : `pm:${title.slice(0, 24)}`,
        source: 'pubmed',
        title,
        authors,
        journal,
        year,
        url,
        doi,
        pmid,
        pmcid,
        abstractText,
        hasFullAbstract: abstractText.length > 60,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Live search across Europe PMC (MEDLINE/OA abstracts), NIH PubMed direct efetch, and ClinicalTrials.gov v2.
 */
export async function searchLiveMedicalStudies(
  env: Env,
  rawQuery: string,
  opts?: { skipNcbiDirect?: boolean }
): Promise<LiveStudySearchResult[]> {
  const q = rawQuery.trim();
  if (!q) return [];

  const hasAcousticWord = /(music|sound|audio|auditory|noise|hz|bpm|binaural|isochronic|gamma|alpha|theta|beta|hrv|breath|acoustic|modulation|listening)/i.test(q);
  const cleanQuery = hasAcousticWord ? q : `${q} music auditory`;
  const epmcQuery = `(${cleanQuery}) ${EUROPEPMC_HUMAN_AUDITORY_EXCLUSION}`;
  const pubmedQuery = appendPubMedHumanAuditoryGuard(cleanQuery);

  const [epmc, pubmed, trials] = await Promise.all([
    fetchEuropePmcByQuery(epmcQuery, 8),
    opts?.skipNcbiDirect ? Promise.resolve([] as LiveStudySearchResult[]) : searchPubMedDirect(env, pubmedQuery, 5),
    searchClinicalTrials(cleanQuery, 3),
  ]);

  const seen = new Set<string>();
  const combined: LiveStudySearchResult[] = [];
  // Prioritize papers with real full abstracts (PubMed & Europe PMC first, then ClinicalTrials)
  const ordered = [...pubmed, ...epmc, ...trials].sort(
    (a, b) => Number(b.hasFullAbstract) - Number(a.hasFullAbstract)
  );
  for (const item of ordered) {
    if (isNonAuditoryOrAnimalStudy(item.title, item.abstractText)) continue;
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(item);
  }
  return combined.slice(0, 8);
}

/**
 * Tier 2 Grounded AI Enrichment using Cloudflare Workers AI Free Tier (10,000 Neurons/day = $0).
 * Strictly validates every extracted quote against `sourceText` — zero hallucinated parameters!
 */
async function runWorkersAiStudyExtractor(
  env: Env,
  title: string,
  sourceText: string
): Promise<AiExtractedStudyPatch | null> {
  if (!env.AI || sourceText.length < 80) return null;
  try {
    const truncated = sourceText.slice(0, 2600);
    const systemPrompt = `You are a precision psychoacoustic compiler. Read the provided scientific paper title and abstract/methods text and extract ONLY explicitly stated acoustic sound parameters as strict JSON.
NEVER invent parameters or quotes not present in the text. Every "studyQuote" MUST be an exact verbatim substring copied from the text.
Return ONLY valid JSON with optional keys:
{
  "entrainmentType": "none" | "amplitude_modulation" | "binaural_beat" | "monaural_beat" | "isochronic_pulse" | "gamma_40hz_clicks" | "theta_gamma_cfc" | "hrv_breathing_swell",
  "frequencyHz": number,
  "carrierLeftHz": number,
  "carrierRightHz": number,
  "modulationDepth": number (0.05 to 0.78),
  "bpm": number (0 for beatless, or 40 to 150),
  "bpmStart": number,
  "bpmEnd": number,
  "tonalMode": "major" | "minor" | "pentatonic" | "suspended" | "dorian" | "drone",
  "tuningA4Hz": 440 | 432,
  "percussion": "none" | "minimal_soft" | "steady_pulse",
  "noiseColor": "none" | "white" | "pink" | "brown" | "soft_rain",
  "snrDb": number (-30 to 0),
  "recommendedDurationMin": number (5 to 90),
  "evidenceQuotes": [{"parameter": string, "targetLabel": string, "executedValue": string, "studyQuote": string}]
}`;

    const aiRes = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Title: ${title}\n\nText: ${truncated}` },
      ],
      max_tokens: 550,
      temperature: 0.05,
    })) as { response?: string; choices?: Array<{ message?: { content?: string } }> };

    const rawOut =
      typeof aiRes?.response === 'string'
        ? aiRes.response
        : aiRes?.choices?.[0]?.message?.content ?? '';
    if (!rawOut) return null;

    const jsonStart = rawOut.indexOf('{');
    const jsonEnd = rawOut.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
    return JSON.parse(rawOut.slice(jsonStart, jsonEnd + 1)) as AiExtractedStudyPatch;
  } catch {
    return null;
  }
}

async function readCompiledStudyCache(
  db: D1Database,
  studyKey: string
): Promise<ExecutableStudySpec | null> {
  try {
    const row = await db
      .prepare('SELECT spec_json, expires_at FROM compiled_studies WHERE study_key = ?')
      .bind(studyKey)
      .first<{ spec_json: string; expires_at: string }>();
    if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
    await db
      .prepare('UPDATE compiled_studies SET execution_count = execution_count + 1 WHERE study_key = ?')
      .bind(studyKey)
      .run()
      .catch(() => {});
    return JSON.parse(row.spec_json) as ExecutableStudySpec;
  } catch {
    return null;
  }
}

async function writeCompiledStudyCache(
  db: D1Database,
  studyKey: string,
  spec: ExecutableStudySpec
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + STUDY_CACHE_TTL_MS).toISOString();
    await db
      .prepare(
        `INSERT INTO compiled_studies (study_key, source, title, spec_json, execution_count, created_at, expires_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(study_key) DO UPDATE SET
           spec_json = excluded.spec_json,
           execution_count = compiled_studies.execution_count + 1,
           expires_at = excluded.expires_at`
      )
      .bind(studyKey, spec.studyRef.source, spec.studyRef.title, JSON.stringify(spec), now, expiresAt)
      .run();
  } catch {
    // Non-fatal cache write
  }
}

/**
 * Universal Medical Study Compiler:
 * Accepts Preset ID, PubMed URL/PMID, DOI, ClinicalTrials NCT ID, search topic, OR pasted study abstract/methods.
 */
export async function compileMedicalStudy(
  env: Env,
  input: {
    queryOrText: string;
    presetId?: string;
    pmid?: string;
    doi?: string;
    nctId?: string;
    abstractOverride?: string;
    titleOverride?: string;
    device?: OutputDevice;
    environment?: SessionEnvironment;
    preferredGenre?: ResolvedGenre;
    skipNcbiDirect?: boolean;
  }
): Promise<{ spec: ExecutableStudySpec; fromCache: boolean }> {
  const raw = (input.queryOrText ?? '').trim();

  // 1. Direct Preset match (by presetId or matching preset DOI / PMID)
  if (input.presetId) {
    const preset = getPresetStudySpecById(input.presetId, input.device, input.environment);
    if (preset) return { spec: preset, fromCache: true };
  }
  const directPreset = VERIFIED_STUDY_PRESETS.find(
    (p) =>
      p.id === raw ||
      (p.studyRef.pmid && raw.includes(p.studyRef.pmid)) ||
      (p.studyRef.doi && raw.toLowerCase().includes(p.studyRef.doi.toLowerCase()))
  );
  if (directPreset && !input.abstractOverride) {
    return {
      spec: applySafetyAndDeviceGuardrails(directPreset, input.device, input.environment),
      fromCache: true,
    };
  }

  // 2. Detect explicit identifier (PMID / PubMed URL / DOI / NCT ID)
  const pmidMatch =
    input.pmid?.match(/\d{6,9}/)?.[0] ||
    raw.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/i)?.[1] ||
    raw.match(/^(?:pmid[:\s]*)?(\d{6,9})$/i)?.[1];

  const doiMatch =
    input.doi?.replace(/^https?:\/\/doi\.org\//i, '').trim() ||
    raw.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];

  const nctMatch =
    input.nctId?.toUpperCase().match(/NCT\d{6,10}/)?.[0] ||
    raw.toUpperCase().match(/NCT\d{6,10}/)?.[0];

  const cacheKey = pmidMatch
    ? `v8:pmid:${pmidMatch}`
    : doiMatch
      ? `v8:doi:${doiMatch.toLowerCase()}`
      : nctMatch
        ? `v8:nct:${nctMatch}`
        : null;

  if (cacheKey && !input.abstractOverride) {
    const cached = await readCompiledStudyCache(env.DB, cacheKey);
    if (cached) {
      return {
        spec: applySafetyAndDeviceGuardrails(cached, input.device, input.environment),
        fromCache: true,
      };
    }
  }

  let resolvedRef: StudyReferenceMeta | null = null;
  let fullText = (input.abstractOverride ?? '').trim();

  // 3. Fetch real paper content from authoritative biomedical APIs
  if (pmidMatch && !fullText) {
    const pm = await fetchPubMedFullByPmid(env, pmidMatch);
    if (pm) {
      resolvedRef = pm.ref;
      fullText = pm.fullText;
    }
  }

  if (!resolvedRef && doiMatch && !fullText) {
    const epmcHits = await fetchEuropePmcByQuery(`DOI:"${doiMatch}"`, 1);
    const hit = epmcHits[0];
    if (hit) {
      let methodsExtra = '';
      if (hit.pmcid) {
        methodsExtra = await fetchEuropePmcMethodsSnippet(hit.pmcid);
      }
      resolvedRef = {
        title: hit.title,
        authors: hit.authors,
        year: hit.year,
        journal: hit.journal,
        url: hit.url,
        doi: hit.doi ?? doiMatch,
        pmid: hit.pmid,
        pmcid: hit.pmcid,
        source: 'europepmc',
      };
      fullText = [hit.abstractText, methodsExtra].filter(Boolean).join(' ');
    }
  }

  if (!resolvedRef && nctMatch && !fullText) {
    const trial = await fetchClinicalTrialByNct(nctMatch);
    if (trial) {
      resolvedRef = trial.ref;
      fullText = trial.fullText;
    }
  }

  // 4. If user passed a short search topic (not a pasted multi-sentence abstract), search Europe PMC + Trials live
  const looksLikePastedAbstract =
    Boolean(input.abstractOverride) || raw.length >= 165 || raw.split(/[.!?]/).filter((s) => s.trim().length > 15).length >= 2;

  if (!resolvedRef && !looksLikePastedAbstract && raw.length >= 3) {
    const hits = await searchLiveMedicalStudies(env, raw, {
      skipNcbiDirect: input.skipNcbiDirect,
    });
    const best = hits.find((h) => h.hasFullAbstract) ?? hits[0];
    if (best) {
      let methodsExtra = '';
      if (best.pmcid) {
        methodsExtra = await fetchEuropePmcMethodsSnippet(best.pmcid);
      }
      resolvedRef = {
        title: best.title,
        authors: best.authors,
        year: best.year,
        journal: best.journal,
        url: best.url,
        doi: best.doi,
        pmid: best.pmid,
        pmcid: best.pmcid,
        nctId: best.nctId,
        source: best.source === 'core' ? 'europepmc' : best.source,
      };
      fullText = [best.abstractText, methodsExtra].filter(Boolean).join(' ');
    }
  }

  // 5. Fallback to direct pasted study text compilation (e.g. user pasted Methods paragraph from a PDF!)
  if (!resolvedRef) {
    const textToParse = fullText || raw;
    if (textToParse.length < 12) {
      throw new Error('Could not find a matching medical study. Try a PubMed URL, PMID, DOI, NCT ID, search topic, or paste a study abstract.');
    }
    const firstSentence = textToParse.split(/[.!?\n]/)[0]?.trim() || 'Custom Clinical Audio Protocol';
    resolvedRef = {
      title: input.titleOverride?.trim() || (firstSentence.length <= 110 ? firstSentence : `${firstSentence.slice(0, 106)}…`),
      authors: 'User-Provided Scientific Text',
      year: String(new Date().getFullYear()),
      journal: 'Direct Study-to-Sound Compilation',
      url: pmidMatch
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmidMatch}/`
        : doiMatch
          ? `https://doi.org/${doiMatch}`
          : 'https://pubmed.ncbi.nlm.nih.gov/',
      doi: doiMatch,
      pmid: pmidMatch,
      nctId: nctMatch,
      source: 'custom_text',
    };
    fullText = textToParse;
  } else if (input.titleOverride) {
    resolvedRef.title = input.titleOverride;
  }

  const specId =
    cacheKey ??
    (resolvedRef.pmid
      ? `pmid:${resolvedRef.pmid}`
      : resolvedRef.doi
        ? `doi:${resolvedRef.doi.toLowerCase()}`
        : resolvedRef.nctId
          ? `nct:${resolvedRef.nctId}`
          : `custom:${crypto.randomUUID().slice(0, 10)}`);

  // Tier 1: Deterministic Scientific Parser (0 ms, 100% reproducible, verbatim quotes)
  let spec = compileStudyTextDeterministically({
    id: specId,
    studyRef: resolvedRef,
    fullText,
    device: input.device,
    environment: input.environment,
    preferredGenre: input.preferredGenre,
  });

  // Tier 2: Cloudflare Workers AI Free Tier grounded enrichment (if available & useful)
  if (env.AI && fullText.length >= 100 && spec.compliancePct < 100) {
    const aiPatch = await runWorkersAiStudyExtractor(env, resolvedRef.title, fullText);
    if (aiPatch) {
      spec = verifyAndMergeAiExtraction(
        spec,
        aiPatch,
        `${resolvedRef.title}. ${fullText}`,
        input.device,
        input.environment
      );
    }
  }

  if (isNonAuditoryOrAnimalStudy(resolvedRef.title, fullText)) {
    const scopeNote =
      'Preclinical or non-auditory source detected: translated conservatively into a safe human non-invasive acoustic protocol.';
    if (!spec.protocol.safetyNotes.includes(scopeNote)) {
      spec.protocol.safetyNotes.push(scopeNote);
    }
  }

  const finalCacheKey =
    resolvedRef.pmid
      ? `v8:pmid:${resolvedRef.pmid}`
      : resolvedRef.doi
        ? `v8:doi:${resolvedRef.doi.toLowerCase()}`
        : resolvedRef.nctId
          ? `v8:nct:${resolvedRef.nctId}`
          : null;

  if (finalCacheKey) {
    await writeCompiledStudyCache(env.DB, finalCacheKey, spec);
  }

  return { spec, fromCache: false };
}
