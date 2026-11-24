import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Crown,
  ExternalLink,
  Loader2,
  Lock,
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
  UserProfile,
} from '../../shared/types';
import { DEVICE_LABELS, GENRE_META, STATE_LABELS, TARGET_LABELS } from '../../shared/types';
import { PsychoacousticEngine, type EngineTelemetry } from '../audio/PsychoacousticEngine';
import { API_BASE, api, saveStoredProfileAuth } from '../lib/api';
import { LiveEnvelopeProof } from './LiveEnvelopeProof';
import { NeuralVisualizer } from './NeuralVisualizer';
import { PvtBenchmarkModal } from './PvtBenchmarkModal';
import { StudyFidelityMatrix } from './StudyFidelityMatrix';

const FREE_PREVIEW_LIMIT_SEC = 300; // 5 minutes free preview before Pro unlock

interface PlayerViewProps {
  recommendation: ProtocolRecommendation;
  lyriaRealtimeAvailable?: boolean;
  isPro?: boolean;
  stripeAvailable?: boolean;
  onUpgradePro?: () => void;
  onStartDirectCheckout?: (plan: 'annual' | 'monthly') => Promise<void>;
  onPlayingChange?: (playing: boolean) => void;
  onSessionClaimed?: (claimed: {
    profile: UserProfile;
    profileToken: string;
    syncCode: string;
    sessionId: string;
  }) => void;
  onFinishToDebrief: (stats: {
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
    pvtPreMs?: number | null;
    pvtLapsesPre?: number | null;
    sessionIdOverride?: string;
    ephemeralOverride?: boolean;
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
  isPro = false,
  stripeAvailable = false,
  onUpgradePro,
  onStartDirectCheckout,
  onPlayingChange,
  onSessionClaimed,
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
  const [previewLocked, setPreviewLocked] = useState(false);
  const [selectedPaywallPlan, setSelectedPaywallPlan] = useState<'annual' | 'monthly'>('annual');
  const [unlockingCheckout, setUnlockingCheckout] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<'none' | 'tune' | 'science'>('none');

  // Live session promotion (lets 1-Click Quick-Try listeners claim a 5s anonymous profession profile without audio stutter!)
  const [liveSessionId, setLiveSessionId] = useState<string>(recommendation.sessionId);
  const [isEphemeral, setIsEphemeral] = useState<boolean>(Boolean(recommendation.ephemeralMode));
  const [claimProfession, setClaimProfession] = useState('');
  const [claimAge, setClaimAge] = useState('');
  const [claimingProfile, setClaimingProfile] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedSyncCode, setClaimedSyncCode] = useState<string | null>(null);

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
  const milestonesSentRef = useRef<Set<number>>(new Set());
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
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
  }, [recommendation.sessionId]);

  useEffect(() => {
    setLiveSessionId(recommendation.sessionId);
    setIsEphemeral(Boolean(recommendation.ephemeralMode));
    setClaimedSyncCode(null);
    setClaimError(null);
    setPreviewLocked(false);
    setUnlockError(null);
    milestonesSentRef.current = new Set();
  }, [recommendation.sessionId, recommendation.ephemeralMode]);

  useEffect(() => {
    if (isPro && previewLocked) {
      setPreviewLocked(false);
    }
  }, [isPro, previewLocked]);

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  // Start instant audio + 2-Speed custom vibe resolution / crossfade
  useEffect(() => {
    let mounted = true;
    switchedAwayRef.current = false;
    milestonesSentRef.current = new Set();
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
              dub_reggae: [],
              ambient_space: [],
              solo_piano: [],
              bossa_nova: [],
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

        const hasCachedCustom = Boolean(
          recommendation.customTrackUrl && recommendation.customGenreLabel
        );

        await engineRef.current?.start(
          recommendation.params,
          recommendation.plannedDurationMin,
          `${recommendation.arm.name} · ${titleLabel}`,
          recommendation.isControlTrial,
          recommendation.executableSpec,
          initialCarrier,
          API_BASE,
          hasCachedCustom
        );

        if (!mounted) return;
        setIsPlaying(true);
        setAudioStarted(true);
        if (engineRef.current) {
          setGenre(engineRef.current.getGenre());
        }

        // Case A: Custom vibe already exists in Cloudflare R2 Community Cache -> immediate HTTP Range streaming!
        if (hasCachedCustom && recommendation.customTrackUrl && recommendation.customGenreLabel) {
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
    if (isEphemeral) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && !endedByUserRef.current && elapsedRef.current > 0) {
        // Checkpoint-only: never penalizes locking phone screen while listening in background!
        api.sendSessionBeacon({
          sessionId: liveSessionId,
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
          sessionId: liveSessionId,
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
  }, [liveSessionId, isEphemeral]);

  // Main 1-second session ticker + 90s progress checkpoint + 25/50/75/90% retention curve milestones
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        const tel = engineRef.current?.updateElapsed(next);
        if (tel) setTelemetry(tel);

        // 4-point behavioral listening retention milestones (25% / 50% halfway / 75% deep / 90% full)
        if (!isEphemeral && plannedSec > 0) {
          const ratio = next / plannedSec;
          const checkpoints: Array<{ pct: number; ratio: number; event: 'milestone_25' | 'milestone_50' | 'milestone_75' | 'milestone_90' }> = [
            { pct: 25, ratio: 0.25, event: 'milestone_25' },
            { pct: 50, ratio: 0.5, event: 'milestone_50' },
            { pct: 75, ratio: 0.75, event: 'milestone_75' },
            { pct: 90, ratio: 0.9, event: 'milestone_90' },
          ];
          for (const cp of checkpoints) {
            if (ratio >= cp.ratio && !milestonesSentRef.current.has(cp.pct)) {
              milestonesSentRef.current.add(cp.pct);
              api.sendSessionBeacon({
                sessionId: liveSessionId,
                event: cp.event,
                actualDurationSec: next,
                audioStarted: audioStartedRef.current,
                liveAdjustments: adjustmentsRef.current,
              });
            }
          }
        }

        // Periodic checkpoint every 90s (D1 free-tier write friendly)
        if (!isEphemeral && next > 0 && next % 90 === 0) {
          void api
            .saveProgress({
              sessionId: liveSessionId,
              actualDurationSec: next,
              liveAdjustments: adjustmentsRef.current,
            })
            .catch(() => {});
        }

        // 5-Minute Free Preview Gate for non-Pro listeners (smooth 2-second fade-out -> Stripe Unlock)
        if (!isPro && next >= FREE_PREVIEW_LIMIT_SEC && plannedSec > FREE_PREVIEW_LIMIT_SEC) {
          window.clearInterval(id);
          setIsPlaying(false);
          setPreviewLocked(true);
          void engineRef.current?.fadeOutAndPause(2.0);
          if (!isEphemeral) {
            void api
              .saveProgress({
                sessionId: liveSessionId,
                actualDurationSec: next,
                liveAdjustments: adjustmentsRef.current,
              })
              .catch(() => {});
          }
          return next;
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
            sessionIdOverride: liveSessionId,
            ephemeralOverride: isEphemeral,
          });
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [isPlaying, isPro, plannedSec, liveSessionId, isEphemeral, onFinishToDebrief]);

  const togglePlay = async () => {
    if (!isPro && previewLocked) {
      return;
    }
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
          },
          async () => {
            try {
              const fresh = await api.getLyriaRealtimeToken();
              return fresh.available && fresh.token
                ? { token: fresh.token, model: fresh.model ?? 'models/lyria-realtime-exp' }
                : null;
            } catch {
              return null;
            }
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
    const keepLyria = carrierMode === 'lyria_realtime';
    if (!keepLyria && carrierMode !== 'studio_library') {
      setCarrierMode('studio_library');
      setAudioSource('studio_library');
      engineRef.current?.setCarrierMode('studio_library');
    }
    engineRef.current?.setGenre(style);
    setAdjustments((prev) => [
      ...prev,
      { atSec: elapsedRef.current, control: 'genre', delta: 0, note: style },
    ]);
    if (!isEphemeral) {
      void api
        .updateSessionGenre({
          sessionId: liveSessionId,
          genre: style,
          customGenreSlug: null,
          audioSource: keepLyria ? 'lyria_realtime' : 'studio_library',
          atSec: elapsedRef.current,
        })
        .catch(() => {});
    }
  };

  const handleClaimProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimError(null);
    const parsedAge = Number(claimAge);
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 95) {
      setClaimError('Enter an age between 18 and 95.');
      return;
    }
    if (claimProfession.trim().length < 2) {
      setClaimError('Enter your profession (e.g. Doctor, Programmer, Student, Driver).');
      return;
    }
    setClaimingProfile(true);
    try {
      const res = await api.claimQuickTryProfile({
        occupationLabel: claimProfession.trim(),
        age: Math.round(parsedAge),
        currentState: recommendation.currentState,
        targetState: recommendation.targetState,
        environment: recommendation.environment,
        device: recommendation.device,
        plannedDurationMin: recommendation.plannedDurationMin,
        actualDurationSec: elapsedRef.current,
        armId: recommendation.arm.id,
        armName: recommendation.arm.name,
        studySpecId: recommendation.executableSpec?.id,
        musicGenre: genre,
        energyTier: recommendation.params.energyTier,
        acousticParams: recommendation.params,
        citedStudyIds: recommendation.arm.studyIds,
      });
      saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
      setLiveSessionId(res.sessionId);
      setIsEphemeral(false);
      setClaimedSyncCode(res.syncCode);
      onSessionClaimed?.(res);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Unable to save profile right now.');
    } finally {
      setClaimingProfile(false);
    }
  };

  const handleEndSession = () => {
    endedByUserRef.current = true;
    engineRef.current?.stop();
    setIsPlaying(false);
    if (!isEphemeral) {
      void api
        .saveProgress({
          sessionId: liveSessionId,
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
      sessionIdOverride: liveSessionId,
      ephemeralOverride: isEphemeral,
    });
  };

  const progressPct = Math.min(100, (elapsedSec / plannedSec) * 100);
  const livePapers = recommendation.livePubMedPapers ?? [];
  const activeVibeDisplay = activeCustomLabel
    ? getGenreDisplayMeta(recommendation.customGenreSlug ?? genre, activeCustomLabel)
    : getGenreDisplayMeta(genre);

  const activeSourceShort =
    telemetry.carrierMode === 'lyria_realtime'
      ? `${activeVibeDisplay.label} · Infinite AI`
      : telemetry.carrierMode === 'pure_stimulus'
        ? 'Pure Acoustic Signal'
        : telemetry.usingCustomTrack || audioSource === 'community_cache'
          ? activeVibeDisplay.label
          : telemetry.usingStudioAudio
            ? `${activeVibeDisplay.label} · Studio`
            : activeVibeDisplay.label;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      {recommendation.safetyMode && (
        <div className="animate-rise rounded-2xl border border-amber-400/40 bg-amber-500/12 p-3.5 backdrop-blur-md">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="space-y-0.5 text-xs text-amber-100">
              <div className="font-semibold uppercase tracking-wide text-amber-300">
                Driving Safety Mode Active
              </div>
              {recommendation.safetyWarnings[0] && (
                <p className="leading-relaxed text-amber-100/90">{recommendation.safetyWarnings[0]}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Brief Custom Music Background Status (disappears once crossfaded) */}
      {customGenState === 'generating' && activeCustomLabel && (
        <div className="animate-rise flex items-center gap-2.5 rounded-2xl border border-fuchsia-400/35 bg-fuchsia-500/12 px-4 py-2.5 text-xs text-fuchsia-100 backdrop-blur-md">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fuchsia-300" />
          <span>
            Crafting custom <strong>“{activeCustomLabel}”</strong> — playing{' '}
            <strong>{GENRE_META[genre].label}</strong> smoothly while it blends in.
          </span>
        </div>
      )}

      {customGenState === 'notice' && customGenNotice && (
        <div className="animate-rise flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span>{customGenNotice}</span>
        </div>
      )}

      {/* STANDALONE FULL-FOCUS PLAYER STAGE (Distraction-Free) */}
      <div className="animate-rise glass-stage rounded-3xl border border-cyan-400/20 p-5 sm:p-8 space-y-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        {/* Minimal Header: Goal + Active Music + Timer */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200">
              <Music2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{activeSourceShort}</span>
              {telemetry.currentModHz > 0 && (
                <span className="shrink-0 text-cyan-300/80">· {telemetry.currentModHz} Hz</span>
              )}
            </div>
            <h1 className="font-display text-xl font-bold text-white sm:text-2xl leading-tight">
              <span className="text-aurora">{TARGET_LABELS[recommendation.targetState]}</span>
            </h1>
            <p className="text-[11px] text-slate-400">
              {STATE_LABELS[recommendation.currentState]} → {TARGET_LABELS[recommendation.targetState]} ·{' '}
              {DEVICE_LABELS[recommendation.device]}
            </p>
          </div>

          <div className="shrink-0 text-right space-y-1">
            <div className="font-mono-tech text-3xl font-bold tracking-tight text-white sm:text-4xl leading-none">
              {formatTimer(elapsedSec)}
            </div>
            <div className="font-mono-tech text-[11px] text-slate-400">
              of {recommendation.plannedDurationMin}:00 min
            </div>
            {!isPro && plannedSec > FREE_PREVIEW_LIMIT_SEC && (
              <button
                type="button"
                onClick={() => onUpgradePro?.()}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono-tech text-[10px] font-semibold transition ${
                  FREE_PREVIEW_LIMIT_SEC - elapsedSec <= 30
                    ? 'border-amber-400/60 bg-amber-400/20 text-amber-200 animate-pulse'
                    : 'border-amber-400/35 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'
                }`}
                title="Free preview lasts 5 minutes. Upgrade to Pro for unlimited full sessions."
              >
                <Clock className="h-3 w-3" />
                {previewLocked
                  ? 'Preview ended'
                  : `Free · ${formatTimer(Math.max(0, FREE_PREVIEW_LIMIT_SEC - elapsedSec))}`}
              </button>
            )}
          </div>
        </div>

        {/* Centerpiece 60fps Neural Soundwave Visualizer */}
        <NeuralVisualizer
          engine={engineRef.current}
          isPlaying={isPlaying}
          safetyMode={recommendation.safetyMode}
          modulationHz={telemetry.currentModHz}
        />

        {/* Synchronized 0.1 Hz HRV Breathing Guide (only shown on calm breathing protocols) */}
        {telemetry.hrvActive && telemetry.hrvBreathPhase && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-200">
                Breathe with the wave ·{' '}
                <span className="uppercase tracking-wider text-white">
                  {telemetry.hrvBreathPhase === 'inhale' ? 'Inhale Slowly (5s)' : 'Exhale Smoothly (5s)'}
                </span>
              </span>
              <span className="font-mono-tech text-[10px] text-emerald-300">6 breaths/min</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-all duration-300"
                style={{ width: `${Math.max(8, Math.round(telemetry.hrvBreathProgress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Clean Session Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-cyan-300">
              <Activity className="h-3.5 w-3.5" />
              {telemetry.phaseLabel}
              {telemetry.antiMonotonyActive && (
                <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                  Fresh pulse
                </span>
              )}
            </span>
            <span className="font-mono-tech text-slate-400">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/90">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-amber-300 shadow-[0_0_14px_rgba(34,211,238,0.55)] transition-all duration-500"
              style={{ width: `${Math.max(2, progressPct)}%` }}
            />
          </div>
        </div>

        {/* 1-Tap Studio Mix vs Infinite Live AI (Never-Repeating) Switch */}
        {lyriaRealtimeAvailable && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-400/20 bg-indigo-500/[0.06] px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
              <span>
                {carrierMode === 'lyria_realtime'
                  ? 'Infinite Live AI active — evolving continuously with zero loops.'
                  : 'Want music that never repeats on long sessions?'}
              </span>
            </div>
            <div className="inline-flex shrink-0 items-center rounded-xl border border-slate-800 bg-slate-950/90 p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => void handleCarrierSwitch('studio_library')}
                className={`rounded-lg px-2.5 py-1 transition ${
                  carrierMode !== 'lyria_realtime'
                    ? 'bg-cyan-400/20 text-cyan-100'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Studio Mix
              </button>
              <button
                type="button"
                disabled={connectingLyria}
                onClick={() => void handleCarrierSwitch('lyria_realtime')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 transition ${
                  carrierMode === 'lyria_realtime'
                    ? 'bg-indigo-500/35 text-indigo-100 shadow-[0_0_12px_rgba(129,140,248,0.3)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {connectingLyria ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {connectingLyria ? 'Starting…' : 'Infinite AI'}
              </button>
            </div>
          </div>
        )}

        {/* Clean Primary Control Dock: Play/Pause + Volume + End & Rate */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/65 p-3.5 sm:px-5 sm:py-4">
          <div className="flex flex-1 items-center gap-3.5 min-w-[190px]">
            <button
              type="button"
              onClick={() => void togglePlay()}
              className="btn-aurora inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.3)]"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6 fill-slate-950" />
              ) : (
                <Play className="h-6 w-6 translate-x-0.5 fill-slate-950" />
              )}
            </button>

            <div className="flex-1 max-w-[180px] space-y-1">
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

          <button
            type="button"
            onClick={handleEndSession}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:bg-emerald-300 sm:px-5 sm:py-3 sm:text-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isEphemeral ? 'End Session' : 'End & Rate'}
          </button>
        </div>

        {/* Optional 5-Second Profession Claim (only if entering from an anonymous quick-try link) */}
        {!recommendation.safetyMode &&
          recommendation.sessionId.startsWith('eph_quick_') &&
          (claimedSyncCode ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-100">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <strong>Saved ({claimProfession.trim()})</strong>
              </span>
              <span className="font-mono-tech text-[11px] text-emerald-200">{claimedSyncCode}</span>
            </div>
          ) : (
            <form
              onSubmit={(e) => void handleClaimProfile(e)}
              className="rounded-2xl border border-indigo-400/25 bg-indigo-500/[0.07] p-3 space-y-2"
            >
              <div className="text-[11px] font-semibold text-indigo-100">
                Save your progress while you listen (anonymous):
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  maxLength={40}
                  value={claimProfession}
                  onChange={(e) => {
                    setClaimProfession(e.target.value);
                    setClaimError(null);
                  }}
                  placeholder="Profession (e.g. Doctor, Programmer, Student)"
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={95}
                  value={claimAge}
                  onChange={(e) => {
                    setClaimAge(e.target.value);
                    setClaimError(null);
                  }}
                  placeholder="Age 18+"
                  className="font-mono-tech w-full rounded-xl border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none sm:w-24"
                />
                <button
                  type="submit"
                  disabled={claimingProfile}
                  className="btn-aurora shrink-0 rounded-xl px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-60"
                >
                  {claimingProfile ? 'Saving...' : 'Save'}
                </button>
              </div>
              {claimError && <p className="text-[11px] text-rose-300">{claimError}</p>}
            </form>
          ))}
      </div>

      {/* 2 Discreet Collapsible Drawer Triggers (Collapsed by default = 100% Zen Player) */}
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={() => setOpenDrawer((prev) => (prev === 'tune' ? 'none' : 'tune'))}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition ${
            openDrawer === 'tune'
              ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100'
              : 'border-white/10 bg-slate-900/60 text-slate-300 hover:border-cyan-400/40 hover:text-white'
          }`}
        >
          <Sliders className="h-3.5 w-3.5 text-cyan-300" />
          <span>Tune Sound &amp; Music</span>
          {openDrawer === 'tune' ? (
            <ChevronUp className="h-3.5 w-3.5 opacity-75" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 opacity-75" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpenDrawer((prev) => (prev === 'science' ? 'none' : 'science'))}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition ${
            openDrawer === 'science'
              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
              : 'border-white/10 bg-slate-900/60 text-slate-300 hover:border-emerald-400/40 hover:text-white'
          }`}
        >
          <Waves className="h-3.5 w-3.5 text-emerald-300" />
          <span>Live Oscilloscope &amp; Science</span>
          {openDrawer === 'science' ? (
            <ChevronUp className="h-3.5 w-3.5 opacity-75" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 opacity-75" />
          )}
        </button>
      </div>

      {/* Collapsible Drawer 1: Live Sound Tweaks, Genre Switcher, Audio Engine & 15s Reaction Test */}
      {openDrawer === 'tune' && (
        <div className="animate-step glass-card rounded-3xl p-5 sm:p-6 space-y-5">
          {/* Fine Live Tweaks */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
              <Sliders className="h-3.5 w-3.5 text-cyan-300" /> Live Sound Balance
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
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
                Wave −
              </button>
              <button
                type="button"
                onClick={() => tweakModulation(0.2)}
                className="subtle-chip rounded-xl px-3 py-1.5 text-xs font-medium"
              >
                Wave +
              </button>
            </div>
          </div>

          {/* Music Style Switcher */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
                <Music2 className="h-3.5 w-3.5 text-cyan-400" />
                Switch Music Style Live
              </span>
              {telemetry.backgroundAudioActive && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
                  <Radio className="h-3 w-3" />
                  Background Audio Ready
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
                    className={`rounded-xl border px-3 py-2 text-left transition-all ${
                      active
                        ? 'border-cyan-400/70 bg-cyan-400/14 text-white'
                        : 'border-slate-800/80 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold">{meta.label}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{meta.shortDesc}</div>
                  </button>
                );
              })}
              <div
                aria-disabled="true"
                className="cursor-not-allowed select-none rounded-xl border border-dashed border-slate-800/80 bg-slate-900/30 px-3 py-2 text-left opacity-70"
              >
                <div className="flex items-center justify-between gap-1 text-xs font-semibold text-slate-400">
                  <span>Other Styles</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-400">
                    Soon
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">More curated genres coming soon</div>
              </div>
            </div>
          </div>

          {/* Audio Engine Switcher */}
          <div className="space-y-2 border-t border-slate-800/80 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-cyan-200">Audio Engine</span>
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
                          ? 'border-cyan-400/70 bg-cyan-400/18 text-white'
                          : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight">
                        {m === 'generative_live'
                          ? 'Live Composer'
                          : m === 'studio_library'
                            ? 'Studio Audio'
                            : m === 'pure_stimulus'
                              ? 'Pure Sound Wave'
                              : connectingLyria
                                ? 'Connecting…'
                                : lyriaRealtimeAvailable
                                  ? 'Lyria Live AI'
                                  : 'Lyria AI'}
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

          {/* Optional 15-Second Reaction Speed Check */}
          {!recommendation.safetyMode && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] px-4 py-3">
              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                  <Zap className="h-3.5 w-3.5 text-cyan-300" />
                  {pvtPreMs !== null
                    ? `Baseline Recorded: ${pvtPreMs} ms`
                    : 'Optional 15s Reaction Speed Test'}
                </div>
                <p className="text-[11px] text-slate-400">
                  {pvtPreMs !== null
                    ? 'Retest at the end to measure your millisecond shift.'
                    : 'Tap 5 quick flashes to measure your speed before vs. after.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrePvt(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
              >
                <Zap className="h-3.5 w-3.5" />
                {pvtPreMs !== null ? 'Retake' : 'Test Now (15s)'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Drawer 2: Live Signal Scope, Acoustic Telemetry & Verified Studies */}
      {openDrawer === 'science' && (
        <div className="animate-step glass-card rounded-3xl p-5 sm:p-6 space-y-5">
          {/* Live 60fps 100%-Measured Real-Time Web Audio Oscilloscope */}
          <LiveEnvelopeProof
            engine={engineRef.current}
            isPlaying={isPlaying}
            entrainmentType={telemetry.entrainmentType}
            frequencyHz={telemetry.currentModHz}
            depth={telemetry.currentModDepth}
            carrierLabel={activeSourceShort}
            tuningA4Hz={telemetry.tuningA4Hz}
            isPureWave={carrierMode === 'pure_stimulus'}
            onTogglePureWave={() =>
              void handleCarrierSwitch(
                carrierMode === 'pure_stimulus' ? 'studio_library' : 'pure_stimulus'
              )
            }
          />

          {/* Compact Telemetry Strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Wave</div>
              <div className="font-mono-tech mt-0.5 text-sm font-semibold text-cyan-300">
                {telemetry.currentModHz > 0 ? `${telemetry.currentModHz} Hz` : `A=${telemetry.tuningA4Hz} Hz`}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Depth</div>
              <div className="font-mono-tech mt-0.5 text-sm font-semibold text-indigo-300">
                {Math.round(telemetry.currentModDepth * 100)}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Tempo</div>
              <div className="font-mono-tech mt-0.5 text-sm font-semibold text-white">
                {telemetry.currentBpm > 0 ? `${telemetry.currentBpm} BPM` : 'Beatless'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Noise Bed</div>
              <div className="font-mono-tech mt-0.5 text-sm font-semibold text-slate-200 capitalize">
                {telemetry.noiseColor === 'none' ? 'Clean' : telemetry.noiseColor.replace('_', ' ')}
              </div>
            </div>
          </div>

          {/* Verified Peer-Reviewed Studies */}
          <div className="space-y-3 border-t border-slate-800/80 pt-4">
            <div className="flex items-center gap-2 text-cyan-300">
              <BookOpen className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-white">
                Peer-Reviewed Science Powering This Sound
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-300">{recommendation.rationale}</p>

            {recommendation.executableSpec && (
              <StudyFidelityMatrix spec={recommendation.executableSpec} />
            )}

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {recommendation.studies.map((study) => (
                <a
                  key={study.id}
                  href={study.doiOrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-2xl border border-slate-800/90 bg-slate-950/60 p-3.5 space-y-1 transition hover:border-cyan-400/45"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11px] font-semibold text-cyan-300">
                      {study.authors.split(',')[0]} et al. ({study.year})
                    </div>
                    <ExternalLink className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-cyan-300" />
                  </div>
                  <div className="text-xs font-medium text-white group-hover:text-cyan-100">
                    {study.title}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">{study.summary}</p>
                </a>
              ))}
            </div>

            {livePapers.length > 0 && (
              <div className="space-y-2 border-t border-slate-800/80 pt-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  Live Matched Studies (NIH PubMed &amp; OpenAlex)
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {livePapers.map((paper) => (
                    <a
                      key={paper.pmid}
                      href={paper.doiUrl || paper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3 space-y-1 transition hover:border-emerald-400/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-tech text-[9px] font-semibold uppercase text-emerald-300">
                          {paper.source === 'openalex' ? 'OpenAlex' : 'NIH PubMed'} · {paper.year}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-emerald-300" />
                      </div>
                      <div className="text-xs font-medium leading-snug text-white">
                        {paper.title}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5-Minute Free Preview Complete -> Stripe Pro Unlock Overlay */}
      {previewLocked && !isPro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/82 p-4 backdrop-blur-md">
          <div className="animate-step glass-stage my-auto w-full max-w-lg rounded-3xl border border-amber-400/40 p-5 sm:p-7 space-y-5">
            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-amber-400/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-200">
                <Lock className="h-3.5 w-3.5" />
                5-Minute Free Preview Complete
              </div>
              <h2 className="font-display text-2xl font-bold text-white sm:text-[1.65rem] leading-tight">
                Keep this feeling going —{' '}
                <span className="text-aurora">unlock the full session.</span>
              </h2>
              <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
                Your custom <strong className="text-white">{activeVibeDisplay.label}</strong> +{' '}
                <strong className="text-cyan-200">{recommendation.arm.name}</strong> mix is tuned
                for your full {recommendation.plannedDurationMin}-minute session.
              </p>
            </div>

            {/* Annual vs Monthly Plan Picker */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSelectedPaywallPlan('annual')}
                className={`relative rounded-2xl border p-4 text-left transition ${
                  selectedPaywallPlan === 'annual'
                    ? 'border-amber-400 bg-amber-400/12 shadow-[0_0_24px_rgba(251,191,36,0.18)]'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                }`}
              >
                <span className="absolute -top-2.5 right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950">
                  Save 50%
                </span>
                <div className="text-xs font-semibold text-amber-200">Annual Pro</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono-tech text-2xl font-bold text-white">$59</span>
                  <span className="text-xs text-slate-400">/ year</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">$4.92/mo · billed yearly</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedPaywallPlan('monthly')}
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedPaywallPlan === 'monthly'
                    ? 'border-cyan-400 bg-cyan-400/12 shadow-[0_0_24px_rgba(34,211,238,0.18)]'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-semibold text-cyan-200">Monthly Pro</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono-tech text-2xl font-bold text-white">$9.99</span>
                  <span className="text-xs text-slate-400">/ month</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Cancel anytime in 1 click</div>
              </button>
            </div>

            <ul className="space-y-1.5 rounded-2xl border border-slate-800/90 bg-slate-950/65 p-3.5 text-xs text-slate-200">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>Unlimited full-length sessions (15, 30, 45, 60 min — zero cutoffs)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>All 10 curated instrumental styles + Infinite Live AI (never repeats)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>Real-time oscilloscope proof, Pure Wave audition &amp; Science Study Lab</span>
              </li>
            </ul>

            {unlockError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {unlockError}
              </div>
            )}

            <button
              type="button"
              disabled={unlockingCheckout}
              onClick={async () => {
                setUnlockError(null);
                if (!stripeAvailable || !onStartDirectCheckout) {
                  onUpgradePro?.();
                  return;
                }
                setUnlockingCheckout(true);
                try {
                  await onStartDirectCheckout(selectedPaywallPlan);
                } catch (err) {
                  setUnlockError(
                    err instanceof Error ? err.message : 'Unable to open Stripe Checkout right now.'
                  );
                  setUnlockingCheckout(false);
                }
              }}
              className="btn-aurora flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 disabled:opacity-60 sm:text-base"
            >
              {unlockingCheckout ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              {unlockingCheckout
                ? 'Opening Secure Stripe Checkout...'
                : selectedPaywallPlan === 'annual'
                  ? 'Unlock Full Session · $59/year'
                  : 'Unlock Full Session · $9.99/month'}
            </button>

            <div className="flex flex-col items-center gap-2 pt-0.5 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Secured by Stripe · Instant unlock · Cancel anytime</span>
              </div>
              <button
                type="button"
                onClick={handleEndSession}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 underline-offset-2 transition hover:text-cyan-200 hover:underline"
              >
                <Crown className="h-3 w-3 opacity-60" />
                Not now — end preview &amp; rate how I feel
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrePvt && (
        <PvtBenchmarkModal
          phase="pre"
          onComplete={(res) => {
            setPvtPreMs(res.medianMs);
            setPvtLapsesPre(res.lapses);
            setShowPrePvt(false);
            if (!isEphemeral && !liveSessionId.startsWith('eph_')) {
              void api
                .saveSessionPvt({
                  sessionId: liveSessionId,
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
