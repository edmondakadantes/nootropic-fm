import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Volume2,
  Waves,
  Zap,
} from 'lucide-react';
import { getGenreDisplayMeta } from '../../shared/promptComposer';
import {
  CARRIER_MODE_LABELS,
  ENTRAINMENT_LABELS,
  type CarrierEngineMode,
} from '../../shared/studySpec';
import type {
  AudioSourceType,
  LiveAdjustment,
  ProtocolRecommendation,
  ResolvedGenre,
} from '../../shared/types';
import { DEVICE_LABELS, ENERGY_LABELS, GENRE_META, STATE_LABELS, TARGET_LABELS } from '../../shared/types';
import { PsychoacousticEngine, type EngineTelemetry } from '../audio/PsychoacousticEngine';
import { API_BASE, api } from '../lib/api';
import { LiveEnvelopeProof } from './LiveEnvelopeProof';
import { NeuralVisualizer } from './NeuralVisualizer';
import { PvtBenchmarkModal } from './PvtBenchmarkModal';
import { StudyFidelityMatrix } from './StudyFidelityMatrix';

interface PlayerViewProps {
  recommendation: ProtocolRecommendation;
  lyriaRealtimeAvailable?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  onFinishToDebrief: (stats: {
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
    pvtPreMs?: number | null;
    pvtLapsesPre?: number | null;
  }) => void;
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PlayerView({
  recommendation,
  lyriaRealtimeAvailable = false,
  onPlayingChange,
  onFinishToDebrief,
}: PlayerViewProps) {
  const engineRef = useRef<PsychoacousticEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PsychoacousticEngine();
  }

  const initialCarrier: CarrierEngineMode =
    recommendation.audioSource === 'pure_stimulus'
      ? 'pure_stimulus'
      : recommendation.audioSource === 'studio_library' ||
          recommendation.audioSource === 'community_cache' ||
          recommendation.audioSource === 'live_generating'
        ? 'studio_library'
        : 'generative_live';

  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [volume, setVolume] = useState(0.74);
  const [intensityMult, setIntensityMult] = useState(1.0);
  const [modMult, setModMult] = useState(1.0);
  const [adjustments, setAdjustments] = useState<LiveAdjustment[]>([]);
  const [genre, setGenre] = useState<ResolvedGenre>(
    recommendation.params.genre ?? 'deep_electronic'
  );
  const [carrierMode, setCarrierMode] = useState<CarrierEngineMode>(initialCarrier);
  const [lyriaNotice, setLyriaNotice] = useState<string | null>(null);
  const [connectingLyria, setConnectingLyria] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSourceType>(
    recommendation.audioSource ?? 'generative_live'
  );
  const [activeCustomLabel, setActiveCustomLabel] = useState<string | null>(
    recommendation.customGenreLabel ?? null
  );
  const [customGenState, setCustomGenState] = useState<'idle' | 'generating' | 'ready' | 'notice'>(
    recommendation.audioSource === 'live_generating'
      ? 'generating'
      : recommendation.audioSource === 'community_cache'
        ? 'ready'
        : 'idle'
  );
  const [customGenNotice, setCustomGenNotice] = useState<string | null>(null);
  const [showPrePvt, setShowPrePvt] = useState(false);
  const [pvtPreMs, setPvtPreMs] = useState<number | null>(null);
  const [pvtLapsesPre, setPvtLapsesPre] = useState<number | null>(null);

  const spec = recommendation.executableSpec;
  const [telemetry, setTelemetry] = useState<EngineTelemetry>({
    phase: 'entry',
    phaseLabel: 'Entry & Iso-Alignment',
    progressRatio: 0,
    currentModHz: spec?.entrainment.frequencyHz ?? recommendation.params.modulationHz,
    currentModDepth: Number((recommendation.params.modulationDepth * 0.55).toFixed(2)),
    crossoverHz: spec?.entrainment.modulationBandHz[0] ?? recommendation.params.crossoverHz ?? 190,
    upperCrossoverHz: spec?.entrainment.modulationBandHz[1] ?? recommendation.params.upperCrossoverHz ?? 4500,
    stereoAmActive: Boolean(recommendation.params.stereoAmSpread && !recommendation.params.speakerSafeEQ),
    energyTier: recommendation.params.energyTier ?? 'focus',
    currentBpm: spec?.music.bpmRamp?.start ?? spec?.music.bpm ?? recommendation.params.bpm,
    antiMonotonyActive: false,
    genre: recommendation.params.genre ?? 'deep_electronic',
    backgroundAudioActive: false,
    usingStudioAudio: false,
    usingCustomTrack: false,
    activeTrackName: null,
    carrierMode: initialCarrier,
    entrainmentType: spec?.entrainment.type ?? 'amplitude_modulation',
    stimulusCarrierLabel: spec
      ? ENTRAINMENT_LABELS[spec.entrainment.type]
      : `${recommendation.params.modulationHz} Hz LR4 AM`,
    tuningA4Hz: spec?.music.tuningA4Hz ?? 440,
    tonalMode: spec?.music.tonalMode ?? 'suspended',
    noiseColor: spec?.noise.color ?? recommendation.params.noiseColor,
    noiseSnrDb: spec?.noise.snrDb ?? -20,
    hrvActive: Boolean(spec?.entrainment.hrvBreathHz || spec?.entrainment.type === 'hrv_breathing_swell'),
    hrvBreathPhase: null,
    hrvBreathProgress: 0,
    lyriaStatus: 'idle',
    usingRealSamples: false,
    studioRetuned432: false,
  });

  const plannedSec = recommendation.plannedDurationMin * 60;
  const elapsedRef = useRef(0);
  const adjustmentsRef = useRef<LiveAdjustment[]>([]);
  const audioStartedRef = useRef(false);
  const milestoneSentRef = useRef(false);
  const endedByUserRef = useRef(false);
  const switchedAwayRef = useRef(false);
  const pvtPreRef = useRef<{ medianMs: number | null; lapses: number | null }>({
    medianMs: null,
    lapses: null,
  });

  elapsedRef.current = elapsedSec;
  adjustmentsRef.current = adjustments;
  audioStartedRef.current = audioStarted;
  pvtPreRef.current = { medianMs: pvtPreMs, lapses: pvtLapsesPre };

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  // Start instant audio + 2-Speed custom vibe resolution / crossfade
  useEffect(() => {
    let mounted = true;
    switchedAwayRef.current = false;
    milestoneSentRef.current = false;
    endedByUserRef.current = false;

    const triggerCustomCrossfade = async (trackUrl: string, label: string) => {
      if (!mounted || switchedAwayRef.current || !engineRef.current) return;
      const fullUrl = trackUrl.startsWith('http') ? trackUrl : `${API_BASE}${trackUrl}`;
      const ok = await engineRef.current.crossfadeToCustomTrack(fullUrl, label);
      if (mounted && ok && !switchedAwayRef.current) {
        setAudioSource('community_cache');
        setActiveCustomLabel(label);
        setCustomGenState('ready');
        setCustomGenNotice(null);
      }
    };

    const startAudio = async () => {
      try {
        // Fetch live Cloudflare R2 Studio Stem catalog in parallel so stems fade in seamlessly
        void api
          .getAudioCatalog()
          .then(({ tracksByGenre }) => {
            if (!mounted) return;
            const resolved: typeof tracksByGenre = {
              lofi_keys: [],
              deep_electronic: [],
              cinematic_strings: [],
              jazz_rhodes: [],
              acoustic_pluck: [],
              nature_rain: [],
            };
            (Object.keys(tracksByGenre) as ResolvedGenre[]).forEach((g) => {
              resolved[g] = tracksByGenre[g].map((t) => ({
                ...t,
                url: `${API_BASE}${t.url}`,
              }));
            });
            engineRef.current?.setStudioCatalog(resolved);
          })
          .catch(() => {});

        const titleLabel =
          recommendation.customGenreLabel ??
          GENRE_META[recommendation.params.genre].label;

        await engineRef.current?.start(
          recommendation.params,
          recommendation.plannedDurationMin,
          `${recommendation.arm.name} · ${titleLabel}`,
          recommendation.isControlTrial,
          recommendation.executableSpec,
          initialCarrier,
          API_BASE
        );

        if (!mounted) return;
        setIsPlaying(true);
        setAudioStarted(true);
        if (engineRef.current) {
          setGenre(engineRef.current.getGenre());
        }

        // Case A: Custom vibe already exists in Cloudflare R2 Community Cache -> immediate crossfade!
        if (recommendation.customTrackUrl && recommendation.customGenreLabel) {
          void triggerCustomCrossfade(
            recommendation.customTrackUrl,
            recommendation.customGenreLabel
          );
          return;
        }

        // Case B: 2-Speed Background Generation (User already hears matched Studio Library audio)
        if (
          recommendation.audioSource === 'live_generating' &&
          recommendation.customGenreLabel
        ) {
          setCustomGenState('generating');
          try {
            const genRes = await api.generateCustomMusic({
              customGenre: recommendation.customGenreLabel,
              energyTier: recommendation.params.energyTier,
              targetState: recommendation.targetState,
              bpm: recommendation.params.bpm,
              harmonicMode: recommendation.params.harmonicMode,
              speakerSafeEQ: recommendation.params.speakerSafeEQ,
              sessionId: recommendation.ephemeralMode ? undefined : recommendation.sessionId,
            });

            if (!mounted || switchedAwayRef.current) return;

            if (genRes.status === 'ready' && genRes.track) {
              await triggerCustomCrossfade(genRes.track.url, genRes.track.displayLabel);
              return;
            }

            if (genRes.status === 'generating' && recommendation.customGenreSlug) {
              // Another request is already generating this exact custom vibe — poll cleanly
              const slug = recommendation.customGenreSlug;
              const energy = recommendation.params.energyTier;
              for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise((r) => window.setTimeout(r, genRes.pollAfterMs ?? 4000));
                if (!mounted || switchedAwayRef.current) return;
                try {
                  const st = await api.getMusicStatus(slug, energy);
                  if (st.status === 'ready' && st.track) {
                    await triggerCustomCrossfade(st.track.url, st.track.displayLabel);
                    return;
                  }
                  if (st.status === 'failed') {
                    setAudioSource('studio_library');
                    setCustomGenState('notice');
                    setCustomGenNotice(
                      st.error ||
                        'Live generation paused — continuing seamlessly on our closest Studio Library match.'
                    );
                    return;
                  }
                } catch {
                  // transient network hiccup; keep polling
                }
              }
              if (mounted && !switchedAwayRef.current) {
                setAudioSource('studio_library');
                setCustomGenState('notice');
                setCustomGenNotice(
                  'Custom track is still rendering in the background — continuing smoothly on Studio Library.'
                );
              }
              return;
            }

            // Cap reached / unavailable / failed -> transparent honest fallback
            setAudioSource('studio_library');
            setCustomGenState('notice');
            setCustomGenNotice(
              genRes.message ??
                'Continuing seamlessly on our closest Studio Library match through the exact same 3-Band LR4 DSP.'
            );
          } catch {
            if (mounted && !switchedAwayRef.current) {
              setAudioSource('studio_library');
              setCustomGenState('notice');
              setCustomGenNotice(
                'Live custom generation is currently offline — continuing seamlessly on Studio Library.'
              );
            }
          }
        }
      } catch {
        if (mounted) {
          setIsPlaying(false);
          setAudioStarted(false);
        }
      }
    };
    void startAudio();

    return () => {
      mounted = false;
      onPlayingChange?.(false);
      engineRef.current?.stop();
    };
  }, [recommendation, onPlayingChange]);

  // Behavioral Retention Beacon lifecycle (visibilitychange checkpoint + pagehide finalize)
  useEffect(() => {
    if (recommendation.ephemeralMode) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && !endedByUserRef.current && elapsedRef.current > 0) {
        // Checkpoint-only: never penalizes locking phone screen while listening in background!
        api.sendSessionBeacon({
          sessionId: recommendation.sessionId,
          event: 'visibility',
          actualDurationSec: elapsedRef.current,
          audioStarted: audioStartedRef.current,
          liveAdjustments: adjustmentsRef.current,
        });
      }
    };

    const handlePageHide = () => {
      if (!endedByUserRef.current && elapsedRef.current > 0) {
        api.sendSessionBeacon({
          sessionId: recommendation.sessionId,
          event: 'pagehide',
          actualDurationSec: elapsedRef.current,
          audioStarted: audioStartedRef.current,
          liveAdjustments: adjustmentsRef.current,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [recommendation.sessionId, recommendation.ephemeralMode]);

  // Main 1-second session ticker + 90s progress checkpoint + 75% implicit completion milestone
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        const tel = engineRef.current?.updateElapsed(next);
        if (tel) setTelemetry(tel);

        // 75% listen retention milestone (implicit positive signal, once per session)
        if (
          !recommendation.ephemeralMode &&
          !milestoneSentRef.current &&
          plannedSec > 0 &&
          next / plannedSec >= 0.75
        ) {
          milestoneSentRef.current = true;
          api.sendSessionBeacon({
            sessionId: recommendation.sessionId,
            event: 'milestone',
            actualDurationSec: next,
            audioStarted: audioStartedRef.current,
            liveAdjustments: adjustmentsRef.current,
          });
        }

        // Periodic checkpoint every 90s (D1 free-tier write friendly)
        if (!recommendation.ephemeralMode && next > 0 && next % 90 === 0) {
          void api
            .saveProgress({
              sessionId: recommendation.sessionId,
              actualDurationSec: next,
              liveAdjustments: adjustmentsRef.current,
            })
            .catch(() => {});
        }

        if (next >= plannedSec) {
          window.clearInterval(id);
          endedByUserRef.current = true;
          engineRef.current?.stop();
          setIsPlaying(false);
          onFinishToDebrief({
            actualDurationSec: next,
            liveAdjustments: adjustmentsRef.current,
            pvtPreMs: pvtPreRef.current.medianMs,
            pvtLapsesPre: pvtPreRef.current.lapses,
          });
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [
    isPlaying,
    plannedSec,
    recommendation.sessionId,
    recommendation.ephemeralMode,
    onFinishToDebrief,
  ]);

  const togglePlay = async () => {
    if (!audioStarted) {
      await engineRef.current?.start(
        recommendation.params,
        recommendation.plannedDurationMin,
        recommendation.arm.name,
        recommendation.isControlTrial,
        recommendation.executableSpec,
        carrierMode,
        API_BASE
      );
      setAudioStarted(true);
      setIsPlaying(true);
      return;
    }
    if (isPlaying) {
      await engineRef.current?.pause();
      setIsPlaying(false);
    } else {
      await engineRef.current?.resume();
      setIsPlaying(true);
    }
  };

  const handleCarrierSwitch = async (nextMode: CarrierEngineMode) => {
    setLyriaNotice(null);
    if (nextMode === 'lyria_realtime') {
      setConnectingLyria(true);
      try {
        const res = await api.getLyriaRealtimeToken();
        if (!res.available || !res.token) {
          setLyriaNotice(
            res.reason ??
              'Lyria RealTime API key not configured yet — continuing seamlessly on $0 Live Generative Composer.'
          );
          setConnectingLyria(false);
          return;
        }
        const ok = await engineRef.current?.activateLyriaRealtime(
          res.token,
          res.model ?? 'models/lyria-realtime-exp',
          (_status, note) => {
            if (note) setLyriaNotice(note);
          }
        );
        if (ok) {
          setCarrierMode('lyria_realtime');
          setAudioSource('lyria_realtime');
        }
      } catch {
        setLyriaNotice('Lyria RealTime temporarily unreachable — continuing on $0 Live Generative Composer.');
      } finally {
        setConnectingLyria(false);
      }
      return;
    }

    setCarrierMode(nextMode);
    setAudioSource(nextMode);
    engineRef.current?.setCarrierMode(nextMode);
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    engineRef.current?.setVolume(v);
  };

  const tweakIntensity = (delta: number) => {
    const next = Number(Math.max(0.5, Math.min(1.5, intensityMult + delta)).toFixed(2));
    setIntensityMult(next);
    engineRef.current?.adjustIntensity(next);
    setAdjustments((prev) => [...prev, { atSec: elapsedRef.current, control: 'intensity', delta }]);
  };

  const tweakModulation = (delta: number) => {
    const next = Number(Math.max(0.3, Math.min(1.5, modMult + delta)).toFixed(2));
    setModMult(next);
    engineRef.current?.adjustModDepth(next);
    setAdjustments((prev) => [...prev, { atSec: elapsedRef.current, control: 'modulation', delta }]);
  };

  const switchGenre = (style: ResolvedGenre) => {
    switchedAwayRef.current = true;
    setGenre(style);
    setActiveCustomLabel(null);
    setCustomGenState('idle');
    setCustomGenNotice(null);
    if (carrierMode === 'pure_stimulus') {
      setCarrierMode('generative_live');
      setAudioSource('generative_live');
      engineRef.current?.setCarrierMode('generative_live');
    }
    engineRef.current?.setGenre(style);
    setAdjustments((prev) => [
      ...prev,
      { atSec: elapsedRef.current, control: 'genre', delta: 0, note: style },
    ]);
    if (!recommendation.ephemeralMode) {
      void api
        .updateSessionGenre({
          sessionId: recommendation.sessionId,
          genre: style,
          customGenreSlug: null,
          audioSource: carrierMode === 'studio_library' ? 'studio_library' : 'generative_live',
          atSec: elapsedRef.current,
        })
        .catch(() => {});
    }
  };

  const handleEndSession = () => {
    endedByUserRef.current = true;
    engineRef.current?.stop();
    setIsPlaying(false);
    if (!recommendation.ephemeralMode) {
      void api
        .saveProgress({
          sessionId: recommendation.sessionId,
          actualDurationSec: elapsedRef.current,
          liveAdjustments: adjustmentsRef.current,
        })
        .catch(() => {});
    }
    onFinishToDebrief({
      actualDurationSec: elapsedRef.current,
      liveAdjustments: adjustmentsRef.current,
      pvtPreMs: pvtPreRef.current.medianMs,
      pvtLapsesPre: pvtPreRef.current.lapses,
    });
  };

  const progressPct = Math.min(100, (elapsedSec / plannedSec) * 100);
  const livePapers = recommendation.livePubMedPapers ?? [];
  const activeVibeDisplay = activeCustomLabel
    ? getGenreDisplayMeta(recommendation.customGenreSlug ?? genre, activeCustomLabel)
    : getGenreDisplayMeta(genre);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {recommendation.safetyMode && (
        <div className="animate-rise rounded-2xl border border-amber-400/40 bg-amber-500/12 p-4 backdrop-blur-md">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-xs text-amber-100">
              <div className="font-semibold uppercase tracking-wide text-amber-300">
                Driving Safety Mode · Ambient Traffic Frequencies Protected
              </div>
              {recommendation.safetyWarnings.map((w, idx) => (
                <p key={idx} className="leading-relaxed text-amber-100/90">
                  {w}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2-Speed Custom Generation Banner */}
      {customGenState === 'generating' && activeCustomLabel && (
        <div className="animate-rise flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-400/35 bg-fuchsia-500/12 px-4 py-3 text-xs text-fuchsia-100 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fuchsia-300" />
            <span>
              <strong>Generating custom “{activeCustomLabel}”</strong> in the background — playing{' '}
              <strong>{GENRE_META[genre].label}</strong> right now so you start immediately, and
              crossfading smoothly once ready.
            </span>
          </div>
          <span className="font-mono-tech hidden shrink-0 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] text-fuchsia-200 sm:inline">
            2-Speed R2 Cache
          </span>
        </div>
      )}

      {customGenState === 'notice' && customGenNotice && (
        <div className="animate-rise flex items-center gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
          <Sparkles className="h-4 w-4 shrink-0 text-amber-300" />
          <span>{customGenNotice}</span>
        </div>
      )}

      {/* Main Live Studio Stage */}
      <div className="animate-rise glass-stage rounded-3xl p-5 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200">
                <Waves className="h-3.5 w-3.5" />
                {recommendation.arm.name} · 3-Band LR4
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/35 bg-indigo-500/12 px-2.5 py-1 text-[11px] font-medium text-indigo-200">
                {ENERGY_LABELS[telemetry.energyTier].label}
              </span>
              {telemetry.carrierMode === 'lyria_realtime' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-purple-400/45 bg-purple-500/18 px-2.5 py-1 text-[11px] font-semibold text-purple-200">
                  <Sparkles className="h-3 w-3" />
                  Google Lyria RealTime AI
                </span>
              ) : telemetry.carrierMode === 'pure_stimulus' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                  Pure Acoustic Signal
                </span>
              ) : telemetry.usingCustomTrack || audioSource === 'community_cache' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200">
                  <Sparkles className="h-3 w-3" />
                  Community R2 Cache · {activeVibeDisplay.label}
                </span>
              ) : telemetry.usingStudioAudio ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/14 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                  {telemetry.studioRetuned432 ? 'Studio R2 · A=432 Hz' : 'Studio R2'} · {telemetry.activeTrackName}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/12 px-2.5 py-1 text-[11px] font-semibold text-cyan-200">
                  <Sparkles className="h-3 w-3" />
                  {telemetry.usingRealSamples
                    ? 'Live Studio Sampler ($0)'
                    : 'Live As-We-Go Composer ($0)'}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  recommendation.isExploration
                    ? 'border-purple-400/35 bg-purple-500/15 text-purple-200'
                    : 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                }`}
              >
                <FlaskConical className="h-3 w-3" />
                {recommendation.isExploration
                  ? 'Controlled Exploration (Bandit)'
                  : `Optimal Fit · ${recommendation.confidencePct}% confidence`}
              </span>
              {recommendation.ephemeralMode && (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/90 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  Local-Only Mode
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              <span className="text-aurora">{TARGET_LABELS[recommendation.targetState]}</span>
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Cohort: <span className="text-slate-200">{recommendation.cohortLabel}</span> · Output:{' '}
              <span className="text-slate-200">{DEVICE_LABELS[recommendation.device]}</span> · Start:{' '}
              <span className="text-slate-200">
                {STATE_LABELS[recommendation.currentState]} ({recommendation.baselineScore}/5)
              </span>
            </p>
          </div>

          <div className="text-right">
            <div className="font-mono-tech text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {formatTimer(elapsedSec)}
            </div>
            <div className="font-mono-tech text-xs text-slate-400">
              of {recommendation.plannedDurationMin}:00 min
            </div>
          </div>
        </div>

        {/* Upgraded Dual-Layer Radial + Ribbon Neural Visualizer */}
        <NeuralVisualizer
          engine={engineRef.current}
          isPlaying={isPlaying}
          safetyMode={recommendation.safetyMode}
          modulationHz={telemetry.currentModHz}
        />

        {/* Real-Time Laboratory Proof Scope (Live Waveform + Exact Mathematical Stimulus Envelope) */}
        <LiveEnvelopeProof
          engine={engineRef.current}
          isPlaying={isPlaying}
          entrainmentType={telemetry.entrainmentType}
          frequencyHz={telemetry.currentModHz}
          depth={telemetry.currentModDepth}
          carrierLabel={
            telemetry.usingStudioAudio
              ? telemetry.studioRetuned432
                ? 'Studio R2 · A=432 Hz'
                : 'Studio R2'
              : telemetry.usingRealSamples
                ? 'Live Studio Sampler'
                : telemetry.carrierMode === 'pure_stimulus'
                  ? 'Pure Acoustic'
                  : telemetry.carrierMode === 'lyria_realtime'
                    ? 'Lyria RealTime AI'
                    : 'Live Synth'
          }
          tuningA4Hz={telemetry.tuningA4Hz}
        />

        {/* Iso-Principle Session Progression Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-cyan-300">
              <Activity className="h-3.5 w-3.5" />
              Active phase: {telemetry.phaseLabel}
              {telemetry.antiMonotonyActive && (
                <span className="rounded-md bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                  Anti-monotony lift
                </span>
              )}
            </span>
            <span className="font-mono-tech text-slate-400">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/90">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-amber-300 shadow-[0_0_16px_rgba(34,211,238,0.55)] transition-all duration-500"
              style={{ width: `${Math.max(2, progressPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>0% · Entry (Iso)</span>
            <span>15% – 88% · Cognitive Plateau</span>
            <span>100% · Landing</span>
          </div>
        </div>

        {/* Play/Pause & Tactile Live Controls */}
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void togglePlay()}
              className="btn-aurora inline-flex h-14 w-14 items-center justify-center rounded-full text-slate-950"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6 fill-slate-950" />
              ) : (
                <Play className="h-6 w-6 translate-x-0.5 fill-slate-950" />
              )}
            </button>

            <div className="w-36 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Volume2 className="h-3.5 w-3.5" /> Volume
                </span>
                <span className="font-mono-tech">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => handleVolume(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
              <Sliders className="h-3.5 w-3.5" /> Live tune:
            </span>
            <button
              type="button"
              onClick={() => tweakIntensity(-0.15)}
              className="subtle-chip rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              Calmer
            </button>
            <button
              type="button"
              onClick={() => tweakIntensity(0.15)}
              className="subtle-chip rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              More drive
            </button>
            <button
              type="button"
              onClick={() => tweakModulation(-0.2)}
              className="subtle-chip rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              AM −
            </button>
            <button
              type="button"
              onClick={() => tweakModulation(0.2)}
              className="subtle-chip rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              AM +
            </button>
          </div>
        </div>

        {/* Synchronized 0.1 Hz HRV Vagal Breath Pacer (when study includes autonomic breathing tide) */}
        {telemetry.hrvActive && telemetry.hrvBreathPhase && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-200">
                0.10 Hz HRV Vagal Resonance Pacer ·{' '}
                <span className="uppercase tracking-wider text-white">
                  {telemetry.hrvBreathPhase === 'inhale' ? 'Inhale Slowly (5s)' : 'Exhale Smoothly (5s)'}
                </span>
              </span>
              <span className="font-mono-tech text-[11px] text-emerald-300">6 breaths/min</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-all duration-300"
                style={{ width: `${Math.max(8, Math.round(telemetry.hrvBreathProgress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Optional 15-Second Pre-Session Objective Brain Benchmark (PVT ms, hidden while driving) */}
        {!recommendation.safetyMode && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] px-4 py-3">
            <div className="space-y-0.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                <Zap className="h-3.5 w-3.5 text-cyan-300" />
                {pvtPreMs !== null
                  ? `Pre-Session Baseline Locked: ${pvtPreMs} ms`
                  : 'Optional 15s Pre-Session Brain Check (PVT ms)'}
              </div>
              <p className="text-[11px] text-slate-400">
                {pvtPreMs !== null
                  ? `Lapses (>500ms): ${pvtLapsesPre ?? 0} · Retest at debrief to prove your objective reaction-time shift.`
                  : 'Tap 5 green flashes now to establish an objective millisecond baseline before the protocol works.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPrePvt(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              <Zap className="h-3.5 w-3.5" />
              {pvtPreMs !== null ? 'Retake Baseline' : 'Measure Baseline (15s)'}
            </button>
          </div>
        )}

        {/* Live Synthesis Carrier Engine Switcher (Study-Locked Generative $0 / Studio R2 / Pure Acoustic / Lyria AI) */}
        <div className="space-y-2 rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-cyan-200">
              Audio Synthesis Mode (Acoustic Modulation Stays 100% Locked)
            </span>
            <span className="font-mono-tech text-[10px] text-slate-400">
              {telemetry.stimulusCarrierLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(['generative_live', 'studio_library', 'pure_stimulus', 'lyria_realtime'] as CarrierEngineMode[]).map(
              (m) => {
                const active = carrierMode === m;
                const info = CARRIER_MODE_LABELS[m];
                const isLyria = m === 'lyria_realtime';
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={isLyria && connectingLyria}
                    onClick={() => void handleCarrierSwitch(m)}
                    className={`rounded-xl border px-2.5 py-2 text-left transition ${
                      active
                        ? 'border-cyan-400/70 bg-cyan-400/18 text-white shadow-[0_0_16px_rgba(34,211,238,0.18)]'
                        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold leading-tight">
                        {m === 'generative_live'
                          ? 'Live As-We-Go ($0)'
                          : m === 'studio_library'
                            ? 'Studio R2 Stems'
                            : m === 'pure_stimulus'
                              ? 'Pure Acoustic Signal'
                              : connectingLyria
                                ? 'Connecting Lyria…'
                                : lyriaRealtimeAvailable
                                  ? 'Lyria RealTime AI'
                                  : 'Lyria AI (API Key)'}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[9px] text-slate-400">{info.shortDesc}</div>
                  </button>
                );
              }
            )}
          </div>
          {lyriaNotice && (
            <div className="rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-200">
              {lyriaNotice}
            </div>
          )}
        </div>

        {/* Live Music Layer (Genre Carrier) Switcher — zero dropout, keeps Multiband AM active */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
              <Music2 className="h-3.5 w-3.5 text-cyan-400" />
              Music Layer (switch live — {telemetry.currentModHz} Hz 3-Band AM {telemetry.crossoverHz}–
              {telemetry.upperCrossoverHz} Hz stays locked)
            </span>
            {telemetry.backgroundAudioActive && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
                <Radio className="h-3 w-3" />
                Lock-Screen &amp; Bluetooth Ready
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(GENRE_META) as ResolvedGenre[]).map((style) => {
              const meta = GENRE_META[style];
              const active = !telemetry.usingCustomTrack && genre === style;
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => switchGenre(style)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-cyan-400/70 bg-cyan-400/14 text-white shadow-[0_0_22px_rgba(34,211,238,0.18)]'
                      : 'border-slate-800/80 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold">{meta.label}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{meta.shortDesc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Acoustic DNA Telemetry Grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Acoustic Signal</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-cyan-300">
              {telemetry.currentModHz > 0 ? `${telemetry.currentModHz} Hz` : `A=${telemetry.tuningA4Hz} Hz`}
            </div>
            <div className="truncate font-mono-tech text-[10px] text-slate-500">
              {ENTRAINMENT_LABELS[telemetry.entrainmentType].split(' ')[0]} · {telemetry.crossoverHz}–{telemetry.upperCrossoverHz}Hz
            </div>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Signal Depth</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-indigo-300">
              {Math.round(telemetry.currentModDepth * 100)}%
            </div>
            <div className="font-mono-tech text-[10px] text-slate-500 capitalize">
              {telemetry.tonalMode} · A={telemetry.tuningA4Hz}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Live Tempo</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-white">
              {telemetry.currentBpm > 0 ? `${telemetry.currentBpm} BPM` : 'Beatless'}
            </div>
            <div className="font-mono-tech text-[10px] text-slate-500">
              {telemetry.carrierMode === 'generative_live'
                ? telemetry.usingRealSamples
                  ? 'Studio Sampler'
                  : 'Live Composer'
                : telemetry.carrierMode === 'pure_stimulus'
                  ? 'Pure Signal'
                  : telemetry.carrierMode === 'lyria_realtime'
                    ? 'Lyria Live'
                    : telemetry.studioRetuned432
                      ? 'Studio R2 · 432Hz'
                      : 'Studio R2'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Stochastic Noise</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-slate-200 capitalize">
              {telemetry.noiseColor === 'none' ? 'Off' : telemetry.noiseColor.replace('_', ' ')}
            </div>
            <div className="font-mono-tech text-[10px] text-slate-500">
              {telemetry.noiseColor === 'none' ? 'Clean bed' : `${telemetry.noiseSnrDb} dB SNR`}
            </div>
          </div>
          <div className="col-span-2 rounded-xl border border-slate-800/80 bg-slate-900/55 p-3 sm:col-span-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Live Tweaks</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-amber-300">
              {adjustments.length}
            </div>
          </div>
        </div>

        {/* Finish Session CTA */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-800/80 pt-4 sm:flex-row">
          <p className="text-xs text-slate-400">
            {recommendation.ephemeralMode
              ? 'Finished listening? End your local-only session anytime.'
              : 'Finished listening (or ready to rate now)? Complete the 10-second debrief so the engine learns what worked.'}
          </p>
          <button
            type="button"
            onClick={handleEndSession}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:bg-emerald-300"
          >
            <CheckCircle2 className="h-4 w-4" />
            {recommendation.ephemeralMode ? 'End Session' : 'End Session & Rate (10s)'}
          </button>
        </div>
      </div>

      {/* Scientific Rationale & Verified Studies (Core DOIs + Live NIH PubMed & OpenAlex Links) */}
      <div className="animate-rise delay-150 glass-card rounded-3xl p-5 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-cyan-300">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-base font-semibold text-white">
              Verified Peer-Reviewed Science Powering This Session
            </h2>
          </div>
          <span className="font-mono-tech text-[10px] uppercase tracking-wider text-slate-400">
            Direct DOI / PubMed / OpenAlex links · Zero fabricated citations
          </span>
        </div>

        <p className="text-sm leading-relaxed text-slate-300">{recommendation.rationale}</p>

        {/* Live Study-to-Sound Fidelity Matrix */}
        {recommendation.executableSpec && (
          <StudyFidelityMatrix spec={recommendation.executableSpec} />
        )}

        {/* Core Acoustic DSP Studies */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {recommendation.studies.map((study) => (
            <a
              key={study.id}
              href={study.doiOrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group block rounded-2xl border border-slate-800/90 bg-slate-950/60 p-4 space-y-1.5 transition hover:border-cyan-400/45"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold text-cyan-300">
                  {study.authors.split(',')[0]} et al. ({study.year}) · {study.journal}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-slate-400 group-hover:text-cyan-300">
                  DOI <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-xs font-medium text-white group-hover:text-cyan-100">
                {study.title}
              </div>
              <p className="text-xs leading-relaxed text-slate-400">{study.summary}</p>
              <p className="text-[11px] text-amber-300/80">Caveat: {study.caveat}</p>
            </a>
          ))}
        </div>

        {/* Live Matched NIH PubMed & OpenAlex Papers */}
        {livePapers.length > 0 && (
          <div className="space-y-2.5 border-t border-slate-800/80 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Live Matched Literature (NIH PubMed &amp; OpenAlex · Click to Verify)
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {livePapers.map((paper) => (
                <a
                  key={paper.pmid}
                  href={paper.doiUrl || paper.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col justify-between gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3.5 transition hover:border-emerald-400/50 hover:bg-emerald-500/[0.08]"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tech rounded border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
                        {paper.source === 'openalex' ? 'OpenAlex' : 'NIH PubMed'} · {paper.year}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-emerald-300" />
                    </div>
                    <div className="text-xs font-medium leading-snug text-white group-hover:text-emerald-100">
                      {paper.title}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {paper.authors} · {paper.journal}
                    </div>
                  </div>
                  {paper.appliedMechanism && (
                    <div className="rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-cyan-200/90">
                      <span className="font-semibold text-cyan-300">Applied in audio:</span>{' '}
                      {paper.appliedMechanism}
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {showPrePvt && (
        <PvtBenchmarkModal
          phase="pre"
          onComplete={(res) => {
            setPvtPreMs(res.medianMs);
            setPvtLapsesPre(res.lapses);
            setShowPrePvt(false);
            if (!recommendation.ephemeralMode && !recommendation.sessionId.startsWith('eph_')) {
              void api
                .saveSessionPvt({
                  sessionId: recommendation.sessionId,
                  phase: 'pre',
                  medianMs: res.medianMs,
                  lapses: res.lapses,
                })
                .catch(() => {});
            }
          }}
          onClose={() => setShowPrePvt(false)}
        />
      )}
    </div>
  );
}
