import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Car,
  Cpu,
  ExternalLink,
  FlaskConical,
  Headphones,
  Loader2,
  Play,
  Search,
  Sparkles,
  Trophy,
  Volume2,
  Waves,
  Zap,
} from 'lucide-react';
import { VERIFIED_STUDY_PRESETS } from '../../shared/studyPresets';
import {
  ENTRAINMENT_LABELS,
  type ExecutableStudySpec,
} from '../../shared/studySpec';
import type {
  OutputDevice,
  ProtocolRecommendation,
  SessionEnvironment,
  StudyLeaderboardEntry,
} from '../../shared/types';
import { api } from '../lib/api';
import { StudyFidelityMatrix } from './StudyFidelityMatrix';

interface StudyLabViewProps {
  defaultDevice?: OutputDevice;
  profileId?: string;
  ephemeralMode?: boolean;
  onExecuteRecommendation: (rec: ProtocolRecommendation, directPlay?: boolean) => void;
}

interface SearchHit {
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

const EXAMPLE_QUERIES = [
  '40 Hz gamma auditory stimulation attention',
  'binaural beats 10 Hz calm pink noise',
  'music 60 bpm stress recovery relaxation',
  'white noise stochastic resonance memory focus',
  '432 Hz music heart rate variability',
];

export function StudyLabView({
  defaultDevice = 'headphones',
  profileId,
  ephemeralMode = true,
  onExecuteRecommendation,
}: StudyLabViewProps) {
  const [queryInput, setQueryInput] = useState('');
  const [device, setDevice] = useState<OutputDevice>(defaultDevice);
  const [environment, setEnvironment] = useState<SessionEnvironment>(
    defaultDevice === 'car_audio' ? 'driving' : 'study'
  );
  const [searching, setSearching] = useState(false);
  const [compilingId, setCompilingId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [compiledResult, setCompiledResult] = useState<{
    spec: ExecutableStudySpec;
    recommendation: ProtocolRecommendation;
    fromCache: boolean;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<StudyLeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);

  useEffect(() => {
    let active = true;
    void api
      .getStudyLeaderboard()
      .then((res) => {
        if (active) setLeaderboard(res.leaderboard ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingLeaderboard(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const leaderboardBySpecId = new Map(leaderboard.map((row) => [row.studySpecId, row]));

  const handleDevicePick = (nextDevice: OutputDevice) => {
    setDevice(nextDevice);
    if (nextDevice === 'car_audio') {
      setEnvironment('driving');
    } else if (environment === 'driving') {
      setEnvironment('study');
    }
  };

  const handleSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? queryInput).trim();
    if (q.length < 2) return;
    setErrorMsg(null);
    setSearching(true);
    try {
      const res = await api.searchMedicalStudies(q);
      setSearchResults(res.results);
      if (res.results.length === 0) {
        setErrorMsg('No matching abstracts found — you can still click "Compile & Execute" to parse pasted text or a direct PMID/DOI.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Live literature search temporarily unavailable.');
    } finally {
      setSearching(false);
    }
  };

  const handleCompile = async (
    payload: Parameters<typeof api.compileMedicalStudy>[0],
    loaderKey: string
  ) => {
    setErrorMsg(null);
    setCompilingId(loaderKey);
    try {
      const res = await api.compileMedicalStudy({
        ...payload,
        device,
        environment,
        profileId,
        ephemeralMode,
      });
      setCompiledResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to compile study parameters.');
    } finally {
      setCompilingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      {/* Hero Header */}
      <div className="animate-rise space-y-3 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
          <FlaskConical className="h-3.5 w-3.5 text-cyan-300" />
          Study-to-Sound Executable Engine · Live As-We-Go Synthesis ($0)
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Turn Published <span className="text-aurora">Acoustic Studies</span> Into Live Sound
        </h1>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-400">
          Paste any <strong className="text-slate-200">PubMed URL / PMID / DOI / ClinicalTrials NCT ID</strong>,
          search live biomedical archives, or paste a paper’s Methods paragraph.{' '}
          <span className="text-cyan-300">nootropic.fm</span> compiles its exact acoustic parameters (Hz, waveforms,
          40 Hz GENUS bursts, binaural/isochronic carriers, BPM ramps, A=432/440 Hz tuning, SNR noise) and composes
          non-repeating music live to match 100% of what the paper specifies.
        </p>
      </div>

      {/* Universal Input Card */}
      <div className="animate-step glass-stage rounded-3xl border border-cyan-400/25 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono-tech text-[11px] uppercase tracking-[0.16em] text-cyan-300">
            Paste PubMed / DOI / NCT / Abstract · or Search Live Science
          </span>

          {/* Output & Safety Selector */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-1">
            {(
              [
                { id: 'headphones', label: 'Headphones', icon: Headphones },
                { id: 'speakers', label: 'Speakers', icon: Volume2 },
                { id: 'car_audio', label: 'Driving Safe', icon: Car },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleDevicePick(id)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  device === id
                    ? id === 'car_audio'
                      ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40'
                      : 'bg-cyan-400/18 text-cyan-100 border border-cyan-400/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="h-3 w-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="glow-input-wrap">
          <textarea
            rows={3}
            value={queryInput}
            onChange={(e) => {
              setQueryInput(e.target.value);
              setErrorMsg(null);
            }}
            placeholder="Paste a PubMed link (e.g. https://pubmed.ncbi.nlm.nih.gov/39455825/), a DOI (10.1038/...), an NCT clinical trial ID, a topic (e.g. '40 Hz gamma attention'), OR paste a study's Methods/Abstract paragraph..."
            className="w-full resize-none rounded-[1rem] bg-[#060a14]/95 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Example Quick Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Try:</span>
          {EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQueryInput(ex);
                void handleSearch(ex);
              }}
              className="subtle-chip rounded-full border px-2.5 py-1 text-[11px] transition hover:border-cyan-400/45 hover:text-cyan-200"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            disabled={!queryInput.trim() || compilingId !== null}
            onClick={() => void handleCompile({ queryOrText: queryInput }, 'custom_input')}
            className="btn-aurora flex flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-950 disabled:opacity-45"
          >
            {compilingId === 'custom_input' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Cpu className="h-4 w-4" />
            )}
            <span>Compile Study to Live Sound</span>
          </button>

          <button
            type="button"
            disabled={!queryInput.trim() || searching}
            onClick={() => void handleSearch()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-indigo-400/40 bg-indigo-500/15 px-5 py-3.5 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 disabled:opacity-45"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span>Search PubMed &amp; Trials</span>
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Compiled Executable Preview (Appears immediately once compiled!) */}
      {compiledResult && (
        <div className="animate-rise glass-stage rounded-3xl border border-emerald-400/35 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-300" />
              <div>
                <h2 className="text-base font-bold text-white">
                  Compiled &amp; Ready to Execute Live
                </h2>
                <p className="text-xs text-slate-400">
                  {compiledResult.fromCache
                    ? 'Instant D1 / Ground-Truth compilation — verify exact study quotes below before listening.'
                    : 'Freshly compiled from live biomedical archives — verify exact study quotes below before listening.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onExecuteRecommendation(compiledResult.recommendation, false)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/50 hover:text-white"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Customize Layer 2</span>
              </button>
              <button
                type="button"
                onClick={() => onExecuteRecommendation(compiledResult.recommendation, true)}
                className="btn-aurora inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-slate-950"
              >
                <Play className="h-4 w-4 fill-slate-950" />
                <span>Execute Study Sound Live Now</span>
              </button>
            </div>
          </div>

          <StudyFidelityMatrix spec={compiledResult.spec} />
        </div>
      )}

      {/* Live Search Results from Europe PMC (PubMed/OA) & ClinicalTrials.gov */}
      {searchResults.length > 0 && (
        <div className="animate-rise space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Live Biomedical Search Results ({searchResults.length} verified papers)
            </h2>
            <span className="text-[11px] text-slate-500">Europe PMC · PubMed · ClinicalTrials.gov v2</span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {searchResults.map((hit) => {
              const isBusy = compilingId === hit.id;
              return (
                <div
                  key={hit.id}
                  className="glass-card flex flex-col justify-between rounded-2xl border border-emerald-400/20 p-4 space-y-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 font-mono-tech text-[10px] text-emerald-300">
                      <span className="uppercase">
                        {hit.source === 'clinicaltrials'
                          ? `ClinicalTrials · ${hit.nctId}`
                          : hit.pmid
                            ? `PubMed · ${hit.pmid}`
                            : 'Europe PMC'}{' '}
                        · {hit.year}
                      </span>
                      <a
                        href={hit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300"
                      >
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <h3 className="text-sm font-semibold leading-snug text-white">{hit.title}</h3>
                    <div className="text-[11px] text-slate-400">
                      {hit.authors} · {hit.journal}
                    </div>
                    {hit.abstractText && (
                      <p className="line-clamp-3 text-xs leading-relaxed text-slate-300/90">
                        {hit.abstractText}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={compilingId !== null}
                    onClick={() =>
                      void handleCompile(
                        {
                          queryOrText: hit.doi || hit.pmid || hit.nctId || hit.title,
                          pmid: hit.pmid,
                          doi: hit.doi,
                          nctId: hit.nctId,
                          abstractOverride: hit.abstractText || undefined,
                          titleOverride: hit.title,
                        },
                        hit.id
                      )
                    }
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/12 px-3.5 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/22 disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Waves className="h-3.5 w-3.5" />
                    )}
                    <span>Compile &amp; Preview Executable Sound</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Community Empirical Study Leaderboard (Real Anonymized Outcomes + Objective PVT ms) */}
      <div className="glass-card rounded-3xl border border-emerald-400/20 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-300" />
            <div>
              <h2 className="text-sm font-bold text-white">
                Open Community Empirical Study Leaderboard
              </h2>
              <p className="text-xs text-slate-400">
                Live anonymized outcomes from real listeners testing peer-reviewed protocols — including optional 15s objective PVT reaction time (ms).
              </p>
            </div>
          </div>
          <span className="font-mono-tech text-[10px] uppercase tracking-wider text-emerald-300/90">
            100% Real D1 Trials · Zero Fake Data
          </span>
        </div>

        {loadingLeaderboard ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
            Loading live empirical study outcomes…
          </div>
        ) : leaderboard.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {leaderboard.slice(0, 6).map((row, idx) => (
              <div
                key={row.studySpecId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800/90 bg-slate-950/65 px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-tech text-[10px] font-bold text-emerald-300">
                      #{idx + 1}
                    </span>
                    <span className="truncate text-xs font-semibold text-white">
                      {row.studyTitle}
                    </span>
                  </div>
                  <div className="font-mono-tech text-[10px] text-slate-400">
                    {row.frequencyHz > 0 ? `${row.frequencyHz} Hz` : 'Acoustic'} · {row.sessions}{' '}
                    {row.sessions === 1 ? 'trial' : 'trials'} · avg Δ{' '}
                    {row.avgDelta >= 0 ? `+${row.avgDelta}` : row.avgDelta}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono-tech text-sm font-bold text-emerald-300">
                    {row.successRatePct}% worked
                  </div>
                  {row.avgPvtDeltaMs !== null && row.pvtTrials > 0 && (
                    <div className="inline-flex items-center gap-1 font-mono-tech text-[10px] text-cyan-300">
                      <Zap className="h-2.5 w-2.5" />
                      {row.avgPvtDeltaMs < 0
                        ? `${Math.abs(row.avgPvtDeltaMs)} ms faster`
                        : `${row.avgPvtDeltaMs > 0 ? `+${row.avgPvtDeltaMs}` : '0'} ms`}{' '}
                      ({row.pvtTrials} PVT)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 px-4 py-3 text-xs text-slate-400">
            No community Study Lab trials rated yet — run any verified protocol below, optionally take the{' '}
            <strong className="text-cyan-200">15s Pre/Post PVT reaction benchmark (ms)</strong>, and submit your debrief to publish the first real empirical result.
          </div>
        )}
      </div>

      {/* Ground-Truth Landmark Clinical Protocols (1-Tap Execution) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <h2 className="text-sm font-bold text-white">
              Verified Landmark Acoustic Protocols (1-Tap Execution)
            </h2>
            <p className="text-xs text-slate-400">
              100% ground-truth peer-reviewed studies pre-compiled into exact mathematical DSP &amp; live generative rules.
            </p>
          </div>
          <span className="font-mono-tech text-[11px] text-cyan-300">
            {VERIFIED_STUDY_PRESETS.length} verified protocols
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VERIFIED_STUDY_PRESETS.map((preset) => {
            const isBusy = compilingId === preset.id;
            const empirical = leaderboardBySpecId.get(preset.id);
            const tempoLabel = preset.music.bpmRamp
              ? `${preset.music.bpmRamp.start}→${preset.music.bpmRamp.end} BPM`
              : preset.music.bpm > 0
                ? `${preset.music.bpm} BPM`
                : 'Beatless';
            return (
              <div
                key={preset.id}
                className="glass-card flex flex-col justify-between rounded-2xl border border-white/[0.08] p-4 space-y-3 transition hover:border-cyan-400/40"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-mono-tech text-[10px] font-semibold text-cyan-200">
                      {preset.entrainment.frequencyHz > 0
                        ? `${preset.entrainment.frequencyHz} Hz`
                        : `A=${preset.music.tuningA4Hz} Hz`}
                    </span>
                    <span className="font-mono-tech text-[10px] text-slate-400">
                      {tempoLabel} · {preset.protocol.recommendedDurationMin}m
                    </span>
                  </div>

                  {empirical && (
                    <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-mono-tech text-[10px] font-semibold text-emerald-200">
                      <span>
                        {empirical.sessions} {empirical.sessions === 1 ? 'trial' : 'trials'} · {empirical.successRatePct}% worked
                      </span>
                      {empirical.avgPvtDeltaMs !== null && empirical.pvtTrials > 0 && (
                        <span className="text-cyan-200">
                          · {empirical.avgPvtDeltaMs < 0 ? `${Math.abs(empirical.avgPvtDeltaMs)}ms faster` : `${empirical.avgPvtDeltaMs > 0 ? `+${empirical.avgPvtDeltaMs}` : '0'}ms`}
                        </span>
                      )}
                    </div>
                  )}

                  <h3 className="text-sm font-bold leading-snug text-white">
                    {preset.shortLabel}
                  </h3>
                  <div className="text-[11px] text-slate-400">
                    {preset.studyRef.journal} · {preset.studyRef.year}
                  </div>
                  <p className="line-clamp-3 text-xs leading-relaxed text-slate-300/90">
                    {preset.abstractExcerpt}
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="truncate font-mono-tech text-[10px] text-indigo-300/90">
                    {ENTRAINMENT_LABELS[preset.entrainment.type]}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={compilingId !== null}
                      onClick={() =>
                        void handleCompile({ queryOrText: preset.id, presetId: preset.id }, preset.id)
                      }
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-400/45 hover:text-white disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                      <span>Inspect</span>
                    </button>
                    <button
                      type="button"
                      disabled={compilingId !== null}
                      onClick={async () => {
                        setCompilingId(`play:${preset.id}`);
                        try {
                          const res = await api.compileMedicalStudy({
                            queryOrText: preset.id,
                            presetId: preset.id,
                            device,
                            environment,
                            profileId,
                            ephemeralMode,
                          });
                          onExecuteRecommendation(res.recommendation, true);
                        } catch (err) {
                          setErrorMsg(err instanceof Error ? err.message : 'Unable to launch protocol.');
                        } finally {
                          setCompilingId(null);
                        }
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-cyan-400/45 bg-cyan-400/18 px-3 py-2 text-[11px] font-bold text-cyan-100 transition hover:bg-cyan-400/28 disabled:opacity-50"
                    >
                      {compilingId === `play:${preset.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-cyan-200" />
                      )}
                      <span>Run Live</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
