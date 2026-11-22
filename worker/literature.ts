import { getMicroStateById } from '../shared/neuralStates';
import type { LivePubMedPaper, SessionEnvironment, TargetState } from '../shared/types';
import type { D1Database, Env } from './env';

const memoryLitCache = new Map<string, { expiresAt: number; papers: LivePubMedPaper[] }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days shared in D1

function inferAppliedMechanism(
  title: string,
  targetState: TargetState,
  environment: SessionEnvironment
): string {
  const t = title.toLowerCase();
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

async function fetchPubMed(
  env: Env,
  targetState: TargetState,
  environment: SessionEnvironment,
  queryOverride?: string
): Promise<LivePubMedPaper[]> {
  const query =
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

  const apiKeyParam = env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(env.NCBI_API_KEY)}` : '';
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=2&sort=relevance&term=${encodeURIComponent(query)}${apiKeyParam}`;
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
    });
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = (searchData.esearchresult?.idlist ?? []).slice(0, 2);
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${apiKeyParam}`;
    const sumRes = await fetch(summaryUrl, {
      signal: AbortSignal.timeout(2500),
      headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
    });
    if (!sumRes.ok) return [];
    const sumData = (await sumRes.json()) as {
      result?: Record<
        string,
        {
          title?: string;
          authors?: Array<{ name?: string }>;
          fulljournalname?: string;
          source?: string;
          pubdate?: string;
        }
      >;
    };

    const papers: LivePubMedPaper[] = [];
    for (const id of ids) {
      const item = sumData.result?.[id];
      if (!item?.title) continue;
      const firstAuthor = item.authors?.[0]?.name ?? 'Research Team';
      const authorLabel =
        (item.authors?.length ?? 0) > 1 ? `${firstAuthor} et al.` : firstAuthor;
      const yearMatch = (item.pubdate ?? '').match(/\d{4}/);
      const cleanTitle = item.title.replace(/\.$/, '');
      papers.push({
        pmid: id,
        source: 'pubmed',
        title: cleanTitle,
        authors: authorLabel,
        journal: item.fulljournalname || item.source || 'PubMed Indexed Journal',
        year: yearMatch ? yearMatch[0] : 'Peer-Reviewed',
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        appliedMechanism: inferAppliedMechanism(cleanTitle, targetState, environment),
      });
    }
    return papers;
  } catch {
    return [];
  }
}

/**
 * Live OpenAlex peer-reviewed search using strict `filter=` queries (~10,000 calls/day on free key)
 * and accepting ONLY works with verified `https://doi.org/...` external URLs.
 */
async function fetchOpenAlex(
  env: Env,
  targetState: TargetState,
  environment: SessionEnvironment,
  termOverride?: string
): Promise<LivePubMedPaper[]> {
  const term =
    termOverride ??
    (() => {
      if (environment === 'driving') return 'music driving vigilance arousal';
      if (targetState === 'sleep_winddown') return 'music sleep quality relaxation';
      if (targetState === 'calm_reset') return 'music stress recovery autonomic cortisol';
      if (targetState === 'energy_lift') return 'musical tempo arousal alertness cognitive';
      return 'amplitude modulation music sustained attention';
    })();

  const filter = `title_and_abstract.search:${term},has_doi:true,type:article`;
  const select = 'id,doi,title,publication_year,authorships,primary_location';
  const keyParam = env.OPENALEX_API_KEY
    ? `&api_key=${encodeURIComponent(env.OPENALEX_API_KEY)}`
    : '';
  const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&select=${select}&sort=cited_by_count:desc&per-page=2&mailto=music@nootropic.fm${keyParam}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { 'user-agent': 'nootropic.fm/2.0 (mailto:music@nootropic.fm)' },
    });
    if (!res.ok) return [];
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
      const authors = w.authorships ?? [];
      const first = authors[0]?.author?.display_name ?? 'Research Team';
      const authorLabel = authors.length > 1 ? `${first} et al.` : first;
      const oaId = (w.id ?? w.doi).split('/').pop() ?? w.doi;
      const cleanTitle = w.title.replace(/\.$/, '');
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
    }
    return papers;
  } catch {
    return [];
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
  papers: LivePubMedPaper[]
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
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

/**
 * Dual-source live literature lookup (NIH PubMed + OpenAlex) with shared 7-day D1 cache.
 * Zero fabricated URLs — every returned link is a verified PubMed or DOI URL.
 */
export async function fetchVerifiedLiveLiterature(
  env: Env,
  targetState: TargetState,
  environment: SessionEnvironment,
  microStateId?: string
): Promise<LivePubMedPaper[]> {
  const micro = environment === 'driving' ? undefined : getMicroStateById(microStateId);
  const cacheKey = micro
    ? `v2:${environment}:${targetState}:${micro.id}`
    : `v2:${environment}:${targetState}`;
  const mem = memoryLitCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.papers;
  }

  const d1Cached = await readD1LitCache(env.DB, cacheKey);
  if (d1Cached && d1Cached.length > 0) {
    memoryLitCache.set(cacheKey, { expiresAt: Date.now() + 60 * 60 * 1000, papers: d1Cached });
    return d1Cached;
  }

  let [pubmed, openalex] = await Promise.all([
    fetchPubMed(env, targetState, environment, micro?.pubmedTerm),
    fetchOpenAlex(env, targetState, environment, micro?.openAlexTerm),
  ]);

  // Graceful fallback to broader verified query if a specific micro-state query returned zero hits
  if (micro && pubmed.length === 0 && openalex.length === 0) {
    [pubmed, openalex] = await Promise.all([
      fetchPubMed(env, targetState, environment),
      fetchOpenAlex(env, targetState, environment),
    ]);
  }

  // Deduplicate by normalized title
  const seenTitles = new Set<string>();
  const combined: LivePubMedPaper[] = [];
  for (const p of [...pubmed, ...openalex]) {
    const normTitle = p.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);
    combined.push(p);
  }

  if (combined.length > 0) {
    memoryLitCache.set(cacheKey, { expiresAt: Date.now() + 60 * 60 * 1000, papers: combined });
    await writeD1LitCache(env.DB, cacheKey, combined);
  }

  return combined;
}
