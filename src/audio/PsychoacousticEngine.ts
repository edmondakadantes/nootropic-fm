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

export interface StudioTrackRef {
  key: string;
  name: string;
  url: string;
  energy: EnergyTier;
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
  private masterGain: GainNode | null = null;

  // Core routing buses
  private cleanSubBus: GainNode | null = null;
  private proceduralMaster: GainNode | null = null;
  private studioBus: GainNode | null = null;
  private pureAmCarrierGain: GainNode | null = null;
  private pureAmCarrierSrc: AudioBufferSourceNode | null = null;

  // 3-Band LR4 Cortical AM nodes
  private amGainL: GainNode | null = null;
  private amGainR: GainNode | null = null;
  private amLfoL: OscillatorNode | null = null;
  private amLfoR: OscillatorNode | null = null;
  private amDepthGainL: GainNode | null = null;
  private amDepthGainR: GainNode | null = null;

  // Modular sub-engines
  private composer = new GenerativeComposer();
  private stimulusRack = new MedicalStimulusRack();
  private lyriaClient = new LyriaRealtimeClient();
  private rainBed = new StereoRainBed();

  // Mobile background bridge & wake lock
  private audioEl: HTMLAudioElement | null = null;
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

  // Active state
  private params: AcousticParams | null = null;
  private studySpec: ExecutableStudySpec | null = null;
  private carrierMode: CarrierEngineMode = 'generative_live';
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

    // Master Peak Limiter / Studio Compressor
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.22;

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

    compressor.connect(masterGain);
    masterGain.connect(analyser);
    masterGain.connect(scopeMasterAnalyser);

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

    // ─── LAYER 1A: PRECISION MEDICAL STIMULUS RACK (40 Hz GENUS, Isochronic, Binaural, Monaural, HRV, SNR Noise) ───
    const { hrvBusInput } = this.stimulusRack.start({
      ctx,
      spec: this.studySpec,
      masterDestination: compressor,
      speakerSafeEQ: params.speakerSafeEQ,
      isControlTrial: this.isControlTrial,
      pureStimulusMode: this.carrierMode === 'pure_stimulus',
    });

    // ─── LAYER 1B: 3-BAND LINKWITZ-RILEY (LR4) PHASE-COHERENT CORTICAL AM MATRIX ───
    const lowerHz = this.studySpec.entrainment.modulationBandHz[0] || params.crossoverHz || 190;
    const upperHz = this.studySpec.entrainment.modulationBandHz[1] || params.upperCrossoverHz || 4500;

    const preHrvBus = ctx.createGain();
    preHrvBus.gain.value = 1.0;
    const musicMixBus = ctx.createGain();
    musicMixBus.gain.value = 1.0;

    if (hrvBusInput) {
      preHrvBus.connect(hrvBusInput);
      hrvBusInput.connect(musicMixBus);
    } else {
      preHrvBus.connect(musicMixBus);
    }

    const startWithMusic = this.carrierMode === 'generative_live';
    const proceduralMaster = ctx.createGain();
    proceduralMaster.gain.setValueAtTime(startWithMusic ? 1.0 : 0.0001, ctx.currentTime);
    proceduralMaster.connect(preHrvBus);
    this.proceduralMaster = proceduralMaster;

    const studioBus = ctx.createGain();
    studioBus.gain.setValueAtTime(0.98, ctx.currentTime);
    studioBus.connect(preHrvBus);
    this.studioBus = studioBus;

    const cleanSubBus = ctx.createGain();
    cleanSubBus.gain.setValueAtTime(startWithMusic ? 0.9 : 0.0001, ctx.currentTime);
    cleanSubBus.connect(compressor);
    this.cleanSubBus = cleanSubBus;

    // Gentle pink carrier specifically for Pure Clinical Signal auditing of Amplitude Modulation (AM) studies
    const pureAmBuf = createCalibratedNoiseBuffer(ctx, 'pink', 6);
    const pureAmSrc = ctx.createBufferSource();
    pureAmSrc.buffer = pureAmBuf;
    pureAmSrc.loop = true;
    const pureAmGain = ctx.createGain();
    const needsPureAmCarrier =
      this.carrierMode === 'pure_stimulus' && this.studySpec.entrainment.type === 'amplitude_modulation';
    pureAmGain.gain.setValueAtTime(needsPureAmCarrier ? 0.32 : 0.0001, ctx.currentTime);
    pureAmSrc.connect(pureAmGain);
    pureAmGain.connect(musicMixBus);
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
      : Math.min(0.72, Math.max(0, targetAmDepth * 0.55 * this.modDepthMultiplier));

    const useStereoSpread = Boolean(
      amActiveForSpec &&
        (this.studySpec.entrainment.phaseOffsetDeg ?? 0) > 0 &&
        !params.speakerSafeEQ
    );

    const amLfoL = ctx.createOscillator();
    amLfoL.type = 'sine';
    amLfoL.frequency.setValueAtTime(Math.max(0.5, amStartHz || 16), ctx.currentTime);

    const amDepthGainL = ctx.createGain();
    amDepthGainL.gain.setValueAtTime(initialDepth / 2, ctx.currentTime);

    const amGainL = ctx.createGain();
    amGainL.gain.setValueAtTime(1 - initialDepth / 2, ctx.currentTime);

    amLfoL.connect(amDepthGainL);
    amDepthGainL.connect(amGainL.gain);
    amLfoL.start();

    let midOutput: AudioNode = amGainL;

    if (useStereoSpread) {
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);

      const amLfoR = ctx.createOscillator();
      amLfoR.setPeriodicWave(
        createPhaseShiftedSineWave(ctx, this.studySpec.entrainment.phaseOffsetDeg ?? 32)
      );
      amLfoR.frequency.setValueAtTime(Math.max(0.5, amStartHz || 16), ctx.currentTime);

      const amDepthGainR = ctx.createGain();
      amDepthGainR.gain.setValueAtTime(initialDepth / 2, ctx.currentTime);

      const amGainR = ctx.createGain();
      amGainR.gain.setValueAtTime(1 - initialDepth / 2, ctx.currentTime);

      amLfoR.connect(amDepthGainR);
      amDepthGainR.connect(amGainR.gain);
      amLfoR.start();

      midBand.output.connect(splitter);
      splitter.connect(amGainL, 0);
      splitter.connect(amGainR, 1);
      amGainL.connect(merger, 0, 0);
      amGainR.connect(merger, 0, 1);

      this.amGainR = amGainR;
      this.amLfoR = amLfoR;
      this.amDepthGainR = amDepthGainR;
      midOutput = merger;
    } else {
      midBand.output.connect(amGainL);
      this.amGainR = null;
      this.amLfoR = null;
      this.amDepthGainR = null;
    }

    // Dedicated zero-smoothing Lab Oscilloscope tap directly on the modulated LR4 cortical band (190-4500 Hz)
    const scopeModAnalyser = ctx.createAnalyser();
    scopeModAnalyser.fftSize = 1024;
    scopeModAnalyser.smoothingTimeConstant = 0.0;
    midOutput.connect(scopeModAnalyser);
    this.scopeModAnalyser = scopeModAnalyser;

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

    if (this.carrierMode === 'studio_library' && !skipInitialStudioDeck) {
      void this.activateStudioForGenre(this.genre);
    }
  }

  private syncRainBed(): void {
    const shouldPlayRain = this.genre === 'nature_rain' && this.carrierMode !== 'pure_stimulus';
    this.rainBed.setActive(shouldPlayRain);
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
      this.stimulusRack.setPureStimulusMode(false);
      this.pureAmCarrierGain?.gain.setTargetAtTime(0.0001, now, 0.4);
      this.proceduralMaster.gain.setTargetAtTime(1.0, now, 0.65);
      this.cleanSubBus.gain.setTargetAtTime(0.9, now, 0.65);
    } else if (mode === 'pure_stimulus') {
      this.clearStudioDeck(1.2);
      this.usingStudioAudio = false;
      this.usingCustomTrack = false;
      this.activeTrackName = null;
      this.stimulusRack.setPureStimulusMode(true);
      this.proceduralMaster.gain.setTargetAtTime(0.0001, now, 0.45);
      this.cleanSubBus.gain.setTargetAtTime(0.0001, now, 0.45);
      const needsPureAm = this.studySpec?.entrainment.type === 'amplitude_modulation';
      this.pureAmCarrierGain?.gain.setTargetAtTime(needsPureAm ? 0.34 : 0.0001, now, 0.45);
    } else if (mode === 'studio_library') {
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
          this.usingStudioAudio = false;
          this.usingCustomTrack = false;
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

  private async playStreamingTrack(
    url: string,
    trackName: string,
    token: number,
    targetGain: number,
    isCustom: boolean,
    onCrossfade?: () => void,
    fadeInSec = 1.8
  ): Promise<boolean> {
    if (!this.ctx || !this.studioBus || token !== this.studioLoadToken) return false;
    try {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.loop = !onCrossfade;
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      if (this.studySpec?.music.tuningA4Hz === 432) {
        el.playbackRate = 432 / 440;
        const pitchEl = el as HTMLAudioElement & {
          preservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        if ('preservesPitch' in pitchEl) pitchEl.preservesPitch = false;
        if ('webkitPreservesPitch' in pitchEl) pitchEl.webkitPreservesPitch = false;
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
            el.currentTime >= el.duration - 4.2
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
    // Prefer all tracks in the genre (energy-matched first) so 2-track genres always alternate smoothly!
    const allGenreTracks = this.studioCatalog[genre] ?? [];
    const energyMatched = this.selectTracksForGenreAndEnergy(genre);
    const tracks =
      energyMatched.length >= 2
        ? energyMatched
        : [
            ...energyMatched,
            ...allGenreTracks.filter((t) => !energyMatched.some((e) => e.key === t.key)),
          ];

    if (tracks.length === 0 || !this.ctx || !this.studioBus) {
      this.clearStudioDeck(1.2);
      this.usingStudioAudio = false;
      this.activeTrackName = null;
      if (this.ctx && this.proceduralMaster && this.cleanSubBus) {
        const now = this.ctx.currentTime;
        this.proceduralMaster.gain.setTargetAtTime(1.0, now, 0.7);
        this.cleanSubBus.gain.setTargetAtTime(0.9, now, 0.7);
      }
      return;
    }

    const chosenIdx = this.studioTrackIdx % tracks.length;
    const track = tracks[chosenIdx];
    // For Soft Rain & Nature, gently tuck warm pads so our stereo rain & raindrops stay crystal clear!
    const studioTargetGain = genre === 'nature_rain' ? 0.54 : 0.96;

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
      fadeSec
    );
    if (streamed) return;
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus) return;

    // 2. Fallback to decoded AudioBuffer
    const buffer = await this.loadAudioBuffer(track.url);
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !buffer) {
      return;
    }

    this.playStudioBuffer(buffer, track.name, token, studioTargetGain, () => {
      if (!this.isPlaying || token !== this.studioLoadToken || this.carrierMode !== 'studio_library') return;
      this.studioTrackIdx = tracks.length > 1 ? (chosenIdx + 1) % tracks.length : 0;
      void this.activateStudioForGenre(genre, 4.0);
    });
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
    onCrossfade: () => void
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
    if (this.studySpec?.music.tuningA4Hz === 432) {
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
      this.lyriaClient.setGenre(style, this.studySpec, this.intensityMultiplier);
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

    if (progressRatio < 0.15) {
      phase = 'entry';
      phaseLabel = 'Entry & Iso-Alignment';
      phaseModFactor = 0.55 + (progressRatio / 0.15) * 0.45;
    } else if (progressRatio > 0.88) {
      phase = 'landing';
      phaseLabel = 'Gentle Landing';
      phaseModFactor = 1.0 - ((progressRatio - 0.88) / 0.12) * 0.45;
    }

    const antiMonotonyActive = this.isAntiMonotonyPulseActive();
    this.composer.updateProgress(progressRatio, antiMonotonyActive);

    const spec = this.studySpec;
    const amActive = spec?.entrainment.type === 'amplitude_modulation' && spec.entrainment.frequencyHz > 0;
    const baseDepth = amActive ? spec.entrainment.modulationDepth : 0;
    const nominalDepth = Math.min(0.75, Math.max(0, baseDepth * this.modDepthMultiplier * phaseModFactor));
    const effectiveDepth = this.isControlTrial ? 0 : nominalDepth;

    // Iso-Principle live frequency ramp (startFrequencyHz -> target frequencyHz during entry)
    let liveAmHz = spec?.entrainment.frequencyHz ?? this.params?.modulationHz ?? 16;
    if (amActive && spec?.entrainment.startFrequencyHz !== undefined) {
      const rampRatio = Math.min(1, progressRatio / 0.25);
      liveAmHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (spec.entrainment.frequencyHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
    }

    if (this.ctx && this.amGainL && this.amDepthGainL && this.amLfoL) {
      const now = this.ctx.currentTime;
      this.amGainL.gain.setTargetAtTime(1 - effectiveDepth / 2, now, 0.35);
      this.amDepthGainL.gain.setTargetAtTime(effectiveDepth / 2, now, 0.35);
      if (amActive) {
        this.amLfoL.frequency.setTargetAtTime(Math.max(0.5, liveAmHz), now, 0.5);
      }

      if (this.amGainR && this.amDepthGainR && this.amLfoR) {
        this.amGainR.gain.setTargetAtTime(1 - effectiveDepth / 2, now, 0.35);
        this.amDepthGainR.gain.setTargetAtTime(effectiveDepth / 2, now, 0.35);
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

    const stim = this.stimulusRack.getTelemetry(elapsedSec);
    return {
      phase,
      phaseLabel,
      progressRatio,
      currentModHz: amActive ? liveAmHz : stim.activeHz,
      currentModDepth: Number(
        (amActive ? nominalDepth : (spec?.entrainment.modulationDepth ?? 0) * this.modDepthMultiplier).toFixed(2)
      ),
      crossoverHz: spec?.entrainment.modulationBandHz[0] ?? this.params?.crossoverHz ?? 190,
      upperCrossoverHz: spec?.entrainment.modulationBandHz[1] ?? this.params?.upperCrossoverHz ?? 4500,
      stereoAmActive: Boolean(this.amGainR),
      energyTier: this.params?.energyTier ?? 'focus',
      currentBpm: this.composer.getCurrentBpm(),
      antiMonotonyActive,
      genre: this.genre,
      backgroundAudioActive: this.backgroundAudioActive,
      usingStudioAudio: this.usingStudioAudio,
      usingCustomTrack: this.usingCustomTrack,
      activeTrackName: this.activeTrackName,
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
    if (this.carrierMode === 'lyria_realtime' && this.studySpec) {
      this.lyriaClient.steer(this.studySpec, this.intensityMultiplier, this.genre);
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
      this.isPlaying = false;
      this.composer.stop();
      this.stimulusRack.stop();
      this.lyriaClient.stop();
      this.rainBed.stop();
      this.clearStudioDeck(0.35);
      window.setTimeout(() => {
        audioElRef?.pause();
        if (audioElRef) audioElRef.srcObject = null;
        ctxRef.close().catch(() => {});
      }, 600);
      this.ctx = null;
      this.audioEl = null;
      this.analyser = null;
      this.scopeMasterAnalyser = null;
      this.scopeModAnalyser = null;
      return;
    }
    this.stopImmediate();
  }

  private stopImmediate(): void {
    this.isPlaying = false;
    this.studioLoadToken++;
    this.usingStudioAudio = false;
    this.usingCustomTrack = false;
    this.activeCustomTrack = null;
    this.activeTrackName = null;
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
    this.amGainL = null;
    this.amGainR = null;
    this.amLfoL = null;
    this.amLfoR = null;
    this.amDepthGainL = null;
    this.amDepthGainR = null;
    this.pureAmCarrierGain = null;
    this.pureAmCarrierSrc = null;
    this.cleanSubBus = null;
    this.proceduralMaster = null;
    this.studioBus = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    this.scopeMasterAnalyser = null;
    this.scopeModAnalyser = null;
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
