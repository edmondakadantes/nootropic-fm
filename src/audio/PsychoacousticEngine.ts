import {
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
import { GenerativeComposer } from './GenerativeComposer';
import { LyriaRealtimeClient, type LyriaRealtimeStatus } from './LyriaRealtimeClient';
import { createCalibratedNoiseBuffer, MedicalStimulusRack } from './MedicalStimulusRack';
import { StereoRainBed } from './StereoRainBed';

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
  f1.Q.value = Math.SQRT1_2;
  f2.Q.value = Math.SQRT1_2;
  f1.connect(f2);
  return { input: f1, output: f2 };
}

function createPhaseShiftedSineWave(ctx: AudioContext, phaseDeg: number): PeriodicWave {
  const rad = (phaseDeg * Math.PI) / 180;
  const real = new Float32Array([0, Math.sin(rad)]);
  const imag = new Float32Array([0, Math.cos(rad)]);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/**
 * 3-harmonic cortical salience pulse normalized to [-1, +1]:
 * sharper attack crest resists musical modulation masking (Woods et al. 2024)
 * while staying smooth and fatigue-free on the 190-4500 Hz mid-band.
 */
function createNeuralSalienceWave(ctx: AudioContext, phaseDeg: number): PeriodicWave {
  const rad = (phaseDeg * Math.PI) / 180;
  const amps = [1.0, 0.34, 0.1];
  const phaseShifts = [rad, 2 * rad - Math.PI / 4, 3 * rad - Math.PI / 2];
  let peak = 0;
  for (let i = 0; i < 512; i++) {
    const t = (2 * Math.PI * i) / 512;
    const v =
      amps[0] * Math.sin(t + phaseShifts[0]) +
      amps[1] * Math.sin(2 * t + phaseShifts[1]) +
      amps[2] * Math.sin(3 * t + phaseShifts[2]);
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const norm = peak > 0 ? 1 / peak : 1;
  const real = new Float32Array(4);
  const imag = new Float32Array(4);
  for (let k = 1; k <= 3; k++) {
    const a = amps[k - 1] * norm;
    const p = phaseShifts[k - 1];
    real[k] = a * Math.sin(p);
    imag[k] = a * Math.cos(p);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
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

function createSilentKeepAliveWavUrl(): string {
  const sampleRate = 8000;
  const numSamples = 8000; // 1.0s loop
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit unsigned
  writeStr(36, 'data');
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) {
    view.setUint8(44 + i, i % 2 === 0 ? 128 : 129); // -90 dBFS dither keeps iOS WebKit active
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
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

  // 3-Band LR4 Cortical AM + Velvet Spectral Tilt nodes
  private amGainL: GainNode | null = null;
  private amGainR: GainNode | null = null;
  private amLfoL: OscillatorNode | null = null;
  private amLfoR: OscillatorNode | null = null;
  private amDepthGainL: GainNode | null = null;
  private amDepthGainR: GainNode | null = null;
  private amTiltDepthL: GainNode | null = null;
  private amTiltDepthR: GainNode | null = null;

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

  // Mobile background bridge & wake lock
  private audioEl: HTMLAudioElement | null = null;
  private keepAliveEl: HTMLAudioElement | null = null;
  private keepAliveUrl: string | null = null;
  private backgroundAudioActive = false;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private visibilityHandler: (() => void) | null = null;

  // Dual-Deck Gapless Studio Stem Engine (Cloudflare R2 — Instant HTTP Range Streaming + Buffer Fallback)
  private studioCatalog: Partial<Record<ResolvedGenre, StudioTrackRef[]>> = {};
  private bufferCache = new Map<string, AudioBuffer>();
  private readonly maxCachedBuffers = 3;
  private activeStudioSource: AudioBufferSourceNode | null = null;
  private activeStreamEl: HTMLAudioElement | null = null;
  private activeStreamSource: MediaElementAudioSourceNode | null = null;
  private activeStreamCleanup: (() => void) | null = null;
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
    this.carrierMode = initialCarrierMode ?? this.studySpec.music.defaultCarrierMode ?? 'generative_live';
    this.layerMonitorMode = this.carrierMode === 'pure_stimulus' ? 'science_only' : 'full_mix';

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.ctx = ctx;

    ctx.addEventListener('statechange', () => {
      if (this.isPlaying && this.ctx === ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    });
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isPlaying && this.ctx) {
        if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
        if (this.activeStreamEl && this.activeStreamEl.paused) {
          void this.activeStreamEl.play().catch(() => {});
        }
        if (this.audioEl && this.audioEl.paused) void this.audioEl.play().catch(() => {});
        void this.requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Master Peak Limiter / Studio Compressor + 3 ms Lookahead Soft-Knee Stage (-0.80 dBFS ceiling)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 16;
    compressor.ratio.value = 2.8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    const lookaheadDelay = ctx.createDelay(0.02);
    lookaheadDelay.delayTime.value = 0.003;

    const masterLimiter = ctx.createWaveShaper();
    masterLimiter.curve = createMasteringLimiterCurve();
    masterLimiter.oversample = '2x';

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

    compressor.connect(lookaheadDelay);
    lookaheadDelay.connect(masterLimiter);
    masterLimiter.connect(masterGain);
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

    // Lock-screen / Car Bluetooth audio bridge
    this.backgroundAudioActive = false;
    let bridged = false;
    if (typeof ctx.createMediaStreamDestination === 'function') {
      try {
        const streamDest = ctx.createMediaStreamDestination();
        analyser.connect(streamDest);
        const audioEl = document.createElement('audio');
        audioEl.setAttribute('playsinline', 'true');
        audioEl.srcObject = streamDest.stream;
        audioEl.volume = 1.0;
        await audioEl.play();
        this.audioEl = audioEl;
        this.backgroundAudioActive = true;
        bridged = true;
      } catch {
        bridged = false;
      }
    }
    if (!bridged) {
      analyser.connect(ctx.destination);
    }

    this.masterGain = masterGain;
    this.analyser = analyser;
    this.scopeMasterAnalyser = scopeMasterAnalyser;

    // Dedicated zero-smoothing Lab Oscilloscope tap on the clinical stimulus / LR4 AM band
    const scopeModAnalyser = ctx.createAnalyser();
    scopeModAnalyser.fftSize = 1024;
    scopeModAnalyser.smoothingTimeConstant = 0.0;
    this.scopeModAnalyser = scopeModAnalyser;

    // ─── LAYER 1A: PRECISION MEDICAL STIMULUS RACK (40 Hz GENUS, Isochronic, Binaural, Monaural, HRV, SNR Noise) ───
    const { hrvBusInput } = this.stimulusRack.start({
      ctx,
      spec: this.studySpec,
      masterDestination: compressor,
      speakerSafeEQ: params.speakerSafeEQ,
      isControlTrial: this.isControlTrial,
      pureStimulusMode: this.carrierMode === 'pure_stimulus',
      stimulusTap: scopeModAnalyser,
    });

    // ─── LAYER 1B: 3-BAND LINKWITZ-RILEY (LR4) PHASE-COHERENT CORTICAL AM MATRIX ───
    const lowerHz = this.studySpec.entrainment.modulationBandHz[0] || params.crossoverHz || 190;
    const upperHz = this.studySpec.entrainment.modulationBandHz[1] || params.upperCrossoverHz || 4500;

    const preHrvBus = ctx.createGain();
    preHrvBus.gain.value = 1.0;
    const musicMixBus = ctx.createGain();
    musicMixBus.gain.value = 1.0;

    const postHrvMusicNode: AudioNode = hrvBusInput ?? preHrvBus;
    if (hrvBusInput) {
      preHrvBus.connect(hrvBusInput);
    }

    // Headphone Studio Crossfeed Matrix on Layer 2 Music ONLY (280 us ITD, 195-1750 Hz, -16.8 dB)
    // Eliminates long-session super-stereo fatigue while keeping Layer 1 Binaural Beats 100% isolated L/R!
    if (!params.speakerSafeEQ) {
      const xfSplit = ctx.createChannelSplitter(2);
      const xfMerge = ctx.createChannelMerger(2);
      const directGainL = ctx.createGain();
      const directGainR = ctx.createGain();
      directGainL.gain.value = 0.94;
      directGainR.gain.value = 0.94;

      const buildCrossfeedArm = (targetChannel: 0 | 1) => {
        const delay = ctx.createDelay(0.005);
        delay.delayTime.value = 0.00028;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 195;
        hp.Q.value = 0.55;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1750;
        lp.Q.value = 0.55;
        const level = ctx.createGain();
        level.gain.value = 0.145;
        delay.connect(hp);
        hp.connect(lp);
        lp.connect(level);
        level.connect(xfMerge, 0, targetChannel);
        return delay;
      };

      const feedLtoR = buildCrossfeedArm(1);
      const feedRtoL = buildCrossfeedArm(0);

      postHrvMusicNode.connect(xfSplit);
      xfSplit.connect(directGainL, 0);
      xfSplit.connect(directGainR, 1);
      directGainL.connect(xfMerge, 0, 0);
      directGainR.connect(xfMerge, 0, 1);
      xfSplit.connect(feedLtoR, 0);
      xfSplit.connect(feedRtoL, 1);
      xfMerge.connect(musicMixBus);
    } else {
      postHrvMusicNode.connect(musicMixBus);
    }

    // Dynamic SNR Envelope Follower tap on Layer 2 Music (uses default Analyser size)
    const musicEnvAnalyser = ctx.createAnalyser();
    musicEnvAnalyser.smoothingTimeConstant = 0.0;
    musicMixBus.connect(musicEnvAnalyser);
    this.musicEnvAnalyser = musicEnvAnalyser;
    this.musicEnvBuf = new Float32Array(new ArrayBuffer(musicEnvAnalyser.fftSize * 4));
    this.musicEnvSmoothedRms = 0.165;

    const spectralPocketNotch = ctx.createBiquadFilter();
    spectralPocketNotch.type = 'peaking';
    const discreteCarrierHz = this.stimulusRack.getPrimaryCarrierHz();
    spectralPocketNotch.frequency.setValueAtTime(discreteCarrierHz ?? 250, ctx.currentTime);
    spectralPocketNotch.Q.value = 2.6;
    const wantPocket = Boolean(discreteCarrierHz && !this.isControlTrial);
    spectralPocketNotch.gain.setValueAtTime(wantPocket ? -4.5 : 0, ctx.currentTime);
    this.spectralPocketNotch = spectralPocketNotch;

    const musicAuditionGain = ctx.createGain();
    musicAuditionGain.gain.setValueAtTime(
      this.layerMonitorMode === 'science_only' ? 0.0001 : 1.0,
      ctx.currentTime
    );
    musicAuditionGain.connect(spectralPocketNotch);
    spectralPocketNotch.connect(preHrvBus);
    this.musicAuditionGain = musicAuditionGain;

    const startWithMusic = this.carrierMode === 'generative_live';
    const proceduralMaster = ctx.createGain();
    proceduralMaster.gain.setValueAtTime(startWithMusic ? 0.94 : 0.0001, ctx.currentTime);
    proceduralMaster.connect(musicAuditionGain);
    this.proceduralMaster = proceduralMaster;

    const studioBus = ctx.createGain();
    studioBus.gain.setValueAtTime(0.96, ctx.currentTime);
    const studioFilter = ctx.createBiquadFilter();
    studioFilter.type = 'lowpass';
    studioFilter.Q.value = 0.62;
    studioFilter.frequency.setValueAtTime(this.computeStudioCutoffHz(), ctx.currentTime);
    studioBus.connect(studioFilter);
    studioFilter.connect(musicAuditionGain);
    this.studioBus = studioBus;
    this.studioFilter = studioFilter;

    const cleanSubBus = ctx.createGain();
    cleanSubBus.gain.setValueAtTime(startWithMusic ? 0.9 : 0.0001, ctx.currentTime);
    cleanSubBus.connect(compressor);
    this.cleanSubBus = cleanSubBus;

    // Gentle pink carrier specifically for Pure Clinical Signal auditing of AM & 0.1 Hz HRV studies
    const pureAmBuf = createCalibratedNoiseBuffer(ctx, 'pink', 6);
    const pureAmSrc = ctx.createBufferSource();
    pureAmSrc.buffer = pureAmBuf;
    pureAmSrc.loop = true;
    const pureAmGain = ctx.createGain();
    const needsPureAmCarrier =
      this.carrierMode === 'pure_stimulus' && this.specNeedsPureReferenceCarrier();
    pureAmGain.gain.setValueAtTime(needsPureAmCarrier ? 0.32 : 0.0001, ctx.currentTime);
    pureAmSrc.connect(pureAmGain);
    pureAmGain.connect(preHrvBus);
    pureAmSrc.start();
    this.pureAmCarrierSrc = pureAmSrc;
    this.pureAmCarrierGain = pureAmGain;

    // BAND 1: Clean Sub-Bass (< lowerHz)
    const lowBand = createLR4Filter(ctx, 'lowpass', lowerHz);
    const lowPhaseAlign = ctx.createBiquadFilter();
    lowPhaseAlign.type = 'allpass';
    lowPhaseAlign.frequency.value = upperHz;
    lowPhaseAlign.Q.value = Math.SQRT1_2;
    musicMixBus.connect(lowBand.input);
    lowBand.output.connect(lowPhaseAlign);
    lowPhaseAlign.connect(compressor);

    // UPPER SPLIT (> lowerHz)
    const aboveLow = createLR4Filter(ctx, 'highpass', lowerHz);
    musicMixBus.connect(aboveLow.input);

    // BAND 3: Clean Air (> upperHz)
    const airBand = createLR4Filter(ctx, 'highpass', upperHz);
    aboveLow.output.connect(airBand.input);
    airBand.output.connect(compressor);

    // BAND 2: Cortical AM Entrainment Band (lowerHz – upperHz)
    const midBand = createLR4Filter(ctx, 'lowpass', upperHz);
    aboveLow.output.connect(midBand.input);

    const amActiveForSpec =
      this.studySpec.entrainment.type === 'amplitude_modulation' &&
      this.studySpec.entrainment.frequencyHz > 0;
    const amStartHz = this.studySpec.entrainment.startFrequencyHz ?? this.studySpec.entrainment.frequencyHz;
    const targetAmDepth = amActiveForSpec ? this.studySpec.entrainment.modulationDepth : 0;
    const initialDepth = this.isControlTrial
      ? 0
      : Math.min(0.74, Math.max(0, targetAmDepth * 0.76 * this.modDepthMultiplier));

    const useStereoSpread = Boolean(
      amActiveForSpec &&
        (this.studySpec.entrainment.phaseOffsetDeg ?? 0) > 0 &&
        !params.speakerSafeEQ
    );
    const isRaisedCosine = this.studySpec.entrainment.waveform === 'raised_cosine';
    const useNeuralSalience =
      amActiveForSpec && !isRaisedCosine && this.studySpec.entrainment.frequencyHz >= 12;
    const initialAmGains = this.computeAmGainPair(initialDepth);

    const amLfoL = ctx.createOscillator();
    if (isRaisedCosine) {
      amLfoL.setPeriodicWave(createPhaseShiftedSineWave(ctx, 90));
    } else if (useNeuralSalience) {
      amLfoL.setPeriodicWave(createNeuralSalienceWave(ctx, 0));
    } else {
      amLfoL.type = 'sine';
    }
    amLfoL.frequency.setValueAtTime(Math.max(0.5, amStartHz || 16), ctx.currentTime);

    const amDepthGainL = ctx.createGain();
    amDepthGainL.gain.setValueAtTime(initialAmGains.swing, ctx.currentTime);

    const amGainL = ctx.createGain();
    amGainL.gain.setValueAtTime(initialAmGains.bias, ctx.currentTime);

    // Hybrid Velvet AM Spectral Presence Tilt (1350 Hz peaking modulated in phase with AM crest)
    const amTiltL = ctx.createBiquadFilter();
    amTiltL.type = 'peaking';
    amTiltL.frequency.setValueAtTime(1350, ctx.currentTime);
    amTiltL.Q.value = 0.85;
    amTiltL.gain.setValueAtTime(0, ctx.currentTime);
    const amTiltDepthL = ctx.createGain();
    amTiltDepthL.gain.setValueAtTime(amActiveForSpec ? initialDepth * 5.6 : 0, ctx.currentTime);

    amLfoL.connect(amDepthGainL);
    amDepthGainL.connect(amGainL.gain);
    amLfoL.connect(amTiltDepthL);
    amTiltDepthL.connect(amTiltL.gain);
    amGainL.connect(amTiltL);
    amLfoL.start();

    let midOutput: AudioNode = amTiltL;
    this.amTiltDepthL = amTiltDepthL;

    if (useStereoSpread) {
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);

      const amLfoR = ctx.createOscillator();
      const spreadDeg = this.studySpec.entrainment.phaseOffsetDeg ?? 32;
      amLfoR.setPeriodicWave(
        useNeuralSalience
          ? createNeuralSalienceWave(ctx, spreadDeg)
          : createPhaseShiftedSineWave(ctx, spreadDeg + (isRaisedCosine ? 90 : 0))
      );
      amLfoR.frequency.setValueAtTime(Math.max(0.5, amStartHz || 16), ctx.currentTime);

      const amDepthGainR = ctx.createGain();
      amDepthGainR.gain.setValueAtTime(initialAmGains.swing, ctx.currentTime);

      const amGainR = ctx.createGain();
      amGainR.gain.setValueAtTime(initialAmGains.bias, ctx.currentTime);

      const amTiltR = ctx.createBiquadFilter();
      amTiltR.type = 'peaking';
      amTiltR.frequency.setValueAtTime(1350, ctx.currentTime);
      amTiltR.Q.value = 0.85;
      amTiltR.gain.setValueAtTime(0, ctx.currentTime);
      const amTiltDepthR = ctx.createGain();
      amTiltDepthR.gain.setValueAtTime(amActiveForSpec ? initialDepth * 5.6 : 0, ctx.currentTime);

      amLfoR.connect(amDepthGainR);
      amDepthGainR.connect(amGainR.gain);
      amLfoR.connect(amTiltDepthR);
      amTiltDepthR.connect(amTiltR.gain);
      amGainR.connect(amTiltR);
      amLfoR.start();

      midBand.output.connect(splitter);
      splitter.connect(amGainL, 0);
      splitter.connect(amGainR, 1);
      amTiltL.connect(merger, 0, 0);
      amTiltR.connect(merger, 0, 1);

      this.amGainR = amGainR;
      this.amLfoR = amLfoR;
      this.amDepthGainR = amDepthGainR;
      this.amTiltDepthR = amTiltDepthR;
      midOutput = merger;
    } else {
      midBand.output.connect(amGainL);
      this.amGainR = null;
      this.amLfoR = null;
      this.amDepthGainR = null;
      this.amTiltDepthR = null;
    }

    const eType = this.studySpec.entrainment.type;
    if (eType === 'amplitude_modulation' || eType === 'hrv_breathing_swell' || eType === 'none') {
      midOutput.connect(scopeModAnalyser);
    }

    if (params.speakerSafeEQ) {
      const safetyNotch = ctx.createBiquadFilter();
      safetyNotch.type = 'peaking';
      safetyNotch.frequency.value = 1850;
      safetyNotch.Q.value = 0.72;
      safetyNotch.gain.value = -5.5;
      midOutput.connect(safetyNotch);
      safetyNotch.connect(compressor);
    } else {
      midOutput.connect(compressor);
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
    reverbHP.frequency.value = 210;
    const reverbLP = ctx.createBiquadFilter();
    reverbLP.type = 'lowpass';
    reverbLP.frequency.value = params.speakerSafeEQ ? 1450 : 2800;

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
    delayFilter.frequency.value = 1350;
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
      proceduralMaster,
      cleanSubBus,
      reverbSend,
      delaySend,
      speakerSafeEQ: params.speakerSafeEQ,
      sampleApiBase,
    });

    // ─── DEDICATED PHYSICAL STEREO RAINFALL LAYER (active whenever Soft Rain & Nature is chosen) ───
    this.rainBed.attach(ctx, compressor, params.speakerSafeEQ);
    this.syncRainBed();

    this.isPlaying = true;
    this.setupMediaSession(title);
    void this.requestWakeLock();

    // iOS Safari / mobile WebKit background keep-alive anchor + auto-resume guard
    try {
      this.keepAliveUrl = createSilentKeepAliveWavUrl();
      const keepAlive = document.createElement('audio');
      keepAlive.setAttribute('playsinline', 'true');
      keepAlive.loop = true;
      keepAlive.volume = 0.02;
      keepAlive.src = this.keepAliveUrl;
      void keepAlive.play().catch(() => {});
      this.keepAliveEl = keepAlive;
    } catch {
      this.keepAliveEl = null;
      this.keepAliveUrl = null;
    }

    ctx.onstatechange = () => {
      if (this.isPlaying && this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
    };

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = () => {
      if (!this.isPlaying || !this.ctx) return;
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      if (this.keepAliveEl && this.keepAliveEl.paused) {
        void this.keepAliveEl.play().catch(() => {});
      }
      if (document.visibilityState === 'visible') {
        void this.requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    if (this.snrTimer !== null) {
      window.clearInterval(this.snrTimer);
    }
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

    if (this.carrierMode === 'studio_library' && !skipInitialStudioDeck) {
      void this.activateStudioForGenre(this.genre);
    }
  }

  private specNeedsPureReferenceCarrier(): boolean {
    return Boolean(
      this.studySpec &&
        (this.studySpec.entrainment.type === 'amplitude_modulation' ||
          this.studySpec.entrainment.type === 'hrv_breathing_swell' ||
          (this.studySpec.entrainment.hrvBreathHz ?? 0) > 0)
    );
  }

  private computeStudioCutoffHz(): number {
    const specCutoff = this.studySpec?.music.spectralLowPassHz ?? this.params?.filterCutoffHz ?? 2200;
    const target = this.studySpec?.protocol.targetState ?? 'alert_focus';
    const isIsoAdapted = this.params?.genreSelectionMode === 'iso_adapted';
    let base = 15000;
    if (target === 'sleep_winddown' || isIsoAdapted) {
      base = Math.max(1150, Math.min(2200, specCutoff * 1.65));
    } else if (target === 'calm_reset' || (this.params?.filterCutoffHz ?? 2200) <= 1750) {
      base = Math.max(2600, Math.min(5200, (this.params?.filterCutoffHz ?? 1600) * 2.4));
    }
    const scaled = base * (0.74 + 0.32 * this.intensityMultiplier);
    return Math.round(Math.max(950, Math.min(18000, scaled)));
  }

  private computeAmGainPair(depth: number): { bias: number; swing: number } {
    if (depth <= 0.001) return { bias: 1.0, swing: 0 };
    // Smooth velvet knee above 0.36 while synchronous spectral presence tilt carries upper cortical salience
    const vcaDepth = depth <= 0.36 ? depth : 0.36 + (depth - 0.36) * 0.68;
    const rms = Math.sqrt((1 - vcaDepth / 2) ** 2 + (vcaDepth ** 2) / 8);
    const makeup = Math.min(1.14, 1 / Math.max(0.74, rms));
    return {
      bias: Number(((1 - vcaDepth / 2) * makeup).toFixed(4)),
      swing: Number(((vcaDepth / 2) * makeup).toFixed(4)),
    };
  }

  private computeTrackLufsGain(track: StudioTrackRef | null, genre: ResolvedGenre): number {
    const base = genre === 'nature_rain' ? 0.54 : 0.94;
    if (track && typeof track.lufs === 'number' && Number.isFinite(track.lufs)) {
      const trimDb = Math.max(-6.0, Math.min(4.0, -14.0 - track.lufs));
      return Number(Math.max(0.28, Math.min(1.35, base * Math.pow(10, trimDb / 20))).toFixed(3));
    }
    return base;
  }

  private syncRainBed(): void {
    const shouldPlayRain =
      this.genre === 'nature_rain' &&
      this.carrierMode !== 'pure_stimulus' &&
      this.layerMonitorMode !== 'science_only';
    this.rainBed.setActive(shouldPlayRain);
  }

  /**
   * Real-time 3-way A/B/C Layer Monitor (~180 ms click-free crossfade, zero track reload):
   * - 'full_mix': Layer 1 Medical DSP + Layer 2 Music
   * - 'science_only': Isolated Layer 1 scientific wave & noise (music muted)
   * - 'music_only': Raw Layer 2 music only (0% scientific modulation, noise muted)
   */
  public setLayerMonitorMode(mode: LayerMonitorMode): void {
    this.layerMonitorMode = mode;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const muteMusic = mode === 'science_only' || this.carrierMode === 'pure_stimulus';
    const muteScience = mode === 'music_only';

    this.musicAuditionGain?.gain.setTargetAtTime(muteMusic ? 0.0001 : 1.0, now, 0.18);
    if (this.cleanSubBus) {
      const wantSub = this.carrierMode === 'generative_live' && !muteMusic;
      this.cleanSubBus.gain.setTargetAtTime(wantSub ? 0.9 : 0.0001, now, 0.18);
    }
    this.stimulusRack.setScienceMuted(muteScience);
    this.stimulusRack.setPureStimulusMode(muteMusic && !muteScience);

    const wantPocket = Boolean(
      this.stimulusRack.getPrimaryCarrierHz() && !this.isControlTrial && !muteScience
    );
    this.spectralPocketNotch?.gain.setTargetAtTime(wantPocket ? -4.5 : 0, now, 0.18);

    const needsPureCarrier = muteMusic && !muteScience && this.specNeedsPureReferenceCarrier();
    this.pureAmCarrierGain?.gain.setTargetAtTime(needsPureCarrier ? 0.34 : 0.0001, now, 0.18);
    this.syncRainBed();

    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec);
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
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      if (this.layerMonitorMode === 'science_only') {
        this.layerMonitorMode = 'full_mix';
      }
      const muteScience = this.layerMonitorMode === 'music_only';
      this.musicAuditionGain?.gain.setTargetAtTime(1.0, now, 0.25);
      this.stimulusRack.setScienceMuted(muteScience);
      this.stimulusRack.setPureStimulusMode(false);
      this.pureAmCarrierGain?.gain.setTargetAtTime(0.0001, now, 0.4);
      this.proceduralMaster.gain.setTargetAtTime(0.94, now, 0.65);
      this.cleanSubBus.gain.setTargetAtTime(0.9, now, 0.65);
    } else if (mode === 'pure_stimulus') {
      this.clearStudioDeck(1.2);
      this.usingStudioAudio = false;
      this.usingCustomTrack = false;
      this.activeTrackName = null;
      this.activeTrackKey = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      this.layerMonitorMode = 'science_only';
      this.musicAuditionGain?.gain.setTargetAtTime(0.0001, now, 0.25);
      this.stimulusRack.setScienceMuted(false);
      this.stimulusRack.setPureStimulusMode(true);
      this.proceduralMaster.gain.setTargetAtTime(0.0001, now, 0.45);
      this.cleanSubBus.gain.setTargetAtTime(0.0001, now, 0.45);
      const needsPureAm = this.specNeedsPureReferenceCarrier();
      this.pureAmCarrierGain?.gain.setTargetAtTime(needsPureAm ? 0.34 : 0.0001, now, 0.45);
    } else if (mode === 'studio_library') {
      if (this.layerMonitorMode === 'science_only') {
        this.layerMonitorMode = 'full_mix';
      }
      const muteScience = this.layerMonitorMode === 'music_only';
      this.musicAuditionGain?.gain.setTargetAtTime(1.0, now, 0.25);
      this.stimulusRack.setScienceMuted(muteScience);
      this.stimulusRack.setPureStimulusMode(false);
      this.pureAmCarrierGain?.gain.setTargetAtTime(0.0001, now, 0.4);
      void this.activateStudioForGenre(this.genre);
    }
    this.syncRainBed();
  }

  /**
   * Plug-and-Play Google Lyria RealTime AI Activation (when ephemeral token is minted by server).
   * Streams infinite, never-repeating 48 kHz stereo music in the active curated genre through 3-Band LR4 DSP.
   */
  public async activateLyriaRealtime(
    token: string,
    model: string,
    onStatus?: (status: LyriaRealtimeStatus, note?: string) => void,
    fetchFreshToken?: () => Promise<{ token: string; model?: string } | null>
  ): Promise<boolean> {
    if (!this.ctx || !this.studioBus || !this.studySpec || !this.isPlaying) return false;
    this.clearStudioDeck(1.2);
    if (this.layerMonitorMode === 'science_only') {
      this.layerMonitorMode = 'full_mix';
    }
    const muteScience = this.layerMonitorMode === 'music_only';
    this.musicAuditionGain?.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.25);
    this.stimulusRack.setScienceMuted(muteScience);
    this.stimulusRack.setPureStimulusMode(false);
    this.pureAmCarrierGain?.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);

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
          this.carrierMode = 'lyria_realtime';
          if (this.layerMonitorMode === 'science_only') {
            this.layerMonitorMode = 'full_mix';
          }
          this.musicAuditionGain?.gain.setTargetAtTime(1.0, now, 0.25);
          this.usingStudioAudio = false;
          this.usingCustomTrack = false;
          this.activeTrackKey = null;
          this.activeTrackNativeBpm = 0;
          this.activeStudioAppliedBpm = 0;
          this.proceduralMaster.gain.setTargetAtTime(0.0001, now, 0.85);
          this.cleanSubBus.gain.setTargetAtTime(0.0001, now, 0.85);
          this.syncRainBed();
        } else if ((st === 'error' || st === 'unavailable') && this.carrierMode === 'lyria_realtime') {
          this.setCarrierMode('studio_library');
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
    if (this.activeStreamCleanup) {
      try {
        this.activeStreamCleanup();
      } catch {
        // ignore
      }
      this.activeStreamCleanup = null;
    }
    const prevSrc = this.activeStudioSource;
    const prevStreamEl = this.activeStreamEl;
    const prevStreamSrc = this.activeStreamSource;
    const prevGain = this.activeStudioGain;
    this.activeStudioSource = null;
    this.activeStreamEl = null;
    this.activeStreamSource = null;
    this.activeStudioGain = null;

    if (this.ctx && prevGain && (prevSrc || prevStreamEl)) {
      const now = this.ctx.currentTime;
      try {
        prevGain.gain.cancelScheduledValues(now);
        prevGain.gain.setValueAtTime(Math.max(0.0001, prevGain.gain.value), now);
        prevGain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
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
          if (prevStreamEl) {
            prevStreamEl.pause();
            prevStreamEl.src = '';
          }
          prevStreamSrc?.disconnect();
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
        if (prevStreamEl) {
          prevStreamEl.pause();
          prevStreamEl.src = '';
        }
        prevStreamSrc?.disconnect();
      } catch {
        // ignore
      }
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
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      if (!this.ctx) return null;
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
  ): { rate: number; effectiveBpm: number } {
    if (this.studySpec?.music.tuningA4Hz === 432) {
      const r432 = 432 / 440;
      return {
        rate: r432,
        effectiveBpm: nativeBpm > 0 ? Math.round(nativeBpm * r432) : 0,
      };
    }
    if (isCustom || nativeBpm <= 0 || targetBpm <= 0) {
      return {
        rate: 1.0,
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
    const rate = Number(Math.max(0.88, Math.min(1.12, targetBpm / metricBase)).toFixed(4));
    return {
      rate,
      effectiveBpm: Math.round(metricBase * rate),
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
    keyLabel: string | null = null
  ): Promise<boolean> {
    if (!this.ctx || !this.studioBus || token !== this.studioLoadToken) return false;
    try {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.loop = !onCrossfade;
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      const pitchEl = el as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      const alignment = this.computeStudioTempoAlignment(nativeBpm, this.getTargetStudyBpm(), isCustom);
      if (this.studySpec?.music.tuningA4Hz === 432) {
        el.playbackRate = alignment.rate;
        if ('preservesPitch' in pitchEl) pitchEl.preservesPitch = false;
        if ('mozPreservesPitch' in pitchEl) pitchEl.mozPreservesPitch = false;
        if ('webkitPreservesPitch' in pitchEl) pitchEl.webkitPreservesPitch = false;
      } else {
        if ('preservesPitch' in pitchEl) pitchEl.preservesPitch = true;
        if ('mozPreservesPitch' in pitchEl) pitchEl.mozPreservesPitch = true;
        if ('webkitPreservesPitch' in pitchEl) pitchEl.webkitPreservesPitch = true;
        el.playbackRate = alignment.rate;
      }
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

      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) {
        el.pause();
        el.src = '';
        return false;
      }

      const ctx = this.ctx;
      const now = ctx.currentTime;
      const srcNode = ctx.createMediaElementSource(el);
      const deckGain = ctx.createGain();
      deckGain.gain.setValueAtTime(0.0001, now);

      srcNode.connect(deckGain);
      deckGain.connect(this.studioBus);

      await el.play();

      if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) {
        el.pause();
        el.src = '';
        try {
          srcNode.disconnect();
          deckGain.disconnect();
        } catch {
          // ignore
        }
        return false;
      }

      this.clearStudioDeck(fadeInSec);
      if (this.proceduralMaster && this.cleanSubBus) {
        this.proceduralMaster.gain.setTargetAtTime(0.0001, now, 0.55);
        this.cleanSubBus.gain.setTargetAtTime(0.0001, now, 0.55);
      }

      deckGain.gain.exponentialRampToValueAtTime(Math.max(0.1, targetGain), now + fadeInSec);

      // Dual-Deck Gapless Crossfade Watcher (tracks playback smoothly across pauses, zero abrupt loop cuts!)
      let cleanupListeners: (() => void) | null = null;
      if (onCrossfade) {
        let crossfadeTriggered = false;
        const triggerOnce = () => {
          if (crossfadeTriggered) return;
          crossfadeTriggered = true;
          cleanupListeners?.();
          onCrossfade();
        };
        const onTimeUpdate = () => {
          if (
            !crossfadeTriggered &&
            Number.isFinite(el.duration) &&
            el.duration > 12 &&
            el.currentTime >= el.duration - 4.2 * Math.max(0.88, el.playbackRate)
          ) {
            triggerOnce();
          }
        };
        const onEnded = () => triggerOnce();
        el.addEventListener('timeupdate', onTimeUpdate);
        el.addEventListener('ended', onEnded);
        cleanupListeners = () => {
          el.removeEventListener('timeupdate', onTimeUpdate);
          el.removeEventListener('ended', onEnded);
        };
      }

      this.activeStreamEl = el;
      this.activeStreamSource = srcNode;
      this.activeStreamCleanup = cleanupListeners;
      this.activeStudioGain = deckGain;
      this.usingStudioAudio = true;
      this.usingCustomTrack = isCustom;
      this.activeTrackName = trackName;
      this.activeTrackKey = keyLabel;
      this.activeTrackNativeBpm = nativeBpm;
      this.activeStudioAppliedBpm = alignment.effectiveBpm;
      return true;
    } catch {
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

  private async activateStudioForGenre(genre: ResolvedGenre, fadeSec = 1.8): Promise<void> {
    const token = ++this.studioLoadToken;
    this.usingCustomTrack = false;
    this.activeCustomTrack = null;
    // Prefer all tracks in the genre (energy-matched + closest study BPM first) so 2-track genres always alternate smoothly!
    const allGenreTracks = this.studioCatalog[genre] ?? [];
    const energyMatched = [...this.selectTracksForGenreAndEnergy(genre)];
    const remainingTracks = allGenreTracks.filter((t) => !energyMatched.some((e) => e.key === t.key));

    const targetBpm = this.getTargetStudyBpm();
    if (targetBpm > 0) {
      const scoreTrackBpmDistance = (track: StudioTrackRef): number => {
        const nb = this.inferTrackNativeBpm(track, genre);
        if (nb <= 0) return 999;
        return Math.min(
          Math.abs(nb - targetBpm),
          Math.abs(nb * 0.5 - targetBpm),
          Math.abs(nb * 2 - targetBpm)
        );
      };
      energyMatched.sort((a, b) => scoreTrackBpmDistance(a) - scoreTrackBpmDistance(b));
      remainingTracks.sort((a, b) => scoreTrackBpmDistance(a) - scoreTrackBpmDistance(b));
    }

    const tracks = energyMatched.length >= 2 ? energyMatched : [...energyMatched, ...remainingTracks];

    if (tracks.length === 0 || !this.ctx || !this.studioBus) {
      this.clearStudioDeck(1.2);
      this.usingStudioAudio = false;
      this.activeTrackName = null;
      this.activeTrackKey = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      if (this.ctx && this.proceduralMaster && this.cleanSubBus) {
        const now = this.ctx.currentTime;
        this.proceduralMaster.gain.setTargetAtTime(0.94, now, 0.7);
        this.cleanSubBus.gain.setTargetAtTime(0.9, now, 0.7);
      }
      return;
    }

    const chosenIdx = this.studioTrackIdx % tracks.length;
    const track = tracks[chosenIdx];
    const nativeBpm = this.inferTrackNativeBpm(track, genre);
    const trackKeyLabel = track.keyLabel ?? null;
    // Calibrated EBU R128 (-14 LUFS) gain trim so all genres & engines stay volume-matched!
    const studioTargetGain = this.computeTrackLufsGain(track, genre);

    const alignHarmonicRootToTrack = () => {
      if (typeof track.rootMidi !== 'number' || !this.ctx || !this.studySpec) return;
      const retunedHz = this.stimulusRack.retuneToMusicalRoot(
        track.rootMidi,
        this.studySpec.music.tuningA4Hz
      );
      if (retunedHz && this.spectralPocketNotch) {
        this.spectralPocketNotch.frequency.setTargetAtTime(retunedHz, this.ctx.currentTime, 0.45);
      }
    };

    // 1. Instant HTTP 206 Range streaming (<0.3s start) with smooth 4s Dual-Deck rotation across tracks!
    const streamed = await this.playStreamingTrack(
      track.url,
      track.name,
      token,
      studioTargetGain,
      false,
      () => {
        if (!this.isPlaying || token !== this.studioLoadToken || this.carrierMode !== 'studio_library') return;
        this.studioTrackIdx = tracks.length > 1 ? (chosenIdx + 1) % tracks.length : 0;
        void this.activateStudioForGenre(genre, 4.0);
      },
      fadeSec,
      nativeBpm,
      trackKeyLabel
    );
    if (streamed) {
      alignHarmonicRootToTrack();
      return;
    }
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) return;

    // 2. Fallback to decoded AudioBuffer
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
      () => {
        if (!this.isPlaying || token !== this.studioLoadToken || this.carrierMode !== 'studio_library') return;
        this.studioTrackIdx = tracks.length > 1 ? (chosenIdx + 1) % tracks.length : 0;
        void this.activateStudioForGenre(genre, 4.0);
      },
      nativeBpm,
      trackKeyLabel
    );
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
    keyLabel: string | null = null
  ): void {
    if (!this.ctx || !this.studioBus || token !== this.studioLoadToken) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fadeInSec = 2.4;

    this.clearStudioDeck(fadeInSec);
    if (this.proceduralMaster && this.cleanSubBus) {
      this.proceduralMaster.gain.setTargetAtTime(0.0001, now, 0.8);
      this.cleanSubBus.gain.setTargetAtTime(0.0001, now, 0.8);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // Futuristic Studio Retuning: mathematically detune real R2 studio tracks to exact A=432 Hz (-31.77 cents) when study requires it!
    const is432 = this.studySpec?.music.tuningA4Hz === 432;
    if (is432) {
      src.playbackRate.setValueAtTime(432 / 440, now);
    }

    const deckGain = ctx.createGain();
    deckGain.gain.setValueAtTime(0.0001, now);
    deckGain.gain.exponentialRampToValueAtTime(Math.max(0.1, targetGain), now + fadeInSec);

    src.connect(deckGain);
    deckGain.connect(this.studioBus);
    src.start(now);

    this.activeStudioSource = src;
    this.activeStudioGain = deckGain;
    this.usingStudioAudio = true;
    this.activeTrackName = trackName;
    this.activeTrackKey = keyLabel;
    this.activeTrackNativeBpm = nativeBpm;
    this.activeStudioAppliedBpm =
      is432 && nativeBpm > 0 ? Math.round(nativeBpm * (432 / 440)) : nativeBpm;

    const crossfadeLeadSec = Math.min(7, Math.max(2.5, buffer.duration * 0.16));
    const delaySec = Math.max(1.5, buffer.duration - crossfadeLeadSec);
    this.scheduleDeckCrossfade(delaySec, onCrossfade);
  }

  public setGenre(style: ResolvedGenre): void {
    this.genre = style;
    const nextPalette = resolvedGenreToPalette(style);
    if (this.studySpec) {
      this.studySpec.music.instrumentPalette = nextPalette;
    }
    this.composer.setPalette(nextPalette);

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

  public updateElapsed(elapsedSec: number): EngineTelemetry {
    this.elapsedSec = elapsedSec;
    const progressRatio = Math.min(1, Math.max(0, elapsedSec / this.plannedSec));
    let phase: SessionPhase = 'plateau';
    let phaseLabel = 'Study Protocol Plateau';
    let phaseModFactor = 1.0;

    const entryDurationSec = Math.min(45, Math.max(20, this.plannedSec * 0.08));
    if (elapsedSec < entryDurationSec) {
      phase = 'entry';
      phaseLabel = 'Entry & Iso-Alignment';
      phaseModFactor = 0.76 + (elapsedSec / entryDurationSec) * 0.24;
    } else if (progressRatio > 0.9) {
      phase = 'landing';
      phaseLabel = 'Gentle Landing';
      phaseModFactor = 1.0 - ((progressRatio - 0.9) / 0.1) * 0.4;
    }

    const antiMonotonyActive = this.isAntiMonotonyPulseActive();
    this.composer.updateProgress(progressRatio, antiMonotonyActive);

    const spec = this.studySpec;
    const scienceMuted = this.layerMonitorMode === 'music_only';
    const activePhaseFactor = this.layerMonitorMode === 'science_only' ? 1.0 : phaseModFactor;
    const amActive = spec?.entrainment.type === 'amplitude_modulation' && spec.entrainment.frequencyHz > 0;
    const baseDepth = amActive ? spec.entrainment.modulationDepth : 0;
    const nominalDepth = Math.min(0.75, Math.max(0, baseDepth * this.modDepthMultiplier * activePhaseFactor));
    const effectiveDepth = this.isControlTrial || scienceMuted ? 0 : nominalDepth;

    // Iso-Principle live frequency ramp (startFrequencyHz -> target frequencyHz within 90s)
    let liveAmHz = spec?.entrainment.frequencyHz ?? this.params?.modulationHz ?? 16;
    if (amActive && spec?.entrainment.startFrequencyHz !== undefined) {
      const freqRampSec = Math.min(90, Math.max(30, this.plannedSec * 0.15));
      const rampRatio = Math.min(1, Math.max(0, elapsedSec / freqRampSec));
      liveAmHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (spec.entrainment.frequencyHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
    }

    if (this.ctx && this.amGainL && this.amDepthGainL && this.amLfoL) {
      const now = this.ctx.currentTime;
      const amGains = this.computeAmGainPair(effectiveDepth);
      const tiltDbGain = amActive ? effectiveDepth * 5.6 : 0;
      this.amGainL.gain.setTargetAtTime(amGains.bias, now, 0.35);
      this.amDepthGainL.gain.setTargetAtTime(amGains.swing, now, 0.35);
      this.amTiltDepthL?.gain.setTargetAtTime(tiltDbGain, now, 0.35);
      if (amActive) {
        this.amLfoL.frequency.setTargetAtTime(Math.max(0.5, liveAmHz), now, 0.5);
      }

      if (this.amGainR && this.amDepthGainR && this.amLfoR) {
        this.amGainR.gain.setTargetAtTime(amGains.bias, now, 0.35);
        this.amDepthGainR.gain.setTargetAtTime(amGains.swing, now, 0.35);
        this.amTiltDepthR?.gain.setTargetAtTime(tiltDbGain, now, 0.35);
        if (amActive) {
          this.amLfoR.frequency.setTargetAtTime(Math.max(0.5, liveAmHz), now, 0.5);
        }
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

    const targetBpm = this.getTargetStudyBpm(progressRatio);
    if (
      this.activeStreamEl &&
      this.usingStudioAudio &&
      !this.usingCustomTrack &&
      spec?.music.tuningA4Hz !== 432 &&
      this.activeTrackNativeBpm > 0
    ) {
      const alignment = this.computeStudioTempoAlignment(this.activeTrackNativeBpm, targetBpm, false);
      this.activeStudioAppliedBpm = alignment.effectiveBpm;
      if (Math.abs(this.activeStreamEl.playbackRate - alignment.rate) >= 0.004) {
        this.activeStreamEl.playbackRate = alignment.rate;
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
        : Number(
            (amActive ? nominalDepth : (spec?.entrainment.modulationDepth ?? 0) * this.modDepthMultiplier).toFixed(2)
          ),
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
    };
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0.0001, this.volume * 0.82),
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
        this.studioFilter.frequency.setTargetAtTime(this.computeStudioCutoffHz(), now, 0.3);
      }
      if (this.studioBus) {
        const gainTrim = 0.98 * Math.max(0.82, Math.min(1.08, 0.88 + 0.12 * this.intensityMultiplier));
        this.studioBus.gain.setTargetAtTime(gainTrim, now, 0.3);
      }
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
    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec);
    }
  }

  public async fadeOutAndPause(durationSec = 2.0): Promise<void> {
    if (!this.ctx || !this.isPlaying) return;
    if (this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
        this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
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
    void this.releaseWakeLock();
  }

  public async resume(): Promise<void> {
    if (!this.ctx || this.isPlaying) return;
    await this.ctx.resume();
    if (this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.volume * 0.82), now, 0.25);
      } catch {
        // ignore
      }
    }
    await this.activeStreamEl?.play().catch(() => {});
    await this.audioEl?.play().catch(() => {});
    await this.keepAliveEl?.play().catch(() => {});
    this.isPlaying = true;
    this.composer.resume();
    if (this.studioDeckPausedRemainingSec !== null && this.studioDeckOnCrossfade) {
      const remaining = this.studioDeckPausedRemainingSec;
      const cb = this.studioDeckOnCrossfade;
      this.scheduleDeckCrossfade(remaining, cb);
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
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
   * Computes the strongest real FFT spectral peak (Hz) from the live Web Audio master output.
   */
  public getMeasuredPeakHz(): number | null {
    if (!this.scopeMasterAnalyser || !this.ctx || !this.isPlaying) return null;
    const bins = this.scopeMasterAnalyser.frequencyBinCount;
    const fft = new Float32Array(bins);
    this.scopeMasterAnalyser.getFloatFrequencyData(fft);
    const binHz = this.ctx.sampleRate / this.scopeMasterAnalyser.fftSize;
    let bestBin = -1;
    let bestDb = -90;
    // Scan audible musical/carrier band (35 Hz – 4000 Hz)
    const minBin = Math.max(2, Math.floor(35 / binHz));
    const maxBin = Math.min(bins - 1, Math.ceil(4000 / binHz));
    for (let i = minBin; i <= maxBin; i++) {
      if (fft[i] > bestDb) {
        bestDb = fft[i];
        bestBin = i;
      }
    }
    if (bestBin < 0 || bestDb < -72) return null;
    return Math.round(bestBin * binHz);
  }

  public getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public stop(): void {
    void this.releaseWakeLock();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    if (this.ctx && this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
        this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      } catch {
        // ignore
      }
      const ctxRef = this.ctx;
      const audioElRef = this.audioEl;
      const keepAliveElRef = this.keepAliveEl;
      const keepAliveUrlRef = this.keepAliveUrl;
      this.isPlaying = false;
      if (this.snrTimer !== null) {
        window.clearInterval(this.snrTimer);
        this.snrTimer = null;
      }
      this.activeTrackKey = null;
      this.activeTrackNativeBpm = 0;
      this.activeStudioAppliedBpm = 0;
      this.composer.stop();
      this.stimulusRack.stop();
      this.lyriaClient.stop();
      this.rainBed.stop();
      this.clearStudioDeck(0.35);
      window.setTimeout(() => {
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
      }, 600);
      this.ctx = null;
      this.audioEl = null;
      this.keepAliveEl = null;
      this.keepAliveUrl = null;
      this.analyser = null;
      this.scopeMasterAnalyser = null;
      this.scopeModAnalyser = null;
      this.scopeLeftAnalyser = null;
      this.scopeRightAnalyser = null;
      this.musicEnvAnalyser = null;
      this.musicEnvBuf = null;
      this.musicEnvSmoothedRms = 0.165;
      return;
    }
    this.stopImmediate();
  }

  private stopImmediate(): void {
    this.isPlaying = false;
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
    this.activeTrackNativeBpm = 0;
    this.activeStudioAppliedBpm = 0;
    this.studioDeckPausedRemainingSec = null;
    this.studioDeckOnCrossfade = null;
    this.lyriaStatus = 'idle';
    this.composer.stop();
    this.stimulusRack.stop();
    this.lyriaClient.stop();
    this.rainBed.stop();
    this.clearStudioDeck(0.1);
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    void this.releaseWakeLock();
    try {
      this.amLfoL?.stop();
      this.amLfoR?.stop();
      this.pureAmCarrierSrc?.stop();
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
    this.amDepthGainL = null;
    this.amDepthGainR = null;
    this.amTiltDepthL = null;
    this.amTiltDepthR = null;
    this.pureAmCarrierGain = null;
    this.pureAmCarrierSrc = null;
    this.cleanSubBus = null;
    this.proceduralMaster = null;
    this.studioBus = null;
    this.studioFilter = null;
    this.musicAuditionGain = null;
    this.spectralPocketNotch = null;
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

  private setupMediaSession(title: string): void {
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
