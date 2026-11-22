import type { AcousticParams, HarmonicMode, NoiseColor } from '../../shared/types';

export type SessionPhase = 'entry' | 'plateau' | 'landing';

export interface EngineTelemetry {
  phase: SessionPhase;
  phaseLabelRo: string;
  progressRatio: number;
  currentModHz: number;
  currentModDepth: number;
  currentBpm: number;
  antiMonotonyActive: boolean;
}

// Musical intervals in semitones above root note for warm, studio-like voicings
const CHORD_PROGRESSIONS: Record<HarmonicMode, number[][]> = {
  bright_maj9: [
    [0, 7, 11, 14, 16], // Maj9 open
    [5, 12, 16, 19, 21], // IV Maj9
    [9, 12, 16, 19, 23], // vi9
    [7, 12, 14, 19, 21], // Vsus4(9)
  ],
  warm_min9: [
    [0, 7, 10, 14, 15], // m9
    [8, 12, 15, 19, 22], // bVI Maj9
    [5, 10, 12, 17, 19], // iv9
    [7, 10, 14, 17, 19], // v7
  ],
  suspended_open: [
    [0, 7, 14, 19, 24], // sus2 wide
    [5, 12, 17, 19, 24], // IV sus2
    [9, 14, 16, 21, 23], // vi11
    [7, 14, 19, 21, 26], // V add9
  ],
  deep_drone: [
    [0, 7, 12, 14], // warm fifth + ninth
    [0, 5, 12, 17], // soft fourth drift
    [0, 7, 12, 19], // open octave
  ],
};

function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
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
        // Paul Kellet pink noise filter
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
        out[i] = color === 'soft_rain' ? pink * (0.75 + 0.25 * Math.sin(i / 22000)) : pink;
      }
    }

    // Seamless crossfade loop ends (first/last 2048 samples)
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
 * Procedural Studio-Grade Psychoacoustic Engine built natively on Web Audio API.
 * Zero server cost, instant startup, mathematically exact AM entrainment,
 * driving-safe EQ protection, and real-time analyzer telemetry.
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
  private pulseBus: GainNode | null = null;
  private binauralNodes: AudioNode[] = [];
  private activePadOscs: OscillatorNode[] = [];
  private activePadGains: GainNode[] = [];
  private lfoFilter: OscillatorNode | null = null;

  private params: AcousticParams | null = null;
  private isPlaying = false;
  private volume = 0.72;
  private intensityMultiplier = 1.0;
  private modDepthMultiplier = 1.0;

  private chordIndex = 0;
  private chordTimer: number | null = null;
  private pulseTimer: number | null = null;
  private nextStepTime = 0;
  private stepCount = 0;
  private elapsedSec = 0;
  private plannedSec = 2400;

  public async start(params: AcousticParams, plannedDurationMin: number, title = 'nootropic.fm'): Promise<void> {
    this.stopImmediate();
    this.params = { ...params };
    this.plannedSec = Math.max(60, plannedDurationMin * 60);
    this.elapsedSec = 0;
    this.chordIndex = 0;
    this.stepCount = 0;
    this.intensityMultiplier = 1.0;
    this.modDepthMultiplier = 1.0;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.ctx = ctx;

    // Master Chain: Compressor -> MasterGain -> Analyser -> Destination
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.25;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(Math.max(0.05, this.volume * 0.78), ctx.currentTime + 2.2);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    compressor.connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);

    this.masterGain = masterGain;
    this.analyser = analyser;

    // Warm Stereo Ping-Pong Delay for lush studio spaciousness
    const delaySend = ctx.createGain();
    delaySend.gain.value = 0.24;
    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.28;
    delayR.delayTime.value = 0.42;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1300;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.26;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.45;
    panR.pan.value = 0.45;

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
    // gain(t) = baseLevel + amDepthGain * sin(2π * modulationHz * t)
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
    padFilter.Q.value = 0.7;

    const lfoFilter = ctx.createOscillator();
    lfoFilter.type = 'sine';
    lfoFilter.frequency.value = 0.075; // ~13 sec calm breath
    const lfoFilterGain = ctx.createGain();
    lfoFilterGain.gain.value = Math.min(260, params.filterCutoffHz * 0.16);
    lfoFilter.connect(lfoFilterGain);
    lfoFilterGain.connect(padFilter.frequency);
    lfoFilter.start();
    this.lfoFilter = lfoFilter;

    // Optional Driving Safety EQ (preserves 800-3500 Hz for sirens/horns)
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
      safetyNotch.connect(delaySend);
    } else {
      padBus.connect(padFilter);
      padFilter.connect(amGain);
      padFilter.connect(delaySend);
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
        ? 720
        : params.noiseColor === 'brown'
          ? 520
          : 1900;

      const noiseGain = ctx.createGain();
      const safeNoiseCap = params.speakerSafeEQ ? Math.min(0.07, params.noiseLevel) : params.noiseLevel;
      noiseGain.gain.setValueAtTime(safeNoiseCap * 0.55, ctx.currentTime);

      noiseSrc.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(compressor);
      noiseSrc.start();

      this.noiseSource = noiseSrc;
      this.noiseGain = noiseGain;
    }

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
      binGain.gain.value = 0.032; // ultra-subtle under harmonic pad

      leftOsc.connect(panLeft);
      rightOsc.connect(panRight);
      panLeft.connect(binGain);
      panRight.connect(binGain);
      binGain.connect(compressor);

      leftOsc.start();
      rightOsc.start();
      this.binauralNodes = [leftOsc, rightOsc, panLeft, panRight, binGain];
    }

    // Soft Percussive & Marimba Pluck Bus
    const pulseBus = ctx.createGain();
    pulseBus.gain.value = Math.max(0, Math.min(1, params.pulseIntensity)) * 0.52;
    pulseBus.connect(amGain);
    pulseBus.connect(delaySend);
    this.pulseBus = pulseBus;

    if (params.bpm > 0 && params.pulseIntensity > 0.04) {
      this.nextStepTime = ctx.currentTime + 0.4;
      this.pulseTimer = window.setInterval(() => this.schedulePulseSteps(), 50);
    }

    this.isPlaying = true;
    this.setupMediaSession(title);
  }

  private spawnChord(index: number): void {
    if (!this.ctx || !this.padBus || !this.params) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const prog = CHORD_PROGRESSIONS[this.params.harmonicMode];
    const intervals = prog[index % prog.length];

    // Fade out previous chord gently over 4.5s
    const prevOscs = this.activePadOscs;
    const prevGains = this.activePadGains;
    for (const g of prevGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);
      } catch {
        // Ignore if already stopped
      }
    }
    window.setTimeout(() => {
      for (const osc of prevOscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // Ignore
        }
      }
    }, 4800);

    const nextOscs: OscillatorNode[] = [];
    const nextGains: GainNode[] = [];

    intervals.forEach((semi, voiceIdx) => {
      const freq = this.params!.rootNoteHz * semitoneRatio(semi);
      // Pair of slightly detuned oscillators for lush analog chorus feel
      const detunes = voiceIdx === 0 ? [0] : [-3.5, 3.5];
      detunes.forEach((detune, dIdx) => {
        const osc = ctx.createOscillator();
        osc.type = voiceIdx === 0 ? 'sine' : dIdx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detune, now);

        const gain = ctx.createGain();
        const targetAmp = voiceIdx === 0 ? 0.22 : 0.085;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(targetAmp, now + 4.2);

        const panner = ctx.createStereoPanner();
        panner.pan.value = voiceIdx === 0 ? 0 : (voiceIdx % 2 === 0 ? -0.35 : 0.35) * (dIdx === 0 ? 1 : -0.6);

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
    const effectiveBpm = this.getEffectiveBpm();
    if (effectiveBpm <= 0) return;

    const eighthDur = 60 / effectiveBpm / 2;
    const lookahead = 0.16;

    while (this.nextStepTime < ctx.currentTime + lookahead) {
      const step = this.stepCount % 16;
      const t = this.nextStepTime;

      // Soft warm sub-kick on beats 1 and 3 (steps 0 and 8), plus subtle heartbeat on 12 for vigilance
      if (step === 0 || step === 8 || (this.params.pulseIntensity > 0.55 && step === 12)) {
        this.triggerSoftKick(t, step === 0 ? 0.55 : 0.36);
      }

      // Organic muted marimba/pluck motif on gentle off-beats for musical flow
      if (step === 2 || step === 6 || step === 10 || step === 14) {
        const antiMonotonyBoost = this.isAntiMonotonyPulseActive() ? 1.28 : 1.0;
        const shouldPlay = step === 6 || step === 14 || this.params.pulseIntensity > 0.42;
        if (shouldPlay) {
          this.triggerWarmPluck(t, step, 0.16 * antiMonotonyBoost);
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

  private triggerWarmPluck(time: number, step: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.params) return;
    const prog = CHORD_PROGRESSIONS[this.params.harmonicMode];
    const chord = prog[this.chordIndex % prog.length];
    const noteSemi = chord[(step / 2) % chord.length] + 12; // one octave higher, gentle sparkle
    const freq = this.params.rootNoteHz * semitoneRatio(noteSemi);

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(1800, this.params.filterCutoffHz * 1.1), time);
    filter.frequency.exponentialRampToValueAtTime(420, time + 0.32);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMultiplier, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.36);

    pan.pan.value = step % 4 === 2 ? -0.28 : 0.28;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);

    osc.start(time);
    osc.stop(time + 0.38);
  }

  private isAntiMonotonyPulseActive(): boolean {
    if (!this.params || this.params.antiMonotonyCycleMin <= 0) return false;
    const cycleSec = this.params.antiMonotonyCycleMin * 60;
    const pos = this.elapsedSec % cycleSec;
    return pos > cycleSec - 25; // 25s gentle alertness lift each cycle
  }

  private getEffectiveBpm(): number {
    if (!this.params || this.params.bpm <= 0) return 0;
    const ratio = Math.min(1, this.elapsedSec / this.plannedSec);
    // Iso-principle smooth curve: slight ramp in, steady plateau, gentle landing
    let factor = 1.0;
    if (ratio < 0.15) factor = 0.94 + (ratio / 0.15) * 0.06;
    else if (ratio > 0.88) factor = 1.0 - ((ratio - 0.88) / 0.12) * 0.07;
    return Math.round(this.params.bpm * factor);
  }

  public updateElapsed(elapsedSec: number): EngineTelemetry {
    this.elapsedSec = elapsedSec;
    const progressRatio = Math.min(1, Math.max(0, elapsedSec / this.plannedSec));
    let phase: SessionPhase = 'plateau';
    let phaseLabelRo = 'Platou de performanță';
    let phaseModFactor = 1.0;

    if (progressRatio < 0.15) {
      phase = 'entry';
      phaseLabelRo = 'Aliniere & intrare (Principiul Iso)';
      phaseModFactor = 0.72 + (progressRatio / 0.15) * 0.28;
    } else if (progressRatio > 0.88) {
      phase = 'landing';
      phaseLabelRo = 'Revenire lină';
      phaseModFactor = 1.0 - ((progressRatio - 0.88) / 0.12) * 0.4;
    }

    const antiMonotonyActive = this.isAntiMonotonyPulseActive();
    const baseDepth = this.params?.modulationDepth ?? 0.25;
    const currentModDepth = Math.min(0.48, baseDepth * this.modDepthMultiplier * phaseModFactor);

    if (this.ctx && this.amGain && this.amDepthGain && this.padFilter && this.params) {
      const now = this.ctx.currentTime;
      this.amGain.gain.setTargetAtTime(1 - currentModDepth / 2, now, 0.3);
      this.amDepthGain.gain.setTargetAtTime(currentModDepth / 2, now, 0.3);

      const targetCutoff =
        this.params.filterCutoffHz *
        (0.85 + 0.25 * this.intensityMultiplier) *
        (antiMonotonyActive ? 1.15 : 1.0);
      this.padFilter.frequency.setTargetAtTime(Math.min(2600, Math.max(420, targetCutoff)), now, 0.6);
    }

    return {
      phase,
      phaseLabelRo,
      progressRatio,
      currentModHz: this.params?.modulationHz ?? 16,
      currentModDepth: Number(currentModDepth.toFixed(2)),
      currentBpm: this.getEffectiveBpm(),
      antiMonotonyActive,
    };
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.volume * 0.78), this.ctx.currentTime, 0.12);
    }
  }

  public adjustIntensity(multiplier: number): void {
    this.intensityMultiplier = Math.max(0.45, Math.min(1.55, multiplier));
    if (this.ctx && this.pulseBus && this.params) {
      const target = Math.max(0, Math.min(0.88, this.params.pulseIntensity * 0.52 * this.intensityMultiplier));
      this.pulseBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }
    if (this.ctx && this.noiseGain && this.params && !this.params.speakerSafeEQ) {
      const targetNoise = Math.max(0.01, Math.min(0.35, this.params.noiseLevel * 0.55 * this.intensityMultiplier));
      this.noiseGain.gain.setTargetAtTime(targetNoise, this.ctx.currentTime, 0.25);
    }
  }

  public adjustModDepth(multiplier: number): void {
    this.modDepthMultiplier = Math.max(0.25, Math.min(1.6, multiplier));
  }

  public async pause(): Promise<void> {
    if (!this.ctx || !this.isPlaying) return;
    this.isPlaying = false;
    await this.ctx.suspend();
  }

  public async resume(): Promise<void> {
    if (!this.ctx || this.isPlaying) return;
    await this.ctx.resume();
    this.isPlaying = true;
    this.nextStepTime = this.ctx.currentTime + 0.1;
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
      this.isPlaying = false;
      this.clearTimers();
      window.setTimeout(() => {
        ctxRef.close().catch(() => {});
      }, 650);
      this.ctx = null;
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
    try {
      this.amLfo?.stop();
      this.lfoFilter?.stop();
      this.noiseSource?.stop();
      for (const osc of this.activePadOscs) osc.stop();
      for (const node of this.binauralNodes) {
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
      }
    } catch {
      // ignore
    }
    this.activePadOscs = [];
    this.activePadGains = [];
    this.binauralNodes = [];
    this.noiseGain = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
  }

  private setupMediaSession(title: string): void {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: 'nootropic.fm · Open Research Beta',
          album: 'Psychoacoustic Cognitive Protocol',
        });
      } catch {
        // Ignore on unsupported browsers
      }
    }
  }
}
