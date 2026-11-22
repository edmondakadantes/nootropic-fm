import type {
  AcousticParams,
  AtmosphereStyle,
  HarmonicMode,
  NoiseColor,
} from '../../shared/types';

export type SessionPhase = 'entry' | 'plateau' | 'landing';

export interface EngineTelemetry {
  phase: SessionPhase;
  phaseLabel: string;
  progressRatio: number;
  currentModHz: number;
  currentModDepth: number;
  currentBpm: number;
  antiMonotonyActive: boolean;
  atmosphere: AtmosphereStyle;
  backgroundAudioActive: boolean;
}

export const ATMOSPHERE_META: Record<
  AtmosphereStyle,
  { label: string; shortDesc: string }
> = {
  warm_horizon: { label: 'Warm Horizon', shortDesc: 'Lush Rhodes pads & warm marimba' },
  kinetic_drive: { label: 'Kinetic Drive', shortDesc: 'Crisp sub-pulse & subtle groove' },
  rain_sanctuary: { label: 'Rain Sanctuary', shortDesc: 'Soft rain & floating glass chimes' },
  deep_cosmos: { label: 'Deep Cosmos', shortDesc: 'Analog space drone & deep hall' },
};

// Musical intervals in semitones above root note for warm, studio-like voicings
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

function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Generates a warm, diffused 2.4-second Stereo Studio Hall Impulse Response
 * so synthesized pads, plucks, and chimes sound spatial and musical.
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
      // Smooth attack pre-delay envelope + natural exponential hall decay
      const env = Math.min(1, i / (rate * 0.025)) * Math.pow(1 - t, 2.75);
      const white = Math.random() * 2 - 1;
      // Progressive high-frequency damping (warm dark hall tail)
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
 * Studio-Grade Procedural Psychoacoustic Engine (Web Audio API).
 * Features:
 * - Procedural Stereo Convolution Hall Reverb
 * - 4 Live-Switchable Atmospheres (zero dropout)
 * - Exact AM Neural Entrainment + Driving Safety EQ
 * - Mobile Lock-Screen / Car Bluetooth Audio Bridge (MediaStream -> <audio> + MediaSession)
 * - Optional Screen Wake Lock during active sessions
 */
export class PsychoacousticEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private padBus: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private amGain: GainNode | null = null;
  private amLfo: OscillatorNode | null = null;
  private amDepthGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private pulseBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private binauralNodes: AudioNode[] = [];
  private activePadOscs: OscillatorNode[] = [];
  private activePadGains: GainNode[] = [];
  private lfoFilter: OscillatorNode | null = null;

  // Mobile background & lock-screen playback bridge
  private audioEl: HTMLAudioElement | null = null;
  private backgroundAudioActive = false;
  private wakeLock: { release: () => Promise<void> } | null = null;

  private params: AcousticParams | null = null;
  private atmosphere: AtmosphereStyle = 'warm_horizon';
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
    initialAtmosphere?: AtmosphereStyle
  ): Promise<void> {
    this.stopImmediate();
    this.params = { ...params };
    this.plannedSec = Math.max(60, plannedDurationMin * 60);
    this.elapsedSec = 0;
    this.chordIndex = 0;
    this.stepCount = 0;
    this.intensityMultiplier = 1.0;
    this.modDepthMultiplier = 1.0;

    this.atmosphere =
      initialAtmosphere ??
      (params.bpm === 0
        ? 'deep_cosmos'
        : params.noiseColor === 'soft_rain'
          ? 'rain_sanctuary'
          : params.pulseIntensity >= 0.5
            ? 'kinetic_drive'
            : 'warm_horizon');

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.ctx = ctx;

    // Master Chain: Compressor -> MasterGain -> Analyser -> (MediaStream Audio Bridge OR Destination)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 20;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.018;
    compressor.release.value = 0.25;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(Math.max(0.05, this.volume * 0.8), ctx.currentTime + 2.0);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    compressor.connect(masterGain);
    masterGain.connect(analyser);

    // Bridge output through an HTMLAudioElement MediaStream for lock-screen / Car Bluetooth resilience
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

    // Lush Stereo Studio Hall Convolution Reverb Send
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = this.atmosphere === 'deep_cosmos' ? 0.52 : 0.34;
    const convolver = ctx.createConvolver();
    convolver.buffer = createStudioReverbIR(ctx, 2.4);
    const reverbHP = ctx.createBiquadFilter();
    reverbHP.type = 'highpass';
    reverbHP.frequency.value = 180;
    const reverbLP = ctx.createBiquadFilter();
    reverbLP.type = 'lowpass';
    reverbLP.frequency.value = params.speakerSafeEQ ? 1400 : 2800;

    reverbSend.connect(convolver);
    convolver.connect(reverbHP);
    reverbHP.connect(reverbLP);
    reverbLP.connect(compressor);
    this.reverbSend = reverbSend;

    // Subtle Stereo Echo for spacious rhythmic depth
    const delaySend = ctx.createGain();
    delaySend.gain.value = 0.18;
    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.28;
    delayR.delayTime.value = 0.42;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1250;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.24;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.48;
    panR.pan.value = 0.48;

    delaySend.connect(delayFilter);
    delayFilter.connect(delayL);
    delayFilter.connect(delayR);
    delayL.connect(panL);
    delayR.connect(panR);
    panL.connect(compressor);
    panR.connect(compressor);
    delayR.connect(feedback);
    feedback.connect(delayL);

    // Scientific Amplitude Modulation (AM) Stage
    const amGain = ctx.createGain();
    const effDepth = Math.min(0.48, Math.max(0, params.modulationDepth * this.modDepthMultiplier));
    amGain.gain.setValueAtTime(1 - effDepth / 2, ctx.currentTime);

    const amLfo = ctx.createOscillator();
    amLfo.type = 'sine';
    amLfo.frequency.setValueAtTime(params.modulationHz, ctx.currentTime);

    const amDepthGain = ctx.createGain();
    amDepthGain.gain.setValueAtTime(effDepth / 2, ctx.currentTime);

    amLfo.connect(amDepthGain);
    amDepthGain.connect(amGain.gain);
    amLfo.start();
    amGain.connect(compressor);

    this.amGain = amGain;
    this.amLfo = amLfo;
    this.amDepthGain = amDepthGain;

    // Pad Filter + Slow Breathing LFO
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.setValueAtTime(params.filterCutoffHz, ctx.currentTime);
    padFilter.Q.value = 0.65;

    const lfoFilter = ctx.createOscillator();
    lfoFilter.type = 'sine';
    lfoFilter.frequency.value = 0.072;
    const lfoFilterGain = ctx.createGain();
    lfoFilterGain.gain.value = Math.min(280, params.filterCutoffHz * 0.17);
    lfoFilter.connect(lfoFilterGain);
    lfoFilterGain.connect(padFilter.frequency);
    lfoFilter.start();
    this.lfoFilter = lfoFilter;

    // Driving Safety EQ (preserves 800-3500 Hz for sirens/horns)
    const padBus = ctx.createGain();
    padBus.gain.value = 0.42;

    if (params.speakerSafeEQ) {
      const safetyNotch = ctx.createBiquadFilter();
      safetyNotch.type = 'peaking';
      safetyNotch.frequency.value = 1850;
      safetyNotch.Q.value = 0.75;
      safetyNotch.gain.value = -5.5;
      padBus.connect(padFilter);
      padFilter.connect(safetyNotch);
      safetyNotch.connect(amGain);
      safetyNotch.connect(reverbSend);
    } else {
      padBus.connect(padFilter);
      padFilter.connect(amGain);
      padFilter.connect(reverbSend);
    }

    this.padBus = padBus;
    this.padFilter = padFilter;

    // Start Warm Harmonic Pad Layer
    this.spawnChord(0);
    this.chordTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.params) return;
      const prog = CHORD_PROGRESSIONS[this.params.harmonicMode];
      this.chordIndex = (this.chordIndex + 1) % prog.length;
      this.spawnChord(this.chordIndex);
    }, params.harmonicMode === 'deep_drone' ? 28000 : 18000);

    // Calibrated Colored Noise Layer
    if (params.noiseColor !== 'none' && params.noiseLevel > 0.005) {
      const noiseBuf = createColoredNoiseBuffer(ctx, params.noiseColor, 6);
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = params.speakerSafeEQ
        ? 700
        : params.noiseColor === 'brown'
          ? 520
          : 1850;

      const noiseGain = ctx.createGain();
      const safeNoiseCap = params.speakerSafeEQ ? Math.min(0.065, params.noiseLevel) : params.noiseLevel;
      noiseGain.gain.setValueAtTime(safeNoiseCap * 0.5, ctx.currentTime);

      noiseSrc.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(compressor);
      noiseSrc.start();

      this.noiseSource = noiseSrc;
      this.noiseGain = noiseGain;
    }

    // Dedicated Live-Switchable Rain Texture Bed (fades smoothly in when 'rain_sanctuary' selected)
    const rainBuf = createColoredNoiseBuffer(ctx, 'soft_rain', 6);
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = rainBuf;
    rainSrc.loop = true;
    const rainBand = ctx.createBiquadFilter();
    rainBand.type = 'bandpass';
    rainBand.frequency.value = params.speakerSafeEQ ? 680 : 1250;
    rainBand.Q.value = 0.55;
    const rainGain = ctx.createGain();
    const initialRainLevel =
      this.atmosphere === 'rain_sanctuary' ? (params.speakerSafeEQ ? 0.06 : 0.22) : 0.0001;
    rainGain.gain.setValueAtTime(initialRainLevel, ctx.currentTime);
    rainSrc.connect(rainBand);
    rainBand.connect(rainGain);
    rainGain.connect(compressor);
    rainSrc.start();
    this.rainSource = rainSrc;
    this.rainGain = rainGain;

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
      binGain.gain.value = 0.03;

      leftOsc.connect(panLeft);
      rightOsc.connect(panRight);
      panLeft.connect(binGain);
      panRight.connect(binGain);
      binGain.connect(compressor);

      leftOsc.start();
      rightOsc.start();
      this.binauralNodes = [leftOsc, rightOsc, panLeft, panRight, binGain];
    }

    // Soft Percussive, Marimba, Hat & Chime Bus
    const pulseBus = ctx.createGain();
    pulseBus.gain.value = this.getAtmospherePulseGain();
    pulseBus.connect(amGain);
    pulseBus.connect(delaySend);
    pulseBus.connect(reverbSend);
    this.pulseBus = pulseBus;

    this.nextStepTime = ctx.currentTime + 0.35;
    this.pulseTimer = window.setInterval(() => this.schedulePulseSteps(), 50);

    this.isPlaying = true;
    this.setupMediaSession(title);
    void this.requestWakeLock();
  }

  private getAtmospherePulseGain(): number {
    if (!this.params) return 0.3;
    const base = Math.max(0.18, Math.min(1, this.params.pulseIntensity));
    if (this.atmosphere === 'deep_cosmos') return 0.14 * this.intensityMultiplier;
    if (this.atmosphere === 'rain_sanctuary') return 0.28 * this.intensityMultiplier;
    if (this.atmosphere === 'kinetic_drive') return Math.min(0.85, base * 0.68 * this.intensityMultiplier);
    return Math.min(0.75, base * 0.52 * this.intensityMultiplier);
  }

  public setAtmosphere(style: AtmosphereStyle): void {
    this.atmosphere = style;
    if (!this.ctx || !this.params) return;
    const now = this.ctx.currentTime;

    if (this.reverbSend) {
      const targetRev =
        style === 'deep_cosmos' ? 0.58 : style === 'rain_sanctuary' ? 0.48 : style === 'warm_horizon' ? 0.36 : 0.22;
      this.reverbSend.gain.setTargetAtTime(targetRev, now, 0.5);
    }

    if (this.rainGain) {
      const targetRain =
        style === 'rain_sanctuary' ? (this.params.speakerSafeEQ ? 0.065 : 0.22) : 0.0001;
      this.rainGain.gain.setTargetAtTime(targetRain, now, 0.7);
    }

    if (this.pulseBus) {
      this.pulseBus.gain.setTargetAtTime(this.getAtmospherePulseGain(), now, 0.4);
    }

    if (this.padFilter) {
      const mult = style === 'deep_cosmos' ? 0.68 : style === 'kinetic_drive' ? 1.12 : 0.95;
      this.padFilter.frequency.setTargetAtTime(
        Math.min(2500, Math.max(460, this.params.filterCutoffHz * mult)),
        now,
        0.5
      );
    }
  }

  public getAtmosphere(): AtmosphereStyle {
    return this.atmosphere;
  }

  private spawnChord(index: number): void {
    if (!this.ctx || !this.padBus || !this.params) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const prog = CHORD_PROGRESSIONS[this.params.harmonicMode];
    const intervals = prog[index % prog.length];

    const prevOscs = this.activePadOscs;
    const prevGains = this.activePadGains;
    for (const g of prevGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);
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
    }, 4800);

    const nextOscs: OscillatorNode[] = [];
    const nextGains: GainNode[] = [];

    intervals.forEach((semi, voiceIdx) => {
      const freq = this.params!.rootNoteHz * semitoneRatio(semi);
      const detunes = voiceIdx === 0 ? [0] : [-4, 4];
      detunes.forEach((detune, dIdx) => {
        const osc = ctx.createOscillator();
        osc.type = voiceIdx === 0 ? 'sine' : dIdx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detune, now);

        const gain = ctx.createGain();
        const targetAmp = voiceIdx === 0 ? 0.22 : 0.082;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(targetAmp, now + 4.2);

        const panner = ctx.createStereoPanner();
        panner.pan.value =
          voiceIdx === 0 ? 0 : (voiceIdx % 2 === 0 ? -0.38 : 0.38) * (dIdx === 0 ? 1 : -0.6);

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.padBus!);
        osc.start(now);

        nextOscs.push(osc);
        nextGains.push(gain);
      });
    });

    this.activePadOscs = nextOscs;
    this.activePadGains = nextGains;
  }

  private schedulePulseSteps(): void {
    if (!this.ctx || !this.pulseBus || !this.params || !this.isPlaying) return;
    const ctx = this.ctx;
    const effectiveBpm = this.getEffectiveBpm() || (this.atmosphere === 'rain_sanctuary' ? 72 : 0);
    if (effectiveBpm <= 0) return;

    const eighthDur = 60 / effectiveBpm / 2;
    const lookahead = 0.16;

    while (this.nextStepTime < ctx.currentTime + lookahead) {
      const step = this.stepCount % 16;
      const t = this.nextStepTime;
      const antiMonotonyBoost = this.isAntiMonotonyPulseActive() ? 1.25 : 1.0;

      if (this.atmosphere === 'rain_sanctuary') {
        // Sparse floating glass chimes
        if (step === 0 || step === 7 || step === 12) {
          this.triggerGlassChime(t, step, 0.15 * antiMonotonyBoost);
        }
      } else if (this.atmosphere === 'deep_cosmos') {
        // Very slow resonant bell harmonic on bar start
        if (step === 0 && this.stepCount % 32 === 0) {
          this.triggerGlassChime(t, step, 0.12);
        }
      } else {
        // Warm Horizon & Kinetic Drive
        const isKinetic = this.atmosphere === 'kinetic_drive';
        if (step === 0 || step === 8 || (isKinetic && (step === 4 || step === 12))) {
          this.triggerSoftKick(t, step === 0 ? 0.52 : isKinetic ? 0.38 : 0.32);
        }
        if (isKinetic && step % 2 === 1) {
          this.triggerSoftAirTick(t, step % 4 === 3 ? 0.045 : 0.025);
        }
        if (step === 2 || step === 6 || step === 10 || step === 14) {
          const shouldPlay = isKinetic || step === 6 || step === 14 || this.params.pulseIntensity > 0.42;
          if (shouldPlay) {
            this.triggerWarmPluck(t, step, 0.16 * antiMonotonyBoost);
          }
        }
      }

      this.nextStepTime += eighthDur;
      this.stepCount++;
    }
  }

  private triggerSoftKick(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.14);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

    osc.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.26);
  }

  private triggerSoftAirTick(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    // Ultra-delicate filtered pulse shimmer for Kinetic Drive (kept gentle in Driving Safety Mode)
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(this.params.speakerSafeEQ ? 640 : 1280, time);
    filter.type = 'bandpass';
    filter.frequency.value = this.params.speakerSafeEQ ? 680 : 2400;
    filter.Q.value = 1.8;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.055);
  }

  private triggerWarmPluck(time: number, step: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const prog = CHORD_PROGRESSIONS[this.params.harmonicMode];
    const chord = prog[this.chordIndex % prog.length];
    const noteSemi = chord[(step / 2) % chord.length] + 12;
    const freq = this.params.rootNoteHz * semitoneRatio(noteSemi);

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(1800, this.params.filterCutoffHz * 1.12), time);
    filter.frequency.exponentialRampToValueAtTime(420, time + 0.34);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);

    pan.pan.value = step % 4 === 2 ? -0.32 : 0.32;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);

    osc.start(time);
    osc.stop(time + 0.4);
  }

  private triggerGlassChime(time: number, step: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const prog = CHORD_PROGRESSIONS[this.params.harmonicMode];
    const chord = prog[this.chordIndex % prog.length];
    const noteSemi = chord[(step + this.chordIndex) % chord.length] + 12;
    const freq = this.params.rootNoteHz * semitoneRatio(noteSemi);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.6);

    pan.pan.value = step % 2 === 0 ? -0.4 : 0.4;
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 1.7);
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

    if (progressRatio < 0.15) {
      phase = 'entry';
      phaseLabel = 'Entry & Alignment (Iso-Principle)';
      phaseModFactor = 0.72 + (progressRatio / 0.15) * 0.28;
    } else if (progressRatio > 0.88) {
      phase = 'landing';
      phaseLabel = 'Gentle Landing';
      phaseModFactor = 1.0 - ((progressRatio - 0.88) / 0.12) * 0.4;
    }

    const antiMonotonyActive = this.isAntiMonotonyPulseActive();
    const baseDepth = this.params?.modulationDepth ?? 0.25;
    const currentModDepth = Math.min(0.48, baseDepth * this.modDepthMultiplier * phaseModFactor);

    if (this.ctx && this.amGain && this.amDepthGain && this.padFilter && this.params) {
      const now = this.ctx.currentTime;
      this.amGain.gain.setTargetAtTime(1 - currentModDepth / 2, now, 0.3);
      this.amDepthGain.gain.setTargetAtTime(currentModDepth / 2, now, 0.3);

      const atmMult = this.atmosphere === 'deep_cosmos' ? 0.72 : 1.0;
      const targetCutoff =
        this.params.filterCutoffHz *
        atmMult *
        (0.85 + 0.25 * this.intensityMultiplier) *
        (antiMonotonyActive ? 1.15 : 1.0);
      this.padFilter.frequency.setTargetAtTime(
        Math.min(2600, Math.max(420, targetCutoff)),
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
      currentModDepth: Number(currentModDepth.toFixed(2)),
      currentBpm: this.getEffectiveBpm(),
      antiMonotonyActive,
      atmosphere: this.atmosphere,
      backgroundAudioActive: this.backgroundAudioActive,
    };
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.volume * 0.8), this.ctx.currentTime, 0.12);
    }
  }

  public adjustIntensity(multiplier: number): void {
    this.intensityMultiplier = Math.max(0.45, Math.min(1.55, multiplier));
    if (this.ctx && this.pulseBus) {
      this.pulseBus.gain.setTargetAtTime(this.getAtmospherePulseGain(), this.ctx.currentTime, 0.2);
    }
    if (this.ctx && this.noiseGain && this.params && !this.params.speakerSafeEQ) {
      const targetNoise = Math.max(
        0.01,
        Math.min(0.35, this.params.noiseLevel * 0.55 * this.intensityMultiplier)
      );
      this.noiseGain.gain.setTargetAtTime(targetNoise, this.ctx.currentTime, 0.25);
    }
  }

  public adjustModDepth(multiplier: number): void {
    this.modDepthMultiplier = Math.max(0.25, Math.min(1.6, multiplier));
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
  }

  private stopImmediate(): void {
    this.isPlaying = false;
    this.clearTimers();
    void this.releaseWakeLock();
    try {
      this.amLfo?.stop();
      this.lfoFilter?.stop();
      this.noiseSource?.stop();
      this.rainSource?.stop();
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
    this.noiseGain = null;
    this.rainGain = null;
    this.reverbSend = null;
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
      // Optional enhancement; ignore when unsupported or tab hidden
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
          album: 'Psychoacoustic Cognitive Protocol',
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
        // Ignore on unsupported browsers
      }
    }
  }
}
