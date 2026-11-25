import { getMicroStateById } from '../shared/neuralStates';
import {
  OPENALEX_HUMAN_AUDITORY_EXCLUSION,
  appendPubMedHumanAuditoryGuard,
  isNonAuditoryOrAnimalStudy,
} from '../shared/openGoals';
import type { LivePubMedPaper, SessionEnvironment, TargetState } from '../shared/types';
import type { D1Database, Env } from './env';

const memoryLitCache = new Map<string, { expiresAt: number; papers: LivePubMedPaper[] }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days shared in D1 when both sources succeed
const PARTIAL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min when only one upstream source responded

function stripInlineTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function inferAppliedMechanism(
  title: string,
  targetState: TargetState,
  environment: SessionEnvironment
): string {
  const t = title.toLowerCase();
  if (/(creativ|divergent|ideation|brainstorm|imagination)/.test(t)) {
    return 'Supports 10 Hz associative Alpha modulation & open suspended voicings linked to divergent creative thinking.';
  }
  if (/(memory|recall|retention|consolidation|learning|hippocamp)/.test(t)) {
    return 'Calibrates 14 Hz SMR / 40 Hz Gamma rhythmic framing for working memory encoding and study recall.';
  }
  if (/(dopamine|striat|mood|positive affect|reward|joy)/.test(t)) {
    return 'Guides bright major-mode harmonic voicings & 12 Hz SMR lift for positive mood and intrinsic motivation.';
  }
  if (/(amplitude modulation|entrainment|beta|gamma|alpha|oscillation)/.test(t)) {
    return 'Supports our 3-Band LR4 cortical amplitude modulation (190 Hz–4.5 kHz) while keeping sub-bass & highs untouched.';
  }
  if (/(driving|vigilance|driver|traffic|road|highway)/.test(t) || environment === 'driving') {
    return 'Guides Driving Safety EQ (leaving 800–3500 Hz traffic cues unobstructed) & periodic anti-monotony lifts.';
  }
  if (/(sleep|insomnia|nocturnal|bedtime)/.test(t) || targetState === 'sleep_winddown') {
    return 'Informs our beatless/slow Calm energy tier (<75 BPM) and warm low-pass down-regulation.';
  }
  if (/(cortisol|stress|autonomic|anxiety|parasympathetic|heart rate)/.test(t) || targetState === 'calm_reset') {
    return 'Shapes smooth non-percussive harmonic trajectories for autonomic stress recovery.';
  }
  if (/(noise|stochastic|masking)/.test(t)) {
    return 'Calibrates our subtle pink/brown stochastic floor to stabilize attention and mask distractions.';
  }
  if (/(lyric|verbal|reading|working memory|comprehension)/.test(t)) {
    return 'Enforces strictly lyric-free instrumental synthesis so verbal working memory stays free.';
  }
  if (/(tempo|arousal|fatigue|alertness)/.test(t) || targetState === 'energy_lift') {
    return 'Calibrates moderate upbeat tempo (104–118 BPM) and bright open voicings to elevate alertness.';
  }
  return 'Informs Layer 1 psychoacoustic parameters & lyric-free instrumental framing for your target state.';
}

interface DoiSeedCandidate {
  doi: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
}

interface PubMedFetchBundle {
  papers: LivePubMedPaper[];
  extraDois: DoiSeedCandidate[];
}

const AUDITORY_TITLE_GUARD_RE =
  /\b(music|musical|auditory|acoustic|sound|binaural|monaural|isochronic|listening|noise|tempo|rhythmic|harmonic|melody|tone|tinnitus|entrainment|piano)\b/i;

/**
 * Official Europe PMC MEDLINE (`SRC:MED`) backup for NIH PubMed `pmid` records when
 * `eutils.ncbi.nlm.nih.gov` rate-limits (`429`) or times out under burst load.
 * Every returned record is an authentic NIH PubMed/MEDLINE indexed article with a verified numeric `pmid`.
 */
async function fetchPubMedViaEuropePmcFallback(
  rawQuery: string,
  targetState: TargetState,
  environment: SessionEnvironment
): Promise<PubMedFetchBundle> {
  try {
    const withoutPmExcl = rawQuery.replace(/\s*NOT\s+\(\(Animals\[MeSH Terms\][\s\S]*$/i, '').trim();
    const converted = withoutPmExcl.replace(/\[(?:Title\/Abstract|Title|MeSH Terms|tiab|mh)\]/gi, '');
    const epmcQuery = `SRC:MED AND (${converted})`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(epmcQuery)}&resultType=lite&pageSize=8&format=json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        accept: 'application/json',
        'user-agent': 'nootropic.fm/3.0 (mailto:music@nootropic.fm)',
      },
    });
    if (!res.ok) return { papers: [], extraDois: [] };
    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          pmid?: string;
          doi?: string;
          title?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
          abstractText?: string;
        }>;
      };
    };

    const papers: LivePubMedPaper[] = [];
    const extraDois: DoiSeedCandidate[] = [];
    for (const r of data.resultList?.result ?? []) {
      const pmid = r.pmid?.replace(/[^0-9]/g, '') ?? '';
      if (!pmid || !r.title) continue;
      const cleanTitle = stripInlineTags(r.title).replace(/\.$/, '');
      const cleanAbstract = r.abstractText ? stripInlineTags(r.abstractText) : '';
      if (isNonAuditoryOrAnimalStudy(cleanTitle, cleanAbstract)) continue;
      const authorParts = (r.authorString ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const firstAuthor = authorParts[0] || 'Research Team';
      const authorLabel = authorParts.length > 1 ? `${firstAuthor} et al.` : firstAuthor;
      const year = r.pubYear?.match(/\d{4}/)?.[0] ?? 'Peer-Reviewed';
      const journal = r.journalTitle || 'PubMed Indexed Journal';
      const doiClean = r.doi?.replace(/^https?:\/\/doi\.org\//i, '').trim();
      if (papers.length < 2) {
        papers.push({
          pmid,
          source: 'pubmed',
          title: cleanTitle,
          authors: authorLabel,
          journal,
          year,
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          ...(doiClean ? { doiUrl: `https://doi.org/${doiClean}` } : {}),
          appliedMechanism: inferAppliedMechanism(cleanTitle, targetState, environment),
        });
      } else if (doiClean && /^10\.\d{4,9}\//i.test(doiClean) && extraDois.length < 4) {
        extraDois.push({ doi: doiClean, title: cleanTitle, authors: authorLabel, journal, year });
      }
    }
    return { papers, extraDois };
  } catch {
    return { papers: [], extraDois: [] };
  }
}

async function fetchPubMed(
  env: Env,
  targetState: TargetState,
  environment: SessionEnvironment,
  queryOverride?: string
): Promise<PubMedFetchBundle> {
  const rawQuery =
    queryOverride ??
    (() => {
      if (environment === 'driving') {
        return '(music[Title/Abstract] OR auditory[Title/Abstract]) AND (driving[Title/Abstract] OR vigilance[Title/Abstract]) AND (attention[Title/Abstract] OR arousal[Title/Abstract])';
      }
      if (targetState === 'sleep_winddown') {
        return 'music[Title/Abstract] AND ("sleep quality"[Title/Abstract] OR insomnia[Title/Abstract])';
      }
      if (targetState === 'calm_reset') {
        return 'music[Title/Abstract] AND (cortisol[Title/Abstract] OR autonomic[Title/Abstract] OR "stress recovery"[Title/Abstract])';
      }
      if (targetState === 'energy_lift') {
        return 'music[Title/Abstract] AND (tempo[Title/Abstract] OR arousal[Title/Abstract]) AND (fatigue[Title/Abstract] OR alertness[Title/Abstract])';
      }
      return '("amplitude modulation"[Title/Abstract] OR "background music"[Title/Abstract] OR "white noise"[Title/Abstract]) AND ("sustained attention"[Title/Abstract] OR "cognitive performance"[Title/Abstract])';
    })();
  const query = appendPubMedHumanAuditoryGuard(rawQuery);

  const apiKeyParam = env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(env.NCBI_API_KEY)}` : '';
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort=relevance&term=${encodeURIComponent(query)}${apiKeyParam}`;
    let searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
    });
    if (searchRes.status === 429) {
      await new Promise((r) => setTimeout(r, 480));
      searchRes = await fetch(searchUrl, {
        signal: AbortSignal.timeout(2500),
        headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
      });
    }
    if (!searchRes.ok) {
      return fetchPubMedViaEuropePmcFallback(rawQuery, targetState, environment);
    }
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = (searchData.esearchresult?.idlist ?? []).slice(0, 8);
    if (ids.length === 0) return { papers: [], extraDois: [] };

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${apiKeyParam}`;
    let sumRes = await fetch(summaryUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
    });
    if (sumRes.status === 429) {
      await new Promise((r) => setTimeout(r, 480));
      sumRes = await fetch(summaryUrl, {
        signal: AbortSignal.timeout(2500),
        headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
      });
    }
    if (!sumRes.ok) {
      return fetchPubMedViaEuropePmcFallback(rawQuery, targetState, environment);
    }
    const sumData = (await sumRes.json()) as {
      result?: Record<
        string,
        {
          title?: string;
          authors?: Array<{ name?: string }>;
          fulljournalname?: string;
          source?: string;
          pubdate?: string;
          articleids?: Array<{ idtype?: string; value?: string }>;
        }
      >;
    };

    const parsedItems: Array<{
      id: string;
      cleanTitle: string;
      authorLabel: string;
      year: string;
      journal: string;
      doiClean?: string;
      hasAuditoryTitle: boolean;
    }> = [];
    for (const id of ids) {
      const item = sumData.result?.[id];
      if (!item?.title) continue;
      const cleanTitle = stripInlineTags(item.title).replace(/\.$/, '');
      if (isNonAuditoryOrAnimalStudy(cleanTitle)) continue;
      const firstAuthor = item.authors?.[0]?.name ?? 'Research Team';
      const authorLabel =
        (item.authors?.length ?? 0) > 1 ? `${firstAuthor} et al.` : firstAuthor;
      const yearMatch = (item.pubdate ?? '').match(/\d{4}/);
      const year = yearMatch ? yearMatch[0] : 'Peer-Reviewed';
      const journal = item.fulljournalname || item.source || 'PubMed Indexed Journal';
      const doiEntry = item.articleids?.find(
        (a) => a.idtype === 'doi' && a.value && /^10\.\d{4,9}\//i.test(a.value.trim())
      );
      parsedItems.push({
        id,
        cleanTitle,
        authorLabel,
        year,
        journal,
        doiClean: doiEntry?.value?.trim(),
        hasAuditoryTitle: AUDITORY_TITLE_GUARD_RE.test(cleanTitle),
      });
    }

    // Prefer papers whose title explicitly names music/auditory/sound mechanisms over incidental abstract mentions
    parsedItems.sort((a, b) => Number(b.hasAuditoryTitle) - Number(a.hasAuditoryTitle));

    const papers: LivePubMedPaper[] = [];
    const extraDois: DoiSeedCandidate[] = [];
    for (const entry of parsedItems) {
      if (papers.length < 2) {
        papers.push({
          pmid: entry.id,
          source: 'pubmed',
          title: entry.cleanTitle,
          authors: entry.authorLabel,
          journal: entry.journal,
          year: entry.year,
          url: `https://pubmed.ncbi.nlm.nih.gov/${entry.id}/`,
          ...(entry.doiClean ? { doiUrl: `https://doi.org/${entry.doiClean}` } : {}),
          appliedMechanism: inferAppliedMechanism(entry.cleanTitle, targetState, environment),
        });
      } else if (entry.doiClean && entry.hasAuditoryTitle && extraDois.length < 4) {
        extraDois.push({
          doi: entry.doiClean,
          title: entry.cleanTitle,
          authors: entry.authorLabel,
          journal: entry.journal,
          year: entry.year,
        });
      }
    }
    return { papers, extraDois };
  } catch {
    return fetchPubMedViaEuropePmcFallback(rawQuery, targetState, environment);
  }
}

function sanitizeOpenAlexBooleanTerm(term: string): string {
  // Commas delimit OpenAlex `filter=` clauses, so strip commas while preserving balanced boolean `()` and `""`
  const noCommas = term.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let depth = 0;
  let balanced = true;
  for (const ch of noCommas) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
  }
  if (depth !== 0) balanced = false;
  return balanced ? noCommas : noCommas.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchCrossrefDoiSeeds(cleanTerm: string): Promise<DoiSeedCandidate[]> {
  try {
    const plainQuery = cleanTerm
      .replace(/\b(AND|OR|NOT)\b/g, ' ')
      .replace(/[()"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plainQuery) return [];
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(plainQuery)}&filter=type:journal-article&rows=8&select=DOI,title,author,published,container-title&mailto=music@nootropic.fm`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: {
        accept: 'application/json',
        'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      message?: {
        items?: Array<{
          DOI?: string;
          title?: string[];
          author?: Array<{ family?: string; given?: string; name?: string }>;
          'container-title'?: string[];
          published?: { 'date-parts'?: number[][] };
        }>;
      };
    };
    const out: DoiSeedCandidate[] = [];
    for (const item of data.message?.items ?? []) {
      const doi = item.DOI?.trim() ?? '';
      const rawTitle = item.title?.[0] ?? '';
      if (!doi || !/^10\.\d{4,9}\//i.test(doi) || !rawTitle) continue;
      const cleanTitle = stripInlineTags(rawTitle).replace(/\.$/, '');
      if (!AUDITORY_TITLE_GUARD_RE.test(cleanTitle)) continue;
      if (isNonAuditoryOrAnimalStudy(cleanTitle)) continue;
      const authors = item.author ?? [];
      const first =
        authors[0]?.family
          ? `${authors[0].family}${authors[0].given ? ` ${authors[0].given[0]}` : ''}`
          : authors[0]?.name || 'Research Team';
      const authorLabel = authors.length > 1 ? `${first} et al.` : first;
      const yearNum = item.published?.['date-parts']?.[0]?.[0];
      out.push({
        doi,
        title: cleanTitle,
        authors: authorLabel,
        journal: item['container-title']?.[0] || 'Peer-Reviewed Journal (DOI)',
        year: yearNum ? String(yearNum) : 'Peer-Reviewed',
      });
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Resolves verified journal DOIs against OpenAlex's `$0.00` (0-credit) single-work endpoint
 * `/works/https://doi.org/{doi}` when shared Cloudflare egress IPs hit OpenAlex's unkeyed
 * `$0.10/day` or `1/s` search filter limit (`HTTP 429`).
 */
async function resolveOpenAlexViaFreeDoiLookup(
  env: Env,
  cleanTerm: string,
  seedDois: DoiSeedCandidate[],
  targetState: TargetState,
  environment: SessionEnvironment
): Promise<LivePubMedPaper[]> {
  const crossrefSeeds = seedDois.length >= 2 ? [] : await fetchCrossrefDoiSeeds(cleanTerm);
  const seenDois = new Set<string>();
  const candidates: DoiSeedCandidate[] = [];
  for (const s of [...crossrefSeeds, ...seedDois]) {
    const key = s.doi.toLowerCase();
    if (seenDois.has(key)) continue;
    seenDois.add(key);
    candidates.push(s);
    if (candidates.length >= 3) break;
  }
  if (candidates.length === 0) return [];

  const select = 'id,doi,title,publication_year,authorships,primary_location';
  const keyParam = env.OPENALEX_API_KEY
    ? `&api_key=${encodeURIComponent(env.OPENALEX_API_KEY)}`
    : '';

  const resolved = await Promise.all(
    candidates.map(async (cand): Promise<LivePubMedPaper | null> => {
      const fullDoiUrl = `https://doi.org/${cand.doi}`;
      const oaUrl = `https://api.openalex.org/works/${encodeURIComponent(fullDoiUrl)}?select=${select}&mailto=music@nootropic.fm${keyParam}`;
      try {
        const res = await fetch(oaUrl, {
          signal: AbortSignal.timeout(2200),
          headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
        });
        if (res.ok) {
          const w = (await res.json()) as {
            id?: string;
            doi?: string;
            title?: string;
            publication_year?: number;
            authorships?: Array<{ author?: { display_name?: string } }>;
            primary_location?: { source?: { display_name?: string } };
          };
          if (w.title && w.doi && w.doi.startsWith('https://doi.org/')) {
            const cleanTitle = stripInlineTags(w.title).replace(/\.$/, '');
            if (!isNonAuditoryOrAnimalStudy(cleanTitle)) {
              const authors = w.authorships ?? [];
              const first = authors[0]?.author?.display_name ?? cand.authors;
              const authorLabel = authors.length > 1 ? `${first} et al.` : first;
              const oaId = (w.id ?? w.doi).split('/').pop() ?? cand.doi;
              return {
                pmid: `OA:${oaId}`,
                source: 'openalex',
                title: cleanTitle,
                authors: authorLabel,
                journal: w.primary_location?.source?.display_name ?? cand.journal,
                year: w.publication_year ? String(w.publication_year) : cand.year,
                url: w.doi,
                doiUrl: w.doi,
                appliedMechanism: inferAppliedMechanism(cleanTitle, targetState, environment),
              };
            }
          }
        }
      } catch {
        // Fall through to verified DOI seed metadata if OpenAlex edge is unreachable/429
      }
      return {
        pmid: `OA:${cand.doi}`,
        source: 'openalex',
        title: cand.title,
        authors: cand.authors,
        journal: cand.journal,
        year: cand.year,
        url: fullDoiUrl,
        doiUrl: fullDoiUrl,
        appliedMechanism: inferAppliedMechanism(cand.title, targetState, environment),
      };
    })
  );

  return resolved.filter((p): p is LivePubMedPaper => p !== null);
}

/**
 * Live OpenAlex peer-reviewed search using strict `filter=` boolean queries sorted by BM25 `relevance_score:desc`
 * and accepting ONLY works with verified `https://doi.org/...` external URLs.
 */
async function fetchOpenAlex(
  env: Env,
  targetState: TargetState,
  environment: SessionEnvironment,
  termOverride?: string,
  seedDoisPromise?: Promise<DoiSeedCandidate[]>
): Promise<LivePubMedPaper[]> {
  const term =
    termOverride ??
    (() => {
      if (environment === 'driving') {
        return 'music AND (driving OR driver) AND (vigilance OR alertness OR fatigue)';
      }
      if (targetState === 'sleep_winddown') {
        return 'music AND ("sleep quality" OR insomnia)';
      }
      if (targetState === 'calm_reset') {
        return 'music AND (cortisol OR "heart rate variability" OR "stress recovery" OR autonomic)';
      }
      if (targetState === 'energy_lift') {
        return 'music AND (tempo OR arousal) AND (fatigue OR alertness OR vigilance)';
      }
      return '("amplitude modulation" OR "background music") AND ("sustained attention" OR "cognitive performance")';
    })();

  const cleanTerm = sanitizeOpenAlexBooleanTerm(term);
  if (!cleanTerm) return [];
  const filter = `title_and_abstract.search:(${cleanTerm}) ${OPENALEX_HUMAN_AUDITORY_EXCLUSION},has_doi:true,type:article`;
  const select = 'id,doi,title,publication_year,authorships,primary_location';
  const keyParam = env.OPENALEX_API_KEY
    ? `&api_key=${encodeURIComponent(env.OPENALEX_API_KEY)}`
    : '';
  const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&select=${select}&sort=relevance_score:desc&per-page=8&mailto=music@nootropic.fm${keyParam}`;

  try {
    let res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
    });
    if (res.status === 429 && env.OPENALEX_API_KEY) {
      await new Promise((r) => setTimeout(r, 650));
      res = await fetch(url, {
        signal: AbortSignal.timeout(2500),
        headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
      });
    }
    if (!res.ok) {
      const seeds = seedDoisPromise ? await seedDoisPromise : [];
      return resolveOpenAlexViaFreeDoiLookup(env, cleanTerm, seeds, targetState, environment);
    }
    const data = (await res.json()) as {
      results?: Array<{
        id?: string;
        doi?: string;
        title?: string;
        publication_year?: number;
        authorships?: Array<{ author?: { display_name?: string } }>;
        primary_location?: { source?: { display_name?: string } };
      }>;
    };

    const papers: LivePubMedPaper[] = [];
    for (const w of data.results ?? []) {
      if (!w.title || !w.doi || !w.doi.startsWith('https://doi.org/')) continue;
      const cleanTitle = stripInlineTags(w.title).replace(/\.$/, '');
      if (isNonAuditoryOrAnimalStudy(cleanTitle)) continue;
      const authors = w.authorships ?? [];
      const first = authors[0]?.author?.display_name ?? 'Research Team';
      const authorLabel = authors.length > 1 ? `${first} et al.` : first;
      const oaId = (w.id ?? w.doi).split('/').pop() ?? w.doi;
      papers.push({
        pmid: `OA:${oaId}`,
        source: 'openalex',
        title: cleanTitle,
        authors: authorLabel,
        journal: w.primary_location?.source?.display_name ?? 'Peer-Reviewed Journal (OpenAlex)',
        year: w.publication_year ? String(w.publication_year) : 'Peer-Reviewed',
        url: w.doi,
        doiUrl: w.doi,
        appliedMechanism: inferAppliedMechanism(cleanTitle, targetState, environment),
      });
      if (papers.length >= 4) break;
    }
    return papers;
  } catch {
    const seeds = seedDoisPromise ? await seedDoisPromise.catch(() => []) : [];
    return resolveOpenAlexViaFreeDoiLookup(env, cleanTerm, seeds, targetState, environment);
  }
}

async function readD1LitCache(db: D1Database, cacheKey: string): Promise<LivePubMedPaper[] | null> {
  try {
    const row = await db
      .prepare('SELECT papers_json, expires_at FROM literature_cache WHERE cache_key = ?')
      .bind(cacheKey)
      .first<{ papers_json: string; expires_at: string }>();
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return JSON.parse(row.papers_json) as LivePubMedPaper[];
  } catch {
    return null;
  }
}

async function writeD1LitCache(
  db: D1Database,
  cacheKey: string,
  papers: LivePubMedPaper[],
  ttlMs = CACHE_TTL_MS
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await db
      .prepare(
        `INSERT INTO literature_cache (cache_key, source, papers_json, expires_at)
         VALUES (?, 'pubmed+openalex', ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET papers_json = excluded.papers_json, expires_at = excluded.expires_at`
      )
      .bind(cacheKey, JSON.stringify(papers), expiresAt)
      .run();
  } catch {
    // Non-fatal cache write
  }
}

function extractPrimaryCustomDomainKeyword(customGoal: {
  slug: string;
  openAlexTerm: string;
  topicWords?: string[];
}): string {
  const fromTopics = customGoal.topicWords?.find((w) => w.length >= 3);
  if (fromTopics) return fromTopics.replace(/[^a-z0-9-]/gi, '').toLowerCase();

  const cleanedTerm = customGoal.openAlexTerm
    .replace(/["()[\],]/g, ' ')
    .replace(
      /\b(music|musical|auditory|stimulation|acoustic|sound|therapy|binaural|monaural|isochronic|noise|listening|human|humans|adult|adults|and|or|not)\b/gi,
      ' '
    )
    .trim();
  const word = cleanedTerm.split(/\s+/).find((w) => w.length >= 3);
  if (word) return word.replace(/[^a-z0-9-]/gi, '').toLowerCase();

  const fromSlug = customGoal.slug
    .replace(/^custom:/i, '')
    .split('_')
    .find((w) => w.length >= 3);
  return fromSlug ?? '';
}

/**
 * Dual-source live literature lookup (NIH PubMed + OpenAlex) with shared 7-day D1 cache.
 * Zero fabricated URLs — every returned link is a verified PubMed or DOI URL.
 */
export async function fetchVerifiedLiveLiterature(
  env: Env,
  targetState: TargetState,
  environment: SessionEnvironment,
  microStateId?: string,
  customGoal?: {
    slug: string;
    pubmedQuery: string;
    openAlexTerm: string;
    topicWords?: string[];
  } | null
): Promise<LivePubMedPaper[]> {
  const micro = environment === 'driving' ? undefined : getMicroStateById(microStateId);
  const goalSlugKey = customGoal?.slug || targetState;
  const cacheKey = micro
    ? `v8:${environment}:${goalSlugKey}:${micro.id}`
    : `v8:${environment}:${goalSlugKey}`;
  const mem = memoryLitCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.papers;
  }

  const d1Cached = await readD1LitCache(env.DB, cacheKey);
  if (d1Cached && d1Cached.length > 0) {
    memoryLitCache.set(cacheKey, { expiresAt: Date.now() + 60 * 60 * 1000, papers: d1Cached });
    return d1Cached;
  }

  const primaryPubmedQuery = customGoal?.pubmedQuery ?? micro?.pubmedTerm;
  const primaryOpenAlexTerm = customGoal?.openAlexTerm ?? micro?.openAlexTerm;

  const pmPrimaryPromise = fetchPubMed(env, targetState, environment, primaryPubmedQuery);
  const [pmPrimary, oaPrimary] = await Promise.all([
    pmPrimaryPromise,
    fetchOpenAlex(
      env,
      targetState,
      environment,
      primaryOpenAlexTerm,
      pmPrimaryPromise.then((b) => b.extraDois)
    ),
  ]);
  let pubmed = pmPrimary.papers;
  let extraDois = pmPrimary.extraDois;
  let openalex = oaPrimary;

  // Independent per-source relaxation for open custom multi-word topics:
  // only re-query whichever source returned 0 papers (preserving hits & avoiding burst rate limits).
  if (customGoal && (pubmed.length === 0 || openalex.length === 0)) {
    const primaryKeyword = extractPrimaryCustomDomainKeyword(customGoal);
    if (primaryKeyword && primaryKeyword.length >= 3) {
      const quotedPm = primaryKeyword.includes('-')
        ? `"${primaryKeyword}"[Title/Abstract]`
        : `${primaryKeyword}[Title/Abstract]`;
      const quotedOa = primaryKeyword.includes('-') ? `"${primaryKeyword}"` : primaryKeyword;
      const pmRelaxPromise =
        pubmed.length === 0
          ? fetchPubMed(
              env,
              targetState,
              environment,
              `(music[Title/Abstract] OR "auditory stimulation"[Title/Abstract] OR binaural[Title/Abstract]) AND ${quotedPm}`
            )
          : Promise.resolve({ papers: pubmed, extraDois });
      const [relaxedPm, relaxedOa] = await Promise.all([
        pmRelaxPromise,
        openalex.length === 0
          ? fetchOpenAlex(
              env,
              targetState,
              environment,
              `(music OR "auditory stimulation" OR "binaural") AND ${quotedOa}`,
              pmRelaxPromise.then((b) => b.extraDois)
            )
          : Promise.resolve(openalex),
      ]);
      pubmed = relaxedPm.papers;
      extraDois = relaxedPm.extraDois;
      openalex = relaxedOa;
    }
  }

  // Independent per-source graceful fallback to targetState query if either source still returned 0 papers
  if ((micro || customGoal) && (pubmed.length === 0 || openalex.length === 0)) {
    const pmFallbackPromise =
      pubmed.length === 0
        ? fetchPubMed(env, targetState, environment)
        : Promise.resolve({ papers: pubmed, extraDois });
    const [fallbackPm, fallbackOa] = await Promise.all([
      pmFallbackPromise,
      openalex.length === 0
        ? fetchOpenAlex(
            env,
            targetState,
            environment,
            undefined,
            pmFallbackPromise.then((b) => b.extraDois)
          )
        : Promise.resolve(openalex),
    ]);
    pubmed = fallbackPm.papers;
    openalex = fallbackOa;
  }

  // Deduplicate by normalized title while preserving up to 2 PubMed + 2 OpenAlex papers
  const seenTitles = new Set<string>();
  const combined: LivePubMedPaper[] = [];
  let pubmedKept = 0;
  let openAlexKept = 0;
  for (const p of pubmed) {
    const normTitle = p.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);
    combined.push(p);
    pubmedKept++;
    if (pubmedKept >= 2) break;
  }
  for (const p of openalex) {
    const normTitle = p.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);
    combined.push(p);
    openAlexKept++;
    if (openAlexKept >= 2) break;
  }

  if (combined.length > 0) {
    const hasBothSources = pubmedKept > 0 && openAlexKept > 0;
    const memTtl = hasBothSources ? 60 * 60 * 1000 : PARTIAL_CACHE_TTL_MS;
    const d1Ttl = hasBothSources ? CACHE_TTL_MS : PARTIAL_CACHE_TTL_MS;
    memoryLitCache.set(cacheKey, { expiresAt: Date.now() + memTtl, papers: combined });
    await writeD1LitCache(env.DB, cacheKey, combined, d1Ttl);
  }

  return combined;
}
