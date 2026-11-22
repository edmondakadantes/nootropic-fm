import type {
  AcousticParams,
  EnergyTier,
  HarmonicMode,
  NoiseColor,
  ResolvedGenre,
} from '../../shared/types';

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
  activeTrackName: string | null;
}

const CHORD_PROGRESSIONS: Record<HarmonicMode, number[][]> = {
  bright_maj9: [
    [0, 7, 11, 14, 16],
    [5, 12, 16, 19, 21],
    [9, 12, 16, 19, 23],
    [7, 12, 14, 19, 21],
  ],
  warm_min9: [
    [0, 7, 10, 14, 15],
    [8, 12, 15, 19, 22],
    [5, 10, 12, 17, 19],
    [7, 10, 14, 17, 19],
  ],
  suspended_open: [
    [0, 7, 14, 19, 24],
    [5, 12, 17, 19, 24],
    [9, 14, 16, 21, 23],
    [7, 14, 19, 21, 26],
  ],
  deep_drone: [
    [0, 7, 12, 14],
    [0, 5, 12, 17],
    [0, 7, 12, 19],
  ],
};

// Lush extended Jazz chord voicings (ii11 -> V13 -> Imaj9 -> VI9)
const JAZZ_VOICINGS: number[][] = [
  [2, 5, 9, 12, 16],
  [7, 11, 16, 17, 21],
  [0, 4, 7, 11, 14],
  [9, 12, 16, 19, 23],
];

function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
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

function createColoredNoiseBuffer(ctx: AudioContext, color: NoiseColor, durationSec = 6): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let lastBrown = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'brown') {
        lastBrown = (lastBrown + 0.02 * white) / 1.02;
        out[i] = lastBrown * 3.2;
      } else {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
        out[i] =
          color === 'soft_rain'
            ? pink * (0.72 + 0.28 * Math.sin(i / 18000 + ch * 1.4))
            : pink;
      }
    }

    const fade = Math.min(2048, Math.floor(length / 8));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      const tailIdx = length - fade + i;
      const blended = out[i] * t + out[tailIdx] * (1 - t);
      out[i] = blended;
      out[tailIdx] = blended;
    }
  }

  return buffer;
}

/**
 * Generates subtle warm vinyl crackle/dust texture for Lo-Fi Warm Keys.
 */
function createVinylDustBuffer(ctx: AudioContext, durationSec = 5): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = rate * durationSec;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const hiss = (Math.random() * 2 - 1) * 0.012;
      const pop = Math.random() < 0.00018 ? (Math.random() * 2 - 1) * 0.26 : 0;
      out[i] = hiss + pop;
    }
  }
  return buf;
}

/**
 * Phase-Coherent 3-Band Linkwitz-Riley (LR4, 24 dB/oct) Crossover helpers.
 * Two cascaded Butterworth (Q = 1/sqrt(2)) biquads sum to exact 0 dB flat magnitude
 * with 0° phase difference at the crossover point (zero 190 Hz / 4.5 kHz dip!).
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

/**
 * Generates a phase-shifted sine PeriodicWave (e.g. +32° for Right-channel organic AM shimmer).
 */
function createPhaseShiftedSineWave(ctx: AudioContext, phaseDeg: number): PeriodicWave {
  const rad = (phaseDeg * Math.PI) / 180;
  // Web Audio PeriodicWave: sum(real[n]*cos(n*w*t) + imag[n]*sin(n*w*t))
  // sin(w*t + rad) = sin(rad)*cos(w*t) + cos(rad)*sin(w*t)
  const real = new Float32Array([0, Math.sin(rad)]);
  const imag = new Float32Array([0, Math.cos(rad)]);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/**
 * 3-Band Linkwitz-Riley (LR4) Phase-Coherent Neuro-DSP + Dual-Deck Studio Stem Engine.
 *
 * Signal topology:
 *   [Music Mix Bus (R2 Studio Stems or Procedural Fallback)]
 *     ├── Band 1 (<190 Hz, LR4 LP + AP@4.5kHz) ─────────────────────────────────────┐ (100% clean sub-bass)
 *     └── LR4 HP (>190 Hz)
 *           ├── Band 2 (190 Hz–4.5 kHz, LR4 LP) ──▶ [Iso-Adaptive Cortical AM L/R] ─┼──▶ [Master Compressor]
 *           └── Band 3 (>4.5 kHz, LR4 HP) ──────────────────────────────────────────┘ (100% clean air & sparkle)
 */
export class PsychoacousticEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;

  // 3-Band LR4 music buses
  private cleanSubBus: GainNode | null = null;
  private proceduralMaster: GainNode | null = null;
  private studioBus: GainNode | null = null;
  private padBus: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private amGainL: GainNode | null = null;
  private amGainR: GainNode | null = null;
  private amLfoL: OscillatorNode | null = null;
  private amLfoR: OscillatorNode | null = null;
  private amDepthGainL: GainNode | null = null;
  private amDepthGainR: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private vinylGain: GainNode | null = null;
  private vinylSource: AudioBufferSourceNode | null = null;
  private pulseBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private binauralNodes: AudioNode[] = [];
  private activePadOscs: OscillatorNode[] = [];
  private activePadGains: GainNode[] = [];
  private lfoFilter: OscillatorNode | null = null;

  private audioEl: HTMLAudioElement | null = null;
  private backgroundAudioActive = false;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private visibilityHandler: (() => void) | null = null;

  // Dual-Deck Gapless Studio Stem Engine (Cloudflare R2 -> 3-Band LR4 AM)
  private studioCatalog: Partial<Record<ResolvedGenre, StudioTrackRef[]>> = {};
  private bufferCache = new Map<string, AudioBuffer>();
  private activeStudioSource: AudioBufferSourceNode | null = null;
  private activeStudioGain: GainNode | null = null;
  private studioCrossfadeTimer: number | null = null;
  private studioTrackIdx = 0;
  private studioLoadToken = 0;
  private usingStudioAudio = false;
  private activeTrackName: string | null = null;

  private params: AcousticParams | null = null;
  private genre: ResolvedGenre = 'deep_electronic';
  private isControlTrial = false;
  private isPlaying = false;
  private volume = 0.74;
  private intensityMultiplier = 1.0;
  private modDepthMultiplier = 1.0;

  private chordIndex = 0;
  private chordTimer: number | null = null;
  private pulseTimer: number | null = null;
  private nextStepTime = 0;
  private stepCount = 0;
  private elapsedSec = 0;
  private plannedSec = 2400;

  public async start(
    params: AcousticParams,
    plannedDurationMin: number,
    title = 'nootropic.fm',
    isControlTrial = false
  ): Promise<void> {
    this.stopImmediate();
    this.params = { ...params };
    this.genre = params.genre ?? 'deep_electronic';
    this.isControlTrial = isControlTrial;
    this.plannedSec = Math.max(60, plannedDurationMin * 60);
    this.elapsedSec = 0;
    this.chordIndex = 0;
    this.stepCount = 0;
    this.intensityMultiplier = 1.0;
    this.modDepthMultiplier = 1.0;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.ctx = ctx;

    // Mobile / iOS lock-screen auto-recovery
    ctx.addEventListener('statechange', () => {
      if (this.isPlaying && this.ctx === ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    });
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isPlaying && this.ctx) {
        if (this.ctx.state === 'suspended') {
          void this.ctx.resume().catch(() => {});
        }
        if (this.audioEl && this.audioEl.paused) {
          void this.audioEl.play().catch(() => {});
        }
        void this.requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Master Chain (transparent studio peak control)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -13;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.0;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.24;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(Math.max(0.05, this.volume * 0.84), ctx.currentTime + 2.0);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    compressor.connect(masterGain);
    masterGain.connect(analyser);

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

    // ─── 3-BAND LINKWITZ-RILEY (LR4) PHASE-COHERENT CROSSOVER ───
    const lowerHz = params.crossoverHz || 190;
    const upperHz = params.upperCrossoverHz || 4500;
    const musicMixBus = ctx.createGain();
    musicMixBus.gain.value = 1.0;

    // Master envelope for procedural synth (smoothly ducks when R2 Studio Stems fade in)
    const proceduralMaster = ctx.createGain();
    proceduralMaster.gain.setValueAtTime(1.0, ctx.currentTime);
    proceduralMaster.connect(musicMixBus);
    this.proceduralMaster = proceduralMaster;

    // Dedicated Studio Stem Bus (R2 MP3/Opus stems route directly into 3-Band LR4!)
    const studioBus = ctx.createGain();
    studioBus.gain.setValueAtTime(0.98, ctx.currentTime);
    studioBus.connect(musicMixBus);
    this.studioBus = studioBus;

    // Dedicated Clean Sub-Bass Bus (< 190 Hz -> bypasses AM completely!)
    const cleanSubBus = ctx.createGain();
    cleanSubBus.gain.value = 0.9;
    cleanSubBus.connect(compressor);
    this.cleanSubBus = cleanSubBus;

    // BAND 1: Clean Sub-Bass (<190 Hz, LR4 LP + Allpass phase alignment at 4.5 kHz)
    const lowBand = createLR4Filter(ctx, 'lowpass', lowerHz);
    const lowPhaseAlign = ctx.createBiquadFilter();
    lowPhaseAlign.type = 'allpass';
    lowPhaseAlign.frequency.value = upperHz;
    lowPhaseAlign.Q.value = Math.SQRT1_2;
    musicMixBus.connect(lowBand.input);
    lowBand.output.connect(lowPhaseAlign);
    lowPhaseAlign.connect(compressor);

    // UPPER SPLIT (>190 Hz, LR4 HP) -> splits into Band 2 (Cortical AM) & Band 3 (Clean Air)
    const aboveLow = createLR4Filter(ctx, 'highpass', lowerHz);
    musicMixBus.connect(aboveLow.input);

    // BAND 3: Clean Air & Sparkle (>4.5 kHz, LR4 HP -> 0% AM so cymbals & acoustic sheen stay pristine!)
    const airBand = createLR4Filter(ctx, 'highpass', upperHz);
    aboveLow.output.connect(airBand.input);
    airBand.output.connect(compressor);

    // BAND 2: Cortical AM Entrainment Band (190 Hz – 4.5 kHz, LR4 LP)
    const midBand = createLR4Filter(ctx, 'lowpass', upperHz);
    aboveLow.output.connect(midBand.input);

    // Iso-Adaptive entry starts ultra-organic (~48% of target depth -> ~12% shimmer),
    // ramping cleanly up to Peak depth during the session. Blind Control trials hold strictly 0%.
    const initialDepth = this.isControlTrial
      ? 0
      : Math.min(0.42, Math.max(0, params.modulationDepth * 0.48 * this.modDepthMultiplier));

    const useStereoSpread = Boolean(params.stereoAmSpread && !params.speakerSafeEQ);

    const amLfoL = ctx.createOscillator();
    amLfoL.type = 'sine';
    amLfoL.frequency.setValueAtTime(params.modulationHz, ctx.currentTime);

    const amDepthGainL = ctx.createGain();
    amDepthGainL.gain.setValueAtTime(initialDepth / 2, ctx.currentTime);

    const amGainL = ctx.createGain();
    amGainL.gain.setValueAtTime(1 - initialDepth / 2, ctx.currentTime);

    amLfoL.connect(amDepthGainL);
    amDepthGainL.connect(amGainL.gain);
    amLfoL.start();

    let midOutput: AudioNode = amGainL;

    if (useStereoSpread) {
      // Organic Stereo Shimmer AM (Headphones only): Right channel uses a +32° phase-shifted LFO
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);

      const amLfoR = ctx.createOscillator();
      amLfoR.setPeriodicWave(createPhaseShiftedSineWave(ctx, 32));
      amLfoR.frequency.setValueAtTime(params.modulationHz, ctx.currentTime);

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
      // Mono-coherent AM on Band 2 (Car speakers / room speakers -> zero cabin phase cancellation)
      midBand.output.connect(amGainL);
      this.amGainR = null;
      this.amLfoR = null;
      this.amDepthGainR = null;
    }

    // Optional Driving Safety EQ (preserves 800–3500 Hz for traffic sirens & horns)
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

    // Studio Hall Convolution Reverb Send -> feeds into musicMixBus so reverb tail joins Multiband AM smoothly
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = this.getGenreReverbLevel(this.genre);
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
    reverbLP.connect(musicMixBus);
    this.reverbSend = reverbSend;

    // Stereo Ping-Pong Delay -> feeds musicMixBus
    const delaySend = ctx.createGain();
    delaySend.gain.value = 0.2;
    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.28;
    delayR.delayTime.value = 0.42;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1350;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.24;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.45;
    panR.pan.value = 0.45;

    delaySend.connect(delayFilter);
    delayFilter.connect(delayL);
    delayFilter.connect(delayR);
    delayL.connect(panL);
    delayR.connect(panR);
    panL.connect(musicMixBus);
    panR.connect(musicMixBus);
    delayR.connect(feedback);
    feedback.connect(delayL);

    // Pad Filter + Slow Breathing LFO
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.setValueAtTime(this.getGenreFilterCutoff(this.genre), ctx.currentTime);
    padFilter.Q.value = this.genre === 'cinematic_strings' ? 1.15 : 0.65;

    const lfoFilter = ctx.createOscillator();
    lfoFilter.type = 'sine';
    lfoFilter.frequency.value = 0.068;
    const lfoFilterGain = ctx.createGain();
    lfoFilterGain.gain.value = Math.min(320, params.filterCutoffHz * 0.18);
    lfoFilter.connect(lfoFilterGain);
    lfoFilterGain.connect(padFilter.frequency);
    lfoFilter.start();
    this.lfoFilter = lfoFilter;

    const padBus = ctx.createGain();
    padBus.gain.value = this.getGenrePadLevel(this.genre);
    padBus.connect(padFilter);
    padFilter.connect(proceduralMaster);
    padFilter.connect(reverbSend);

    this.padBus = padBus;
    this.padFilter = padFilter;

    // Spawn Genre-aware Harmonic Bed
    this.spawnChord(0);
    this.chordTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.params) return;
      this.chordIndex = (this.chordIndex + 1) % 4;
      this.spawnChord(this.chordIndex);
    }, this.genre === 'cinematic_strings' ? 14000 : 16000);

    // Calibrated Stochastic Noise Layer
    if (params.noiseColor !== 'none' && params.noiseLevel > 0.005) {
      const noiseBuf = createColoredNoiseBuffer(ctx, params.noiseColor, 6);
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = params.speakerSafeEQ
        ? 680
        : params.noiseColor === 'brown'
          ? 500
          : 1850;

      const noiseGain = ctx.createGain();
      const safeNoiseCap = params.speakerSafeEQ ? Math.min(0.06, params.noiseLevel) : params.noiseLevel;
      noiseGain.gain.setValueAtTime(safeNoiseCap * 0.48, ctx.currentTime);

      noiseSrc.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(compressor);
      noiseSrc.start();

      this.noiseSource = noiseSrc;
      this.noiseGain = noiseGain;
    }

    // Dedicated Soft Rain Layer (fades in smoothly for Nature & Rain genre)
    const rainBuf = createColoredNoiseBuffer(ctx, 'soft_rain', 6);
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = rainBuf;
    rainSrc.loop = true;
    const rainBand = ctx.createBiquadFilter();
    rainBand.type = 'bandpass';
    rainBand.frequency.value = params.speakerSafeEQ ? 680 : 1250;
    rainBand.Q.value = 0.55;
    const rainGain = ctx.createGain();
    rainGain.gain.setValueAtTime(
      this.genre === 'nature_rain' ? (params.speakerSafeEQ ? 0.065 : 0.24) : 0.0001,
      ctx.currentTime
    );
    rainSrc.connect(rainBand);
    rainBand.connect(rainGain);
    rainGain.connect(compressor);
    rainSrc.start();
    this.rainSource = rainSrc;
    this.rainGain = rainGain;

    // Dedicated Subtle Warm Vinyl Dust Layer (fades in softly for Lo-Fi Warm Keys)
    const vinylBuf = createVinylDustBuffer(ctx, 5);
    const vinylSrc = ctx.createBufferSource();
    vinylSrc.buffer = vinylBuf;
    vinylSrc.loop = true;
    const vinylBP = ctx.createBiquadFilter();
    vinylBP.type = 'bandpass';
    vinylBP.frequency.value = 1800;
    vinylBP.Q.value = 0.8;
    const vinylGain = ctx.createGain();
    vinylGain.gain.setValueAtTime(
      this.genre === 'lofi_keys' && !params.speakerSafeEQ ? 0.14 : 0.0001,
      ctx.currentTime
    );
    vinylSrc.connect(vinylBP);
    vinylBP.connect(vinylGain);
    vinylGain.connect(compressor);
    vinylSrc.start();
    this.vinylSource = vinylSrc;
    this.vinylGain = vinylGain;

    // Subtle Binaural Layer ONLY when headphones & non-driving
    if (!params.speakerSafeEQ && params.binauralOffsetHz > 0) {
      const leftOsc = ctx.createOscillator();
      const rightOsc = ctx.createOscillator();
      leftOsc.type = 'sine';
      rightOsc.type = 'sine';
      leftOsc.frequency.value = params.rootNoteHz * 1.5;
      rightOsc.frequency.value = params.rootNoteHz * 1.5 + params.binauralOffsetHz;

      const panLeft = ctx.createStereoPanner();
      const panRight = ctx.createStereoPanner();
      panLeft.pan.value = -1;
      panRight.pan.value = 1;

      const binGain = ctx.createGain();
      binGain.gain.value = 0.028;

      leftOsc.connect(panLeft);
      rightOsc.connect(panRight);
      panLeft.connect(binGain);
      panRight.connect(binGain);
      binGain.connect(compressor);

      leftOsc.start();
      rightOsc.start();
      this.binauralNodes = [leftOsc, rightOsc, panLeft, panRight, binGain];
    }

    // Melodic & Groove Pulse Bus -> routes into proceduralMaster (joins Multiband AM) + Delay + Reverb
    const pulseBus = ctx.createGain();
    pulseBus.gain.value = this.getGenrePulseLevel(this.genre);
    pulseBus.connect(proceduralMaster);
    pulseBus.connect(delaySend);
    pulseBus.connect(reverbSend);
    this.pulseBus = pulseBus;

    this.nextStepTime = ctx.currentTime + 0.35;
    this.pulseTimer = window.setInterval(() => this.scheduleGenreSteps(), 45);

    this.isPlaying = true;
    this.setupMediaSession(title);
    void this.requestWakeLock();
    void this.activateStudioForGenre(this.genre);
  }

  public setStudioCatalog(catalog: Partial<Record<ResolvedGenre, StudioTrackRef[]>>): void {
    this.studioCatalog = catalog;
    if (this.isPlaying && this.ctx) {
      void this.activateStudioForGenre(this.genre);
    }
  }

  private clearStudioDeck(fadeSec = 1.6): void {
    if (this.studioCrossfadeTimer !== null) {
      window.clearTimeout(this.studioCrossfadeTimer);
      this.studioCrossfadeTimer = null;
    }
    const prevSrc = this.activeStudioSource;
    const prevGain = this.activeStudioGain;
    this.activeStudioSource = null;
    this.activeStudioGain = null;

    if (this.ctx && prevGain && prevSrc) {
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
          prevSrc.stop();
          prevSrc.disconnect();
        } catch {
          // ignore
        }
      }, fadeSec * 1000 + 150);
    } else if (prevSrc) {
      try {
        prevSrc.stop();
        prevSrc.disconnect();
      } catch {
        // ignore
      }
    }
  }

  private async loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      if (!this.ctx) return null;
      const decoded = await this.ctx.decodeAudioData(arr);
      this.bufferCache.set(url, decoded);
      return decoded;
    } catch {
      return null;
    }
  }

  private selectTracksForGenreAndEnergy(genre: ResolvedGenre): StudioTrackRef[] {
    const all = this.studioCatalog[genre] ?? [];
    if (all.length === 0) return [];
    const targetEnergy: EnergyTier = this.params?.energyTier ?? 'focus';

    const exact = all.filter((t) => t.energy === targetEnergy);
    if (exact.length > 0) return exact;

    // Graceful nearest-energy fallback so a missing bucket still plays real studio audio
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

  private async activateStudioForGenre(genre: ResolvedGenre): Promise<void> {
    const token = ++this.studioLoadToken;
    const tracks = this.selectTracksForGenreAndEnergy(genre);

    if (tracks.length === 0 || !this.ctx || !this.studioBus) {
      this.clearStudioDeck(1.5);
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
    const buffer = await this.loadAudioBuffer(track.url);
    if (token !== this.studioLoadToken || !this.ctx || !this.studioBus || !buffer) {
      return;
    }

    this.playStudioBuffer(buffer, track.name, genre, chosenIdx, token);

    // Pre-fetch next track silently in background for seamless zero-gap crossfade
    if (tracks.length > 1) {
      const nextTrack = tracks[(chosenIdx + 1) % tracks.length];
      void this.loadAudioBuffer(nextTrack.url);
    }
  }

  private playStudioBuffer(
    buffer: AudioBuffer,
    trackName: string,
    genre: ResolvedGenre,
    idx: number,
    token: number
  ): void {
    if (!this.ctx || !this.studioBus || token !== this.studioLoadToken) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fadeInSec = 2.6;

    // Smoothly crossfade out previous studio deck (if any) & duck procedural synth
    this.clearStudioDeck(fadeInSec);
    if (this.proceduralMaster && this.cleanSubBus) {
      this.proceduralMaster.gain.setTargetAtTime(0.0001, now, 0.85);
      this.cleanSubBus.gain.setTargetAtTime(0.0001, now, 0.85);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const deckGain = ctx.createGain();
    deckGain.gain.setValueAtTime(0.0001, now);
    deckGain.gain.exponentialRampToValueAtTime(0.96, now + fadeInSec);

    src.connect(deckGain);
    deckGain.connect(this.studioBus);
    src.start(now);

    this.activeStudioSource = src;
    this.activeStudioGain = deckGain;
    this.usingStudioAudio = true;
    this.activeTrackName = trackName;

    // Schedule seamless equal-power crossfade 7 seconds before track ends
    const crossfadeLeadSec = Math.min(7, Math.max(2, buffer.duration * 0.18));
    const waitMs = Math.max(1500, (buffer.duration - crossfadeLeadSec) * 1000);
    this.studioCrossfadeTimer = window.setTimeout(() => {
      if (!this.isPlaying || token !== this.studioLoadToken) return;
      this.studioTrackIdx = idx + 1;
      void this.activateStudioForGenre(genre);
    }, waitMs);
  }

  private getGenreReverbLevel(g: ResolvedGenre): number {
    if (g === 'cinematic_strings') return 0.62;
    if (g === 'nature_rain') return 0.54;
    if (g === 'acoustic_pluck') return 0.42;
    if (g === 'jazz_rhodes') return 0.32;
    if (g === 'lofi_keys') return 0.28;
    return 0.24; // deep_electronic
  }

  private getGenrePadLevel(g: ResolvedGenre): number {
    if (g === 'cinematic_strings') return 0.52;
    if (g === 'nature_rain') return 0.26;
    if (g === 'deep_electronic') return 0.34;
    return 0.38;
  }

  private getGenrePulseLevel(g: ResolvedGenre): number {
    const base = Math.max(0.22, Math.min(1, this.params?.pulseIntensity ?? 0.45));
    if (g === 'cinematic_strings') return 0.24 * this.intensityMultiplier;
    if (g === 'nature_rain') return 0.3 * this.intensityMultiplier;
    if (g === 'deep_electronic') return Math.min(0.88, base * 0.72 * this.intensityMultiplier);
    return Math.min(0.76, base * 0.58 * this.intensityMultiplier);
  }

  private getGenreFilterCutoff(g: ResolvedGenre): number {
    const base = this.params?.filterCutoffHz ?? 1500;
    if (g === 'lofi_keys') return Math.min(base, 1180);
    if (g === 'cinematic_strings') return Math.min(base * 1.05, 1950);
    if (g === 'jazz_rhodes') return Math.min(base, 1380);
    if (g === 'deep_electronic') return Math.min(base * 1.12, 2100);
    return base;
  }

  public setGenre(style: ResolvedGenre): void {
    this.genre = style;
    if (!this.ctx || !this.params) return;
    const now = this.ctx.currentTime;

    this.reverbSend?.gain.setTargetAtTime(this.getGenreReverbLevel(style), now, 0.45);
    this.padBus?.gain.setTargetAtTime(this.getGenrePadLevel(style), now, 0.45);
    this.pulseBus?.gain.setTargetAtTime(this.getGenrePulseLevel(style), now, 0.35);

    if (this.padFilter) {
      this.padFilter.frequency.setTargetAtTime(this.getGenreFilterCutoff(style), now, 0.45);
      this.padFilter.Q.setTargetAtTime(style === 'cinematic_strings' ? 1.15 : 0.65, now, 0.4);
    }

    if (this.rainGain) {
      const targetRain =
        style === 'nature_rain' ? (this.params.speakerSafeEQ ? 0.065 : 0.24) : 0.0001;
      this.rainGain.gain.setTargetAtTime(targetRain, now, 0.6);
    }

    if (this.vinylGain) {
      const targetVinyl =
        style === 'lofi_keys' && !this.params.speakerSafeEQ ? 0.14 : 0.0001;
      this.vinylGain.gain.setTargetAtTime(targetVinyl, now, 0.6);
    }

    // Gently crossfade chord bed into new genre's timbre & activate R2 studio stems if uploaded
    this.spawnChord(this.chordIndex);
    this.studioTrackIdx = 0;
    void this.activateStudioForGenre(style);
  }

  public getGenre(): ResolvedGenre {
    return this.genre;
  }

  private getActiveChord(): number[] {
    if (this.genre === 'jazz_rhodes') {
      return JAZZ_VOICINGS[this.chordIndex % JAZZ_VOICINGS.length];
    }
    const mode = this.params?.harmonicMode ?? 'bright_maj9';
    const prog = CHORD_PROGRESSIONS[mode];
    return prog[this.chordIndex % prog.length];
  }

  private spawnChord(index: number): void {
    if (!this.ctx || !this.padBus || !this.params) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.chordIndex = index;
    const intervals = this.getActiveChord();

    const prevOscs = this.activePadOscs;
    const prevGains = this.activePadGains;
    for (const g of prevGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);
      } catch {
        // ignore
      }
    }
    window.setTimeout(() => {
      for (const osc of prevOscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      }
    }, 4100);

    const nextOscs: OscillatorNode[] = [];
    const nextGains: GainNode[] = [];
    const isStrings = this.genre === 'cinematic_strings';

    intervals.forEach((semi, voiceIdx) => {
      const freq = this.params!.rootNoteHz * semitoneRatio(semi);
      const detunes = voiceIdx === 0 ? [0] : isStrings ? [-7, 0, 7] : [-3.5, 3.5];

      detunes.forEach((detune, dIdx) => {
        const osc = ctx.createOscillator();
        osc.type =
          voiceIdx === 0
            ? 'sine'
            : isStrings
              ? 'sawtooth'
              : dIdx === 0
                ? 'triangle'
                : 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detune, now);

        const gain = ctx.createGain();
        const targetAmp =
          voiceIdx === 0 ? 0.21 : isStrings ? 0.042 : 0.075;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(targetAmp, now + (isStrings ? 5.0 : 3.5));

        const panner = ctx.createStereoPanner();
        panner.pan.value =
          voiceIdx === 0 ? 0 : (voiceIdx % 2 === 0 ? -0.45 : 0.45) * (dIdx % 2 === 0 ? 1 : -0.6);

        osc.connect(gain);
        gain.connect(panner);
        // Root sub-tone goes to cleanSubBus so low-end stays rock-solid & unmodulated!
        if (voiceIdx === 0 && this.cleanSubBus && freq < 185) {
          panner.connect(this.cleanSubBus);
        } else {
          panner.connect(this.padBus!);
        }
        osc.start(now);

        nextOscs.push(osc);
        nextGains.push(gain);
      });
    });

    this.activePadOscs = nextOscs;
    this.activePadGains = nextGains;
  }

  private scheduleGenreSteps(): void {
    if (!this.ctx || !this.pulseBus || !this.params || !this.isPlaying) return;
    const ctx = this.ctx;

    // Genre-calibrated tempo ceiling (honors target BPM while staying faithful to genre feel)
    const rawBpm = this.getEffectiveBpm();
    const effectiveBpm =
      rawBpm > 0
        ? this.genre === 'lofi_keys'
          ? Math.min(rawBpm, 88)
          : this.genre === 'jazz_rhodes'
            ? Math.min(rawBpm, 96)
            : rawBpm
        : this.genre === 'nature_rain' || this.genre === 'cinematic_strings'
          ? 70
          : 0;

    if (effectiveBpm <= 0) return;

    const eighthDur = 60 / effectiveBpm / 2;
    const lookahead = 0.16;

    while (this.nextStepTime < ctx.currentTime + lookahead) {
      const step = this.stepCount % 16;
      // Subtle jazz/lo-fi swing on odd 8th steps
      const swingOffset =
        (this.genre === 'lofi_keys' || this.genre === 'jazz_rhodes') && step % 2 === 1
          ? eighthDur * 0.14
          : 0;
      const t = this.nextStepTime + swingOffset;
      const lift = this.isAntiMonotonyPulseActive() ? 1.24 : 1.0;

      if (this.genre === 'deep_electronic') {
        // Steady 4-on-floor clean sub-kick + rolling bass + muted air hats + hypnotic synth arp
        if (step % 4 === 0) this.triggerCleanSubKick(t, step === 0 ? 0.56 : 0.42);
        if (step % 2 === 1) this.triggerSoftAirTick(t, step % 4 === 3 ? 0.045 : 0.025);
        if (step === 2 || step === 6 || step === 10 || step === 14) {
          this.triggerElectronicArp(t, step, 0.17 * lift);
        }
        if (step === 0 || step === 6 || step === 8 || step === 14) {
          this.triggerCleanBassNote(t, step === 14 ? 7 : 0, 0.24, eighthDur * 1.4);
        }
      } else if (this.genre === 'lofi_keys') {
        // Laid-back boom-bap soft kick + warm muffled brush + Dusty Rhodes chord comping
        if (step === 0 || step === 10) this.triggerCleanSubKick(t, 0.48);
        if (step === 4 || step === 12) this.triggerLoFiBrushSnare(t, 0.11);
        if (step === 0 || step === 6 || step === 12) {
          this.triggerRhodesBellChord(t, step === 0 ? 0.12 : 0.08 * lift);
        }
      } else if (this.genre === 'jazz_rhodes') {
        // Syncopated Jazz Rhodes stabs + walking clean upright bass + soft swung brush ride
        if (step % 2 === 0 || step === 7 || step === 15) {
          this.triggerSoftAirTick(t, step % 4 === 0 ? 0.032 : 0.02);
        }
        if (step % 4 === 0) {
          const walkSemi = [0, 4, 7, 5][(step / 4) % 4];
          this.triggerCleanBassNote(t, walkSemi, 0.22, eighthDur * 1.8);
        }
        if (step === 0 || step === 5 || step === 11) {
          this.triggerRhodesBellChord(t, 0.11 * lift);
        }
      } else if (this.genre === 'acoustic_pluck') {
        // Organic nylon guitar / harp fingerpicked arpeggio pattern
        if (step === 0 || step === 8) this.triggerCleanSubKick(t, 0.22);
        if (step % 2 === 0 || step === 7 || step === 15) {
          this.triggerAcousticPluck(t, step, 0.16 * lift);
        }
      } else if (this.genre === 'cinematic_strings') {
        // Spacious orchestral pulse + occasional resonant bell swell
        if (step === 0) this.triggerCleanSubKick(t, 0.34);
        if (step === 0 || step === 10) {
          this.triggerGlassChime(t, step, 0.11 * lift);
        }
      } else if (this.genre === 'nature_rain') {
        // Gentle floating water/glass chimes inside stereo rain
        if (step === 0 || step === 7 || step === 12) {
          this.triggerGlassChime(t, step, 0.14 * lift);
        }
      }

      this.nextStepTime += eighthDur;
      this.stepCount++;
    }
  }

  private triggerCleanSubKick(time: number, amp: number): void {
    if (!this.ctx || !this.cleanSubBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(94, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.15);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);

    osc.connect(gain);
    gain.connect(this.cleanSubBus);
    osc.start(time);
    osc.stop(time + 0.28);
  }

  private triggerCleanBassNote(time: number, semiOffset: number, amp: number, dur: number): void {
    if (!this.ctx || !this.cleanSubBus || !this.params) return;
    const chord = this.getActiveChord();
    const rootSemi = chord[0] + semiOffset - 12; // one octave below pad root
    const freq = Math.max(48, Math.min(165, this.params.rootNoteHz * semitoneRatio(rootSemi)));

    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = this.genre === 'deep_electronic' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, time);
    lp.type = 'lowpass';
    lp.frequency.value = 180;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.18, dur));

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.cleanSubBus);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  private triggerLoFiBrushSnare(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(110, time + 0.09);
    bp.type = 'bandpass';
    bp.frequency.value = 540;
    bp.Q.value = 0.9;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    osc.connect(bp);
    bp.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  private triggerRhodesBellChord(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const chord = this.getActiveChord().slice(1, 4); // lush upper 3 voices
    chord.forEach((semi, idx) => {
      const freq = this.params!.rootNoteHz * semitoneRatio(semi + 12);
      const osc = this.ctx!.createOscillator();
      const overtone = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const otGain = this.ctx!.createGain();
      const pan = this.ctx!.createStereoPanner();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time + idx * 0.018);
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(freq * 2, time + idx * 0.018); // Rhodes bell shimmer

      gain.gain.setValueAtTime(0.0001, time + idx * 0.018);
      gain.gain.linearRampToValueAtTime(amp, time + idx * 0.018 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.15);

      otGain.gain.setValueAtTime(0.0001, time + idx * 0.018);
      otGain.gain.linearRampToValueAtTime(amp * 0.22, time + idx * 0.018 + 0.01);
      otGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);

      pan.pan.value = (idx - 1) * 0.34;
      osc.connect(gain);
      overtone.connect(otGain);
      otGain.connect(gain);
      gain.connect(pan);
      pan.connect(this.pulseBus!);

      osc.start(time + idx * 0.018);
      overtone.start(time + idx * 0.018);
      osc.stop(time + 1.25);
      overtone.stop(time + 0.35);
    });
  }

  private triggerElectronicArp(time: number, step: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const chord = this.getActiveChord();
    const noteSemi = chord[(step / 2) % chord.length] + 12;
    const freq = this.params.rootNoteHz * semitoneRatio(noteSemi);

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(1900, this.params.filterCutoffHz * 1.15), time);
    filter.frequency.exponentialRampToValueAtTime(340, time + 0.28);
    filter.Q.value = 2.2;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * 0.65 * this.intensityMultiplier, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);

    pan.pan.value = step % 4 === 2 ? -0.35 : 0.35;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.35);
  }

  private triggerAcousticPluck(time: number, step: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const chord = this.getActiveChord();
    const noteSemi = chord[step % chord.length] + 12;
    const freq = this.params.rootNoteHz * semitoneRatio(noteSemi);

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(2200, this.params.filterCutoffHz * 1.2), time);
    filter.frequency.exponentialRampToValueAtTime(480, time + 0.55);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.72);

    pan.pan.value = step % 4 === 0 ? -0.3 : 0.3;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.78);
  }

  private triggerSoftAirTick(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(this.params.speakerSafeEQ ? 640 : 1380, time);
    filter.type = 'bandpass';
    filter.frequency.value = this.params.speakerSafeEQ ? 680 : 2500;
    filter.Q.value = 1.6;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.055);
  }

  private triggerGlassChime(time: number, step: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const chord = this.getActiveChord();
    const noteSemi = chord[(step + this.chordIndex) % chord.length] + 12;
    const freq = this.params.rootNoteHz * semitoneRatio(noteSemi);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.65);

    pan.pan.value = step % 2 === 0 ? -0.4 : 0.4;
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 1.75);
  }

  private isAntiMonotonyPulseActive(): boolean {
    if (!this.params || this.params.antiMonotonyCycleMin <= 0) return false;
    const cycleSec = this.params.antiMonotonyCycleMin * 60;
    const pos = this.elapsedSec % cycleSec;
    return pos > cycleSec - 25;
  }

  private getEffectiveBpm(): number {
    if (!this.params || this.params.bpm <= 0) return 0;
    const ratio = Math.min(1, this.elapsedSec / this.plannedSec);
    let factor = 1.0;
    if (ratio < 0.15) factor = 0.94 + (ratio / 0.15) * 0.06;
    else if (ratio > 0.88) factor = 1.0 - ((ratio - 0.88) / 0.12) * 0.07;
    return Math.round(this.params.bpm * factor);
  }

  public updateElapsed(elapsedSec: number): EngineTelemetry {
    this.elapsedSec = elapsedSec;
    const progressRatio = Math.min(1, Math.max(0, elapsedSec / this.plannedSec));
    let phase: SessionPhase = 'plateau';
    let phaseLabel = 'Cognitive Performance Plateau';
    let phaseModFactor = 1.0;

    // Iso-Adaptive Organic Curve: starts silky (~48% of target depth -> ~12%) so music hooks you immediately,
    // ramps smoothly into Peak cortical entrainment (100%), then eases gently in Landing.
    if (progressRatio < 0.15) {
      phase = 'entry';
      phaseLabel = 'Entry & Alignment (Iso-Adaptive)';
      phaseModFactor = 0.48 + (progressRatio / 0.15) * 0.52;
    } else if (progressRatio > 0.88) {
      phase = 'landing';
      phaseLabel = 'Gentle Landing';
      phaseModFactor = 1.0 - ((progressRatio - 0.88) / 0.12) * 0.5;
    }

    const antiMonotonyActive = this.isAntiMonotonyPulseActive();
    const baseDepth = this.params?.modulationDepth ?? 0.24;
    const nominalDepth = Math.min(0.42, Math.max(0, baseDepth * this.modDepthMultiplier * phaseModFactor));
    const effectiveDepth = this.isControlTrial ? 0 : nominalDepth;

    if (this.ctx && this.amGainL && this.amDepthGainL && this.padFilter && this.params) {
      const now = this.ctx.currentTime;
      this.amGainL.gain.setTargetAtTime(1 - effectiveDepth / 2, now, 0.35);
      this.amDepthGainL.gain.setTargetAtTime(effectiveDepth / 2, now, 0.35);

      if (this.amGainR && this.amDepthGainR) {
        this.amGainR.gain.setTargetAtTime(1 - effectiveDepth / 2, now, 0.35);
        this.amDepthGainR.gain.setTargetAtTime(effectiveDepth / 2, now, 0.35);
      }

      const targetCutoff =
        this.getGenreFilterCutoff(this.genre) *
        (0.86 + 0.24 * this.intensityMultiplier) *
        (antiMonotonyActive ? 1.15 : 1.0);
      this.padFilter.frequency.setTargetAtTime(
        Math.min(2500, Math.max(440, targetCutoff)),
        now,
        0.6
      );
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

    return {
      phase,
      phaseLabel,
      progressRatio,
      currentModHz: this.params?.modulationHz ?? 16,
      currentModDepth: Number(nominalDepth.toFixed(2)),
      crossoverHz: this.params?.crossoverHz ?? 190,
      upperCrossoverHz: this.params?.upperCrossoverHz ?? 4500,
      stereoAmActive: Boolean(this.amGainR),
      energyTier: this.params?.energyTier ?? 'focus',
      currentBpm: this.getEffectiveBpm(),
      antiMonotonyActive,
      genre: this.genre,
      backgroundAudioActive: this.backgroundAudioActive,
      usingStudioAudio: this.usingStudioAudio,
      activeTrackName: this.activeTrackName,
    };
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.volume * 0.82), this.ctx.currentTime, 0.12);
    }
  }

  public adjustIntensity(multiplier: number): void {
    this.intensityMultiplier = Math.max(0.45, Math.min(1.55, multiplier));
    if (this.ctx && this.pulseBus) {
      this.pulseBus.gain.setTargetAtTime(this.getGenrePulseLevel(this.genre), this.ctx.currentTime, 0.2);
    }
    if (this.ctx && this.noiseGain && this.params && !this.params.speakerSafeEQ) {
      const targetNoise = Math.max(
        0.01,
        Math.min(0.35, this.params.noiseLevel * 0.52 * this.intensityMultiplier)
      );
      this.noiseGain.gain.setTargetAtTime(targetNoise, this.ctx.currentTime, 0.25);
    }
  }

  public adjustModDepth(multiplier: number): void {
    this.modDepthMultiplier = Math.max(0.0, Math.min(1.65, multiplier));
    if (this.isPlaying) {
      this.updateElapsed(this.elapsedSec);
    }
  }

  public async pause(): Promise<void> {
    if (!this.ctx || !this.isPlaying) return;
    this.isPlaying = false;
    this.audioEl?.pause();
    await this.ctx.suspend();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    void this.releaseWakeLock();
  }

  public async resume(): Promise<void> {
    if (!this.ctx || this.isPlaying) return;
    await this.ctx.resume();
    await this.audioEl?.play().catch(() => {});
    this.isPlaying = true;
    this.nextStepTime = this.ctx.currentTime + 0.1;
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
        this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      } catch {
        // ignore
      }
      const ctxRef = this.ctx;
      const audioElRef = this.audioEl;
      this.isPlaying = false;
      this.clearTimers();
      window.setTimeout(() => {
        audioElRef?.pause();
        if (audioElRef) audioElRef.srcObject = null;
        ctxRef.close().catch(() => {});
      }, 650);
      this.ctx = null;
      this.audioEl = null;
      this.analyser = null;
      return;
    }
    this.stopImmediate();
  }

  private clearTimers(): void {
    if (this.chordTimer !== null) {
      window.clearInterval(this.chordTimer);
      this.chordTimer = null;
    }
    if (this.pulseTimer !== null) {
      window.clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
    if (this.studioCrossfadeTimer !== null) {
      window.clearTimeout(this.studioCrossfadeTimer);
      this.studioCrossfadeTimer = null;
    }
  }

  private stopImmediate(): void {
    this.isPlaying = false;
    this.studioLoadToken++;
    this.usingStudioAudio = false;
    this.activeTrackName = null;
    this.clearStudioDeck(0.1);
    this.clearTimers();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    void this.releaseWakeLock();
    try {
      this.amLfoL?.stop();
      this.amLfoR?.stop();
      this.lfoFilter?.stop();
      this.noiseSource?.stop();
      this.rainSource?.stop();
      this.vinylSource?.stop();
      for (const osc of this.activePadOscs) osc.stop();
      for (const node of this.binauralNodes) {
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
      }
    } catch {
      // ignore
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    this.activePadOscs = [];
    this.activePadGains = [];
    this.binauralNodes = [];
    this.amGainL = null;
    this.amGainR = null;
    this.amLfoL = null;
    this.amLfoR = null;
    this.amDepthGainL = null;
    this.amDepthGainR = null;
    this.noiseGain = null;
    this.rainGain = null;
    this.vinylGain = null;
    this.reverbSend = null;
    this.cleanSubBus = null;
    this.proceduralMaster = null;
    this.studioBus = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
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
          artist: 'nootropic.fm · Open Research Beta',
          album: 'Psychoacoustic Cognitive Formula',
        });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('play', () => {
          void this.resume();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          void this.pause();
        });
        navigator.mediaSession.setActionHandler('stop', () => {
          this.stop();
        });
      } catch {
        // ignore
      }
    }
  }
}
