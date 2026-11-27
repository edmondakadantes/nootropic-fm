import {
  computeHarmonicCarrierHz,
  resolvedGenreToPalette,
  type CarrierEngineMode,
  type EntrainmentType,
  type ExecutableStudySpec,
  type StudyMusicSpec,
  type TonalMode,
} from '../../shared/studySpec';
import type {
  AcousticParams,
  EnergyTier,
  NoiseColor,
  ResolvedGenre,
} from '../../shared/types';
import {
  computeDownbeatPhaseDelaySec,
  pickPlaybackGridRate,
} from '../../shared/subharmonicGrid';
import {
  BUTTERWORTH_LP_HP_Q_DB,
  LIMITER_CEILING_LINEAR,
  computeExactAmGainPair,
  computeParabolicPeakHz,
  computePeriodicWaveStats,
  createSilentKeepAliveWavBytes,
} from './dspMath';
import { ensureDspWorkletsLoaded } from './dspWorklets';
import { GenerativeComposer } from './GenerativeComposer';
import { LyriaRealtimeClient, type LyriaRealtimeStatus } from './LyriaRealtimeClient';
import { createCalibratedNoiseBuffer, MedicalStimulusRack, type GammaStimulusMode } from './MedicalStimulusRack';
import { canUseWebCodecsOpus, streamOpusIntoWorklet } from './ProgressiveStemDecoder';
import { StereoRainBed } from './StereoRainBed';
import {
  MUSIC_FADE_IN_AFTER_VOICE_SEC,
  MUSIC_VOICE_DUCK_GAIN,
  VoiceConciergePlayer,
} from './VoiceConciergePlayer';
import {
  bindNativeMediaActionHandler,
  isNativeMobileApp,
  notifyNativeAudioState,
} from '../lib/platform';

export type SessionPhase = 'entry' | 'plateau' | 'landing';
export type LayerMonitorMode = 'full_mix' | 'science_only' | 'music_only';

export interface StudioTrackRef {
  key: string;
  name: string;
  url: string;
  energy: EnergyTier;
  bpm?: number;
  lufs?: number;
  rootMidi?: number;
  keyLabel?: string;
  opusUrl?: string;
  aacUrl?: string;
  subHarmonicBpm?: number;
  alignedBandsHz?: number[];
  downbeatOffsetMs?: number;
  sampleRate?: number;
  v7Remastered?: boolean;
  durationSec?: number;
  darwinianFitScore?: number;
}

export interface EngineTelemetry {
  phase: SessionPhase;
  phaseLabel: string;
  progressRatio: number;
  currentModHz: number;
  currentModDepth: number;
  crossoverHz: number;
  upperCrossoverHz: number;
  stereoAmActive: boolean;
  energyTier: EnergyTier;
  currentBpm: number;
  antiMonotonyActive: boolean;
  genre: ResolvedGenre;
  backgroundAudioActive: boolean;
  usingStudioAudio: boolean;
  usingCustomTrack?: boolean;
  activeTrackName: string | null;
  activeTrackKey?: string | null;
  activeTrackKeyLabel?: string | null;
  // v3.0 Study-to-Sound & Live As-We-Go Telemetry
  carrierMode: CarrierEngineMode;
  entrainmentType: EntrainmentType;
  stimulusCarrierLabel: string;
  tuningA4Hz: 440 | 432;
  tonalMode: TonalMode;
  noiseColor: NoiseColor;
  noiseSnrDb: number;
  hrvActive: boolean;
  hrvBreathPhase: 'inhale' | 'exhale' | null;
  hrvBreathProgress: number;
  lyriaStatus: LyriaRealtimeStatus;
  usingRealSamples?: boolean;
  studioRetuned432?: boolean;
  layerMonitorMode: LayerMonitorMode;
  momentaryLufs: number | null;
  truePeakDbtp: number | null;
  gammaMode: GammaStimulusMode;
  alphaIafHz: number | null;
  hugginsStatus: 'untested' | 'verified_stereo' | 'monaural_safe';
  bluetoothSafeActive: boolean;
  band2FlattenerActive: boolean;
  stemCodecLabel: string | null;
  stemSubHarmonicLocked: boolean;
  audioInterrupted?: boolean;
  autopilotLiftActive?: boolean;
  tunnelLockProgress?: number;
  hrvClosedLoopTrim?: number;
  dopamineArcPhase?: 'groove' | 'riser' | 'drop';
  ignitionStage?: 'decompression' | 'ignition' | 'flow_locked';
}

/**
 * Even-harmonic Studer-style Analog Tape Warmth Curve (exact 0.000 DC offset at x=0, Layer-2 music only).
 */
function createAnalogTapeWarmthCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const tanhNorm = Math.tanh(1.08);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const raw = Math.tanh(x * 1.08) / tanhNorm + 0.024 * x * x * (1 - x * x);
    curve[i] = Math.max(-0.99, Math.min(0.99, raw));
  }
  return curve;
}

/**
 * Transparent Mastering Soft-Knee Clipper Curve:
 * Linear (0.000% harmonic distortion) below |0.72|, gentle analog tanh saturation above |0.72|
 * capping absolute master peaks below -0.80 dBFS (0.912).
 */
function createMasteringLimiterCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const knee = 0.72;
  const headroom = 0.192;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const ax = Math.abs(x);
    curve[i] =
      ax <= knee
        ? x
        : Math.sign(x) * (knee + headroom * Math.tanh((ax - knee) / headroom));
  }
  return curve;
}

/**
 * Procedural 2.4-second Stereo Studio Hall Impulse Response.
 */
function createStudioReverbIR(ctx: AudioContext, durationSec = 2.4): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const ir = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.min(1, i / (rate * 0.025)) * Math.pow(1 - t, 2.7);
      const white = Math.random() * 2 - 1;
      const alpha = 0.28 * (1 - t * 0.65);
      lp = lp + alpha * (white - lp);
      data[i] = lp * env * 0.85;
    }
  }
  return ir;
}

/**
 * Phase-Coherent 3-Band Linkwitz-Riley (LR4, 24 dB/oct) Crossover helpers.
 * Uses exact Butterworth dB Q (-3.0103 dB = 20*log10(1/sqrt(2))) for Web Audio lowpass/highpass
 * so LP4 + HP4 sums to 0.0000 dB flat across the entire spectrum.
 */
function createLR4Filter(
  ctx: AudioContext,
  type: 'lowpass' | 'highpass',
  frequency: number
): { input: BiquadFilterNode; output: BiquadFilterNode } {
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.type = type;
  f2.type = type;
  f1.frequency.value = frequency;
  f2.frequency.value = frequency;
  f1.Q.value = BUTTERWORTH_LP_HP_Q_DB;
  f2.Q.value = BUTTERWORTH_LP_HP_Q_DB;
  f1.connect(f2);
  return { input: f1, output: f2 };
}

function createPhaseShiftedSineWave(ctx: AudioContext, phaseDeg: number): PeriodicWave {
  const rad = (phaseDeg * Math.PI) / 180;
  const real = new Float32Array([0, Math.sin(rad)]);
  const imag = new Float32Array([0, Math.cos(rad)]);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

interface AmWaveBundle {
  wave: PeriodicWave;
  min: number;
  max: number;
  rms: number;
  peakPhaseFraction: number;
}

/**
 * 3-harmonic cortical salience pulse normalized to peak=1 with exact min/max/RMS stats:
 * sharper attack crest resists musical modulation masking (Woods et al. 2024)
 * while preserving exact modulation depth via `computeExactAmGainPair`.
 */
function createNeuralSalienceWave(ctx: AudioContext, phaseDeg: number): AmWaveBundle {
  const rad = (phaseDeg * Math.PI) / 180;
  const amps = [1.0, 0.24, 0.07];
  const phaseShifts = [rad, 2 * rad - Math.PI / 4, 3 * rad - Math.PI / 2];
  const stats = computePeriodicWaveStats(amps, phaseShifts, 1024);
  const norm = stats.normPeak > 0 ? 1 / stats.normPeak : 1;
  const real = new Float32Array(4);
  const imag = new Float32Array(4);
  for (let k = 1; k <= 3; k++) {
    const a = amps[k - 1] * norm;
    const p = phaseShifts[k - 1];
    real[k] = a * Math.sin(p);
    imag[k] = a * Math.cos(p);
  }
  return {
    wave: ctx.createPeriodicWave(real, imag, { disableNormalization: true }),
    min: stats.min,
    max: stats.max,
    rms: stats.rms,
    peakPhaseFraction: stats.peakPhaseFraction,
  };
}

function buildFallbackStudySpec(params: AcousticParams, durationMin: number): ExecutableStudySpec {
  const tonalMap: Record<AcousticParams['harmonicMode'], TonalMode> = {
    bright_maj9: 'major',
    warm_min9: 'minor',
    suspended_open: 'suspended',
    deep_drone: 'drone',
  };
  const rootMidi = Math.max(
    38,
    Math.min(64, Math.round(69 + 12 * Math.log2(Math.max(60, params.rootNoteHz) / 440)))
  );
  return {
    id: 'protocol-fallback',
    shortLabel: 'Adaptive Protocol',
    studyRef: {
      title: 'Adaptive Psychoacoustic Protocol',
      authors: 'nootropic.fm',
      year: String(new Date().getFullYear()),
      journal: 'Peer-Reviewed Baseline',
      url: 'https://app.nootropic.fm',
      source: 'core',
    },
    abstractExcerpt: '',
    compilerMode: 'deterministic_parser',
    compliancePct: 80,
    evidenceMap: [],
    entrainment: {
      type:
        params.binauralOffsetHz > 0 && !params.speakerSafeEQ && params.modulationDepth <= 0.05
          ? 'binaural_beat'
          : params.modulationHz > 0
            ? 'amplitude_modulation'
            : 'none',
      frequencyHz: params.modulationHz,
      modulationBandHz: [params.crossoverHz || 190, params.upperCrossoverHz || 4500],
      modulationDepth: params.modulationDepth,
      waveform: 'sine',
      phaseOffsetDeg: params.stereoAmSpread ? 32 : 0,
    },
    music: {
      defaultCarrierMode: 'generative_live',
      bpm: params.bpm,
      tonalMode: tonalMap[params.harmonicMode] ?? 'suspended',
      tuningA4Hz: 440,
      rootMidi,
      percussion:
        params.bpm === 0 || params.pulseIntensity < 0.15
          ? 'none'
          : params.pulseIntensity < 0.45
            ? 'minimal_soft'
            : 'steady_pulse',
      density: Math.max(0.22, Math.min(0.75, params.pulseIntensity || 0.42)),
      brightness: Math.max(0.22, Math.min(0.8, (params.filterCutoffHz || 1500) / 3000)),
      spectralLowPassHz: params.filterCutoffHz || 1650,
      instrumentPalette: resolvedGenreToPalette(params.genre),
      vibeTags: ['lyric-free', 'adaptive'],
      lyriaWeightedPrompts: [],
    },
    noise: {
      color: params.noiseColor,
      snrDb:
        params.noiseColor === 'none' || params.noiseLevel <= 0.005
          ? -36
          : Math.round(20 * Math.log10(Math.max(0.015, params.noiseLevel / 0.48))),
    },
    protocol: {
      recommendedDurationMin: durationMin,
      targetState: 'alert_focus',
      requiresHeadphones: false,
      drivingSafe: params.speakerSafeEQ,
      safetyNotes: [],
    },
  };
}

function holdAndRampGain(gainParam: AudioParam, target: number, endTime: number, now: number): void {
  const p = gainParam as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(now);
  } else {
    p.cancelScheduledValues(now);
    p.setValueAtTime(Math.max(0.0001, p.value), now);
  }
  p.exponentialRampToValueAtTime(Math.max(0.0001, target), endTime);
}

function smoothSetParam(
  param: AudioParam | null | undefined,
  target: number,
  now: number,
  timeConst: number
): void {
  if (!param) return;
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(now);
  } else {
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
  }
  p.setTargetAtTime(target, now, timeConst);
}

function createSilentKeepAliveWavUrl(sampleRate = 48000): string {
  const wavBytes = createSilentKeepAliveWavBytes(sampleRate);
  return URL.createObjectURL(new Blob([wavBytes], { type: 'audio/wav' }));
}

/**
 * nootropic.fm v3.0 Study-to-Sound Audio Engine.
 * Unifies:
 *   - Layer 1: Precision MedicalStimulusRack (3-Band LR4 AM, 40 Hz GENUS, Isochronic, Binaural, Monaural, 0.1 Hz HRV, SNR Noise)
 *   - Layer 2A: GenerativeComposer (Live "As We Go" $0 study-locked composer obeying exact BPM/ramps/key/432Hz/percussion)
 *   - Layer 2B: Dual-Deck Cloudflare R2 Studio Stems + Custom Lyria 3.5 Crossfade
 *   - Layer 2C: Plug-and-Play Google Lyria RealTime WebSocket AI Streaming
 *   - Layer 2D: Pure Clinical Signal mode (audition exact medical signal without background music)
 */
export class PsychoacousticEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scopeMasterAnalyser: AnalyserNode | null = null;
  private scopeModAnalyser: AnalyserNode | null = null;
  private scopeLeftAnalyser: AnalyserNode | null = null;
  private scopeRightAnalyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;

  // Core routing buses
  private cleanSubBus: GainNode | null = null;
  private proceduralMaster: GainNode | null = null;
  private studioBus: GainNode | null = null;
  private studioFilter: BiquadFilterNode | null = null;
  private musicAuditionGain: GainNode | null = null;
  private spectralPocketNotch: BiquadFilterNode | null = null;
  private pureAmCarrierGain: GainNode | null = null;
  private pureAmCarrierSrc: AudioBufferSourceNode | null = null;
  private amScienceCarrierGain: GainNode | null = null;
  private amSciencePulseGain: GainNode | null = null;
  private amSciencePulseDepth: GainNode | null = null;
  private amCarrierRootOsc: OscillatorNode | null = null;
  private amCarrierFifthOsc: OscillatorNode | null = null;
  private amCarrierOctOsc: OscillatorNode | null = null;
  private amCarrierNoiseSrc: AudioBufferSourceNode | null = null;
  private amCarrierRootHz: number | null = null;

  // 3-Band LR4 Cortical AM + Velvet Spectral Tilt + Active Aperiodic Sham nodes
  private amGainL: GainNode | null = null;
  private amGainR: GainNode | null = null;
  private amLfoL: OscillatorNode | null = null;
  private amLfoR: OscillatorNode | null = null;
  private amPeriodicGateL: GainNode | null = null;
  private amPeriodicGateR: GainNode | null = null;
  private amShamGateL: GainNode | null = null;
  private amShamGateR: GainNode | null = null;
  private amShamOscs: OscillatorNode[] = [];
  private amDepthGainL: GainNode | null = null;
  private amDepthGainR: GainNode | null = null;
  private amTiltDepthL: GainNode | null = null;
  private amTiltDepthR: GainNode | null = null;
  private amWaveStats = { min: -1, max: 1, rms: Math.SQRT1_2 };
  private amSalienceStats = { min: -1, max: 1, rms: Math.SQRT1_2 };
  private amPureWaveL: PeriodicWave | null = null;
  private amPureWaveR: PeriodicWave | null = null;
  private amSalienceWaveL: PeriodicWave | null = null;
  private amSalienceWaveR: PeriodicWave | null = null;
  private amUsesSalience = false;
  private amLfoOriginSec = 0;
  private amCrestFrac = 0.25;
  private amSaliencePeakFrac = 0.23;

  // AudioWorklet DSP nodes (Layer-2 Pre-Limiter, Master Safety Limiter, Bauer/MS Crossfeed, Env Follower, Flattener, Pre-Split ZDF Tilt)
  private workletsReady = false;
  private musicPreLimiterNode: AudioWorkletNode | null = null;
  private lookaheadLimiterNode: AudioWorkletNode | null = null;
  private crossfeedNode: AudioWorkletNode | null = null;
  private envFollowerNode: AudioWorkletNode | null = null;
  private band2FlattenerNode: AudioWorkletNode | null = null;
  private amTiltNodeL: AudioNode | null = null;
  private amTiltNodeR: AudioNode | null = null;
  private band2SpectralRotNode: BiquadFilterNode | null = null;
  private mudCleanFilterNode: BiquadFilterNode | null = null;
  private innerVoicePocketNode: BiquadFilterNode | null = null;
  private ignitionArcFilterNode: BiquadFilterNode | null = null;
  private airShimmerPanNode: StereoPannerNode | null = null;
  private activeStemAbort: AbortController | null = null;
  private envSinkGain: GainNode | null = null;
  private scopeFftBuf: Float32Array<ArrayBuffer> | null = null;
  private gammaMode: GammaStimulusMode = 'harmonic_mbi';
  private alphaIafHz: number | null = null;
  private personalFatigueDipMin: number | null = null;
  private hrvClosedLoopTrim = 0;
  private autopilotLiftActive = false;
  private landingChordTriggered = false;
  private hugginsStatus: 'untested' | 'verified_stereo' | 'monaural_safe' = 'untested';
  private bluetoothSafeActive = false;
  private momentaryLufs: number | null = null;
  private truePeakDbtp: number | null = null;

  // Dynamic SNR Music Envelope Follower (keeps Layer 1 stimulus locked at true study SNR)
  private musicEnvAnalyser: AnalyserNode | null = null;
  private musicEnvBuf: Float32Array<ArrayBuffer> | null = null;
  private musicEnvSmoothedRms = 0.165;
  private snrTimer: number | null = null;

  // Modular sub-engines
  private composer = new GenerativeComposer();
  private stimulusRack = new MedicalStimulusRack();
  private lyriaClient = new LyriaRealtimeClient();
  private rainBed = new StereoRainBed();
  private voicePlayer = new VoiceConciergePlayer();
  private musicMasterBus: GainNode | null = null;
  private voiceDuckFilterNode: BiquadFilterNode | null = null;
  private voiceHoldWatchdogTimer: number | null = null;
  private isVoiceSpeaking = false;
  private sessionStartCtxTime = 0;
  private circadianFilterNode: BiquadFilterNode | null = null;
  private circadianMode: 'daylight' | 'night' = 'night';
  private voiceSpeakingListeners = new Set<(speaking: boolean) => void>();

  // Mobile background bridge, iOS 'interrupted' recovery & wake lock
  private audioEl: HTMLAudioElement | null = null;
  private keepAliveEl: HTMLAudioElement | null = null;
  private keepAliveUrl: string | null = null;
  private backgroundAudioActive = false;
  private audioInterrupted = false;
  private lastGestureResumeAtMs = 0;
  private interruptionListeners = new Set<(interrupted: boolean) => void>();
  private gestureResumeCleanup: (() => void) | null = null;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private visibilityHandler: (() => void) | null = null;

  // Dual-Deck Gapless Studio Stem Engine (Cloudflare R2 — Progressive WebCodecs + Pre-Unlocked iOS Safari HTTP 206 Pool)
  private studioCatalog: Partial<Record<ResolvedGenre, StudioTrackRef[]>> = {};
  private bufferCache = new Map<string, AudioBuffer>();
  private readonly maxCachedBuffers = 1;
  private mediaDeckPool: Array<{
    el: HTMLAudioElement;
    srcNode: MediaElementAudioSourceNode;
    generation: number;
    inUse: boolean;
    fadingOut: boolean;
  }> = [];
  private mediaDeckCursor = 0;
  private activeMediaSlot: {
    el: HTMLAudioElement;
    srcNode: MediaElementAudioSourceNode;
    generation: number;
    inUse: boolean;
    fadingOut: boolean;
  } | null = null;
  private activeMediaSlotGen = 0;
  private activeMediaDelayNode: DelayNode | null = null;
  private activeStudioSource: AudioBufferSourceNode | null = null;
  private activeStreamEl: HTMLAudioElement | null = null;
  private activeStreamSource: MediaElementAudioSourceNode | null = null;
  private activeStreamCleanup: (() => void) | null = null;
  private activeStreamCrossfadeCheck: (() => void) | null = null;
  private activeWsolaNode: AudioWorkletNode | null = null;
  private activeWsolaMode: 'none' | 'ring' | 'buffer' = 'none';
  private activeStemPlayerNode: AudioWorkletNode | null = null;
  private activeStemCodecLabel: string | null = null;
  private activeStemSubHarmonicLocked = false;
  private opusSupported: boolean | null = null;
  private activeStudioGain: GainNode | null = null;
  private studioCrossfadeTimer: number | null = null;
  private studioDeckStartedAtCtx = 0;
  private studioDeckCrossfadeDelaySec = 0;
  private studioDeckPausedRemainingSec: number | null = null;
  private studioDeckOnCrossfade: (() => void) | null = null;
  private studioTrackIdx = 0;
  private studioLoadToken = 0;
  private usingStudioAudio = false;
  private usingCustomTrack = false;
  private activeCustomTrack: { url: string; label: string } | null = null;
  private activeTrackName: string | null = null;
  private activeTrackKey: string | null = null;
  private activeTrackKeyLabel: string | null = null;
  private activeTrackNativeBpm = 0;
  private activeStudioAppliedBpm = 0;

  // Active state
  private params: AcousticParams | null = null;
  private studySpec: ExecutableStudySpec | null = null;
  private carrierMode: CarrierEngineMode = 'generative_live';
  private layerMonitorMode: LayerMonitorMode = 'full_mix';
  private genre: ResolvedGenre = 'deep_electronic';
  private isControlTrial = false;
  private isPlaying = false;
  private startToken = 0;
  private pendingCloseTimer: number | null = null;
  private pendingCloseCtx: AudioContext | null = null;
  private volume = 0.74;
  private intensityMultiplier = 1.0;
  private modDepthMultiplier = 1.0;
  private elapsedSec = 0;
  private plannedSec = 1500;
  private lyriaStatus: LyriaRealtimeStatus = 'idle';
  private sampleApiBase = '';

  public async start(
    params: AcousticParams,
    plannedDurationMin: number,
    title = 'nootropic.fm',
    isControlTrial = false,
    executableSpec?: ExecutableStudySpec,
    initialCarrierMode?: CarrierEngineMode,
    sampleApiBase = '',
    skipInitialStudioDeck = false
  ): Promise<void> {
    this.stopImmediate();
    const myStartToken = ++this.startToken;
    this.sampleApiBase = sampleApiBase;
    this.params = { ...params };
    this.studySpec = executableSpec
      ? structuredClone(executableSpec)
      : buildFallbackStudySpec(params, plannedDurationMin);
    this.genre = params.genre ?? 'deep_electronic';
    this.isControlTrial = isControlTrial;
    this.plannedSec = Math.max(60, plannedDurationMin * 60);
    this.elapsedSec = 0;
    this.intensityMultiplier = 1.0;
    this.modDepthMultiplier = 1.0;
    this.hrvClosedLoopTrim = 0;
    this.autopilotLiftActive = false;
    this.landingChordTriggered = false;
    this.carrierMode = initialCarrierMode ?? this.studySpec.music.defaultCarrierMode ?? 'generative_live';
    this.layerMonitorMode = this.carrierMode === 'pure_stimulus' ? 'science_only' : 'full_mix';
    this.gammaMode = this.carrierMode === 'pure_stimulus' ? 'clinical_clicks' : 'harmonic_mbi';
    this.momentaryLufs = null;
    this.truePeakDbtp = null;
    try {
      const savedHuggins = localStorage.getItem('nootropic_fm_huggins_v1');
      if (savedHuggins) {
        const parsed = JSON.parse(savedHuggins) as { passed?: boolean };
        if (parsed.passed === true) this.hugginsStatus = 'verified_stereo';
        else if (parsed.passed === false) this.hugginsStatus = 'monaural_safe';
      }
    } catch {
      // ignore storage errors
    }

    if ('audioSession' in navigator) {
      try {
        (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback';
      } catch {
        // ignore unsupported browser
      }
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx({ latencyHint: 'playback' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume().catch(() => {}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 120)),
      ]);
    }
    if (myStartToken !== this.startToken || this.ctx !== ctx) {
      try {
        await ctx.close();
      } catch {
        // ignore
      }
      return;
    }
    this.workletsReady = await ensureDspWorkletsLoaded(ctx);
    if (myStartToken !== this.startToken || this.ctx !== ctx) {
      try {
        await ctx.close();
      } catch {
        // ignore
      }
      return;
    }

    if (ctx.destination.maxChannelCount >= 2) {
      try {
        ctx.destination.channelCount = 2;
      } catch {
        // ignore read-only hardware destination
      }
    }

    // Layer-2 Pre-Limiting Architecture:
    //   Layer 2 Music + Sub-Bass + Rain -> musicMasterBus -> musicPreLimiter (-3.35 dBTP = 0.68) -> masterSumBus
    //   Layer 1 Clinical Stimuli + AM Reference Pad (peak <= 0.19) -----------------------------> masterSumBus
    //   masterSumBus -> masterSafetyLimiter (-1.0 dBTP = 0.8913) -> masterGain
    // Because 0.68 + 0.19 = 0.87 < 0.8913, loud drum peaks on Layer 2 are absorbed BEFORE masterSumBus,
    // guaranteeing 100.000% mathematical Layer-1 amplitude invariance (0.000 dB ducking)!
    const masterSumBus = ctx.createGain();
    masterSumBus.gain.value = 1.0;
    const musicMasterBus = ctx.createGain();
    musicMasterBus.gain.value = 1.0;
    this.musicMasterBus = musicMasterBus;
    this.isVoiceSpeaking = false;
    this.sessionStartCtxTime = ctx.currentTime;

    const voiceDuckFilter = ctx.createBiquadFilter();
    voiceDuckFilter.type = 'peaking';
    voiceDuckFilter.frequency.setValueAtTime(Math.min(ctx.sampleRate * 0.35, 1250), ctx.currentTime);
    voiceDuckFilter.Q.setValueAtTime(0.80, ctx.currentTime);
    voiceDuckFilter.gain.setValueAtTime(0.0, ctx.currentTime);
    this.voiceDuckFilterNode = voiceDuckFilter;

    this.voicePlayer.attach(ctx, masterSumBus, null, (speaking, skipped) => {
      this.isVoiceSpeaking = speaking;
      this.clearVoiceHoldWatchdog();
      if (speaking) {
        this.scheduleMusicFadeFromVoice(MUSIC_VOICE_DUCK_GAIN, 0.32, -6.0);
      } else {
        this.scheduleMusicFadeFromVoice(
          1.0,
          skipped ? 1.8 : MUSIC_FADE_IN_AFTER_VOICE_SEC,
          0.0
        );
      }
      for (const cb of this.voiceSpeakingListeners) {
        try {
          cb(speaking);
        } catch {
          // ignore
        }
      }
    });

    // Circadian Layer-2 tone shaper: crisp full-spectrum clarity in Daylight Mode (0 dB),
    // gentle melatonin-safe -2.8 dB silk roll-off above 3.2 kHz in Night Mode (Layer-1 untouched!)
    const circadianFilter = ctx.createBiquadFilter();
    circadianFilter.type = 'highshelf';
    circadianFilter.frequency.setValueAtTime(Math.min(ctx.sampleRate * 0.42, 3200), ctx.currentTime);
    circadianFilter.gain.setValueAtTime(this.circadianMode === 'night' ? -2.8 : 0.0, ctx.currentTime);
    this.circadianFilterNode = circadianFilter;
    musicMasterBus.connect(voiceDuckFilter);
    voiceDuckFilter.connect(circadianFilter);

    if (this.workletsReady) {
      const musicPreLim = new AudioWorkletNode(ctx, 'nootropic-lookahead-limiter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const initPreCeil = this.computeMusicPreLimiterCeiling();
      musicPreLim.parameters.get('ceiling')?.setValueAtTime(initPreCeil, ctx.currentTime);
      circadianFilter.connect(musicPreLim);
      musicPreLim.connect(masterSumBus);
      this.musicPreLimiterNode = musicPreLim;
    } else {
      const preClipper = ctx.createWaveShaper();
      preClipper.curve = createMasteringLimiterCurve();
      preClipper.oversample = '2x';
      circadianFilter.connect(preClipper);
      preClipper.connect(masterSumBus);
      this.musicPreLimiterNode = null;
    }

    // Musical Layer 2 Glue Compressor (leveled BEFORE AM & SNR follower so AM & Layer 1 stay 100% linear)
    const musicCompressor = ctx.createDynamicsCompressor();
    musicCompressor.threshold.value = -14;
    musicCompressor.knee.value = 16;
    musicCompressor.ratio.value = 2.0;
    musicCompressor.attack.value = 0.012;
    musicCompressor.release.value = 0.2;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.05, this.volume * 0.84),
      ctx.currentTime + 1.8
    );

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    // Dedicated zero-smoothing Lab Oscilloscope tap on master output (2048 raw IEEE-754 samples)
    const scopeMasterAnalyser = ctx.createAnalyser();
    scopeMasterAnalyser.fftSize = 2048;
    scopeMasterAnalyser.smoothingTimeConstant = 0.0;
    this.scopeFftBuf = new Float32Array(new ArrayBuffer(scopeMasterAnalyser.frequencyBinCount * 4));

    if (this.workletsReady) {
      const limiterNode = new AudioWorkletNode(ctx, 'nootropic-lookahead-limiter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      limiterNode.parameters.get('ceiling')?.setValueAtTime(LIMITER_CEILING_LINEAR, ctx.currentTime);
      limiterNode.port.onmessage = (evt) => {
        if (!this.isPlaying || !evt.data || evt.data.type !== 'meter') return;
        const lufs = Number(evt.data.momentaryLufs);
        const tp = Number(evt.data.truePeakDbtp);
        if (Number.isFinite(lufs)) this.momentaryLufs = lufs;
        if (Number.isFinite(tp)) this.truePeakDbtp = tp;
      };
      masterSumBus.connect(limiterNode);
      limiterNode.connect(masterGain);
      this.lookaheadLimiterNode = limiterNode;
    } else {
      const lookaheadDelay = ctx.createDelay(0.02);
      lookaheadDelay.delayTime.value = 0.005;
      const masterLimiter = ctx.createWaveShaper();
      masterLimiter.curve = createMasteringLimiterCurve();
      masterLimiter.oversample = '2x';
      masterSumBus.connect(lookaheadDelay);
      lookaheadDelay.connect(masterLimiter);
      masterLimiter.connect(masterGain);
      this.lookaheadLimiterNode = null;
    }

    masterGain.connect(analyser);
    masterGain.connect(scopeMasterAnalyser);

    const scopeSplitter = ctx.createChannelSplitter(2);
    const scopeLeftAnalyser = ctx.createAnalyser();
    scopeLeftAnalyser.fftSize = 1024;
    scopeLeftAnalyser.smoothingTimeConstant = 0.0;
    const scopeRightAnalyser = ctx.createAnalyser();
    scopeRightAnalyser.fftSize = 1024;
    scopeRightAnalyser.smoothingTimeConstant = 0.0;
    masterGain.connect(scopeSplitter);
    scopeSplitter.connect(scopeLeftAnalyser, 0);
    scopeSplitter.connect(scopeRightAnalyser, 1);
    this.scopeLeftAnalyser = scopeLeftAnalyser;
    this.scopeRightAnalyser = scopeRightAnalyser;

    // Bit-transparent hardware DAC / Bluetooth A2DP output (zero MediaStream resampling/mono downmix)
    analyser.connect(ctx.destination);
    this.backgroundAudioActive = 'mediaSession' in navigator || isNativeMobileApp();

    this.masterGain = masterGain;
    this.analyser = analyser;
    this.scopeMasterAnalyser = scopeMasterAnalyser;

    // Dedicated zero-smoothing Lab Oscilloscope tap on the clinical stimulus / LR4 AM band
    const scopeModAnalyser = ctx.createAnalyser();
    scopeModAnalyser.fftSize = 1024;
    scopeModAnalyser.smoothingTimeConstant = 0.0;
    this.scopeModAnalyser = scopeModAnalyser;

    const ctxAny = ctx as AudioContext & { outputLatency?: number; baseLatency?: number };
    const measuredLatency = Number(ctxAny.outputLatency ?? ctxAny.baseLatency ?? 0);
    this.bluetoothSafeActive = Number.isFinite(measuredLatency) && measuredLatency > 0.1;

    // ─── LAYER 1A: PRECISION MEDICAL STIMULUS RACK (40 Hz Gamma-MBI, Isochronic, Binaural/Monaural, HRV, SNR Noise) ───
    const { hrvBusInput } = this.stimulusRack.start({
      ctx,
      spec: this.studySpec,
      masterDestination: masterSumBus,
      speakerSafeEQ: params.speakerSafeEQ,
      isControlTrial: this.isControlTrial,
      pureStimulusMode: this.carrierMode === 'pure_stimulus',
      stimulusTap: scopeModAnalyser,
      workletsReady: this.workletsReady,
      gammaMode: this.gammaMode,
      forceMonaural: this.hugginsStatus === 'monaural_safe',
      bluetoothSafe: this.bluetoothSafeActive,
      alphaIafHz: this.alphaIafHz ?? undefined,
      plannedSec: this.plannedSec,
    });

    // ─── LAYER 1B: 3-BAND LINKWITZ-RILEY (LR4) PHASE-COHERENT CORTICAL AM MATRIX ───
    const nyquistSafe = Math.max(800, ctx.sampleRate * 0.44);
    const lowerHz = Math.min(
      nyquistSafe * 0.35,
      this.studySpec.entrainment.modulationBandHz[0] || params.crossoverHz || 190
    );
    const upperHz = Math.min(
      nyquistSafe,
      this.studySpec.entrainment.modulationBandHz[1] || params.upperCrossoverHz || 4500
    );

    const preHrvBus = ctx.createGain();
    preHrvBus.gain.value = 1.0;
    const preTiltBus = ctx.createGain();
    preTiltBus.gain.value = 1.0;
    const musicMixBus = ctx.createGain();
    musicMixBus.gain.value = 1.0;

    const postHrvMusicNode: AudioNode = hrvBusInput ?? preHrvBus;
    if (hrvBusInput) {
      preHrvBus.connect(hrvBusInput);
    }

    // M/S-Balanced Bauer/Linkwitz Headphone Crossfeed on Layer 2 Music ONLY (0.000 dB mono error, 680 Hz + 260 us ITD)
    // Eliminates headphone super-stereo fatigue while keeping Layer 1 Binaural Beats 100% isolated L/R!
    if (!params.speakerSafeEQ && this.workletsReady) {
      const xfNode = new AudioWorkletNode(ctx, 'nootropic-crossfeed-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      xfNode.parameters.get('enabled')?.setValueAtTime(1, ctx.currentTime);
      xfNode.parameters.get('crossLevel')?.setValueAtTime(0.18, ctx.currentTime);
      postHrvMusicNode.connect(xfNode);
      xfNode.connect(preTiltBus);
      this.crossfeedNode = xfNode;
    } else {
      this.crossfeedNode = null;
      postHrvMusicNode.connect(preTiltBus);
    }

    // Audio-Thread Dynamic SNR Envelope Follower on Layer 2 Music (immune to background tab throttling)
    this.musicEnvSmoothedRms = 0.165;
    if (this.workletsReady) {
      const envNode = new AudioWorkletNode(ctx, 'nootropic-env-follower', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const envSink = ctx.createGain();
      envSink.gain.value = 0;
      musicMixBus.connect(envNode);
      envNode.connect(envSink);
      envSink.connect(ctx.destination);
      envNode.port.onmessage = (evt) => {
        if (!this.isPlaying || !evt.data || evt.data.type !== 'env') return;
        if (this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus') {
          this.stimulusRack.setDynamicMusicEnvelope(1.0);
          return;
        }
        const rms = Number(evt.data.rms);
        if (Number.isFinite(rms)) {
          this.musicEnvSmoothedRms = rms;
          this.stimulusRack.setDynamicMusicEnvelope(rms / 0.165);
        }
      };
      this.envFollowerNode = envNode;
      this.envSinkGain = envSink;
      this.musicEnvAnalyser = null;
      this.musicEnvBuf = null;
    } else {
      this.envFollowerNode = null;
      this.envSinkGain = null;
      const musicEnvAnalyser = ctx.createAnalyser();
      musicEnvAnalyser.smoothingTimeConstant = 0.0;
      musicMixBus.connect(musicEnvAnalyser);
      this.musicEnvAnalyser = musicEnvAnalyser;
      this.musicEnvBuf = new Float32Array(new ArrayBuffer(musicEnvAnalyser.fftSize * 4));
    }

    const initMonitorMode = this.layerMonitorMode as LayerMonitorMode;
    const amSpecActive =
      this.studySpec.entrainment.type === 'amplitude_modulation' &&
      this.studySpec.entrainment.frequencyHz > 0;
    const amCarrierRootHz = amSpecActive
      ? computeHarmonicCarrierHz(
          this.studySpec.music.rootMidi,
          this.studySpec.music.tuningA4Hz,
          220
        )
      : null;
    this.amCarrierRootHz = amCarrierRootHz;

    const spectralPocketNotch = ctx.createBiquadFilter();
    spectralPocketNotch.type = 'peaking';
    const discreteCarrierHz = this.stimulusRack.getPrimaryCarrierHz();
    const pocketHz = discreteCarrierHz ?? amCarrierRootHz;
    spectralPocketNotch.frequency.setValueAtTime(
      Math.min(nyquistSafe, pocketHz ?? 250),
      ctx.currentTime
    );
    spectralPocketNotch.Q.value = discreteCarrierHz ? 2.6 : 2.1;
    const wantPocket = Boolean(
      pocketHz &&
        !this.isControlTrial &&
        initMonitorMode !== 'music_only' &&
        initMonitorMode !== 'science_only'
    );
    spectralPocketNotch.gain.setValueAtTime(
      wantPocket ? (discreteCarrierHz ? -4.5 : -3.2) : 0,
      ctx.currentTime
    );
    this.spectralPocketNotch = spectralPocketNotch;

    const musicAuditionGain = ctx.createGain();
    musicAuditionGain.gain.setValueAtTime(
      initMonitorMode === 'science_only'
        ? 0
        : initMonitorMode === 'music_only'
          ? 1.0
          : this.computeFullMixMusicPocketGain(),
      ctx.currentTime
    );
    musicAuditionGain.connect(spectralPocketNotch);

    // v7.1 Gentle Anti-Habituation Spectral Rotation sits BEFORE LR4 split so all 3 crossover bands stay 0.000 dB phase-coherent!
    const spectralRot = ctx.createBiquadFilter();
    spectralRot.type = 'peaking';
    spectralRot.frequency.setValueAtTime(Math.min(nyquistSafe, 950), ctx.currentTime);
    spectralRot.Q.setValueAtTime(0.75, ctx.currentTime);
    const allowInitRot =
      amSpecActive &&
      !this.isControlTrial &&
      initMonitorMode !== 'science_only' &&
      initMonitorMode !== 'music_only' &&
      this.carrierMode !== 'pure_stimulus';
    spectralRot.gain.setValueAtTime(allowInitRot ? 1.5 : 0, ctx.currentTime);
    this.band2SpectralRotNode = spectralRot;

    // Inner-Voice Clarity Pocket (1650 Hz Baddeley Phonological Loop space) + 280 Hz Mud Clean + 3-Stage Ignition Filter
    // All three sit UPSTREAM of LR4 split -> 0.000 dB LR4 crossover phase-coherence preserved!
    const mudCleanFilter = ctx.createBiquadFilter();
    mudCleanFilter.type = 'peaking';
    mudCleanFilter.frequency.setValueAtTime(Math.min(nyquistSafe, 280), ctx.currentTime);
    mudCleanFilter.Q.setValueAtTime(1.15, ctx.currentTime);
    mudCleanFilter.gain.setValueAtTime(initMonitorMode === 'science_only' ? 0 : -2.2, ctx.currentTime);
    this.mudCleanFilterNode = mudCleanFilter;

    const innerVoicePocket = ctx.createBiquadFilter();
    innerVoicePocket.type = 'peaking';
    innerVoicePocket.frequency.setValueAtTime(Math.min(nyquistSafe, 1650), ctx.currentTime);
    innerVoicePocket.Q.setValueAtTime(0.9, ctx.currentTime);
    innerVoicePocket.gain.setValueAtTime(
      initMonitorMode === 'science_only' ? 0 : params.energyTier === 'calm' ? -1.8 : -3.2,
      ctx.currentTime
    );
    this.innerVoicePocketNode = innerVoicePocket;

    const ignitionArcFilter = ctx.createBiquadFilter();
    ignitionArcFilter.type = 'lowpass';
    ignitionArcFilter.Q.setValueAtTime(BUTTERWORTH_LP_HP_Q_DB, ctx.currentTime);
    ignitionArcFilter.frequency.setValueAtTime(
      initMonitorMode !== 'science_only' && params.energyTier !== 'calm'
        ? Math.min(nyquistSafe, 960)
        : nyquistSafe,
      ctx.currentTime
    );
    this.ignitionArcFilterNode = ignitionArcFilter;

    if (params.speakerSafeEQ) {
      // Driving/speaker safety notch sits BEFORE LR4 split so crossover summing remains 0.000 dB phase-coherent
      const safetyNotch = ctx.createBiquadFilter();
      safetyNotch.type = 'peaking';
      safetyNotch.frequency.value = Math.min(nyquistSafe, 1850);
      safetyNotch.Q.value = 0.72;
      safetyNotch.gain.value = -5.5;
      spectralPocketNotch.connect(mudCleanFilter);
      mudCleanFilter.connect(innerVoicePocket);
      innerVoicePocket.connect(ignitionArcFilter);
      ignitionArcFilter.connect(safetyNotch);
      safetyNotch.connect(spectralRot);
    } else {
      spectralPocketNotch.connect(mudCleanFilter);
      mudCleanFilter.connect(innerVoicePocket);
      innerVoicePocket.connect(ignitionArcFilter);
      ignitionArcFilter.connect(spectralRot);
    }
    spectralRot.connect(preHrvBus);
    this.musicAuditionGain = musicAuditionGain;

    // Gentle peak glue ONLY on procedural live synth + even-harmonic Analog Tape Warmth exclusively on Layer-2 music
    musicCompressor.threshold.value = -8;
    musicCompressor.knee.value = 8;
    musicCompressor.ratio.value = 1.65;

    const layer2WarmthShaper = ctx.createWaveShaper();
    layer2WarmthShaper.curve = createAnalogTapeWarmthCurve();
    layer2WarmthShaper.oversample = '2x';
    layer2WarmthShaper.connect(musicAuditionGain);

    const startWithMusic = this.carrierMode === 'generative_live';
    const proceduralMaster = ctx.createGain();
    proceduralMaster.gain.setValueAtTime(startWithMusic ? 0.94 : 0, ctx.currentTime);
    proceduralMaster.connect(musicCompressor);
    musicCompressor.connect(layer2WarmthShaper);
    this.proceduralMaster = proceduralMaster;

    const studioBus = ctx.createGain();
    studioBus.gain.setValueAtTime(0.96, ctx.currentTime);
    const studioFilter = ctx.createBiquadFilter();
    studioFilter.type = 'lowpass';
    studioFilter.Q.value = BUTTERWORTH_LP_HP_Q_DB;
    studioFilter.frequency.setValueAtTime(
      Math.min(nyquistSafe, this.computeStudioCutoffHz()),
      ctx.currentTime
    );
    studioBus.connect(studioFilter);
    studioFilter.connect(layer2WarmthShaper);
    this.studioBus = studioBus;
    this.studioFilter = studioFilter;

    // Phase-aligned & HRV-synchronized clean sub-bass bus (<185 Hz bass & sub-kick stay 100% AM-free, routed into musicMasterBus)
    const cleanSubBus = ctx.createGain();
    cleanSubBus.gain.setValueAtTime(startWithMusic ? 0.9 : 0, ctx.currentTime);
    const subPhaseAlignLow = ctx.createBiquadFilter();
    subPhaseAlignLow.type = 'allpass';
    subPhaseAlignLow.frequency.value = lowerHz;
    subPhaseAlignLow.Q.value = Math.SQRT1_2;
    const subPhaseAlignHigh = ctx.createBiquadFilter();
    subPhaseAlignHigh.type = 'allpass';
    subPhaseAlignHigh.frequency.value = upperHz;
    subPhaseAlignHigh.Q.value = Math.SQRT1_2;
    const subHrvBranch = this.stimulusRack.createHrvGainBranch();
    if (subHrvBranch) {
      cleanSubBus.connect(subHrvBranch);
      subHrvBranch.connect(subPhaseAlignLow);
    } else {
      cleanSubBus.connect(subPhaseAlignLow);
    }
    subPhaseAlignLow.connect(subPhaseAlignHigh);
    subPhaseAlignHigh.connect(musicMasterBus);
    this.cleanSubBus = cleanSubBus;

    // Gentle calibrated pink carrier specifically for Pure Clinical Signal auditing of 0.1 Hz HRV studies (non-AM)
    const pureAmBuf = createCalibratedNoiseBuffer(ctx, 'pink', 6);
    const pureAmSrc = ctx.createBufferSource();
    pureAmSrc.buffer = pureAmBuf;
    pureAmSrc.loop = true;
    const pureAmGain = ctx.createGain();
    const needsPureHrvCarrier =
      (this.carrierMode === 'pure_stimulus' || this.layerMonitorMode === 'science_only') &&
      this.specNeedsPureHrvReferenceCarrier();
    pureAmGain.gain.setValueAtTime(needsPureHrvCarrier ? 0.24 : 0, ctx.currentTime);
    pureAmSrc.connect(pureAmGain);
    pureAmGain.connect(preHrvBus);
    pureAmSrc.start();
    this.pureAmCarrierSrc = pureAmSrc;
    this.pureAmCarrierGain = pureAmGain;

    // BAND 1: Clean Sub-Bass (< lowerHz) -> musicMasterBus (pre-limited before Layer 1 sum)
    const lowBand = createLR4Filter(ctx, 'lowpass', lowerHz);
    const lowPhaseAlign = ctx.createBiquadFilter();
    lowPhaseAlign.type = 'allpass';
    lowPhaseAlign.frequency.value = upperHz;
    lowPhaseAlign.Q.value = Math.SQRT1_2;
    musicMixBus.connect(lowBand.input);
    lowBand.output.connect(lowPhaseAlign);
    lowPhaseAlign.connect(musicMasterBus);

    // UPPER SPLIT (> lowerHz)
    const aboveLow = createLR4Filter(ctx, 'highpass', lowerHz);
    musicMixBus.connect(aboveLow.input);

    // BAND 3: Clean Air (> upperHz) + Ultra-Slow 0.04 Hz 3D Shimmer -> musicMasterBus
    const airBand = createLR4Filter(ctx, 'highpass', upperHz);
    const airShimmerPan = ctx.createStereoPanner();
    airShimmerPan.pan.setValueAtTime(0, ctx.currentTime);
    this.airShimmerPanNode = airShimmerPan;
    aboveLow.output.connect(airBand.input);
    airBand.output.connect(airShimmerPan);
    airShimmerPan.connect(musicMasterBus);

    // BAND 2: Cortical AM Entrainment Band (lowerHz – upperHz) — ZERO phase-shifting IIR filters inside Band 2!
    const midBand = createLR4Filter(ctx, 'lowpass', upperHz);
    aboveLow.output.connect(midBand.input);

    const amActiveForSpec =
      this.studySpec.entrainment.type === 'amplitude_modulation' &&
      this.studySpec.entrainment.frequencyHz > 0;
    const isAlphaSpec =
      this.studySpec.entrainment.frequencyHz >= 8 && this.studySpec.entrainment.frequencyHz <= 12;
    const amTargetEndHz =
      isAlphaSpec && this.alphaIafHz !== null ? this.alphaIafHz : this.studySpec.entrainment.frequencyHz;
    const amStartHz = this.studySpec.entrainment.startFrequencyHz ?? amTargetEndHz;
    const initBridge = this.studySpec.entrainment.isoBridge;
    const initPhaseScale =
      initBridge && this.modDepthMultiplier < 1.24 ? initBridge.stabilizeEffectScale : 1.0;
    const initialDepth = this.computeCalibratedEffectPct(initPhaseScale, 1.0);

    let flattenedMidOutput: AudioNode = midBand.output;
    if (this.workletsReady) {
      const flattenerNode = new AudioWorkletNode(ctx, 'nootropic-env-flattener', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const wantFlatten =
        amActiveForSpec &&
        !this.isControlTrial &&
        initMonitorMode !== 'science_only' &&
        initMonitorMode !== 'music_only' &&
        this.carrierMode !== 'pure_stimulus';
      // Gentler 0.50 exponent keeps more natural groove dynamics (less inverse-pumping on kick-driven genres)
      flattenerNode.parameters.get('gamma')?.setValueAtTime(wantFlatten ? 0.5 : 0, ctx.currentTime);
      midBand.output.connect(flattenerNode);
      flattenedMidOutput = flattenerNode;
      this.band2FlattenerNode = flattenerNode;
    } else {
      this.band2FlattenerNode = null;
    }

    const midInputForAm: AudioNode = flattenedMidOutput;

    const useStereoSpread = Boolean(
      amActiveForSpec &&
        (this.studySpec.entrainment.phaseOffsetDeg ?? 0) > 0 &&
        !params.speakerSafeEQ
    );
    const monauralCollapse = this.hugginsStatus === 'monaural_safe';
    const isRaisedCosine = this.studySpec.entrainment.waveform === 'raised_cosine';
    const useNeuralSalience =
      amActiveForSpec && !isRaisedCosine && (amTargetEndHz || 0) >= 12;
    this.amUsesSalience = useNeuralSalience;
    const salienceBundleL = createNeuralSalienceWave(ctx, 0);
    this.amSalienceWaveL = salienceBundleL.wave;
    this.amSaliencePeakFrac = salienceBundleL.peakPhaseFraction;
    this.amSalienceStats = {
      min: salienceBundleL.min,
      max: salienceBundleL.max,
      rms: salienceBundleL.rms,
    };
    this.amPureWaveL = createPhaseShiftedSineWave(ctx, isRaisedCosine ? 90 : 0);

    const startWithSalience = useNeuralSalience && this.layerMonitorMode !== 'science_only' && !this.isControlTrial;
    this.amWaveStats = startWithSalience
      ? { ...this.amSalienceStats }
      : { min: -1, max: 1, rms: Math.SQRT1_2 };
    this.amCrestFrac = isRaisedCosine
      ? 0.0
      : startWithSalience
        ? this.amSaliencePeakFrac
        : 0.25;
    const initialAmGains = this.computeActiveAmGainPair(initialDepth);

    // Active Aperiodic Acoustic Sham Bank (0.17 + 0.29 + 0.43 Hz incommensurate ultra-slow drift):
    // Delivers matched-RMS audible organic modulation in both Nootropic Mix & Science Only without
    // any 1–80 Hz periodic ASSR phase-locking, completely preventing sham unblinding!
    const shamLfoSum = ctx.createGain();
    shamLfoSum.gain.value = 1.0;
    this.amShamOscs = [];
    const shamSpecs: Array<[number, number]> = [
      [0.17, 0.46],
      [0.29, 0.33],
      [0.43, 0.21],
    ];
    for (const [sHz, sWeight] of shamSpecs) {
      const sOsc = ctx.createOscillator();
      sOsc.type = 'sine';
      sOsc.frequency.setValueAtTime(sHz, ctx.currentTime);
      const sGain = ctx.createGain();
      sGain.gain.value = sWeight;
      sOsc.connect(sGain);
      sGain.connect(shamLfoSum);
      sOsc.start(ctx.currentTime);
      this.amShamOscs.push(sOsc);
    }

    const amLfoL = ctx.createOscillator();
    if (isRaisedCosine) {
      amLfoL.setPeriodicWave(this.amPureWaveL);
    } else if (startWithSalience) {
      amLfoL.setPeriodicWave(this.amSalienceWaveL);
    } else {
      amLfoL.type = 'sine';
    }
    amLfoL.frequency.setValueAtTime(Math.max(0.5, amStartHz || 16), ctx.currentTime);

    const periodicGateL = ctx.createGain();
    periodicGateL.gain.setValueAtTime(this.isControlTrial ? 0 : 1, ctx.currentTime);
    const shamGateL = ctx.createGain();
    shamGateL.gain.setValueAtTime(this.isControlTrial ? 1 : 0, ctx.currentTime);
    const modSignalL = ctx.createGain();
    modSignalL.gain.value = 1.0;
    amLfoL.connect(periodicGateL);
    periodicGateL.connect(modSignalL);
    shamLfoSum.connect(shamGateL);
    shamGateL.connect(modSignalL);
    this.amPeriodicGateL = periodicGateL;
    this.amShamGateL = shamGateL;

    const amDepthGainL = ctx.createGain();
    amDepthGainL.gain.setValueAtTime(initialAmGains.swing, ctx.currentTime);

    const amGainL = ctx.createGain();
    amGainL.gain.setValueAtTime(initialAmGains.bias, ctx.currentTime);

    // Hybrid Velvet AM Spectral Presence Tilt (restricted <= 12 Hz; placed UPSTREAM of musicMixBus BEFORE LR4 split
    // so Band 1 <190 Hz, Band 2 190–4500 Hz, and Band 3 >4500 Hz maintain exact 0.000° relative phase coherence!)
    const tiltCenterHz = Math.min(nyquistSafe, 1350);
    const amTiltDepthL = ctx.createGain();
    const allowTiltInit =
      amActiveForSpec &&
      !this.isControlTrial &&
      (amStartHz || 16) <= 12 &&
      this.layerMonitorMode === 'full_mix';
    const initTilt = allowTiltInit ? initialDepth * 4.2 : 0;
    amTiltDepthL.gain.setValueAtTime(initTilt, ctx.currentTime);

    const makeTiltNode = (depthDriver: GainNode): AudioNode => {
      if (this.workletsReady) {
        const zdf = new AudioWorkletNode(ctx, 'nootropic-zdf-tilt');
        zdf.parameters.get('freq')?.setValueAtTime(tiltCenterHz, ctx.currentTime);
        zdf.parameters.get('Q')?.setValueAtTime(1.15, ctx.currentTime);
        zdf.parameters.get('gainDb')?.setValueAtTime(0, ctx.currentTime);
        const gainDbParam = zdf.parameters.get('gainDb');
        if (gainDbParam) depthDriver.connect(gainDbParam);
        return zdf;
      }
      const bq = ctx.createBiquadFilter();
      bq.type = 'peaking';
      bq.frequency.setValueAtTime(tiltCenterHz, ctx.currentTime);
      bq.Q.value = 1.15;
      bq.gain.setValueAtTime(0, ctx.currentTime);
      depthDriver.connect(bq.gain);
      return bq;
    };

    const amTiltLNode = makeTiltNode(amTiltDepthL);

    modSignalL.connect(amDepthGainL);
    amDepthGainL.connect(amGainL.gain);
    modSignalL.connect(amTiltDepthL);
    const amStartAt = ctx.currentTime;
    amLfoL.start(amStartAt);
    this.amLfoOriginSec = amStartAt;

    let midOutput: AudioNode = amGainL;
    this.amTiltDepthL = amTiltDepthL;
    this.amTiltNodeL = amTiltLNode;

    if (useStereoSpread) {
      // Pre-split stereo ZDF tilt (before musicMixBus)
      const tiltSplitter = ctx.createChannelSplitter(2);
      const tiltMerger = ctx.createChannelMerger(2);
      // Band-2 pure linear stereo AM VCA (zero phase shift)
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);

      const amLfoR = ctx.createOscillator();
      const spreadDeg = this.studySpec.entrainment.phaseOffsetDeg ?? 32;
      const salienceBundleR = createNeuralSalienceWave(ctx, spreadDeg);
      this.amSalienceWaveR = salienceBundleR.wave;
      this.amPureWaveR = createPhaseShiftedSineWave(ctx, spreadDeg + (isRaisedCosine ? 90 : 0));
      const useZeroDegRight = monauralCollapse;
      amLfoR.setPeriodicWave(
        startWithSalience
          ? (useZeroDegRight ? this.amSalienceWaveL : this.amSalienceWaveR)
          : (useZeroDegRight ? this.amPureWaveL : this.amPureWaveR)
      );
      amLfoR.frequency.setValueAtTime(Math.max(0.5, amStartHz || 16), ctx.currentTime);

      const periodicGateR = ctx.createGain();
      periodicGateR.gain.setValueAtTime(this.isControlTrial ? 0 : 1, ctx.currentTime);
      const shamGateR = ctx.createGain();
      shamGateR.gain.setValueAtTime(this.isControlTrial ? 1 : 0, ctx.currentTime);
      const modSignalR = ctx.createGain();
      modSignalR.gain.value = 1.0;
      amLfoR.connect(periodicGateR);
      periodicGateR.connect(modSignalR);
      shamLfoSum.connect(shamGateR);
      shamGateR.connect(modSignalR);
      this.amPeriodicGateR = periodicGateR;
      this.amShamGateR = shamGateR;

      const amDepthGainR = ctx.createGain();
      amDepthGainR.gain.setValueAtTime(initialAmGains.swing, ctx.currentTime);

      const amGainR = ctx.createGain();
      amGainR.gain.setValueAtTime(initialAmGains.bias, ctx.currentTime);

      const amTiltDepthR = ctx.createGain();
      amTiltDepthR.gain.setValueAtTime(initTilt, ctx.currentTime);
      const amTiltRNode = makeTiltNode(amTiltDepthR);

      modSignalR.connect(amDepthGainR);
      amDepthGainR.connect(amGainR.gain);
      modSignalR.connect(amTiltDepthR);
      amLfoR.start();

      // Wire pre-split ZDF tilt BEFORE musicMixBus
      preTiltBus.connect(tiltSplitter);
      tiltSplitter.connect(amTiltLNode, 0);
      tiltSplitter.connect(amTiltRNode, 1);
      amTiltLNode.connect(tiltMerger, 0, 0);
      amTiltRNode.connect(tiltMerger, 0, 1);
      tiltMerger.connect(musicMixBus);

      // Wire pure phase-neutral Band-2 AM VCA
      midInputForAm.connect(splitter);
      splitter.connect(amGainL, 0);
      splitter.connect(amGainR, 1);
      amGainL.connect(merger, 0, 0);
      amGainR.connect(merger, 0, 1);

      this.amGainR = amGainR;
      this.amLfoR = amLfoR;
      this.amDepthGainR = amDepthGainR;
      this.amTiltDepthR = amTiltDepthR;
      this.amTiltNodeR = amTiltRNode;
      midOutput = merger;
    } else {
      preTiltBus.connect(amTiltLNode);
      amTiltLNode.connect(musicMixBus);
      midInputForAm.connect(amGainL);
      this.amGainR = null;
      this.amLfoR = null;
      this.amPeriodicGateR = null;
      this.amShamGateR = null;
      this.amDepthGainR = null;
      this.amTiltDepthR = null;
      this.amTiltNodeR = null;
      this.amPureWaveR = null;
      this.amSalienceWaveR = null;
    }

    const eType = this.studySpec.entrainment.type;
    if (eType === 'amplitude_modulation' || eType === 'hrv_breathing_swell' || eType === 'none') {
      midOutput.connect(scopeModAnalyser);
    }
    midOutput.connect(musicMasterBus);

    // Dedicated 94%-depth phase-locked Layer 1 Cortical AM Harmonic + Velvet Pulse Bus:
    // Driven by `modSignalL` (exact `amLfoL` on active trials, matched-RMS aperiodic sham drift on control trials)
    // delivering unmistakable isolated clarity in Science Only AND audible rhythmic fusion in Nootropic Mix,
    // while muting to 0.0000 in Plain Music!
    if (amActiveForSpec) {
      const f0 = Math.min(nyquistSafe * 0.45, amCarrierRootHz ?? 220);
      const fifthRatio = Math.pow(2, 7 / 12);
      const rootOsc = ctx.createOscillator();
      rootOsc.type = 'sine';
      rootOsc.frequency.setValueAtTime(f0, ctx.currentTime);
      const rootGain = ctx.createGain();
      rootGain.gain.value = 0.58;

      const fifthOsc = ctx.createOscillator();
      fifthOsc.type = 'sine';
      fifthOsc.frequency.setValueAtTime(
        Math.min(nyquistSafe, Number((f0 * fifthRatio).toFixed(2))),
        ctx.currentTime
      );
      const fifthGain = ctx.createGain();
      fifthGain.gain.value = f0 * fifthRatio < nyquistSafe ? 0.21 : 0;

      const octOsc = ctx.createOscillator();
      octOsc.type = 'sine';
      octOsc.frequency.setValueAtTime(
        Math.min(nyquistSafe, Number((f0 * 2).toFixed(2))),
        ctx.currentTime
      );
      const octGain = ctx.createGain();
      octGain.gain.value = f0 * 2 < nyquistSafe ? 0.11 : 0;

      const noiseHpHz = Math.min(nyquistSafe * 0.35, 240);
      const noiseLpHz = Math.min(nyquistSafe, 2100);
      const amNoiseSrc = ctx.createBufferSource();
      amNoiseSrc.buffer = createCalibratedNoiseBuffer(ctx, 'pink', 6, { hpHz: noiseHpHz, lpHz: noiseLpHz });
      amNoiseSrc.loop = true;
      const amNoiseHp = ctx.createBiquadFilter();
      amNoiseHp.type = 'highpass';
      amNoiseHp.frequency.value = noiseHpHz;
      amNoiseHp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
      const amNoiseLp = ctx.createBiquadFilter();
      amNoiseLp.type = 'lowpass';
      amNoiseLp.frequency.value = noiseLpHz;
      amNoiseLp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
      const amNoiseGain = ctx.createGain();
      amNoiseGain.gain.value = 0.24;

      const amCarrierWarmLp = ctx.createBiquadFilter();
      amCarrierWarmLp.type = 'lowpass';
      amCarrierWarmLp.frequency.value = Math.min(nyquistSafe, params.speakerSafeEQ ? 920 : 1320);
      amCarrierWarmLp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

      const pulsePair = this.computeAmPulseModPair();
      const pulseGain = ctx.createGain();
      pulseGain.gain.setValueAtTime(pulsePair.bias, ctx.currentTime);
      const pulseDepth = ctx.createGain();
      pulseDepth.gain.setValueAtTime(pulsePair.swing, ctx.currentTime);
      modSignalL.connect(pulseDepth);
      pulseDepth.connect(pulseGain.gain);

      const amScienceGain = ctx.createGain();
      amScienceGain.gain.setValueAtTime(
        this.computeAmScienceCarrierTarget(initPhaseScale),
        ctx.currentTime
      );

      rootOsc.connect(rootGain);
      fifthOsc.connect(fifthGain);
      octOsc.connect(octGain);
      rootGain.connect(amCarrierWarmLp);
      fifthGain.connect(amCarrierWarmLp);
      octGain.connect(amCarrierWarmLp);

      amNoiseSrc.connect(amNoiseHp);
      amNoiseHp.connect(amNoiseLp);
      amNoiseLp.connect(amNoiseGain);
      amNoiseGain.connect(amCarrierWarmLp);

      amCarrierWarmLp.connect(pulseGain);
      pulseGain.connect(amScienceGain);
      amScienceGain.connect(masterSumBus);
      amScienceGain.connect(scopeModAnalyser);

      rootOsc.start(ctx.currentTime);
      fifthOsc.start(ctx.currentTime);
      octOsc.start(ctx.currentTime);
      amNoiseSrc.start(ctx.currentTime);

      this.amScienceCarrierGain = amScienceGain;
      this.amSciencePulseGain = pulseGain;
      this.amSciencePulseDepth = pulseDepth;
      this.amCarrierRootOsc = rootOsc;
      this.amCarrierFifthOsc = fifthOsc;
      this.amCarrierOctOsc = octOsc;
      this.amCarrierNoiseSrc = amNoiseSrc;
    } else {
      this.amScienceCarrierGain = null;
      this.amSciencePulseGain = null;
      this.amSciencePulseDepth = null;
      this.amCarrierRootOsc = null;
      this.amCarrierFifthOsc = null;
      this.amCarrierOctOsc = null;
      this.amCarrierNoiseSrc = null;
    }

    this.amGainL = amGainL;
    this.amLfoL = amLfoL;
    this.amDepthGainL = amDepthGainL;

    // ─── STUDIO HALL CONVOLUTION REVERB + STEREO PING-PONG DELAY FOR LIVE COMPOSER ───
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.42;
    const convolver = ctx.createConvolver();
    convolver.buffer = createStudioReverbIR(ctx, 2.4);
    const reverbHP = ctx.createBiquadFilter();
    reverbHP.type = 'highpass';
    reverbHP.frequency.value = Math.min(nyquistSafe * 0.4, 210);
    reverbHP.Q.value = BUTTERWORTH_LP_HP_Q_DB;
    const reverbLP = ctx.createBiquadFilter();
    reverbLP.type = 'lowpass';
    reverbLP.frequency.value = Math.min(nyquistSafe, params.speakerSafeEQ ? 1450 : 2800);
    reverbLP.Q.value = BUTTERWORTH_LP_HP_Q_DB;

    reverbSend.connect(convolver);
    convolver.connect(reverbHP);
    reverbHP.connect(reverbLP);
    reverbLP.connect(proceduralMaster);

    const delaySend = ctx.createGain();
    delaySend.gain.value = 0.18;
    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.28;
    delayR.delayTime.value = 0.42;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = Math.min(nyquistSafe, 1350);
    delayFilter.Q.value = BUTTERWORTH_LP_HP_Q_DB;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.22;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.45;
    panR.pan.value = 0.45;

    delaySend.connect(delayFilter);
    delayFilter.connect(delayL);
    delayFilter.connect(delayR);
    delayL.connect(panL);
    delayR.connect(panR);
    panL.connect(proceduralMaster);
    panR.connect(proceduralMaster);
    delayR.connect(feedback);
    feedback.connect(delayL);

    // ─── LAYER 2A: LIVE ADAPTIVE "AS WE GO" STUDIO SAMPLER COMPOSER ($0, 100% STUDY-LOCKED) ───
    const musicSpec: StudyMusicSpec = {
      ...this.studySpec.music,
      instrumentPalette: this.studySpec.music.instrumentPalette || resolvedGenreToPalette(this.genre),
    };
    this.composer.start({
      ctx,
      musicSpec,
      genre: this.genre,
      proceduralMaster,
      cleanSubBus,
      reverbSend,
      delaySend,
      speakerSafeEQ: params.speakerSafeEQ,
      sampleApiBase,
      deferStart: this.carrierMode !== 'generative_live',
      workletsReady: this.workletsReady,
    });

    // ─── DEDICATED PHYSICAL STEREO RAINFALL LAYER (routed into musicMasterBus so rain peaks never duck Layer 1!) ───
    const rainHrvBranch = this.stimulusRack.createHrvGainBranch();
    if (rainHrvBranch) {
      rainHrvBranch.connect(musicMasterBus);
      this.rainBed.attach(ctx, rainHrvBranch, params.speakerSafeEQ, sampleApiBase);
    } else {
      this.rainBed.attach(ctx, musicMasterBus, params.speakerSafeEQ, sampleApiBase);
    }
    this.syncRainBed();

    this.isPlaying = true;
    this.setAudioInterrupted(false);
    if (String(ctx.state) !== 'running') {
      this.setAudioInterrupted(true);
      this.installOneShotGestureResume();
    }
    this.triggerPavlovianEntryChime();
    this.setupMediaSession(title);
    void this.requestWakeLock();

    // iOS Safari / mobile WebKit background keep-alive anchor + pre-unlocked Dual-Deck HTTP 206 streaming pool
    try {
      this.keepAliveUrl = createSilentKeepAliveWavUrl(ctx.sampleRate);
      const keepAlive = document.createElement('audio');
      keepAlive.setAttribute('playsinline', 'true');
      keepAlive.loop = true;
      keepAlive.volume = 0.02;
      keepAlive.src = this.keepAliveUrl;
      void keepAlive
        .play()
        .then(() => {
          this.backgroundAudioActive = true;
        })
        .catch(() => {});
      this.keepAliveEl = keepAlive;
    } catch {
      this.keepAliveEl = null;
      this.keepAliveUrl = null;
    }

    this.initMediaDeckPool(ctx);

    ctx.onstatechange = () => {
      if (!this.isPlaying || this.ctx !== ctx) return;
      const rawState = String(ctx.state);
      if (rawState === 'running') {
        this.setAudioInterrupted(false);
        return;
      }
      if (rawState === 'interrupted') {
        this.setAudioInterrupted(true);
        this.installOneShotGestureResume();
        return;
      }
      if (rawState === 'suspended') {
        void ctx.resume().then(
          () => {
            if (this.ctx === ctx && String(ctx.state) === 'running') {
              this.setAudioInterrupted(false);
            }
          },
          () => {
            if (this.isPlaying && this.ctx === ctx) {
              this.setAudioInterrupted(true);
              this.installOneShotGestureResume();
            }
          }
        );
      }
    };

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = () => {
      if (!this.isPlaying || !this.ctx) return;
      const rawState = String(this.ctx.state);
      if (rawState === 'suspended' || rawState === 'interrupted') {
        void this.ctx.resume().then(
          () => {
            if (this.ctx && String(this.ctx.state) === 'running') {
              this.setAudioInterrupted(false);
            }
          },
          () => {
            this.setAudioInterrupted(true);
            this.installOneShotGestureResume();
          }
        );
      }
      if (this.keepAliveEl && this.keepAliveEl.paused) {
        void this.keepAliveEl.play().catch(() => {});
      }
      if (this.activeStreamEl && this.activeStreamEl.paused) {
        void this.activeStreamEl.play().catch(() => {});
      }
      this.activeStreamCrossfadeCheck?.();
      if (document.visibilityState === 'visible') {
        void this.requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    if (this.snrTimer !== null) {
      window.clearInterval(this.snrTimer);
      this.snrTimer = null;
    }
    if (!this.workletsReady) {
      this.snrTimer = window.setInterval(() => {
        if (!this.isPlaying || !this.ctx || !this.musicEnvAnalyser || !this.musicEnvBuf) return;
        if (this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus') {
          this.stimulusRack.setDynamicMusicEnvelope(1.0);
          return;
        }
        this.musicEnvAnalyser.getFloatTimeDomainData(this.musicEnvBuf);
        let sumSq = 0;
        const len = this.musicEnvBuf.length;
        for (let i = 0; i < len; i++) {
          const s = this.musicEnvBuf[i];
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, len));
        const alpha = rms > this.musicEnvSmoothedRms ? 0.28 : 0.14;
        this.musicEnvSmoothedRms += alpha * (rms - this.musicEnvSmoothedRms);
        this.stimulusRack.setDynamicMusicEnvelope(this.musicEnvSmoothedRms / 0.165);
      }, 120);
    }

    if (this.carrierMode === 'studio_library' && !skipInitialStudioDeck) {
      void this.activateStudioForGenre(this.genre);
    }
  }

  public onInterruptionChange(cb: (interrupted: boolean) => void): () => void {
    this.interruptionListeners.add(cb);
    return () => {
      this.interruptionListeners.delete(cb);
    };
  }

  public isAudioInterrupted(): boolean {
    return this.audioInterrupted;
  }

  public consumeRecentGestureResume(withinMs = 450): boolean {
    if (this.lastGestureResumeAtMs <= 0) return false;
    const recent = Date.now() - this.lastGestureResumeAtMs <= withinMs;
    this.lastGestureResumeAtMs = 0;
    return recent;
  }

  private setAudioInterrupted(interrupted: boolean): void {
    if (this.audioInterrupted === interrupted) return;
    this.audioInterrupted = interrupted;
    if (!interrupted && this.gestureResumeCleanup) {
      this.gestureResumeCleanup();
      this.gestureResumeCleanup = null;
    }
    for (const cb of this.interruptionListeners) {
      try {
        cb(interrupted);
      } catch {
        // ignore listener errors
      }
    }
  }

  private installOneShotGestureResume(): void {
    if (this.gestureResumeCleanup || typeof window === 'undefined') return;
    const handler = (evt: Event) => {
      if (evt instanceof KeyboardEvent) {
        if (evt.code !== 'Space' && evt.code !== 'Enter') return;
      }
      void this.resumeFromInterruption(true);
    };
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('touchend', handler, { passive: true });
    window.addEventListener('keydown', handler);
    this.gestureResumeCleanup = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('touchend', handler);
      window.removeEventListener('keydown', handler);
    };
  }

  public async resumeFromInterruption(fromWindowGesture = false): Promise<boolean> {
    if (!this.ctx) {
      this.setAudioInterrupted(false);
      return false;
    }
    try {
      await Promise.race([
        this.ctx.resume().catch(() => {}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 200)),
      ]);
      if (this.keepAliveEl && this.keepAliveEl.paused) {
        await this.keepAliveEl.play().catch(() => {});
      }
      if (this.activeStreamEl && this.activeStreamEl.paused && this.isPlaying) {
        await this.activeStreamEl.play().catch(() => {});
      }
      const running = String(this.ctx.state) === 'running';
      if (running) {
        if (fromWindowGesture) {
          this.lastGestureResumeAtMs = Date.now();
        }
        this.setAudioInterrupted(false);
        void this.requestWakeLock();
      }
      return running;
    } catch {
      return false;
    }
  }

  private initMediaDeckPool(ctx: AudioContext): void {
    this.teardownMediaDeckPool();
    this.mediaDeckCursor = 0;
    if (typeof Audio === 'undefined' || typeof ctx.createMediaElementSource !== 'function') {
      return;
    }
    // 4 pre-unlocked <audio> + MediaElementAudioSourceNode slots guarantee overlap-safe crossfades
    // and rapid genre switches without ever recycling a slot that is still fading out!
    for (let i = 0; i < 4; i++) {
      try {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.preload = 'none';
        (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
        el.setAttribute('playsinline', 'true');
        const srcNode = ctx.createMediaElementSource(el);
        const slot = {
          el,
          srcNode,
          generation: 0,
          inUse: false,
          fadingOut: false,
        };
        if (this.keepAliveUrl) {
          const unlockGen = slot.generation;
          el.src = this.keepAliveUrl;
          el.muted = true;
          void el
            .play()
            .then(() => {
              // Generation guard: NEVER clobber src/pause if a stem already claimed this slot!
              if (slot.generation !== unlockGen) return;
              el.pause();
              el.muted = false;
              el.removeAttribute('src');
              el.load();
            })
            .catch(() => {
              if (slot.generation !== unlockGen) return;
              el.muted = false;
              el.removeAttribute('src');
            });
        }
        this.mediaDeckPool.push(slot);
      } catch {
        break;
      }
    }
  }

  private acquireMediaDeckSlot(): {
    slot: PsychoacousticEngine['mediaDeckPool'][number];
    gen: number;
  } | null {
    if (this.mediaDeckPool.length === 0) return null;
    const len = this.mediaDeckPool.length;
    let chosen: PsychoacousticEngine['mediaDeckPool'][number] | null = null;
    for (let step = 0; step < len; step++) {
      const cand = this.mediaDeckPool[(this.mediaDeckCursor + step) % len];
      if (!cand.inUse && !cand.fadingOut) {
        chosen = cand;
        this.mediaDeckCursor = (this.mediaDeckCursor + step + 1) % len;
        break;
      }
    }
    if (!chosen) {
      for (let step = 0; step < len; step++) {
        const cand = this.mediaDeckPool[(this.mediaDeckCursor + step) % len];
        if (!cand.inUse && cand !== this.activeMediaSlot) {
          chosen = cand;
          this.mediaDeckCursor = (this.mediaDeckCursor + step + 1) % len;
          break;
        }
      }
    }
    if (!chosen) return null;
    chosen.generation += 1;
    chosen.inUse = true;
    chosen.fadingOut = false;
    chosen.el.muted = false;
    try {
      chosen.el.volume = 1.0;
    } catch {
      // read-only on iOS WebKit (hardware volume); WebAudio GainNode controls deck level
    }
    return { slot: chosen, gen: chosen.generation };
  }

  private releaseFailedMediaSlot(
    slot: PsychoacousticEngine['mediaDeckPool'][number] | null,
    claimedGen: number,
    fallbackEl: HTMLAudioElement
  ): void {
    try {
      if (slot) {
        if (slot.generation !== claimedGen) return;
        slot.inUse = false;
        slot.fadingOut = false;
        slot.el.pause();
        slot.el.removeAttribute('src');
        slot.el.load();
        slot.srcNode.disconnect();
      } else {
        fallbackEl.pause();
        fallbackEl.src = '';
      }
    } catch {
      // ignore
    }
  }

  private teardownMediaDeckPool(): void {
    for (const slot of this.mediaDeckPool) {
      slot.generation += 1;
      slot.inUse = false;
      slot.fadingOut = false;
      try {
        slot.el.pause();
        slot.el.removeAttribute('src');
        slot.el.load();
        slot.srcNode.disconnect();
      } catch {
        // ignore
      }
    }
    this.mediaDeckPool = [];
    this.mediaDeckCursor = 0;
    this.activeMediaSlot = null;
    this.activeMediaSlotGen = 0;
  }

  /**
   * Computes exact Layer-2 `musicPreLimiter` ceiling so `musicPreLimiterCeiling + maxLayer1Peak < LIMITER_CEILING_LINEAR`
   * across ALL Neural Effect tiers (Min, Standard, Max) and ALL noise levels, guaranteeing 0.000 dB Layer-1 ducking!
   */
  private computeMusicPreLimiterCeiling(): number {
    if (this.layerMonitorMode === 'music_only') {
      return LIMITER_CEILING_LINEAR;
    }
    const spec = this.studySpec;
    if (!spec) return 0.68;
    const eType = spec.entrainment.type;
    const amActive = eType === 'amplitude_modulation' && spec.entrainment.frequencyHz > 0;
    const amPeak = amActive ? this.computeAmScienceCarrierTarget(1.0) * 0.96 : 0;
    const stimPeak =
      !amActive && eType !== 'none' && eType !== 'hrv_breathing_swell'
        ? Math.min(0.36, 0.22 * Math.max(0.5, this.modDepthMultiplier))
        : 0;
    const noisePeak =
      spec.noise.color !== 'none' && spec.noise.snrDb > -34
        ? Math.min(0.18, Math.pow(10, spec.noise.snrDb / 20) * 0.36 * this.intensityMultiplier)
        : 0;
    const reservedLayer1 = Math.min(0.45, Math.max(0.19, amPeak + stimPeak + noisePeak));
    return Number(
      Math.max(0.42, Math.min(0.68, LIMITER_CEILING_LINEAR - reservedLayer1 - 0.02)).toFixed(4)
    );
  }

  private specNeedsPureHrvReferenceCarrier(): boolean {
    if (!this.studySpec) return false;
    const isAm =
      this.studySpec.entrainment.type === 'amplitude_modulation' &&
      this.studySpec.entrainment.frequencyHz > 0;
    if (isAm) return false;
    return (
      this.studySpec.entrainment.type === 'hrv_breathing_swell' ||
      (this.studySpec.entrainment.hrvBreathHz ?? 0) > 0
    );
  }

  private computeFullMixMusicPocketGain(): number {
    // Dynamically carves -0.4 dB (Min) / -1.1 dB (Standard) / -2.4 dB (Max) headroom in Nootropic Mix
    // (matched identically on Active & Sham trials so loudness never unblinds participants!)
    const duck = Math.max(0.76, Math.min(0.96, 1.04 - 0.17 * this.modDepthMultiplier));
    return Number(duck.toFixed(3));
  }

  private computeCalibratedEffectPct(
    activePhaseFactor = 1.0,
    antiHabFactor = 1.0
  ): number {
    const spec = this.studySpec;
    if (!spec || spec.entrainment.type === 'none') return 0;
    const baseDepth = Math.max(0.2, Math.min(0.6, spec.entrainment.modulationDepth || 0.38));
    const normBase = 0.88 + 0.3 * baseDepth; // ~0.994 on 0.38 focus protocols, ~0.952 on 0.24 calm protocols
    const hrvFactor = Math.max(0.88, Math.min(1.06, 1 + this.hrvClosedLoopTrim));
    const raw =
      0.65 * this.modDepthMultiplier * hrvFactor * normBase * activePhaseFactor * antiHabFactor;
    const cap = this.params?.speakerSafeEQ ? 0.68 : 0.95;
    return Math.min(cap, Math.max(0.15, raw));
  }

  private computeAmPulseModPair(): { bias: number; swing: number } {
    if (this.layerMonitorMode === 'music_only') {
      return { bias: 0, swing: 0 };
    }
    if (this.isControlTrial) {
      // Active Aperiodic Acoustic Sham: matched RMS with organic slow drift (zero periodic ASSR)
      const shamSwing = Number((0.36 * (0.78 + 0.22 * this.modDepthMultiplier)).toFixed(4));
      const shamBias = Number((1.0 - shamSwing).toFixed(4));
      return { bias: shamBias, swing: shamSwing };
    }
    const pulseDepth = Math.min(
      0.97,
      Math.max(0.76, 0.88 * (0.72 + 0.28 * this.modDepthMultiplier))
    );
    const span = Math.max(0.5, this.amWaveStats.max - this.amWaveStats.min);
    const swing = Number((pulseDepth / span).toFixed(4));
    const bias = Number((1.0 - swing * this.amWaveStats.max).toFixed(4));
    return { bias, swing };
  }

  private computeAmScienceCarrierTarget(activePhaseFactor = 1.0): number {
    if (
      !this.studySpec ||
      this.studySpec.entrainment.type !== 'amplitude_modulation' ||
      this.studySpec.entrainment.frequencyHz <= 0
    ) {
      return 0;
    }
    if (this.layerMonitorMode === 'music_only') {
      return 0;
    }
    if (this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus') {
      // Loudness-matched ~ -15.5 LUFS isolated neural reference chord + band-limited pink carrier
      // (identical RMS in Active & Aperiodic Sham trials so Science Only never unblinds!)
      return Number(
        Math.min(0.52, Math.max(0.32, 0.42 * (0.82 + 0.18 * this.modDepthMultiplier))).toFixed(4)
      );
    }
    // Scales smoothly across Min (~0.14 = 35% effect) -> Standard (~0.27 = 65% effect) -> Max (~0.42 = 94% effect)
    const baseDepth = Math.max(0.2, Math.min(0.65, this.studySpec.entrainment.modulationDepth || 0.38));
    const speakerScale = this.params?.speakerSafeEQ ? 0.72 : 1.0;
    const tierCurve = Math.pow(Math.max(0.3, this.modDepthMultiplier), 1.15);
    const raw = 0.27 * (0.62 + baseDepth) * tierCurve * activePhaseFactor * speakerScale;
    return Number(Math.min(0.44, Math.max(0, raw)).toFixed(4));
  }

  private computeActiveAmGainPair(calibratedEffectDepth: number): { bias: number; swing: number } {
    const amActive =
      this.studySpec?.entrainment.type === 'amplitude_modulation' &&
      this.studySpec.entrainment.frequencyHz > 0;
    if (!amActive || this.layerMonitorMode === 'music_only') {
      return { bias: 1.0, swing: 0 };
    }
    if (this.isControlTrial) {
      // Gentle matched-RMS aperiodic drift (0.17 + 0.29 + 0.43 Hz) — zero periodic cortical phase-locking
      const shamDepth = Math.min(0.34, Math.max(0.14, calibratedEffectDepth * 0.42));
      return computeExactAmGainPair(shamDepth, -1, 1, Math.SQRT1_2);
    }
    if (this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus') {
      const isoDepth = Math.min(
        0.96,
        Math.max(0.76, 0.88 * (0.72 + 0.28 * this.modDepthMultiplier))
      );
      const swing = Number((0.5 * isoDepth).toFixed(4));
      const bias = Number((1.0 - swing).toFixed(4));
      return { bias, swing };
    }
    // Maps 35%..94% calibrated effect onto safe 0.34..0.75 Band-2 music VCA depth
    const mixDriveDepth = Math.min(0.75, Math.max(0, calibratedEffectDepth * 0.82));
    return this.computeAmGainPair(mixDriveDepth);
  }

  private computeStudioCutoffHz(): number {
    // Mastered 48 kHz studio stems already carry warm instrument voicings; keep natural acoustic
    // articulation (rain droplets, nylon guitar plucks, felt piano hammers, strings rosin) open
    // instead of brickwall-muffling studio recordings down to oscillator pad cutoffs!
    const target = this.studySpec?.protocol.targetState ?? 'alert_focus';
    const isIsoAdapted = this.params?.genreSelectionMode === 'iso_adapted';
    let base = 17200;
    if (target === 'sleep_winddown') {
      base = 7800;
    } else if (isIsoAdapted) {
      base = 9200;
    } else if (target === 'calm_reset') {
      base = 12400;
    }
    const scaled = base * (0.86 + 0.18 * this.intensityMultiplier);
    return Math.round(Math.max(5400, Math.min(18500, scaled)));
  }

  private computeAmGainPair(depth: number): { bias: number; swing: number } {
    const pair = computeExactAmGainPair(
      depth,
      this.amWaveStats.min,
      this.amWaveStats.max,
      this.amWaveStats.rms
    );
    return { bias: pair.bias, swing: pair.swing };
  }

  private isBand2FlattenerActive(): boolean {
    return Boolean(
      this.band2FlattenerNode &&
        this.studySpec?.entrainment.type === 'amplitude_modulation' &&
        this.studySpec.entrainment.frequencyHz > 0 &&
        !this.isControlTrial &&
        this.layerMonitorMode !== 'science_only' &&
        this.layerMonitorMode !== 'music_only' &&
        this.carrierMode !== 'pure_stimulus'
    );
  }

  private syncBand2Flattener(): void {
    if (!this.ctx || !this.band2FlattenerNode) return;
    const isSustainedPadGenre =
      this.genre === 'ambient_space' ||
      this.genre === 'nature_rain' ||
      this.genre === 'cinematic_strings';
    const activeGamma = isSustainedPadGenre ? 0.34 : 0.18;
    const gamma = this.isBand2FlattenerActive() ? activeGamma : 0;
    this.band2FlattenerNode.parameters.get('gamma')?.setValueAtTime(gamma, this.ctx.currentTime);
  }

  public setGammaMode(mode: GammaStimulusMode): void {
    this.gammaMode = mode;
    this.stimulusRack.setGammaMode(mode);
  }

  public setAlphaIafHz(hz: number): void {
    const clamped = Math.max(8.5, Math.min(11.6, Math.round(hz * 10) / 10));
    this.alphaIafHz = clamped;
    const spec = this.studySpec;
    if (spec && spec.entrainment.frequencyHz >= 8 && spec.entrainment.frequencyHz <= 12) {
      this.stimulusRack.setOverrideFrequencyHz(clamped);
      if (this.isPlaying) {
        this.updateElapsed(this.elapsedSec);
      }
    }
  }

  public setPersonalAutopilot(opts: {
    fatigueDipMinute?: number | null;
    personalIafHz?: number | null;
  }): void {
    this.personalFatigueDipMin =
      typeof opts.fatigueDipMinute === 'number' && Number.isFinite(opts.fatigueDipMinute)
        ? Math.max(8, Math.min(45, Math.round(opts.fatigueDipMinute)))
        : null;
    if (typeof opts.personalIafHz === 'number' && Number.isFinite(opts.personalIafHz)) {
      this.setAlphaIafHz(opts.personalIafHz);
    }
  }

  public ingestLiveHrvMetrics(
    metrics: { rmssdMs: number; lfPowerRatio: number } | null
  ): void {
    if (!metrics || !Number.isFinite(metrics.rmssdMs) || metrics.rmssdMs <= 0) {
      this.hrvClosedLoopTrim = 0;
      return;
    }
    const isCalmTarget = this.params?.energyTier === 'calm';
    if (!isCalmTarget && metrics.rmssdMs < 22) {
      this.hrvClosedLoopTrim = -0.04;
    } else if (!isCalmTarget && metrics.rmssdMs >= 42) {
      this.hrvClosedLoopTrim = 0.02;
    } else {
      this.hrvClosedLoopTrim = 0;
    }
  }

  /**
   * 1.8s Pavlovian Phase-Lock Signature routed strictly onto Layer-2 `musicMasterBus`
   * (zero impact on Layer-1 stimulus invariance and zero unblinding bias between Active & Sham).
   */
  private triggerPavlovianEntryChime(): void {
    if (
      !this.ctx ||
      !this.musicMasterBus ||
      this.carrierMode === 'pure_stimulus' ||
      this.layerMonitorMode === 'science_only' ||
      !this.studySpec
    ) {
      return;
    }
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + 0.08;
      const rootHz = Math.max(
        196,
        Math.min(
          440,
          computeHarmonicCarrierHz(this.studySpec.music.rootMidi, this.studySpec.music.tuningA4Hz, 220)
        )
      );
      const busGain = ctx.createGain();
      busGain.gain.setValueAtTime(0.0001, t0);
      busGain.gain.linearRampToValueAtTime(0.055, t0 + 0.05);
      busGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      busGain.connect(this.musicMasterBus);

      const oscRoot = ctx.createOscillator();
      const oscFifth = ctx.createOscillator();
      const fifthGain = ctx.createGain();
      fifthGain.gain.setValueAtTime(0.42, t0);

      oscRoot.type = 'sine';
      oscRoot.frequency.setValueAtTime(rootHz, t0);
      oscFifth.type = 'sine';
      oscFifth.frequency.setValueAtTime(rootHz * 1.5, t0);

      oscRoot.connect(busGain);
      oscFifth.connect(fifthGain);
      fifthGain.connect(busGain);

      oscRoot.start(t0);
      oscFifth.start(t0 + 0.14);
      oscRoot.stop(t0 + 1.85);
      oscFifth.stop(t0 + 1.85);
      oscRoot.onended = () => {
        try {
          oscRoot.disconnect();
          oscFifth.disconnect();
          fifthGain.disconnect();
          busGain.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore non-critical WebAudio chime errors
    }
  }

  private triggerLandingReleaseChord(): void {
    if (
      this.landingChordTriggered ||
      !this.ctx ||
      !this.musicMasterBus ||
      this.carrierMode === 'pure_stimulus' ||
      this.layerMonitorMode === 'science_only' ||
      !this.studySpec
    ) {
      return;
    }
    this.landingChordTriggered = true;
    try {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + 0.05;
      const rootHz = Math.max(
        174,
        Math.min(
          392,
          computeHarmonicCarrierHz(this.studySpec.music.rootMidi, this.studySpec.music.tuningA4Hz, 220)
        )
      );
      const busGain = ctx.createGain();
      busGain.gain.setValueAtTime(0.0001, t0);
      busGain.gain.linearRampToValueAtTime(0.042, t0 + 0.25);
      busGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      busGain.connect(this.musicMasterBus);

      const freqs = [rootHz, rootHz * 1.5, rootHz * 2.5];
      const oscs = freqs.map((f, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t0);
        g.gain.setValueAtTime(idx === 0 ? 0.55 : idx === 1 ? 0.35 : 0.22, t0);
        osc.connect(g);
        g.connect(busGain);
        osc.start(t0 + idx * 0.08);
        osc.stop(t0 + 2.45);
        return { osc, g };
      });
      oscs[0].osc.onended = () => {
        try {
          for (const item of oscs) {
            item.osc.disconnect();
            item.g.disconnect();
          }
          busGain.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore non-critical release chord errors
    }
  }

  public applyAcousticProfile(opts: {
    hugginsPassed?: boolean;
    bluetoothHighLatency?: boolean;
  }): void {
    if (opts.hugginsPassed !== undefined) {
      this.hugginsStatus = opts.hugginsPassed ? 'verified_stereo' : 'monaural_safe';
      this.stimulusRack.setForceMonaural(!opts.hugginsPassed);
      this.syncAmWaveformForMonitorMode(
        this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus'
      );
    }
    if (opts.bluetoothHighLatency !== undefined) {
      this.bluetoothSafeActive = opts.bluetoothHighLatency;
      this.stimulusRack.setBluetoothSafe(opts.bluetoothHighLatency);
    }
  }

  public onVoiceSpeakingChange(listener: (speaking: boolean) => void): () => void {
    this.voiceSpeakingListeners.add(listener);
    return () => {
      this.voiceSpeakingListeners.delete(listener);
    };
  }

  private clearVoiceHoldWatchdog(): void {
    if (this.voiceHoldWatchdogTimer !== null) {
      window.clearTimeout(this.voiceHoldWatchdogTimer);
      this.voiceHoldWatchdogTimer = null;
    }
  }

  private scheduleMusicFadeFromVoice(targetGain: number, rampSec: number, eqCutDb: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.08, rampSec);
    if (this.musicMasterBus) {
      try {
        const g = this.musicMasterBus.gain;
        const cur = Math.max(0.05, Math.min(1.0, g.value || 1.0));
        g.cancelScheduledValues(now);
        g.setValueAtTime(cur, now);
        g.exponentialRampToValueAtTime(Math.max(0.05, Math.min(1.0, targetGain)), now + dur);
      } catch {
        // ignore
      }
    }
    if (this.voiceDuckFilterNode) {
      try {
        const fg = this.voiceDuckFilterNode.gain;
        fg.cancelScheduledValues(now);
        fg.setValueAtTime(fg.value, now);
        fg.linearRampToValueAtTime(eqCutDb, now + Math.min(dur, 3.8));
      } catch {
        // ignore
      }
    }
  }

  public primeVoiceIntroHold(): void {
    this.clearVoiceHoldWatchdog();
    if (
      !this.ctx ||
      !this.musicMasterBus ||
      this.layerMonitorMode === 'science_only' ||
      this.isVoiceSpeaking
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    try {
      const g = this.musicMasterBus.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0.06, now);
      g.exponentialRampToValueAtTime(MUSIC_VOICE_DUCK_GAIN, now + 1.6);
    } catch {
      // ignore
    }
    if (this.voiceDuckFilterNode) {
      try {
        const fg = this.voiceDuckFilterNode.gain;
        fg.cancelScheduledValues(now);
        fg.setValueAtTime(-6.0, now);
      } catch {
        // ignore
      }
    }
    this.voiceHoldWatchdogTimer = window.setTimeout(() => {
      this.releaseVoiceIntroHold();
    }, 12000);
  }

  public releaseVoiceIntroHold(): void {
    this.clearVoiceHoldWatchdog();
    if (!this.isVoiceSpeaking) {
      this.scheduleMusicFadeFromVoice(1.0, 2.5, 0.0);
    }
  }

  public async playVoiceConciergeCue(opts: {
    greetingUrl: string;
    bodyUrl: string;
    breathPauseMs?: number;
    initialDelayMs?: number;
    minSessionOffsetMs?: number;
  }): Promise<boolean> {
    if (!this.ctx || !this.isPlaying || this.layerMonitorMode === 'science_only') return false;
    return this.voicePlayer.playTwoPartCue({
      ...opts,
      sessionStartCtxTime: this.sessionStartCtxTime,
      onDuckHold: () => {
        this.clearVoiceHoldWatchdog();
        this.scheduleMusicFadeFromVoice(MUSIC_VOICE_DUCK_GAIN, 0.32, -6.0);
      },
    });
  }

  public stopVoiceConcierge(fadeSec = 0.2): void {
    this.clearVoiceHoldWatchdog();
    this.voicePlayer.cancelActiveVoices(fadeSec);
  }

  public setCircadianMode(mode: 'daylight' | 'night'): void {
    this.circadianMode = mode;
    if (this.ctx && this.circadianFilterNode) {
      smoothSetParam(
        this.circadianFilterNode.gain,
        mode === 'night' ? -2.8 : 0.0,
        this.ctx.currentTime,
        0.35
      );
    }
  }

  public getMomentaryLufs(): number | null {
    return this.momentaryLufs;
  }

  private syncAmWaveformForMonitorMode(pureOnly: boolean): void {
    if (!this.amLfoL) return;
    const isRaisedCosine = this.studySpec?.entrainment.waveform === 'raised_cosine';
    const collapseStereo = this.hugginsStatus === 'monaural_safe';
    if (pureOnly || !this.amUsesSalience) {
      this.amCrestFrac = isRaisedCosine ? 0.0 : 0.25;
      this.amWaveStats = { min: -1, max: 1, rms: Math.SQRT1_2 };
      if (this.amPureWaveL) {
        this.amLfoL.setPeriodicWave(this.amPureWaveL);
      } else {
        this.amLfoL.type = 'sine';
      }
      if (this.amLfoR) {
        const waveR = collapseStereo ? this.amPureWaveL : this.amPureWaveR;
        if (waveR) this.amLfoR.setPeriodicWave(waveR);
      }
    } else {
      this.amCrestFrac = this.amSaliencePeakFrac;
      this.amWaveStats = { ...this.amSalienceStats };
      if (this.amSalienceWaveL) {
        this.amLfoL.setPeriodicWave(this.amSalienceWaveL);
      }
      if (this.amLfoR) {
        const waveR = collapseStereo ? this.amSalienceWaveL : this.amSalienceWaveR;
        if (waveR) this.amLfoR.setPeriodicWave(waveR);
      }
    }
  }

  private computeTrackLufsGain(track: StudioTrackRef | null, genre: ResolvedGenre): number {
    // Target -15.5 LUFS across all 10 genres so peaks (-2.0 dBTP) stay cleanly below musicPreLimiter (-3.35 dBTP);
    // broadband rain stems measure ~3 dB higher K-weighted LUFS than mid-band instruments at equal perceived RMS.
    const base = genre === 'nature_rain' ? 1.15 : 0.92;
    if (track && typeof track.lufs === 'number' && Number.isFinite(track.lufs)) {
      const trimDb = Math.max(-6.0, Math.min(5.0, -15.5 - track.lufs));
      return Number(Math.max(0.28, Math.min(1.35, base * Math.pow(10, trimDb / 20))).toFixed(3));
    }
    return base;
  }

  private syncRainBed(): void {
    const shouldPlayRain =
      this.genre === 'nature_rain' &&
      this.carrierMode !== 'pure_stimulus' &&
      this.layerMonitorMode !== 'science_only';
    this.rainBed.setStudioTrackHasEmbeddedRain(
      this.carrierMode === 'studio_library' && this.usingStudioAudio && !this.usingCustomTrack
    );
    this.rainBed.setActive(shouldPlayRain);
  }

  /**
   * Real-time 3-way A/B/C Layer Monitor (~65 ms snappy click-free crossfade, zero track reload):
   * - 'full_mix': Layer 1 Medical DSP + Layer 2 Music overlapped in key-locked consonance
   * - 'science_only': 100% Isolated Layer 1 scientific wave & noise (0% music bleed)
   * - 'music_only': 100% Raw Layer 2 music only (0% scientific modulation, 0% carrier, 0% noise)
   */
  public setControlTrial(flag: boolean): void {
    this.isControlTrial = flag;
    this.stimulusRack.setControlTrial(flag);
    if (this.ctx) {
      const now = this.ctx.currentTime;
      smoothSetParam(this.amPeriodicGateL?.gain, flag ? 0 : 1, now, 0.065);
      smoothSetParam(this.amShamGateL?.gain, flag ? 1 : 0, now, 0.065);
      smoothSetParam(this.amPeriodicGateR?.gain, flag ? 0 : 1, now, 0.065);
      smoothSetParam(this.amShamGateR?.gain, flag ? 1 : 0, now, 0.065);
    }
    this.syncAmWaveformForMonitorMode(
      flag || this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus'
    );
    this.syncBand2Flattener();
    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec, 0.065);
    }
  }

  public setLayerMonitorMode(mode: LayerMonitorMode): void {
    this.layerMonitorMode = mode;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const muteMusic = mode === 'science_only' || this.carrierMode === 'pure_stimulus';
    const muteScience = mode === 'music_only';

    const preLimCeiling = this.computeMusicPreLimiterCeiling();
    smoothSetParam(this.musicPreLimiterNode?.parameters.get('ceiling'), preLimCeiling, now, 0.065);

    const targetMusicGain = muteMusic
      ? 0
      : muteScience
        ? 1.0
        : this.computeFullMixMusicPocketGain();
    smoothSetParam(this.musicAuditionGain?.gain, targetMusicGain, now, 0.065);
    if (this.cleanSubBus) {
      const wantSub = this.carrierMode === 'generative_live' && !muteMusic;
      smoothSetParam(this.cleanSubBus.gain, wantSub ? 0.9 : 0, now, 0.065);
    }
    this.stimulusRack.setScienceMuted(muteScience);
    this.stimulusRack.setPureStimulusMode(muteMusic && !muteScience);

    const discreteHz = this.stimulusRack.getPrimaryCarrierHz();
    const pocketHz = discreteHz ?? this.amCarrierRootHz;
    const wantPocket = Boolean(pocketHz && !this.isControlTrial && !muteScience && !muteMusic);
    smoothSetParam(
      this.spectralPocketNotch?.gain,
      wantPocket ? (discreteHz ? -4.5 : -3.2) : 0,
      now,
      0.08
    );
    smoothSetParam(this.mudCleanFilterNode?.gain, muteMusic ? 0 : -2.2, now, 0.08);
    smoothSetParam(
      this.innerVoicePocketNode?.gain,
      muteMusic ? 0 : this.params?.energyTier === 'calm' ? -1.8 : -3.2,
      now,
      0.08
    );

    const needsPureHrv = muteMusic && !muteScience && this.specNeedsPureHrvReferenceCarrier();
    smoothSetParam(this.pureAmCarrierGain?.gain, needsPureHrv ? 0.24 : 0, now, 0.08);
    smoothSetParam(
      this.amScienceCarrierGain?.gain,
      this.computeAmScienceCarrierTarget(1.0),
      now,
      0.065
    );
    this.crossfeedNode?.parameters.get('enabled')?.setValueAtTime(muteMusic ? 0 : 1, now);
    this.syncAmWaveformForMonitorMode(muteMusic && !muteScience);
    this.syncBand2Flattener();
    this.syncRainBed();

    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec, 0.065);
    }
  }

  public getLayerMonitorMode(): LayerMonitorMode {
    return this.layerMonitorMode;
  }

  /**
   * Live mid-session Carrier Engine Switcher:
   * Switch seamlessly between Live Generative ($0 Study-Locked), Studio R2 Library, or Pure Clinical Signal
   * while keeping Layer 1 Medical DSP 100% uninterrupted!
   */
  public setCarrierMode(mode: CarrierEngineMode): void {
    this.carrierMode = mode;
    if (!this.ctx || !this.proceduralMaster || !this.cleanSubBus) return;
    const now = this.ctx.currentTime;

    if (mode !== 'lyria_realtime') {
      this.lyriaClient.stop();
      this.lyriaStatus = 'idle';
    }

    if (mode === 'generative_live') {
      this.clearStudioDeck(1.4);
      this.usingStudioAudio = false;
      this.usingCustomTrack = false;
      this.activeTrackName = null;
      this.activeTrackKey = null;
      this.activeTrackKeyLabel = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      this.activeStemCodecLabel = null;
      this.activeStemSubHarmonicLocked = false;
      if (this.layerMonitorMode === 'science_only') {
        this.layerMonitorMode = 'full_mix';
      }
      const muteScience = this.layerMonitorMode === 'music_only';
      smoothSetParam(
        this.musicPreLimiterNode?.parameters.get('ceiling'),
        this.computeMusicPreLimiterCeiling(),
        now,
        0.12
      );
      smoothSetParam(
        this.musicAuditionGain?.gain,
        muteScience ? 1.0 : this.computeFullMixMusicPocketGain(),
        now,
        0.12
      );
      this.stimulusRack.setScienceMuted(muteScience);
      this.stimulusRack.setPureStimulusMode(false);
      smoothSetParam(this.pureAmCarrierGain?.gain, 0, now, 0.12);
      smoothSetParam(
        this.amScienceCarrierGain?.gain,
        this.computeAmScienceCarrierTarget(1.0),
        now,
        0.12
      );
      this.crossfeedNode?.parameters.get('enabled')?.setValueAtTime(1, now);
      this.syncAmWaveformForMonitorMode(false);
      this.composer.setStandby(false);
      smoothSetParam(this.proceduralMaster.gain, 0.94, now, 0.45);
      smoothSetParam(this.cleanSubBus.gain, 0.9, now, 0.45);
    } else if (mode === 'pure_stimulus') {
      this.clearStudioDeck(1.2);
      this.usingStudioAudio = false;
      this.usingCustomTrack = false;
      this.activeTrackName = null;
      this.activeTrackKey = null;
      this.activeTrackKeyLabel = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      this.activeStemCodecLabel = null;
      this.activeStemSubHarmonicLocked = false;
      this.layerMonitorMode = 'science_only';
      smoothSetParam(this.musicAuditionGain?.gain, 0, now, 0.08);
      this.stimulusRack.setScienceMuted(false);
      this.stimulusRack.setPureStimulusMode(true);
      this.composer.setStandby(true);
      smoothSetParam(this.proceduralMaster.gain, 0, now, 0.25);
      smoothSetParam(this.cleanSubBus.gain, 0, now, 0.25);
      const needsPureHrv = this.specNeedsPureHrvReferenceCarrier();
      smoothSetParam(this.pureAmCarrierGain?.gain, needsPureHrv ? 0.24 : 0, now, 0.12);
      smoothSetParam(
        this.amScienceCarrierGain?.gain,
        this.computeAmScienceCarrierTarget(1.0),
        now,
        0.12
      );
      this.crossfeedNode?.parameters.get('enabled')?.setValueAtTime(0, now);
      this.syncAmWaveformForMonitorMode(true);
    } else if (mode === 'studio_library') {
      if (this.layerMonitorMode === 'science_only') {
        this.layerMonitorMode = 'full_mix';
      }
      const muteScience = this.layerMonitorMode === 'music_only';
      smoothSetParam(
        this.musicPreLimiterNode?.parameters.get('ceiling'),
        this.computeMusicPreLimiterCeiling(),
        now,
        0.12
      );
      smoothSetParam(
        this.musicAuditionGain?.gain,
        muteScience ? 1.0 : this.computeFullMixMusicPocketGain(),
        now,
        0.12
      );
      this.stimulusRack.setScienceMuted(muteScience);
      this.stimulusRack.setPureStimulusMode(false);
      smoothSetParam(this.pureAmCarrierGain?.gain, 0, now, 0.12);
      smoothSetParam(
        this.amScienceCarrierGain?.gain,
        this.computeAmScienceCarrierTarget(1.0),
        now,
        0.12
      );
      this.crossfeedNode?.parameters.get('enabled')?.setValueAtTime(1, now);
      this.syncAmWaveformForMonitorMode(false);
      void this.activateStudioForGenre(this.genre);
    }
    this.syncBand2Flattener();
    this.syncRainBed();
    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec, 0.08);
    }
  }

  /**
   * Plug-and-Play Google Lyria RealTime AI Activation (when ephemeral token is minted by server).
   * Streams infinite, never-repeating 48 kHz stereo music in the active curated genre through 3-Band LR4 DSP.
   * Keeps the prior deck playing seamlessly until the first live audio frame arrives.
   */
  public async activateLyriaRealtime(
    token: string,
    model: string,
    onStatus?: (status: LyriaRealtimeStatus, note?: string) => void,
    fetchFreshToken?: () => Promise<{ token: string; model?: string } | null>
  ): Promise<boolean> {
    if (!this.ctx || !this.studioBus || !this.studySpec || !this.isPlaying) return false;
    if (this.layerMonitorMode === 'science_only') {
      this.layerMonitorMode = 'full_mix';
    }
    const muteScience = this.layerMonitorMode === 'music_only';
    smoothSetParam(
      this.musicPreLimiterNode?.parameters.get('ceiling'),
      this.computeMusicPreLimiterCeiling(),
      this.ctx.currentTime,
      0.12
    );
    smoothSetParam(
      this.musicAuditionGain?.gain,
      muteScience ? 1.0 : this.computeFullMixMusicPocketGain(),
      this.ctx.currentTime,
      0.12
    );
    this.stimulusRack.setScienceMuted(muteScience);
    this.stimulusRack.setPureStimulusMode(false);
    smoothSetParam(this.pureAmCarrierGain?.gain, 0, this.ctx.currentTime, 0.12);
    smoothSetParam(
      this.amScienceCarrierGain?.gain,
      this.computeAmScienceCarrierTarget(1.0),
      this.ctx.currentTime,
      0.12
    );
    this.crossfeedNode?.parameters.get('enabled')?.setValueAtTime(1, this.ctx.currentTime);
    this.syncAmWaveformForMonitorMode(false);

    const ok = await this.lyriaClient.connect({
      ctx: this.ctx,
      destinationBus: this.studioBus,
      token,
      model,
      spec: this.studySpec,
      genre: this.genre,
      apiBase: this.sampleApiBase,
      fetchFreshToken,
      onStatusChange: (st, note) => {
        this.lyriaStatus = st;
        onStatus?.(st, note);
        if (st === 'streaming' && this.ctx && this.proceduralMaster && this.cleanSubBus) {
          const now = this.ctx.currentTime;
          const wasAlreadyLyria = this.carrierMode === 'lyria_realtime';
          if (!wasAlreadyLyria) {
            this.clearStudioDeck(1.2);
            this.carrierMode = 'lyria_realtime';
            if (this.layerMonitorMode === 'science_only') {
              this.layerMonitorMode = 'full_mix';
            }
          }
          const isSciOnly = this.layerMonitorMode === 'science_only';
          const isMusOnly = this.layerMonitorMode === 'music_only';
          smoothSetParam(
            this.musicPreLimiterNode?.parameters.get('ceiling'),
            this.computeMusicPreLimiterCeiling(),
            now,
            0.12
          );
          smoothSetParam(
            this.musicAuditionGain?.gain,
            isSciOnly ? 0 : isMusOnly ? 1.0 : this.computeFullMixMusicPocketGain(),
            now,
            0.12
          );
          smoothSetParam(
            this.amScienceCarrierGain?.gain,
            this.computeAmScienceCarrierTarget(1.0),
            now,
            0.12
          );
          this.crossfeedNode?.parameters.get('enabled')?.setValueAtTime(isSciOnly ? 0 : 1, now);
          this.syncAmWaveformForMonitorMode(isSciOnly);
          this.usingStudioAudio = false;
          this.usingCustomTrack = false;
          this.activeTrackKey = null;
          this.activeTrackKeyLabel = null;
          this.activeTrackNativeBpm = 0;
          this.activeStudioAppliedBpm = 0;
          this.activeStemCodecLabel = null;
          this.activeStemSubHarmonicLocked = false;
          this.composer.setStandby(true);
          smoothSetParam(this.proceduralMaster.gain, 0, now, 0.65);
          smoothSetParam(this.cleanSubBus.gain, 0, now, 0.65);
          this.syncRainBed();
        } else if ((st === 'error' || st === 'unavailable') && this.carrierMode === 'lyria_realtime') {
          this.setCarrierMode(
            Object.keys(this.studioCatalog).length > 0 ? 'studio_library' : 'generative_live'
          );
        }
      },
    });
    return ok;
  }

  public getCarrierMode(): CarrierEngineMode {
    return this.carrierMode;
  }

  public setStudioCatalog(catalog: Partial<Record<ResolvedGenre, StudioTrackRef[]>>): void {
    this.studioCatalog = catalog;
    if (
      this.isPlaying &&
      this.ctx &&
      this.carrierMode === 'studio_library' &&
      !this.activeCustomTrack &&
      !this.usingCustomTrack &&
      !this.usingStudioAudio
    ) {
      void this.activateStudioForGenre(this.genre);
    }
  }

  private clearStudioDeck(fadeSec = 1.4): void {
    if (this.studioCrossfadeTimer !== null) {
      window.clearTimeout(this.studioCrossfadeTimer);
      this.studioCrossfadeTimer = null;
    }
    if (this.activeStemAbort) {
      try {
        this.activeStemAbort.abort();
      } catch {
        // ignore
      }
      this.activeStemAbort = null;
    }
    if (this.activeStreamCleanup) {
      try {
        this.activeStreamCleanup();
      } catch {
        // ignore
      }
      this.activeStreamCleanup = null;
    }
    this.activeStreamCrossfadeCheck = null;
    const prevSrc = this.activeStudioSource;
    const prevStreamEl = this.activeStreamEl;
    const prevStreamSrc = this.activeStreamSource;
    const prevSlot = this.activeMediaSlot;
    const releaseGen = this.activeMediaSlotGen;
    const prevMediaDelay = this.activeMediaDelayNode;
    const prevWsola = this.activeWsolaNode;
    const prevStemPlayer = this.activeStemPlayerNode;
    const prevGain = this.activeStudioGain;
    if (prevSlot) {
      prevSlot.inUse = false;
      prevSlot.fadingOut = true;
    }
    this.activeStudioSource = null;
    this.activeStreamEl = null;
    this.activeStreamSource = null;
    this.activeMediaSlot = null;
    this.activeMediaSlotGen = 0;
    this.activeMediaDelayNode = null;
    this.activeWsolaNode = null;
    this.activeWsolaMode = 'none';
    this.activeStemPlayerNode = null;
    this.activeStudioGain = null;

    const cleanupMediaEl = () => {
      try {
        prevMediaDelay?.disconnect();
      } catch {
        // ignore
      }
      if (!prevStreamEl) return;
      if (prevSlot) {
        // Generation guard: NEVER pause, clear src, or disconnect if this pooled slot was already acquired by a newer stem!
        if (prevSlot.generation !== releaseGen) return;
        prevSlot.fadingOut = false;
        prevSlot.inUse = false;
        try {
          prevStreamEl.pause();
          prevStreamEl.removeAttribute('src');
          prevStreamEl.load();
          prevStreamSrc?.disconnect();
        } catch {
          // ignore
        }
        return;
      }
      try {
        prevStreamEl.pause();
        prevStreamEl.src = '';
        prevStreamSrc?.disconnect();
      } catch {
        // ignore
      }
    };

    if (this.ctx && prevGain && (prevSrc || prevStreamEl || prevWsola || prevStemPlayer)) {
      const now = this.ctx.currentTime;
      try {
        holdAndRampGain(prevGain.gain, 0.0001, now + fadeSec, now);
      } catch {
        // ignore
      }
      window.setTimeout(() => {
        try {
          prevSrc?.stop();
          prevSrc?.disconnect();
        } catch {
          // ignore
        }
        try {
          if (prevWsola) {
            prevWsola.port.postMessage({ type: 'stop' });
            prevWsola.port.onmessage = null;
            prevWsola.disconnect();
          }
          if (prevStemPlayer) {
            prevStemPlayer.port.postMessage({ type: 'stop' });
            prevStemPlayer.port.onmessage = null;
            prevStemPlayer.disconnect();
          }
        } catch {
          // ignore
        }
        cleanupMediaEl();
        try {
          prevGain.disconnect();
        } catch {
          // ignore
        }
      }, fadeSec * 1000 + 150);
    } else {
      try {
        prevSrc?.stop();
        prevSrc?.disconnect();
      } catch {
        // ignore
      }
      try {
        if (prevWsola) {
          prevWsola.port.postMessage({ type: 'stop' });
          prevWsola.port.onmessage = null;
          prevWsola.disconnect();
        }
        if (prevStemPlayer) {
          prevStemPlayer.port.postMessage({ type: 'stop' });
          prevStemPlayer.port.onmessage = null;
          prevStemPlayer.disconnect();
        }
      } catch {
        // ignore
      }
      cleanupMediaEl();
    }
  }

  private computeRmsGain(buffer: AudioBuffer): number {
    const chCount = Math.min(2, buffer.numberOfChannels);
    const len = buffer.length;
    if (chCount === 0 || len === 0) return 0.96;
    const stride = Math.max(1, Math.floor(len / 48000));
    let sumSq = 0;
    let count = 0;
    for (let c = 0; c < chCount; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < len; i += stride) {
        const s = data[i];
        sumSq += s * s;
        count++;
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(1, count));
    if (rms < 0.005) return 0.96;
    return Number(Math.max(0.45, Math.min(1.55, (0.19 / rms) * 0.96)).toFixed(3));
  }

  private async loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.bufferCache.get(url);
    if (cached) {
      this.bufferCache.delete(url);
      this.bufferCache.set(url, cached);
      return cached;
    }
    // Hard mobile/WebKit memory ceiling: NEVER decode multi-minute stems (> 2.2 MB compressed = ~138 MB PCM)
    // via decodeAudioData — long stems stream progressively via WebCodecs or HTTP 206 MediaElement (< 3 MB RAM)!
    const MAX_DECODE_AUDIO_BYTES = 2_200_000;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const contentLen = Number(res.headers.get('content-length') ?? 0);
      if (Number.isFinite(contentLen) && contentLen > MAX_DECODE_AUDIO_BYTES) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        return null;
      }
      const arr = await res.arrayBuffer();
      if (!this.ctx || arr.byteLength > MAX_DECODE_AUDIO_BYTES) return null;
      const decoded = await this.ctx.decodeAudioData(arr);

      while (this.bufferCache.size >= this.maxCachedBuffers) {
        const oldestKey = this.bufferCache.keys().next().value;
        if (oldestKey) this.bufferCache.delete(oldestKey);
        else break;
      }
      this.bufferCache.set(url, decoded);
      return decoded;
    } catch {
      return null;
    }
  }

  private inferTrackNativeBpm(track: StudioTrackRef | null, genre: ResolvedGenre): number {
    if (track && typeof track.bpm === 'number' && Number.isFinite(track.bpm)) {
      return Math.max(0, Math.round(track.bpm));
    }
    const name = track?.name ?? '';
    const explicitMatch =
      name.match(/\b(4[89]|[5-9]\d|1[0-6]\d|17[0-5])\s*bpm\b/i) ??
      name.match(/\b(4[89]|[5-9]\d|1[0-6]\d|17[0-5])(?:\s+\d+)?$/i);
    if (explicitMatch) return Number(explicitMatch[1]);
    switch (genre) {
      case 'nature_rain':
        return 0;
      case 'ambient_space':
        return 64;
      case 'solo_piano':
        return track?.energy === 'calm' ? 72 : 86;
      case 'lofi_keys':
      case 'dub_reggae':
        return 88;
      case 'acoustic_pluck':
        return 90;
      case 'cinematic_strings':
      case 'jazz_rhodes':
      case 'bossa_nova':
        return 92;
      case 'nootropic_trance':
        return 120;
      case 'deep_electronic':
        return 112;
    }
  }

  private getTargetStudyBpm(
    progressRatio = Math.min(1, Math.max(0, this.elapsedSec / Math.max(1, this.plannedSec)))
  ): number {
    const ramp = this.studySpec?.music.bpmRamp;
    if (ramp) {
      return Math.round(ramp.start + (ramp.end - ramp.start) * progressRatio);
    }
    return Math.round(this.studySpec?.music.bpm ?? this.params?.bpm ?? 0);
  }

  private computeStudioTempoAlignment(
    nativeBpm: number,
    targetBpm: number,
    isCustom = this.usingCustomTrack
  ): { tempoRate: number; pitchRatio: number; effectiveBpm: number } {
    const want432 = this.studySpec?.music.tuningA4Hz === 432;
    const pitchRatio = want432 ? 432 / 440 : 1.0;

    if (!this.workletsReady && want432) {
      return {
        tempoRate: pitchRatio,
        pitchRatio,
        effectiveBpm: nativeBpm > 0 ? Math.round(nativeBpm * pitchRatio) : 0,
      };
    }

    if (isCustom || nativeBpm <= 0 || targetBpm <= 0) {
      return {
        tempoRate: 1.0,
        pitchRatio,
        effectiveBpm: nativeBpm > 0 ? nativeBpm : 0,
      };
    }

    const candidates = [nativeBpm, nativeBpm * 0.5, nativeBpm * 2];
    let metricBase = nativeBpm;
    let bestDist = Math.abs(nativeBpm - targetBpm);
    for (const cand of candidates) {
      const dist = Math.abs(cand - targetBpm);
      if (dist < bestDist) {
        bestDist = dist;
        metricBase = cand;
      }
    }
    const tempoRate = Number(Math.max(0.88, Math.min(1.12, targetBpm / metricBase)).toFixed(4));
    return {
      tempoRate,
      pitchRatio,
      effectiveBpm: Math.round(metricBase * tempoRate),
    };
  }

  private async playStreamingTrack(
    url: string,
    trackName: string,
    token: number,
    targetGain: number,
    isCustom: boolean,
    onCrossfade?: () => void,
    fadeInSec = 1.8,
    nativeBpm = 0,
    keyLabel: string | null = null,
    trackKey: string | null = null
  ): Promise<boolean> {
    if (!this.ctx || !this.studioBus || token !== this.studioLoadToken) return false;
    const claimed = this.acquireMediaDeckSlot();
    const pooledSlot = claimed?.slot ?? null;
    const claimedGen = claimed?.gen ?? 0;
    const el = pooledSlot ? pooledSlot.el : new Audio();
    if (!pooledSlot) {
      el.crossOrigin = 'anonymous';
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      el.setAttribute('playsinline', 'true');
    }
    try {
      el.preload = 'auto';
      el.loop = !onCrossfade;
      const pitchEl = el as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      const alignment = this.computeStudioTempoAlignment(nativeBpm, this.getTargetStudyBpm(), isCustom);
      const wantsWsola =
        this.workletsReady &&
        (Math.abs(alignment.tempoRate - 1.0) >= 0.0005 ||
          Math.abs(alignment.pitchRatio - 1.0) >= 0.0005 ||
          Boolean(this.studySpec?.music.bpmRamp));

      if (wantsWsola || this.studySpec?.music.tuningA4Hz === 432) {
        if ('preservesPitch' in pitchEl) pitchEl.preservesPitch = false;
        if ('mozPreservesPitch' in pitchEl) pitchEl.mozPreservesPitch = false;
        if ('webkitPreservesPitch' in pitchEl) pitchEl.webkitPreservesPitch = false;
      } else {
        const useBrowserPitchPreserve = Math.abs(alignment.tempoRate - 1.0) >= 0.0005;
        if ('preservesPitch' in pitchEl) pitchEl.preservesPitch = useBrowserPitchPreserve;
        if ('mozPreservesPitch' in pitchEl) pitchEl.mozPreservesPitch = useBrowserPitchPreserve;
        if ('webkitPreservesPitch' in pitchEl) pitchEl.webkitPreservesPitch = useBrowserPitchPreserve;
      }
      el.playbackRate = alignment.tempoRate;
      el.src = url;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: unknown) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          el.removeEventListener('canplay', onReady);
          el.removeEventListener('loadeddata', onReady);
          el.removeEventListener('error', onErr);
          if (err) reject(err);
          else resolve();
        };
        const onReady = () => done();
        const onErr = () => done(new Error('stream_load_failed'));
        const timer = window.setTimeout(() => done(new Error('stream_timeout')), 8000);
        el.addEventListener('canplay', onReady);
        el.addEventListener('loadeddata', onReady);
        el.addEventListener('error', onErr);
        el.load();
      });

      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        this.releaseFailedMediaSlot(pooledSlot, claimedGen, el);
        return false;
      }

      const ctx = this.ctx;
      const now = ctx.currentTime;
      const srcNode = pooledSlot ? pooledSlot.srcNode : ctx.createMediaElementSource(el);
      try {
        srcNode.disconnect();
      } catch {
        // ignore
      }
      const deckGain = ctx.createGain();
      deckGain.gain.setValueAtTime(0.0001, now);

      let wsolaNode: AudioWorkletNode | null = null;
      if (wantsWsola) {
        wsolaNode = new AudioWorkletNode(ctx, 'nootropic-wsola-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { mode: 'ring', sourceScale: 1.0 },
        });
        const ringPitch = Math.max(
          0.72,
          Math.min(1.38, alignment.pitchRatio / Math.max(0.5, el.playbackRate || alignment.tempoRate))
        );
        wsolaNode.parameters.get('pitchRatio')?.setValueAtTime(ringPitch, now);
        wsolaNode.parameters.get('tempoRatio')?.setValueAtTime(alignment.tempoRate, now);
        // Keep bypass=0 so constant-delay unity crossfade inside NootropicWsolaProcessor prevents 80ms clicks
        wsolaNode.parameters.get('bypass')?.setValueAtTime(0, now);
        srcNode.connect(wsolaNode);
        wsolaNode.connect(deckGain);
      } else {
        srcNode.connect(deckGain);
      }
      deckGain.connect(this.studioBus);

      await el.play();

      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        try {
          if (wsolaNode) {
            wsolaNode.port.postMessage({ type: 'stop' });
            wsolaNode.port.onmessage = null;
            wsolaNode.disconnect();
          }
          deckGain.disconnect();
        } catch {
          // ignore
        }
        this.releaseFailedMediaSlot(pooledSlot, claimedGen, el);
        return false;
      }

      this.clearStudioDeck(fadeInSec);
      this.composer.setStandby(true);
      if (this.proceduralMaster && this.cleanSubBus) {
        this.proceduralMaster.gain.setTargetAtTime(0, now, 0.55);
        this.cleanSubBus.gain.setTargetAtTime(0, now, 0.55);
      }

      deckGain.gain.exponentialRampToValueAtTime(Math.max(0.1, targetGain), now + fadeInSec);

      // Dual-Deck Gapless Crossfade Watcher (timeupdate + background-safe updateElapsed guard)
      let cleanupListeners: (() => void) | null = null;
      let crossfadeChecker: (() => void) | null = null;
      if (onCrossfade) {
        let crossfadeTriggered = false;
        const triggerOnce = () => {
          if (crossfadeTriggered) return;
          crossfadeTriggered = true;
          this.activeStreamCrossfadeCheck = null;
          cleanupListeners?.();
          onCrossfade();
        };
        const checkPosition = () => {
          if (
            !crossfadeTriggered &&
            Number.isFinite(el.duration) &&
            el.duration > 12 &&
            el.currentTime >= el.duration - 4.2 * Math.max(0.88, el.playbackRate)
          ) {
            triggerOnce();
          }
        };
        crossfadeChecker = checkPosition;
        const onEnded = () => triggerOnce();
        el.addEventListener('timeupdate', checkPosition);
        el.addEventListener('ended', onEnded);
        cleanupListeners = () => {
          el.removeEventListener('timeupdate', checkPosition);
          el.removeEventListener('ended', onEnded);
        };
      }

      this.activeStreamEl = el;
      this.activeStreamSource = srcNode;
      this.activeMediaSlot = pooledSlot;
      this.activeMediaSlotGen = claimedGen;
      this.activeStreamCleanup = cleanupListeners;
      this.activeStreamCrossfadeCheck = crossfadeChecker;
      this.activeWsolaNode = wsolaNode;
      this.activeWsolaMode = wsolaNode ? 'ring' : 'none';
      this.activeStudioGain = deckGain;
      this.usingStudioAudio = true;
      this.usingCustomTrack = isCustom;
      this.activeTrackName = trackName;
      this.activeTrackKey = this.usingCustomTrack ? null : trackKey;
      this.activeTrackKeyLabel = keyLabel;
      this.activeTrackNativeBpm = nativeBpm;
      this.activeStudioAppliedBpm = alignment.effectiveBpm;
      return true;
    } catch {
      this.releaseFailedMediaSlot(pooledSlot, claimedGen, el);
      return false;
    }
  }

  public async crossfadeToCustomTrack(url: string, label: string, fadeSec = 1.8): Promise<boolean> {
    if (!this.ctx || !this.studioBus || !this.isPlaying) return false;
    const token = ++this.studioLoadToken;
    this.activeCustomTrack = { url, label };
    this.carrierMode = 'studio_library';
    this.stimulusRack.setPureStimulusMode(false);

    // 1. Instant HTTP 206 Range streaming (<0.3s start) with smooth 4s Dual-Deck crossfade
    const streamed = await this.playStreamingTrack(
      url,
      label,
      token,
      0.96,
      true,
      () => {
        if (!this.isPlaying || token !== this.studioLoadToken) return;
        void this.crossfadeToCustomTrack(url, label, 4.0);
      },
      fadeSec
    );
    if (streamed) return true;
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) return false;

    // 2. Fallback to decoded AudioBuffer if streaming autoplay/CORS ever fails
    const buffer = await this.loadAudioBuffer(url);
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !buffer) {
      return false;
    }
    const rmsGain = this.computeRmsGain(buffer);
    this.usingCustomTrack = true;
    this.playStudioBuffer(buffer, label, token, rmsGain, () => {
      if (!this.isPlaying || token !== this.studioLoadToken) return;
      void this.crossfadeToCustomTrack(url, label, 4.0);
    });
    return true;
  }

  private selectTracksForGenreAndEnergy(genre: ResolvedGenre): StudioTrackRef[] {
    const all = this.studioCatalog[genre] ?? [];
    if (all.length === 0) return [];
    const targetEnergy: EnergyTier = this.params?.energyTier ?? 'focus';
    const exact = all.filter((t) => t.energy === targetEnergy);
    if (exact.length > 0) return exact;
    const fallbackOrder: Record<EnergyTier, EnergyTier[]> = {
      calm: ['focus', 'drive'],
      focus: ['calm', 'drive'],
      drive: ['focus', 'calm'],
    };
    for (const alt of fallbackOrder[targetEnergy]) {
      const matched = all.filter((t) => t.energy === alt);
      if (matched.length > 0) return matched;
    }
    return all;
  }

  private getActiveTargetNeuralHz(): number {
    const spec = this.studySpec;
    if (!spec) return this.params?.modulationHz ?? 0;
    const baseHz = spec.entrainment.frequencyHz ?? this.params?.modulationHz ?? 0;
    if (baseHz >= 8 && baseHz <= 12 && this.alphaIafHz !== null) {
      return this.alphaIafHz;
    }
    return baseHz;
  }

  private supportsOpusAudio(): boolean {
    if (this.opusSupported !== null) return this.opusSupported;
    try {
      if (typeof document !== 'undefined') {
        const probe = document.createElement('audio');
        const support = probe.canPlayType('audio/ogg; codecs="opus"');
        this.opusSupported = support === 'probably' || support === 'maybe';
        return this.opusSupported;
      }
    } catch {
      // ignore SSR / headless probes
    }
    this.opusSupported = true;
    return true;
  }

  private async playDirectWorkletStem(
    track: StudioTrackRef,
    targetGain: number,
    token: number,
    fadeSec: number,
    onCrossfade: () => void,
    nativeBpm: number
  ): Promise<boolean> {
    if (!this.ctx || !this.studioBus || !this.workletsReady || token !== this.studioLoadToken) {
      return false;
    }

    const stemBpm = track.subHarmonicBpm && track.subHarmonicBpm > 0 ? track.subHarmonicBpm : nativeBpm;
    const neuralHz = this.getActiveTargetNeuralHz();
    const tune432Ratio = this.studySpec?.music.tuningA4Hz === 432 ? 432 / 440 : 1.0;
    // NEVER pitch-shift music to chase a grid: varispeed (no pitch preservation) would detune the stem by up to
    // ±12% (~2 semitones) and wobble as the Iso-ramp moves. Stems are pre-rendered offline on exact grids, so we
    // play them at unity rate (only the constant 432/440 tuning ratio) and phase-lock only when truly aligned.
    const rawGrid = pickPlaybackGridRate(stemBpm, neuralHz, tune432Ratio);
    const gridRate = {
      targetGridBpm: stemBpm,
      tempoScale: 1,
      totalRate: tune432Ratio,
      isSubHarmonicLocked: rawGrid.isSubHarmonicLocked && Math.abs(rawGrid.tempoScale - 1) < 1e-9,
    };
    const amActive =
      this.studySpec?.entrainment.type === 'amplitude_modulation' &&
      neuralHz > 0 &&
      gridRate.isSubHarmonicLocked;
    const trackDurSec =
      typeof track.durationSec === 'number' && track.durationSec > 20 ? track.durationSec : null;
    // Start next-track preload 10 s before the end so the 4 s overlap crossfade never leaves a silent gap
    const CROSSFADE_LEAD_SEC = 10;

    // Path A: Progressive WebCodecs Ogg/Opus HTTP Range streaming (<200 ms start, low RAM)
    if (track.opusUrl && (await canUseWebCodecsOpus())) {
      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        return false;
      }
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const delaySec =
        amActive && typeof track.downbeatOffsetMs === 'number' && track.downbeatOffsetMs >= 0
          ? computeDownbeatPhaseDelaySec({
              amOriginSec: this.amLfoOriginSec,
              scheduleStartSec: now,
              downbeatOffsetMs: track.downbeatOffsetMs / Math.max(0.75, gridRate.totalRate),
              neuralHz,
              crestCycleFraction: this.amCrestFrac,
            })
          : 0;
      const delaySamples = Math.max(0, Math.round(delaySec * ctx.sampleRate));

      const abortCtrl = new AbortController();
      const stemNode = new AudioWorkletNode(ctx, 'nootropic-stem-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          sourceSampleRate: track.sampleRate || 48000,
          delaySamples,
        },
      });
      stemNode.parameters.get('playbackRate')?.setValueAtTime(gridRate.totalRate, now);

      let knownTotalFrames = trackDurSec ? Math.round(trackDurSec * 48000) : Infinity;
      let streamHandle: Awaited<ReturnType<typeof streamOpusIntoWorklet>> = null;
      let latestConsumerFrame = 0;
      let crossfadeTriggered = false;
      const crossfadeLeadSec = CROSSFADE_LEAD_SEC;

      const triggerCrossfadeOnce = () => {
        if (crossfadeTriggered) return;
        crossfadeTriggered = true;
        if (this.studioCrossfadeTimer !== null) {
          window.clearTimeout(this.studioCrossfadeTimer);
          this.studioCrossfadeTimer = null;
        }
        onCrossfade();
      };

      stemNode.port.onmessage = (evt) => {
        if (token !== this.studioLoadToken || !evt.data) return;
        if (evt.data.type === 'need_chunk') {
          const sf = Number(evt.data.sourceFrame) || 0;
          if (sf > latestConsumerFrame) latestConsumerFrame = sf;
          streamHandle?.onConsumerFrame(latestConsumerFrame);
        } else if (evt.data.type === 'progress') {
          const sourceFrame = Number(evt.data.sourceFrame) || 0;
          if (sourceFrame > latestConsumerFrame) latestConsumerFrame = sourceFrame;
          streamHandle?.onConsumerFrame(latestConsumerFrame);
          if (Number.isFinite(knownTotalFrames)) {
            const remainingFrames = Math.max(0, knownTotalFrames - sourceFrame);
            const remainingSec = remainingFrames / (48000 * Math.max(0.75, gridRate.totalRate));
            if (remainingSec <= crossfadeLeadSec) {
              triggerCrossfadeOnce();
            }
          }
        } else if (evt.data.type === 'eof') {
          triggerCrossfadeOnce();
        }
      };

      streamHandle = await streamOpusIntoWorklet({
        url: track.opusUrl,
        signal: abortCtrl.signal,
        onChunk: (left, right) => {
          stemNode.port.postMessage({ type: 'chunk', left, right }, [left.buffer, right.buffer]);
        },
        onEnd: (totFrames) => {
          knownTotalFrames = totFrames;
          stemNode.port.postMessage({ type: 'end' });
        },
      });

      if (
        streamHandle &&
        token === this.studioLoadToken &&
        this.ctx &&
        this.studioBus &&
        this.isPlaying
      ) {
        streamHandle.onConsumerFrame(latestConsumerFrame);
        const startNow = this.ctx.currentTime;
        this.clearStudioDeck(fadeSec);
        this.composer.setStandby(true);
        if (this.proceduralMaster && this.cleanSubBus) {
          this.proceduralMaster.gain.setTargetAtTime(0, startNow, 0.55);
          this.cleanSubBus.gain.setTargetAtTime(0, startNow, 0.55);
        }

        const deckGain = this.ctx.createGain();
        deckGain.gain.setValueAtTime(0.0001, startNow);
        deckGain.gain.exponentialRampToValueAtTime(Math.max(0.1, targetGain), startNow + fadeSec);
        stemNode.connect(deckGain);
        deckGain.connect(this.studioBus);

        this.activeStudioSource = null;
        this.activeWsolaNode = null;
        this.activeWsolaMode = 'none';
        this.activeStemPlayerNode = stemNode;
        this.activeStemAbort = abortCtrl;
        this.activeStudioGain = deckGain;
        this.usingStudioAudio = true;
        this.usingCustomTrack = false;
        this.activeTrackName = track.name;
        this.activeTrackKey = track.key;
        this.activeTrackKeyLabel = track.keyLabel ?? null;
        this.activeTrackNativeBpm = stemBpm;
        this.activeStudioAppliedBpm =
          gridRate.targetGridBpm > 0 ? Math.round(gridRate.targetGridBpm * tune432Ratio) : 0;
        this.activeStemCodecLabel = gridRate.isSubHarmonicLocked
          ? '48 kHz Opus · WebCodecs Phase-Locked'
          : '48 kHz Opus · WebCodecs';
        this.activeStemSubHarmonicLocked = gridRate.isSubHarmonicLocked;
        const streamDelaySec = trackDurSec
          ? Math.max(1.5, delaySec + trackDurSec / Math.max(0.75, gridRate.totalRate) - CROSSFADE_LEAD_SEC)
          : 150;
        this.scheduleDeckCrossfade(streamDelaySec, triggerCrossfadeOnce);
        return true;
      }

      // Clean up pre-created worklet if streaming aborted or unavailable
      try {
        abortCtrl.abort();
        stemNode.port.postMessage({ type: 'stop' });
        stemNode.port.onmessage = null;
        stemNode.disconnect();
      } catch {
        // ignore
      }
      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        return false;
      }
    }

    // Path B (Safari / iOS WebKit / non-WebCodecs browsers):
    // Progressive HTTP 206 Range streaming (.m4a 48 kHz AAC-LC on Safari/iOS, .opus on Firefox)
    // via our pre-unlocked Dual-Deck <audio> pool + sample-accurate DelayNode phase lock (< 2.5 MB RAM,
    // ZERO full-stem decodeAudioData -> eliminates 138–276 MB iOS Safari Jetsam tab crashes!).
    const preferOpusStream = this.supportsOpusAudio() && Boolean(track.opusUrl);
    const streamCandidateUrls: Array<{ url: string; codec: 'opus' | 'aac' }> = [];
    if (preferOpusStream && track.opusUrl) {
      streamCandidateUrls.push({ url: track.opusUrl, codec: 'opus' });
    }
    if (track.aacUrl) {
      streamCandidateUrls.push({ url: track.aacUrl, codec: 'aac' });
    }
    if (!preferOpusStream && track.opusUrl) {
      streamCandidateUrls.push({ url: track.opusUrl, codec: 'opus' });
    }

    for (const cand of streamCandidateUrls) {
      const progressiveOk = await this.playProgressiveMediaStem({
        url: cand.url,
        codec: cand.codec,
        track,
        targetGain,
        token,
        fadeSec,
        amActive,
        neuralHz,
        totalRate: gridRate.totalRate,
        tune432Ratio,
        targetGridBpm: gridRate.targetGridBpm,
        isSubHarmonicLocked: gridRate.isSubHarmonicLocked,
        stemBpm,
        trackDurSec,
        crossfadeLeadSec: CROSSFADE_LEAD_SEC,
        onCrossfade,
      });
      if (progressiveOk) return true;
      if (cand.codec === 'opus') this.opusSupported = false;
      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        return false;
      }
    }

    return false;
  }

  private async playProgressiveMediaStem(opts: {
    url: string;
    codec: 'opus' | 'aac';
    track: StudioTrackRef;
    targetGain: number;
    token: number;
    fadeSec: number;
    amActive: boolean;
    neuralHz: number;
    totalRate: number;
    tune432Ratio: number;
    targetGridBpm: number;
    isSubHarmonicLocked: boolean;
    stemBpm: number;
    trackDurSec: number | null;
    crossfadeLeadSec: number;
    onCrossfade: () => void;
  }): Promise<boolean> {
    if (!this.ctx || !this.studioBus || opts.token !== this.studioLoadToken || typeof Audio === 'undefined') {
      return false;
    }

    const claimed = this.acquireMediaDeckSlot();
    const pooledSlot = claimed?.slot ?? null;
    const claimedGen = claimed?.gen ?? 0;

    const el = pooledSlot ? pooledSlot.el : new Audio();
    if (!pooledSlot) {
      el.crossOrigin = 'anonymous';
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      el.setAttribute('playsinline', 'true');
    }

    try {
      el.preload = 'auto';
      el.loop = false;
      const pitchEl = el as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      // Pure varispeed (no browser WSOLA warble) for exact 432/440 Hz or 1.0x sub-harmonic grid playback
      if ('preservesPitch' in pitchEl) pitchEl.preservesPitch = false;
      if ('mozPreservesPitch' in pitchEl) pitchEl.mozPreservesPitch = false;
      if ('webkitPreservesPitch' in pitchEl) pitchEl.webkitPreservesPitch = false;
      el.playbackRate = opts.totalRate;
      el.src = opts.url;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: unknown) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          el.removeEventListener('canplay', onReady);
          el.removeEventListener('loadeddata', onReady);
          el.removeEventListener('error', onErr);
          if (err) reject(err);
          else resolve();
        };
        const onReady = () => done();
        const onErr = () => done(new Error('progressive_stem_load_failed'));
        const timer = window.setTimeout(() => done(new Error('progressive_stem_timeout')), 8000);
        el.addEventListener('canplay', onReady);
        el.addEventListener('loadeddata', onReady);
        el.addEventListener('error', onErr);
        el.load();
      });

      if (opts.token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        this.releaseFailedMediaSlot(pooledSlot, claimedGen, el);
        return false;
      }

      const ctx = this.ctx;
      const now = ctx.currentTime;
      const delaySec =
        opts.amActive && typeof opts.track.downbeatOffsetMs === 'number' && opts.track.downbeatOffsetMs >= 0
          ? computeDownbeatPhaseDelaySec({
              amOriginSec: this.amLfoOriginSec,
              scheduleStartSec: now,
              downbeatOffsetMs: opts.track.downbeatOffsetMs / Math.max(0.75, opts.totalRate),
              neuralHz: opts.neuralHz,
              crestCycleFraction: this.amCrestFrac,
            })
          : 0;

      const srcNode = pooledSlot ? pooledSlot.srcNode : ctx.createMediaElementSource(el);
      try {
        srcNode.disconnect();
      } catch {
        // ignore
      }

      const safeDelay = Math.min(0.45, Math.max(0, delaySec));
      const phaseDelay = safeDelay > 0.0005 ? ctx.createDelay(0.5) : null;
      if (phaseDelay) {
        phaseDelay.delayTime.setValueAtTime(safeDelay, now);
      }

      const deckGain = ctx.createGain();
      deckGain.gain.setValueAtTime(0.0001, now);
      if (phaseDelay) {
        srcNode.connect(phaseDelay);
        phaseDelay.connect(deckGain);
      } else {
        srcNode.connect(deckGain);
      }
      deckGain.connect(this.studioBus);

      await el.play();

      if (opts.token !== this.studioLoadToken || !this.ctx || !this.studioBus || !this.isPlaying) {
        try {
          phaseDelay?.disconnect();
          deckGain.disconnect();
        } catch {
          // ignore
        }
        this.releaseFailedMediaSlot(pooledSlot, claimedGen, el);
        return false;
      }

      this.clearStudioDeck(opts.fadeSec);
      this.composer.setStandby(true);
      if (this.proceduralMaster && this.cleanSubBus) {
        this.proceduralMaster.gain.setTargetAtTime(0, now, 0.55);
        this.cleanSubBus.gain.setTargetAtTime(0, now, 0.55);
      }

      deckGain.gain.exponentialRampToValueAtTime(Math.max(0.1, opts.targetGain), now + opts.fadeSec);

      let crossfadeTriggered = false;
      let cleanupListeners: (() => void) | null = null;
      const triggerOnce = () => {
        if (crossfadeTriggered) return;
        crossfadeTriggered = true;
        if (this.studioCrossfadeTimer !== null) {
          window.clearTimeout(this.studioCrossfadeTimer);
          this.studioCrossfadeTimer = null;
        }
        this.activeStreamCrossfadeCheck = null;
        cleanupListeners?.();
        opts.onCrossfade();
      };
      const checkPosition = () => {
        if (
          !crossfadeTriggered &&
          Number.isFinite(el.duration) &&
          el.duration > 12 &&
          el.currentTime >= el.duration - opts.crossfadeLeadSec * Math.max(0.75, el.playbackRate)
        ) {
          triggerOnce();
        }
      };
      const onEnded = () => triggerOnce();
      el.addEventListener('timeupdate', checkPosition);
      el.addEventListener('ended', onEnded);
      cleanupListeners = () => {
        el.removeEventListener('timeupdate', checkPosition);
        el.removeEventListener('ended', onEnded);
      };

      this.activeStudioSource = null;
      this.activeStemPlayerNode = null;
      this.activeWsolaNode = null;
      this.activeWsolaMode = 'none';
      this.activeStreamEl = el;
      this.activeStreamSource = srcNode;
      this.activeMediaSlot = pooledSlot;
      this.activeMediaSlotGen = claimedGen;
      this.activeMediaDelayNode = phaseDelay;
      this.activeStreamCleanup = cleanupListeners;
      this.activeStreamCrossfadeCheck = checkPosition;
      this.activeStudioGain = deckGain;
      this.usingStudioAudio = true;
      this.usingCustomTrack = false;
      this.activeTrackName = opts.track.name;
      this.activeTrackKey = opts.track.key;
      this.activeTrackKeyLabel = opts.track.keyLabel ?? null;
      this.activeTrackNativeBpm = opts.stemBpm;
      this.activeStudioAppliedBpm =
        opts.targetGridBpm > 0 ? Math.round(opts.targetGridBpm * opts.tune432Ratio) : 0;
      const codecTag = opts.codec === 'opus' ? '48 kHz Opus' : '48 kHz AAC';
      this.activeStemCodecLabel = opts.isSubHarmonicLocked
        ? `${codecTag} · Range Stream Phase-Locked`
        : `${codecTag} · Range Stream`;
      this.activeStemSubHarmonicLocked = opts.isSubHarmonicLocked;

      const durEst =
        (Number.isFinite(el.duration) && el.duration > 20 ? el.duration : null) ?? opts.trackDurSec;
      const scheduledDelaySec = durEst
        ? Math.max(1.5, safeDelay + durEst / Math.max(0.75, opts.totalRate) - opts.crossfadeLeadSec)
        : 150;
      this.scheduleDeckCrossfade(scheduledDelaySec, triggerOnce);
      return true;
    } catch {
      this.releaseFailedMediaSlot(pooledSlot, claimedGen, el);
      return false;
    }
  }

  private async activateStudioForGenre(genre: ResolvedGenre, fadeSec = 1.8): Promise<void> {
    const token = ++this.studioLoadToken;
    this.usingCustomTrack = false;
    this.activeCustomTrack = null;
    // Prefer all tracks in the genre (sub-harmonic aligned + energy-matched + closest BPM first)
    const allGenreTracks = this.studioCatalog[genre] ?? [];
    const energyMatched = [...this.selectTracksForGenreAndEnergy(genre)];
    const remainingTracks = allGenreTracks.filter((t) => !energyMatched.some((e) => e.key === t.key));

    const targetBpm = this.getTargetStudyBpm();
    const activeNeuralHz = this.getActiveTargetNeuralHz();
    const sortGenreStems = (list: StudioTrackRef[]) => {
      list.sort((a, b) => {
        const aAligned =
          activeNeuralHz > 0 && Array.isArray(a.alignedBandsHz)
            ? a.alignedBandsHz.some((hz) => Math.abs(hz - activeNeuralHz) < 0.25)
            : false;
        const bAligned =
          activeNeuralHz > 0 && Array.isArray(b.alignedBandsHz)
            ? b.alignedBandsHz.some((hz) => Math.abs(hz - activeNeuralHz) < 0.25)
            : false;
        if (aAligned !== bAligned) return aAligned ? -1 : 1;

        const aFit = typeof a.darwinianFitScore === 'number' ? a.darwinianFitScore : 0.5;
        const bFit = typeof b.darwinianFitScore === 'number' ? b.darwinianFitScore : 0.5;
        if (Math.abs(bFit - aFit) >= 0.06) {
          return bFit - aFit;
        }

        if (targetBpm > 0) {
          const score = (track: StudioTrackRef): number => {
            const nb = track.subHarmonicBpm || this.inferTrackNativeBpm(track, genre);
            if (nb <= 0) return 999;
            return Math.min(
              Math.abs(nb - targetBpm),
              Math.abs(nb * 0.5 - targetBpm),
              Math.abs(nb * 2 - targetBpm)
            );
          };
          return score(a) - score(b);
        }
        return 0;
      });
    };
    sortGenreStems(energyMatched);
    sortGenreStems(remainingTracks);

    const tracks = energyMatched.length >= 2 ? energyMatched : [...energyMatched, ...remainingTracks];

    if (tracks.length === 0 || !this.ctx || !this.studioBus) {
      this.clearStudioDeck(1.2);
      this.usingStudioAudio = false;
      this.activeTrackName = null;
      this.activeTrackKey = null;
      this.activeTrackKeyLabel = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      this.activeStemCodecLabel = null;
      this.activeStemSubHarmonicLocked = false;
      if (this.ctx && this.proceduralMaster && this.cleanSubBus) {
        const now = this.ctx.currentTime;
        this.composer.setStandby(false);
        this.proceduralMaster.gain.setTargetAtTime(0.94, now, 0.7);
        this.cleanSubBus.gain.setTargetAtTime(0.9, now, 0.7);
      }
      this.syncRainBed();
      return;
    }

    const chosenIdx = this.studioTrackIdx % tracks.length;
    const track = tracks[chosenIdx];
    const nativeBpm = track.subHarmonicBpm || this.inferTrackNativeBpm(track, genre);
    const trackKeyLabel = track.keyLabel ?? null;
    // Calibrated EBU R128 (-14 LUFS) gain trim so all genres & engines stay volume-matched!
    const studioTargetGain = this.computeTrackLufsGain(track, genre);

    const alignHarmonicRootToTrack = () => {
      if (!this.ctx || !this.studySpec) return;
      const now = this.ctx.currentTime;
      // STRICT LAYER-1 SCIENCE INVARIANCE: Never retune Layer 1 scientific carriers (binaural,
      // monaural, gamma, or AM harmonic carriers) when switching Layer 2 music genres/tracks!
      // Keep the spectral pocket notch on the music bus aimed at Layer 1's fixed carrier frequency.
      const pocketHz = this.stimulusRack.getPrimaryCarrierHz() ?? this.amCarrierRootHz;
      if (pocketHz && this.spectralPocketNotch) {
        smoothSetParam(this.spectralPocketNotch.frequency, pocketHz, now, 0.35);
      }
    };

    const advanceToNextTrack = () => {
      if (!this.isPlaying || token !== this.studioLoadToken || this.carrierMode !== 'studio_library') return;
      this.studioTrackIdx = tracks.length > 1 ? (chosenIdx + 1) % tracks.length : 0;
      void this.activateStudioForGenre(genre, 4.0);
    };

    // 1. v7.0 Zero-WSOLA Sub-Harmonic Worklet Path: Decodes 48 kHz Opus/AAC directly into AudioWorklet
    //    with sample-accurate AM crest phase lock (never degrades remastered stems via WSOLA MP3 slicing).
    if (
      this.workletsReady &&
      track.v7Remastered &&
      (track.opusUrl || track.aacUrl)
    ) {
      const workletOk = await this.playDirectWorkletStem(
        track,
        studioTargetGain,
        token,
        fadeSec,
        advanceToNextTrack,
        nativeBpm
      );
      if (workletOk) {
        alignHarmonicRootToTrack();
        this.syncRainBed();
        return;
      }
      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) return;
    }

    // 2. HTTP 206 Range streaming fallback (e.g. continuous bpmRamp or un-remastered legacy stem)
    this.activeStemCodecLabel = this.workletsReady ? 'WSOLA Stream' : 'HTTP Range Stream';
    this.activeStemSubHarmonicLocked = false;
    const streamed = await this.playStreamingTrack(
      track.url,
      track.name,
      token,
      studioTargetGain,
      false,
      advanceToNextTrack,
      fadeSec,
      nativeBpm,
      trackKeyLabel,
      track.key
    );
    if (streamed) {
      alignHarmonicRootToTrack();
      this.syncRainBed();
      return;
    }
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) return;

    // 3. Fallback to decoded AudioBuffer
    const buffer = await this.loadAudioBuffer(track.url);
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !buffer) {
      return;
    }

    alignHarmonicRootToTrack();
    this.playStudioBuffer(
      buffer,
      track.name,
      token,
      studioTargetGain,
      advanceToNextTrack,
      nativeBpm,
      trackKeyLabel,
      track.key
    );
    this.syncRainBed();
  }

  private scheduleDeckCrossfade(delaySec: number, onCrossfade: () => void): void {
    if (this.studioCrossfadeTimer !== null) {
      window.clearTimeout(this.studioCrossfadeTimer);
      this.studioCrossfadeTimer = null;
    }
    this.studioDeckStartedAtCtx = this.ctx?.currentTime ?? 0;
    this.studioDeckCrossfadeDelaySec = Math.max(1.5, delaySec);
    this.studioDeckPausedRemainingSec = null;
    this.studioDeckOnCrossfade = onCrossfade;
    this.studioCrossfadeTimer = window.setTimeout(() => {
      this.studioCrossfadeTimer = null;
      onCrossfade();
    }, this.studioDeckCrossfadeDelaySec * 1000);
  }

  private playStudioBuffer(
    buffer: AudioBuffer,
    trackName: string,
    token: number,
    targetGain: number,
    onCrossfade: () => void,
    nativeBpm = 0,
    keyLabel: string | null = null,
    trackKey: string | null = null
  ): void {
    if (!this.ctx || !this.studioBus || token !== this.studioLoadToken) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fadeInSec = 2.4;

    this.clearStudioDeck(fadeInSec);
    this.composer.setStandby(true);
    if (this.proceduralMaster && this.cleanSubBus) {
      this.proceduralMaster.gain.setTargetAtTime(0, now, 0.8);
      this.cleanSubBus.gain.setTargetAtTime(0, now, 0.8);
    }

    const alignment = this.computeStudioTempoAlignment(
      nativeBpm,
      this.getTargetStudyBpm(),
      this.usingCustomTrack
    );
    const wantsWsola =
      this.workletsReady &&
      (Math.abs(alignment.tempoRate - 1.0) >= 0.0005 ||
        Math.abs(alignment.pitchRatio - 1.0) >= 0.0005 ||
        Boolean(this.studySpec?.music.bpmRamp));

    const deckGain = ctx.createGain();
    deckGain.gain.setValueAtTime(0.0001, now);
    deckGain.gain.exponentialRampToValueAtTime(Math.max(0.1, targetGain), now + fadeInSec);
    deckGain.connect(this.studioBus);

    const crossfadeLeadSec = Math.min(7, Math.max(2.5, buffer.duration * 0.16));

    if (wantsWsola) {
      const wsolaNode = new AudioWorkletNode(ctx, 'nootropic-wsola-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          mode: 'buffer',
          sourceScale: buffer.sampleRate / ctx.sampleRate,
        },
      });
      wsolaNode.parameters.get('pitchRatio')?.setValueAtTime(alignment.pitchRatio, now);
      wsolaNode.parameters.get('tempoRatio')?.setValueAtTime(alignment.tempoRate, now);
      wsolaNode.parameters.get('bypass')?.setValueAtTime(0, now);
      wsolaNode.connect(deckGain);

      const leftAll = buffer.getChannelData(0);
      const rightAll = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftAll;
      const totalFrames = buffer.length;
      const CHUNK_FRAMES = 16384;
      let feedCursor = 0;
      let endPosted = false;
      let crossfadeTriggered = false;

      const triggerCrossfadeOnce = () => {
        if (crossfadeTriggered) return;
        crossfadeTriggered = true;
        if (this.studioCrossfadeTimer !== null) {
          window.clearTimeout(this.studioCrossfadeTimer);
          this.studioCrossfadeTimer = null;
        }
        onCrossfade();
      };

      const pumpChunks = (count: number) => {
        for (let c = 0; c < count; c++) {
          if (feedCursor >= totalFrames) {
            if (!endPosted) {
              endPosted = true;
              wsolaNode.port.postMessage({ type: 'end' });
            }
            break;
          }
          const nextEnd = Math.min(totalFrames, feedCursor + CHUNK_FRAMES);
          const leftSlice = leftAll.slice(feedCursor, nextEnd);
          const rightSlice = rightAll.slice(feedCursor, nextEnd);
          wsolaNode.port.postMessage(
            { type: 'chunk', left: leftSlice, right: rightSlice },
            [leftSlice.buffer, rightSlice.buffer]
          );
          feedCursor = nextEnd;
        }
        if (feedCursor >= totalFrames && !endPosted) {
          endPosted = true;
          wsolaNode.port.postMessage({ type: 'end' });
        }
      };

      wsolaNode.port.onmessage = (evt) => {
        if (token !== this.studioLoadToken || !evt.data) return;
        if (evt.data.type === 'need_chunk') {
          pumpChunks(1);
        } else if (evt.data.type === 'progress') {
          const sourceFrame = Number(evt.data.sourceFrame) || 0;
          const remainingFrames = Math.max(0, totalFrames - sourceFrame);
          const curTempo = Math.max(
            0.72,
            wsolaNode.parameters.get('tempoRatio')?.value ?? alignment.tempoRate
          );
          const remainingSec = remainingFrames / (buffer.sampleRate * curTempo);
          if (remainingSec <= crossfadeLeadSec) {
            triggerCrossfadeOnce();
          }
        } else if (evt.data.type === 'eof') {
          triggerCrossfadeOnce();
        }
      };

      pumpChunks(2);

      this.activeStudioSource = null;
      this.activeWsolaNode = wsolaNode;
      this.activeWsolaMode = 'buffer';
      this.activeStudioGain = deckGain;
      this.usingStudioAudio = true;
      this.activeTrackName = trackName;
      this.activeTrackKey = this.usingCustomTrack ? null : trackKey;
      this.activeTrackKeyLabel = keyLabel;
      this.activeTrackNativeBpm = nativeBpm;
      this.activeStudioAppliedBpm = alignment.effectiveBpm;

      const delaySec = Math.max(
        1.5,
        buffer.duration / Math.max(0.72, alignment.tempoRate) - crossfadeLeadSec
      );
      this.scheduleDeckCrossfade(delaySec, triggerCrossfadeOnce);
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const is432Fallback = this.studySpec?.music.tuningA4Hz === 432;
    const fallbackRate = is432Fallback ? 432 / 440 : 1.0;
    if (is432Fallback) {
      src.playbackRate.setValueAtTime(fallbackRate, now);
    }

    src.connect(deckGain);
    src.start(now);

    this.activeStudioSource = src;
    this.activeWsolaNode = null;
    this.activeWsolaMode = 'none';
    this.activeStudioGain = deckGain;
    this.usingStudioAudio = true;
    this.activeTrackName = trackName;
    this.activeTrackKey = this.usingCustomTrack ? null : trackKey;
    this.activeTrackKeyLabel = keyLabel;
    this.activeTrackNativeBpm = nativeBpm;
    this.activeStudioAppliedBpm = alignment.effectiveBpm;

    const delaySec = Math.max(1.5, buffer.duration / fallbackRate - crossfadeLeadSec);
    this.scheduleDeckCrossfade(delaySec, onCrossfade);
  }

  public setGenre(style: ResolvedGenre): void {
    this.genre = style;
    const nextPalette = resolvedGenreToPalette(style);
    if (this.studySpec) {
      this.studySpec.music.instrumentPalette = nextPalette;
    }
    this.composer.setGenre(style, nextPalette);

    if (this.carrierMode === 'lyria_realtime' && this.studySpec) {
      this.lyriaClient.setGenre(style, this.studySpec, this.intensityMultiplier, this.getTargetStudyBpm());
    } else if (this.carrierMode === 'studio_library') {
      this.studioTrackIdx = 0;
      void this.activateStudioForGenre(style);
    }
    this.syncRainBed();
  }

  public getGenre(): ResolvedGenre {
    return this.genre;
  }

  public getActiveCustomTrack(): { url: string; label: string } | null {
    return this.activeCustomTrack;
  }

  private isAntiMonotonyPulseActive(): boolean {
    if (!this.params || this.params.antiMonotonyCycleMin <= 0) return false;
    const cycleSec = this.params.antiMonotonyCycleMin * 60;
    const pos = this.elapsedSec % cycleSec;
    return pos > cycleSec - 25;
  }

  public updateElapsed(elapsedSec: number, gainTimeConst = 0.14): EngineTelemetry {
    this.elapsedSec = elapsedSec;
    const progressRatio = Math.min(1, Math.max(0, elapsedSec / this.plannedSec));
    const spec = this.studySpec;
    const isoBridge = spec?.entrainment.isoBridge;
    let phase: SessionPhase = 'plateau';
    let phaseLabel = 'Study Protocol Plateau';
    // Immediate Second-1 adaptive effect (1.0 from t=0 unless 2-Stage Iso-Bridge is stabilizing or final 10% landing)
    let phaseModFactor = 1.0;

    if (progressRatio > 0.9) {
      phase = 'landing';
      phaseLabel = 'Gentle Landing';
      phaseModFactor = 1.0 - ((progressRatio - 0.9) / 0.1) * 0.35;
    } else if (isoBridge) {
      const stabSec = Math.max(30, isoBridge.stabilizeDurationSec);
      const glideSec = Math.max(15, isoBridge.rampDurationSec);
      const manualMaxOverride = this.modDepthMultiplier >= 1.24;
      if (elapsedSec < stabSec) {
        phase = 'entry';
        phaseLabel = `Stage 1/2 · ${isoBridge.stabilizeHz} Hz Calm Stabilizer`;
        phaseModFactor = manualMaxOverride ? 1.0 : isoBridge.stabilizeEffectScale;
      } else if (elapsedSec < stabSec + glideSec) {
        const s = 0.5 * (1 - Math.cos((Math.PI * (elapsedSec - stabSec)) / glideSec));
        phase = 'entry';
        phaseLabel = `Iso-Bridge Glide · ${isoBridge.stabilizeHz} → ${spec?.entrainment.frequencyHz} Hz`;
        phaseModFactor = manualMaxOverride
          ? 1.0
          : isoBridge.stabilizeEffectScale + (1.0 - isoBridge.stabilizeEffectScale) * s;
      } else {
        phase = 'plateau';
        phaseLabel = 'Stage 2/2 · Locked Focus Plateau';
        phaseModFactor = 1.0;
      }
    } else if (elapsedSec < 20) {
      phase = 'entry';
      phaseLabel = 'Stage 1/3 · Decompression Airlock';
      phaseModFactor = 1.0;
    } else if (elapsedSec < 75) {
      phase = 'entry';
      phaseLabel = 'Stage 2/3 · Tunnel Ignition';
      phaseModFactor = 1.0;
    } else if (elapsedSec < 95) {
      phase = 'plateau';
      phaseLabel = 'Stage 3/3 · Flow-Lock Drop';
      phaseModFactor = 1.0;
    }

    const ignitionStage: 'decompression' | 'ignition' | 'flow_locked' =
      elapsedSec < 20 ? 'decompression' : elapsedSec < 75 ? 'ignition' : 'flow_locked';

    if (this.ctx && this.ignitionArcFilterNode) {
      const nyqSafe = this.ctx.sampleRate * 0.44;
      let targetIgnitionHz = nyqSafe;
      if (this.layerMonitorMode !== 'science_only' && this.params?.energyTier !== 'calm') {
        if (elapsedSec < 20) {
          targetIgnitionHz = Math.min(nyqSafe, 960);
        } else if (elapsedSec < 75) {
          const s = 0.5 * (1 - Math.cos((Math.PI * (elapsedSec - 20)) / 55));
          targetIgnitionHz = Math.min(nyqSafe, 960 + 990 * s);
        } else if (elapsedSec < 95) {
          const openMax = Math.min(nyqSafe, 14000);
          const s2 = 0.5 * (1 - Math.cos((Math.PI * (elapsedSec - 75)) / 20));
          targetIgnitionHz = Math.min(nyqSafe, 1950 + Math.max(0, openMax - 1950) * s2);
        } else {
          targetIgnitionHz = Math.min(nyqSafe, 14000);
        }
      }
      this.ignitionArcFilterNode.frequency.setTargetAtTime(
        targetIgnitionHz,
        this.ctx.currentTime,
        0.35
      );
    }

    if (this.ctx && this.airShimmerPanNode) {
      const panTarget =
        !this.params?.speakerSafeEQ && this.layerMonitorMode !== 'science_only'
          ? Number((0.22 * Math.sin(2 * Math.PI * 0.04 * elapsedSec)).toFixed(4))
          : 0;
      this.airShimmerPanNode.pan.setTargetAtTime(panTarget, this.ctx.currentTime, 0.25);
    }

    let antiMonotonyActive = this.isAntiMonotonyPulseActive();
    let autopilotLiftActive = false;
    if (
      this.personalFatigueDipMin &&
      this.plannedSec >= this.personalFatigueDipMin * 60 &&
      !this.isControlTrial
    ) {
      const liftStartSec = Math.max(180, (this.personalFatigueDipMin - 2) * 60);
      if (elapsedSec >= liftStartSec && elapsedSec <= liftStartSec + 45) {
        autopilotLiftActive = true;
        antiMonotonyActive = true;
      }
    }
    this.autopilotLiftActive = autopilotLiftActive;
    if (progressRatio > 0.9) {
      this.triggerLandingReleaseChord();
    }
    this.composer.updateProgress(progressRatio, antiMonotonyActive);

    const scienceMuted = this.layerMonitorMode === 'music_only';
    const isIsolatedScience =
      this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus';
    const activePhaseFactor = isIsolatedScience ? 1.0 : phaseModFactor;
    // Gentle 0.004 Hz (~4 min) macro-dynamic breathing prevents N1 cortical habituation without ever dropping AM audibility
    const antiHabBase =
      isIsolatedScience || this.isControlTrial
        ? 1.0
        : 0.94 + 0.06 * Math.cos(2 * Math.PI * 0.004 * elapsedSec);
    const antiHabFactor = autopilotLiftActive ? Math.min(1.04, antiHabBase * 1.04) : antiHabBase;

    // 90-Second Visceral "Acoustic Airlock & Stereo-to-Midline Tunnel Pull" on Layer-2 Headphone Crossfeed
    const tunnelLockProgress = Number(Math.min(1, Math.max(0, elapsedSec / 90)).toFixed(3));
    if (
      this.ctx &&
      this.crossfeedNode &&
      this.layerMonitorMode !== 'science_only' &&
      !this.params?.speakerSafeEQ &&
      this.params?.energyTier !== 'calm'
    ) {
      let targetXf = 0.18;
      if (elapsedSec < 12) {
        targetXf = 0.08;
      } else if (elapsedSec < 75) {
        const s = 0.5 * (1 - Math.cos((Math.PI * (elapsedSec - 12)) / 63));
        targetXf = 0.08 + 0.22 * s;
      } else {
        targetXf = 0.24;
      }
      this.crossfeedNode.parameters
        .get('crossLevel')
        ?.setTargetAtTime(targetXf, this.ctx.currentTime, 0.25);
    }
    const amActive = spec?.entrainment.type === 'amplitude_modulation' && spec.entrainment.frequencyHz > 0;
    const nominalDepth = this.computeCalibratedEffectPct(activePhaseFactor, antiHabFactor);
    const effectiveDepth = scienceMuted ? 0 : nominalDepth;

    // Iso-Principle live frequency trajectory (2-Stage Iso-Bridge OR direct 60s state ramp)
    const isAlphaSpec =
      Boolean(spec && spec.entrainment.frequencyHz >= 8 && spec.entrainment.frequencyHz <= 12);
    const targetSpecHz =
      isAlphaSpec && this.alphaIafHz !== null
        ? this.alphaIafHz
        : spec?.entrainment.frequencyHz ?? this.params?.modulationHz ?? 16;
    let liveAmHz = targetSpecHz;
    if (amActive && isoBridge) {
      const stabSec = Math.max(30, isoBridge.stabilizeDurationSec);
      const glideSec = Math.max(15, isoBridge.rampDurationSec);
      if (elapsedSec < stabSec) {
        liveAmHz = isoBridge.stabilizeHz;
      } else if (elapsedSec < stabSec + glideSec) {
        const s = 0.5 * (1 - Math.cos((Math.PI * (elapsedSec - stabSec)) / glideSec));
        liveAmHz = Number(
          (isoBridge.stabilizeHz + (targetSpecHz - isoBridge.stabilizeHz) * s).toFixed(2)
        );
      } else {
        liveAmHz = targetSpecHz;
      }
      if (this.ctx && this.studioFilter) {
        const baseCutoff = this.computeStudioCutoffHz();
        const softScale =
          elapsedSec < stabSec
            ? 0.76
            : elapsedSec < stabSec + glideSec
              ? 0.76 + 0.24 * (0.5 * (1 - Math.cos((Math.PI * (elapsedSec - stabSec)) / glideSec)))
              : 1.0;
        smoothSetParam(
          this.studioFilter.frequency,
          Math.min(this.ctx.sampleRate * 0.44, Math.max(5200, baseCutoff * softScale)),
          this.ctx.currentTime,
          0.4
        );
      }
    } else if (amActive && spec?.entrainment.startFrequencyHz !== undefined) {
      const freqRampSec = Math.min(60, Math.max(25, this.plannedSec * 0.1));
      const rampRatio = Math.min(1, Math.max(0, elapsedSec / freqRampSec));
      liveAmHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (targetSpecHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
    }

    if (this.ctx && this.amGainL && this.amDepthGainL && this.amLfoL) {
      const now = this.ctx.currentTime;
      const amGains = this.computeActiveAmGainPair(effectiveDepth);
      // Restrict ZDF peaking-EQ tilt strictly to <= 12 Hz so 16–40 Hz protocols have zero off-center FM/PM warble
      const tiltDbGain =
        amActive &&
        liveAmHz <= 12 &&
        !scienceMuted &&
        !isIsolatedScience &&
        !this.isControlTrial
          ? effectiveDepth * 4.2
          : 0;
      smoothSetParam(this.amGainL.gain, amGains.bias, now, gainTimeConst);
      smoothSetParam(this.amDepthGainL.gain, amGains.swing, now, gainTimeConst);
      smoothSetParam(this.amTiltDepthL?.gain, tiltDbGain, now, gainTimeConst);
      if (amActive) {
        smoothSetParam(this.amLfoL.frequency, Math.max(0.5, liveAmHz), now, 0.35);
      }

      if (this.amGainR && this.amDepthGainR && this.amLfoR) {
        smoothSetParam(this.amGainR.gain, amGains.bias, now, gainTimeConst);
        smoothSetParam(this.amDepthGainR.gain, amGains.swing, now, gainTimeConst);
        smoothSetParam(this.amTiltDepthR?.gain, tiltDbGain, now, gainTimeConst);
        if (amActive) {
          smoothSetParam(this.amLfoR.frequency, Math.max(0.5, liveAmHz), now, 0.35);
        }
      }

      if (this.amScienceCarrierGain) {
        const pulsePair = this.computeAmPulseModPair();
        smoothSetParam(this.amSciencePulseGain?.gain, pulsePair.bias, now, gainTimeConst);
        smoothSetParam(this.amSciencePulseDepth?.gain, pulsePair.swing, now, gainTimeConst);
        smoothSetParam(
          this.amScienceCarrierGain.gain,
          this.computeAmScienceCarrierTarget(activePhaseFactor),
          now,
          gainTimeConst
        );
      }

      if (this.band2SpectralRotNode) {
        const allowRot =
          amActive &&
          !this.isControlTrial &&
          !scienceMuted &&
          !isIsolatedScience;
        // Smooth 0.0028 Hz (~6-min cycle) spectral focus sweep between 600 Hz (warm low-mid) & 2050 Hz (presence)
        const rotHz = Math.min(
          this.ctx.sampleRate * 0.44,
          1325 + 725 * Math.sin(2 * Math.PI * 0.0028 * elapsedSec)
        );
        smoothSetParam(this.band2SpectralRotNode.frequency, rotHz, now, 0.35);
        smoothSetParam(this.band2SpectralRotNode.gain, allowRot ? 1.8 : 0, now, gainTimeConst);
      }
    }

    if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function') {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.plannedSec,
          playbackRate: 1,
          position: Math.min(this.plannedSec, elapsedSec),
        });
      } catch {
        // ignore
      }
    }

    this.activeStreamCrossfadeCheck?.();

    const targetBpm = this.getTargetStudyBpm(progressRatio);
    if (
      this.ctx &&
      this.usingStudioAudio &&
      !this.usingCustomTrack &&
      this.activeTrackNativeBpm > 0
    ) {
      const now = this.ctx.currentTime;
      if (this.activeStemPlayerNode) {
        // Constant unity rate (only 432/440 tuning) — never chase the live Iso-ramp with pitch-altering varispeed
        const tune432 = spec?.music.tuningA4Hz === 432 ? 432 / 440 : 1.0;
        const lockNow = pickPlaybackGridRate(this.activeTrackNativeBpm, this.getActiveTargetNeuralHz(), tune432);
        this.activeStemPlayerNode.parameters.get('playbackRate')?.setTargetAtTime(tune432, now, 0.25);
        this.activeStudioAppliedBpm = Math.round(this.activeTrackNativeBpm * tune432);
        this.activeStemSubHarmonicLocked =
          lockNow.isSubHarmonicLocked && Math.abs(lockNow.tempoScale - 1) < 1e-9;
      } else {
        const alignment = this.computeStudioTempoAlignment(this.activeTrackNativeBpm, targetBpm, false);
        this.activeStudioAppliedBpm = alignment.effectiveBpm;
        if (this.activeWsolaNode && this.activeWsolaMode === 'ring' && this.activeStreamEl) {
          if (Math.abs(this.activeStreamEl.playbackRate - alignment.tempoRate) >= 0.001) {
            this.activeStreamEl.playbackRate = alignment.tempoRate;
          }
          const actualRate = Math.max(0.5, this.activeStreamEl.playbackRate || alignment.tempoRate);
          const targetRingPitch = Math.max(
            0.72,
            Math.min(1.38, alignment.pitchRatio / actualRate)
          );
          this.activeWsolaNode.parameters.get('pitchRatio')?.setTargetAtTime(targetRingPitch, now, 0.25);
          this.activeWsolaNode.parameters.get('tempoRatio')?.setTargetAtTime(actualRate, now, 0.25);
          // Keep bypass=0 so constant-delay unity crossfade inside NootropicWsolaProcessor prevents 80ms clicks
          this.activeWsolaNode.parameters.get('bypass')?.setValueAtTime(0, now);
        } else if (this.activeWsolaNode && this.activeWsolaMode === 'buffer') {
          this.activeWsolaNode.parameters.get('tempoRatio')?.setTargetAtTime(alignment.tempoRate, now, 0.25);
          this.activeWsolaNode.parameters.get('pitchRatio')?.setTargetAtTime(alignment.pitchRatio, now, 0.25);
        } else if (this.activeStreamEl && spec?.music.tuningA4Hz !== 432) {
          if (Math.abs(this.activeStreamEl.playbackRate - alignment.tempoRate) >= 0.004) {
            this.activeStreamEl.playbackRate = alignment.tempoRate;
          }
        }
      }
    }
    if (this.carrierMode === 'lyria_realtime' && spec && targetBpm > 0) {
      this.lyriaClient.updateBpm(spec, targetBpm, this.intensityMultiplier);
    }

    const currentBpm =
      this.layerMonitorMode === 'science_only' || this.carrierMode === 'pure_stimulus'
        ? 0
        : this.carrierMode === 'lyria_realtime'
          ? (spec?.music.percussion === 'none' && !spec?.music.bpm && !spec?.music.bpmRamp) ||
            this.genre === 'nature_rain'
            ? 0
            : Math.max(60, Math.min(160, targetBpm || 82))
          : this.carrierMode === 'studio_library' && this.usingStudioAudio
            ? this.activeStudioAppliedBpm
            : this.composer.getCurrentBpm();

    this.stimulusRack.updateProgress(progressRatio, activePhaseFactor);
    const stim = this.stimulusRack.getTelemetry(elapsedSec);
    return {
      phase,
      phaseLabel,
      progressRatio,
      currentModHz: amActive ? liveAmHz : stim.activeHz,
      currentModDepth: scienceMuted
        ? 0
        : isIsolatedScience && amActive
          ? Number(
              Math.min(0.96, Math.max(0.76, 0.88 * (0.72 + 0.28 * this.modDepthMultiplier))).toFixed(2)
            )
          : Number(nominalDepth.toFixed(2)),
      crossoverHz: spec?.entrainment.modulationBandHz[0] ?? this.params?.crossoverHz ?? 190,
      upperCrossoverHz: spec?.entrainment.modulationBandHz[1] ?? this.params?.upperCrossoverHz ?? 4500,
      stereoAmActive: Boolean(this.amGainR),
      energyTier: this.params?.energyTier ?? 'focus',
      currentBpm,
      antiMonotonyActive,
      genre: this.genre,
      backgroundAudioActive: this.backgroundAudioActive,
      usingStudioAudio: this.usingStudioAudio,
      usingCustomTrack: this.usingCustomTrack,
      activeTrackName: this.activeTrackName,
      activeTrackKey: this.activeTrackKey,
      activeTrackKeyLabel: this.activeTrackKeyLabel,
      carrierMode: this.carrierMode,
      entrainmentType: stim.entrainmentType,
      stimulusCarrierLabel: stim.carrierLabel,
      tuningA4Hz: spec?.music.tuningA4Hz ?? 440,
      tonalMode: spec?.music.tonalMode ?? 'suspended',
      noiseColor: stim.noiseColor,
      noiseSnrDb: stim.noiseSnrDb,
      hrvActive: stim.hrvActive,
      hrvBreathPhase: stim.hrvBreathPhase,
      hrvBreathProgress: stim.hrvBreathProgress,
      lyriaStatus: this.lyriaStatus,
      usingRealSamples: this.composer.isUsingRealSamples(),
      studioRetuned432: this.usingStudioAudio && spec?.music.tuningA4Hz === 432,
      layerMonitorMode: this.layerMonitorMode,
      momentaryLufs: this.momentaryLufs !== null ? Number(this.momentaryLufs.toFixed(1)) : null,
      truePeakDbtp: this.truePeakDbtp !== null ? Number(this.truePeakDbtp.toFixed(1)) : null,
      gammaMode: stim.gammaMode,
      alphaIafHz: this.alphaIafHz,
      hugginsStatus: this.hugginsStatus,
      autopilotLiftActive: this.autopilotLiftActive,
      tunnelLockProgress,
      hrvClosedLoopTrim: this.hrvClosedLoopTrim,
      dopamineArcPhase: this.composer.getStriatalArcPhase(),
      ignitionStage,
      bluetoothSafeActive: this.bluetoothSafeActive,
      band2FlattenerActive: this.isBand2FlattenerActive(),
      stemCodecLabel: this.usingStudioAudio ? this.activeStemCodecLabel : null,
      stemSubHarmonicLocked: this.usingStudioAudio && this.activeStemSubHarmonicLocked,
      audioInterrupted: this.audioInterrupted,
    };
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0.0001, this.volume * 0.84),
        this.ctx.currentTime,
        0.12
      );
    }
  }

  public adjustIntensity(multiplier: number): void {
    this.intensityMultiplier = Math.max(0.45, Math.min(1.55, multiplier));
    this.composer.setIntensityMultiplier(this.intensityMultiplier);
    this.stimulusRack.setIntensityMultiplier(this.intensityMultiplier);
    this.rainBed.setIntensityMultiplier(this.intensityMultiplier);
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this.studioFilter) {
        this.studioFilter.frequency.setTargetAtTime(
          Math.min(this.ctx.sampleRate * 0.44, this.computeStudioCutoffHz()),
          now,
          0.3
        );
      }
      if (this.studioBus) {
        const gainTrim = 0.98 * Math.max(0.82, Math.min(1.08, 0.88 + 0.12 * this.intensityMultiplier));
        this.studioBus.gain.setTargetAtTime(gainTrim, now, 0.3);
      }
      smoothSetParam(
        this.musicPreLimiterNode?.parameters.get('ceiling'),
        this.computeMusicPreLimiterCeiling(),
        now,
        0.12
      );
    }
    if (this.carrierMode === 'lyria_realtime' && this.studySpec) {
      this.lyriaClient.steer(
        this.studySpec,
        this.intensityMultiplier,
        this.genre,
        this.getTargetStudyBpm()
      );
    }
  }

  public adjustModDepth(multiplier: number): void {
    this.modDepthMultiplier = Math.max(0.0, Math.min(1.65, multiplier));
    this.stimulusRack.setModMultiplier(this.modDepthMultiplier);
    if (this.ctx) {
      smoothSetParam(
        this.musicPreLimiterNode?.parameters.get('ceiling'),
        this.computeMusicPreLimiterCeiling(),
        this.ctx.currentTime,
        0.08
      );
      if (this.musicAuditionGain && this.layerMonitorMode === 'full_mix') {
        smoothSetParam(
          this.musicAuditionGain.gain,
          this.computeFullMixMusicPocketGain(),
          this.ctx.currentTime,
          0.08
        );
      }
    }
    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec, 0.08);
    }
  }

  public async fadeOutAndPause(durationSec = 2.0): Promise<void> {
    if (!this.ctx || !this.isPlaying) return;
    if (this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        holdAndRampGain(this.masterGain.gain, 0.0001, now + durationSec, now);
      } catch {
        // ignore
      }
      await new Promise((r) => window.setTimeout(r, Math.round(durationSec * 1000)));
    }
    await this.pause();
  }

  public async pause(): Promise<void> {
    if (!this.ctx || !this.isPlaying) return;
    this.isPlaying = false;
    this.composer.pause();
    this.lyriaClient.pause();
    if (this.carrierMode === 'studio_library' && !this.usingStudioAudio) {
      this.studioLoadToken++;
    }
    if (this.studioCrossfadeTimer !== null) {
      window.clearTimeout(this.studioCrossfadeTimer);
      this.studioCrossfadeTimer = null;
      const elapsedInDeck = Math.max(0, this.ctx.currentTime - this.studioDeckStartedAtCtx);
      this.studioDeckPausedRemainingSec = Math.max(1.0, this.studioDeckCrossfadeDelaySec - elapsedInDeck);
    }
    this.activeStreamEl?.pause();
    this.audioEl?.pause();
    this.keepAliveEl?.pause();
    await this.ctx.suspend();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    notifyNativeAudioState('paused', this.activeSessionTitle, 'Paused · Tap to resume');
    void this.releaseWakeLock();
  }

  public async resume(): Promise<void> {
    if (!this.ctx || this.isPlaying) return;
    await this.ctx.resume();
    if (this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        const p = this.masterGain.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
        if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
        else p.cancelScheduledValues(now);
        p.setTargetAtTime(Math.max(0.0001, this.volume * 0.84), now, 0.25);
      } catch {
        // ignore
      }
    }
    await this.activeStreamEl?.play().catch(() => {});
    await this.audioEl?.play().catch(() => {});
    await this.keepAliveEl?.play().catch(() => {});
    this.isPlaying = true;
    this.composer.resume();
    if (this.carrierMode === 'lyria_realtime') {
      this.lyriaClient.resume();
    }
    if (this.carrierMode === 'studio_library' && !this.usingStudioAudio && !this.activeCustomTrack) {
      void this.activateStudioForGenre(this.genre);
    }
    if (this.studioDeckPausedRemainingSec !== null && this.studioDeckOnCrossfade) {
      const remaining = this.studioDeckPausedRemainingSec;
      const cb = this.studioDeckOnCrossfade;
      this.scheduleDeckCrossfade(remaining, cb);
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    notifyNativeAudioState(
      'playing',
      this.activeSessionTitle,
      `${this.studySpec?.entrainment.frequencyHz ?? this.params?.modulationHz ?? 0} Hz · Study-Backed Audio`
    );
    void this.requestWakeLock();
  }

  public getFrequencyData(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser || !this.isPlaying) return false;
    this.analyser.getByteFrequencyData(target);
    return true;
  }

  public getTimeDomainData(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser || !this.isPlaying) return false;
    this.analyser.getByteTimeDomainData(target);
    return true;
  }

  /**
   * High-resolution IEEE-754 float samples directly from the live master Web Audio output
   * (zero smoothing — authentic lab oscilloscope trace).
   */
  public getScopeWaveform(target: Float32Array<ArrayBuffer>): boolean {
    if (!this.scopeMasterAnalyser || !this.isPlaying) return false;
    this.scopeMasterAnalyser.getFloatTimeDomainData(target);
    return true;
  }

  /**
   * High-resolution IEEE-754 float samples tapped directly from the LR4 modulated cortical mid-band
   * (190–4500 Hz) for real measured AM envelope telemetry.
   */
  public getScopeModBand(target: Float32Array<ArrayBuffer>): boolean {
    if (!this.scopeModAnalyser || !this.isPlaying) return false;
    this.scopeModAnalyser.getFloatTimeDomainData(target);
    return true;
  }

  /**
   * Captures synchronized Left & Right raw IEEE-754 audio channels from master output
   * for genuine stereo X/Y Lissajous phase vectorscope visualization & correlation telemetry.
   */
  public getScopeStereoXY(
    left: Float32Array<ArrayBuffer>,
    right: Float32Array<ArrayBuffer>
  ): boolean {
    if (!this.scopeLeftAnalyser || !this.scopeRightAnalyser || !this.isPlaying) return false;
    this.scopeLeftAnalyser.getFloatTimeDomainData(left);
    this.scopeRightAnalyser.getFloatTimeDomainData(right);
    return true;
  }

  /**
   * Computes the strongest real FFT spectral peak (Hz) using parabolic bin interpolation
   * from the live Web Audio master output (< 0.5 Hz resolution at 48 kHz / 2048 FFT).
   */
  public getMeasuredPeakHz(): number | null {
    if (!this.scopeMasterAnalyser || !this.ctx || !this.isPlaying) return null;
    const bins = this.scopeMasterAnalyser.frequencyBinCount;
    if (!this.scopeFftBuf || this.scopeFftBuf.length !== bins) {
      this.scopeFftBuf = new Float32Array(new ArrayBuffer(bins * 4));
    }
    this.scopeMasterAnalyser.getFloatFrequencyData(this.scopeFftBuf);
    return computeParabolicPeakHz(
      this.scopeFftBuf,
      this.ctx.sampleRate,
      this.scopeMasterAnalyser.fftSize,
      35,
      4000,
      -72
    );
  }

  public getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public stop(): void {
    void this.releaseWakeLock();
    this.setAudioInterrupted(false);
    this.bufferCache.clear();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    notifyNativeAudioState('stopped');
    bindNativeMediaActionHandler(null);
    if (this.ctx && this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        holdAndRampGain(this.masterGain.gain, 0.0001, now + 0.5, now);
      } catch {
        // ignore
      }
      const ctxRef = this.ctx;
      const audioElRef = this.audioEl;
      const keepAliveElRef = this.keepAliveEl;
      const keepAliveUrlRef = this.keepAliveUrl;
      this.isPlaying = false;
      this.startToken++;
      this.studioLoadToken++;
      if (this.snrTimer !== null) {
        window.clearInterval(this.snrTimer);
        this.snrTimer = null;
      }
      if (this.studioCrossfadeTimer !== null) {
        window.clearTimeout(this.studioCrossfadeTimer);
        this.studioCrossfadeTimer = null;
      }
      this.activeStreamCrossfadeCheck = null;
      this.activeTrackKey = null;
      this.activeTrackKeyLabel = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      // Pause note scheduling immediately while letting audio fade smoothly over 500 ms
      this.composer.pause();
      this.voicePlayer.cancelActiveVoices(0.18);
      if (this.envFollowerNode) {
        this.envFollowerNode.port.onmessage = null;
      }
      if (this.lookaheadLimiterNode) {
        this.lookaheadLimiterNode.port.onmessage = null;
      }
      this.ctx = null;
      this.audioEl = null;
      this.keepAliveEl = null;
      this.keepAliveUrl = null;
      this.analyser = null;
      this.scopeMasterAnalyser = null;
      this.scopeModAnalyser = null;
      this.scopeLeftAnalyser = null;
      this.scopeRightAnalyser = null;
      this.scopeFftBuf = null;
      this.lookaheadLimiterNode = null;
      this.crossfeedNode = null;
      this.envFollowerNode = null;
      this.band2FlattenerNode = null;
      this.amTiltNodeL = null;
      this.amTiltNodeR = null;
      this.band2SpectralRotNode = null;
      this.mudCleanFilterNode = null;
      this.innerVoicePocketNode = null;
      this.ignitionArcFilterNode = null;
      this.airShimmerPanNode = null;
      this.envSinkGain = null;
      this.momentaryLufs = null;
      this.truePeakDbtp = null;
      this.amPureWaveL = null;
      this.amPureWaveR = null;
      this.amSalienceWaveL = null;
      this.amSalienceWaveR = null;
      this.musicEnvAnalyser = null;
      this.musicEnvBuf = null;
      this.musicEnvSmoothedRms = 0.165;
      this.musicMasterBus = null;
      this.voiceDuckFilterNode = null;
      this.circadianFilterNode = null;
      this.isVoiceSpeaking = false;
      this.clearVoiceHoldWatchdog();

      this.pendingCloseCtx = ctxRef;
      this.pendingCloseTimer = window.setTimeout(() => {
        this.pendingCloseTimer = null;
        this.pendingCloseCtx = null;
        this.composer.stop();
        this.stimulusRack.stop();
        this.lyriaClient.stop();
        this.rainBed.stop();
        this.voicePlayer.stop();
        this.clearStudioDeck(0.02);
        this.teardownMediaDeckPool();
        audioElRef?.pause();
        if (audioElRef) audioElRef.srcObject = null;
        if (keepAliveElRef) {
          keepAliveElRef.pause();
          keepAliveElRef.src = '';
        }
        if (keepAliveUrlRef) {
          URL.revokeObjectURL(keepAliveUrlRef);
        }
        ctxRef.close().catch(() => {});
      }, 580);
      return;
    }
    if (this.pendingCloseTimer !== null) {
      return;
    }
    this.stopImmediate();
  }

  private stopImmediate(): void {
    this.isPlaying = false;
    this.lastGestureResumeAtMs = 0;
    this.setAudioInterrupted(false);
    this.bufferCache.clear();
    this.startToken++;
    if (this.pendingCloseTimer !== null) {
      window.clearTimeout(this.pendingCloseTimer);
      this.pendingCloseTimer = null;
    }
    if (this.pendingCloseCtx) {
      this.pendingCloseCtx.close().catch(() => {});
      this.pendingCloseCtx = null;
    }
    if (this.snrTimer !== null) {
      window.clearInterval(this.snrTimer);
      this.snrTimer = null;
    }
    this.studioLoadToken++;
    this.usingStudioAudio = false;
    this.usingCustomTrack = false;
    this.activeCustomTrack = null;
    this.activeTrackName = null;
    this.activeTrackKey = null;
    this.activeTrackKeyLabel = null;
    this.activeTrackNativeBpm = 0;
    this.activeStudioAppliedBpm = 0;
    this.studioDeckPausedRemainingSec = null;
    this.studioDeckOnCrossfade = null;
    this.lyriaStatus = 'idle';
    this.composer.stop();
    this.stimulusRack.stop();
    this.lyriaClient.stop();
    this.rainBed.stop();
    this.voicePlayer.stop();
    this.clearVoiceHoldWatchdog();
    this.isVoiceSpeaking = false;
    this.musicMasterBus = null;
    this.voiceDuckFilterNode = null;
    this.circadianFilterNode = null;
    this.clearStudioDeck(0.1);
    this.teardownMediaDeckPool();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    void this.releaseWakeLock();
    try {
      this.amLfoL?.stop();
      this.amLfoR?.stop();
      for (const sOsc of this.amShamOscs) {
        try {
          sOsc.stop();
        } catch {
          // ignore
        }
      }
      this.amShamOscs = [];
      this.pureAmCarrierSrc?.stop();
      this.amCarrierRootOsc?.stop();
      this.amCarrierFifthOsc?.stop();
      this.amCarrierOctOsc?.stop();
      this.amCarrierNoiseSrc?.stop();
    } catch {
      // ignore
    }
    try {
      if (this.envFollowerNode) {
        this.envFollowerNode.port.onmessage = null;
        this.envFollowerNode.disconnect();
      }
      if (this.lookaheadLimiterNode) {
        this.lookaheadLimiterNode.port.onmessage = null;
        this.lookaheadLimiterNode.disconnect();
      }
      this.musicPreLimiterNode?.disconnect();
      this.envSinkGain?.disconnect();
      this.crossfeedNode?.disconnect();
      this.band2FlattenerNode?.disconnect();
      this.amTiltNodeL?.disconnect();
      this.amTiltNodeR?.disconnect();
      this.mudCleanFilterNode?.disconnect();
      this.innerVoicePocketNode?.disconnect();
      this.ignitionArcFilterNode?.disconnect();
      this.airShimmerPanNode?.disconnect();
    } catch {
      // ignore
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    if (this.keepAliveEl) {
      this.keepAliveEl.pause();
      this.keepAliveEl.src = '';
      this.keepAliveEl = null;
    }
    if (this.keepAliveUrl) {
      URL.revokeObjectURL(this.keepAliveUrl);
      this.keepAliveUrl = null;
    }
    this.amGainL = null;
    this.amGainR = null;
    this.amLfoL = null;
    this.amLfoR = null;
    this.amPeriodicGateL = null;
    this.amPeriodicGateR = null;
    this.amShamGateL = null;
    this.amShamGateR = null;
    this.amDepthGainL = null;
    this.amDepthGainR = null;
    this.amTiltDepthL = null;
    this.amTiltDepthR = null;
    this.amPureWaveL = null;
    this.amPureWaveR = null;
    this.amSalienceWaveL = null;
    this.amSalienceWaveR = null;
    this.musicPreLimiterNode = null;
    this.lookaheadLimiterNode = null;
    this.crossfeedNode = null;
    this.envFollowerNode = null;
    this.band2FlattenerNode = null;
    this.amTiltNodeL = null;
    this.amTiltNodeR = null;
    this.envSinkGain = null;
    this.momentaryLufs = null;
    this.truePeakDbtp = null;
    this.scopeFftBuf = null;
    this.activeStreamCrossfadeCheck = null;
    this.activeWsolaNode = null;
    this.activeWsolaMode = 'none';
    this.pureAmCarrierGain = null;
    this.pureAmCarrierSrc = null;
    this.amScienceCarrierGain = null;
    this.amSciencePulseGain = null;
    this.amSciencePulseDepth = null;
    this.amCarrierRootOsc = null;
    this.amCarrierFifthOsc = null;
    this.amCarrierOctOsc = null;
    this.amCarrierNoiseSrc = null;
    this.amCarrierRootHz = null;
    this.cleanSubBus = null;
    this.proceduralMaster = null;
    this.studioBus = null;
    this.studioFilter = null;
    this.musicAuditionGain = null;
    this.spectralPocketNotch = null;
    this.band2SpectralRotNode = null;
    this.mudCleanFilterNode = null;
    this.innerVoicePocketNode = null;
    this.ignitionArcFilterNode = null;
    this.airShimmerPanNode = null;
    this.musicEnvAnalyser = null;
    this.musicEnvBuf = null;
    this.musicEnvSmoothedRms = 0.165;
    this.layerMonitorMode = 'full_mix';
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    this.scopeMasterAnalyser = null;
    this.scopeModAnalyser = null;
    this.scopeLeftAnalyser = null;
    this.scopeRightAnalyser = null;
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) {
        this.wakeLock = await nav.wakeLock.request('screen');
      }
    } catch {
      // ignore
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      // ignore
    }
    this.wakeLock = null;
  }

  private activeSessionTitle = 'nootropic.fm';

  private setupMediaSession(title: string): void {
    this.activeSessionTitle = title || 'nootropic.fm';
    bindNativeMediaActionHandler((action) => {
      if (action === 'play') void this.resume();
      else if (action === 'pause') void this.pause();
      else if (action === 'stop') this.stop();
    });
    notifyNativeAudioState(
      'playing',
      this.activeSessionTitle,
      `${this.studySpec?.entrainment.frequencyHz ?? this.params?.modulationHz ?? 0} Hz · Study-Backed Audio`
    );
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: 'nootropic.fm · Study-to-Sound Engine',
          album: 'Executable Psychoacoustic Protocol',
        });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('play', () => void this.resume());
        navigator.mediaSession.setActionHandler('pause', () => void this.pause());
        navigator.mediaSession.setActionHandler('stop', () => this.stop());
      } catch {
        // ignore
      }
    }
  }
}
