import {
  computeHarmonicCarrierHz,
  snrDbToLinearGain,
  type EntrainmentType,
  type ExecutableStudySpec,
} from '../../shared/studySpec';
import type { NoiseColor } from '../../shared/types';

export interface StimulusTelemetry {
  entrainmentType: EntrainmentType;
  activeHz: number;
  carrierLabel: string;
  noiseColor: NoiseColor;
  noiseSnrDb: number;
  hrvActive: boolean;
  hrvBreathPhase: 'inhale' | 'exhale' | null;
  hrvBreathProgress: number; // 0..1
}

/**
 * Generates seamless 6-second colored noise buffer supporting TRUE White, Pink, Brown, and Soft Rain.
 */
export function createCalibratedNoiseBuffer(
  ctx: AudioContext,
  color: Exclude<NoiseColor, 'none'>,
  durationSec = 6
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    let lastBrown = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'white') {
        out[i] = white * 0.24;
      } else if (color === 'brown') {
        lastBrown = (lastBrown + 0.02 * white) / 1.02;
        out[i] = lastBrown * 3.1;
      } else {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
        out[i] =
          color === 'soft_rain'
            ? pink * (0.72 + 0.28 * Math.sin(i / 18000 + ch * 1.4))
            : pink;
      }
    }

    // Equal-power boundary crossfade for zero-click looping
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
 * Sample-accurate 1-second looping AudioBuffer for 40 Hz GENUS raised-cosine tone bursts
 * OR trapezoidal Isochronic pulses (ZERO timer jitter, ZERO phase click!).
 */
function createPeriodicPulseBuffer(
  ctx: AudioContext,
  opts: {
    pulseRateHz: number;
    carrierHz: number;
    dutyCycle: number;
    mode: 'gamma_click' | 'isochronic';
  }
): AudioBuffer {
  const rate = ctx.sampleRate;
  // Choose an integer number of cycles for an exact zero-seam loop
  const safeHz = Math.max(1, Math.min(80, opts.pulseRateHz));
  const cycles = Math.max(1, Math.round(safeHz));
  const loopSec = cycles / safeHz;
  const totalSamples = Math.max(256, Math.round(loopSec * rate));
  const buf = ctx.createBuffer(2, totalSamples, rate);

  const periodSamples = totalSamples / cycles;
  const duty = Math.max(0.02, Math.min(0.85, opts.dutyCycle));
  const pulseSamples = Math.max(8, periodSamples * duty);
  const rampSamples = Math.max(4, Math.min(pulseSamples * 0.22, rate * 0.004));

  // Snap carrier frequency to an integer multiple of loop fundamental for zero phase jump
  const carrierCycles = Math.max(1, Math.round(opts.carrierHz * loopSec));
  const exactCarrierHz = carrierCycles / loopSec;

  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);

  for (let i = 0; i < totalSamples; i++) {
    const posInCycle = i % periodSamples;
    let env = 0;

    if (posInCycle < pulseSamples) {
      if (opts.mode === 'gamma_click') {
        // Raised-cosine (Hann) window for pure, click-free 1 ms GENUS burst
        env = 0.5 * (1 - Math.cos((2 * Math.PI * posInCycle) / pulseSamples));
      } else {
        // Smooth trapezoidal gate for Isochronic pulse
        if (posInCycle < rampSamples) {
          env = 0.5 * (1 - Math.cos((Math.PI * posInCycle) / rampSamples));
        } else if (posInCycle > pulseSamples - rampSamples) {
          const rem = pulseSamples - posInCycle;
          env = 0.5 * (1 - Math.cos((Math.PI * rem) / rampSamples));
        } else {
          env = 1.0;
        }
      }
    }

    const t = i / rate;
    // Warm fundamental + ultra-soft octave shimmer so clinical bursts remain pleasant
    const tone =
      Math.sin(2 * Math.PI * exactCarrierHz * t) * 0.85 +
      Math.sin(2 * Math.PI * exactCarrierHz * 2 * t) * 0.15;
    const sample = tone * env;
    left[i] = sample;
    right[i] = sample;
  }

  return buf;
}

/**
 * Precision Clinical Stimulus Rack:
 * Executes 100% of peer-reviewed neuroacoustic primitives directly from ExecutableStudySpec:
 * - 40 Hz Gamma GENUS Bursts
 * - Isochronic Trapezoidal Pulses
 * - Precision Binaural Beats (exact L/R Hz)
 * - Acoustic Monaural Beats (speaker-compatible)
 * - 0.1 Hz HRV Vagal Breathing Swell (10 s sinusoidal tide)
 * - Exact SNR-Calibrated White / Pink / Brown / Soft Rain Noise
 */
export class MedicalStimulusRack {
  private ctx: AudioContext | null = null;
  private spec: ExecutableStudySpec | null = null;
  private isControlTrial = false;
  private speakerSafeEQ = false;
  private pureStimulusMode = false;
  private scienceMuted = false;
  private modMult = 1.0;
  private intensityMult = 1.0;
  private phaseModFactor = 1.0;

  private activeSources: AudioScheduledSourceNode[] = [];
  private stimulusGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private hrvCarrierGain: GainNode | null = null;
  private hrvDepthGain: GainNode | null = null;
  private hrvBaseDepth = 0;
  private beatOscL: OscillatorNode | null = null;
  private beatOscR: OscillatorNode | null = null;
  private beatCenterHz = 200;
  private beatSymmetric = false;
  private primaryCarrierHz: number | null = null;

  private currentHz = 0;
  private carrierLabel = 'None';

  /**
   * Builds and attaches clinical stimulus layers to `masterDestination`,
   * and returns an optional HRV tidal GainNode to insert in series with the music bus.
   */
  public start(opts: {
    ctx: AudioContext;
    spec: ExecutableStudySpec;
    masterDestination: AudioNode;
    speakerSafeEQ: boolean;
    isControlTrial: boolean;
    pureStimulusMode: boolean;
    stimulusTap?: AudioNode | null;
  }): { hrvBusInput: GainNode | null } {
    this.stop();
    const { ctx, spec, masterDestination, speakerSafeEQ, isControlTrial, pureStimulusMode, stimulusTap } = opts;
    this.ctx = ctx;
    this.spec = spec;
    this.speakerSafeEQ = speakerSafeEQ;
    this.isControlTrial = isControlTrial;
    this.pureStimulusMode = pureStimulusMode;
    this.scienceMuted = false;
    this.phaseModFactor = 1.0;
    this.primaryCarrierHz = null;
    this.currentHz = spec.entrainment.startFrequencyHz ?? spec.entrainment.frequencyHz;

    const now = ctx.currentTime;

    // 1. Optional 0.1 Hz HRV / Vagal Breathing Envelope Bus (10 s cycle = 6 breaths/min)
    const hrvHz =
      spec.entrainment.type === 'hrv_breathing_swell'
        ? spec.entrainment.frequencyHz || 0.1
        : spec.entrainment.hrvBreathHz ?? 0;

    let hrvBusInput: GainNode | null = null;
    if (hrvHz > 0 && !speakerSafeEQ && !isControlTrial) {
      const hrvGain = ctx.createGain();
      this.hrvBaseDepth =
        spec.entrainment.type === 'hrv_breathing_swell'
          ? Math.max(0.14, Math.min(0.55, spec.entrainment.modulationDepth || 0.32))
          : 0.14;
      const effHrv = this.computeEffectiveHrvDepth();
      hrvGain.gain.setValueAtTime(1 - effHrv / 2, now);

      const hrvLfo = ctx.createOscillator();
      hrvLfo.type = 'sine';
      hrvLfo.frequency.setValueAtTime(hrvHz, now);

      const hrvDepth = ctx.createGain();
      hrvDepth.gain.setValueAtTime(effHrv / 2, now);

      hrvLfo.connect(hrvDepth);
      hrvDepth.connect(hrvGain.gain);
      hrvLfo.start(now);

      this.activeSources.push(hrvLfo);
      this.hrvCarrierGain = hrvGain;
      this.hrvDepthGain = hrvDepth;
      hrvBusInput = hrvGain;
    }

    // 2. Discrete Clinical Entrainment Generators (40 Hz GENUS, Isochronic, Binaural, Monaural)
    const eType = spec.entrainment.type;
    if (!isControlTrial && eType !== 'none' && eType !== 'amplitude_modulation' && eType !== 'hrv_breathing_swell') {
      const stimGain = ctx.createGain();
      stimGain.gain.setValueAtTime(0.0001, now);
      stimGain.connect(masterDestination);
      if (stimulusTap) {
        stimGain.connect(stimulusTap);
      }
      this.stimulusGain = stimGain;

      const targetLevel = this.computeStimulusTargetGain();

      if (eType === 'gamma_40hz_clicks' && !speakerSafeEQ) {
        const rateHz = spec.entrainment.frequencyHz || 40;
        const carrierHz =
          spec.entrainment.carrierLeftHz ??
          Math.round(computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 520));
        const duty = spec.entrainment.dutyCycle ?? 0.048;
        const buf = createPeriodicPulseBuffer(ctx, {
          pulseRateHz: rateHz,
          carrierHz,
          dutyCycle: duty,
          mode: 'gamma_click',
        });
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        // Gentle warm lowpass around carrier so 40 Hz clicks sound crisp yet non-fatiguing
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(3600, carrierHz * 4.5);

        src.connect(lp);
        lp.connect(stimGain);
        src.start(now);
        this.primaryCarrierHz = carrierHz;
        this.activeSources.push(src);
        this.carrierLabel = `${rateHz} Hz · ${(duty * (1000 / rateHz)).toFixed(1)} ms @ ${carrierHz} Hz`;
      } else if (eType === 'isochronic_pulse') {
        const rateHz = spec.entrainment.frequencyHz || 14;
        const carrierHz =
          spec.entrainment.carrierLeftHz ??
          Number(computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220).toFixed(2));
        const duty = spec.entrainment.dutyCycle ?? 0.5;
        const buf = createPeriodicPulseBuffer(ctx, {
          pulseRateHz: rateHz,
          carrierHz,
          dutyCycle: duty,
          mode: 'isochronic',
        });
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = speakerSafeEQ ? 720 : 1800;

        src.connect(lp);
        lp.connect(stimGain);
        src.start(now);
        this.primaryCarrierHz = carrierHz;
        this.activeSources.push(src);
        this.carrierLabel = `${rateHz} Hz Isochronic (${Math.round(duty * 100)}% duty @ ${carrierHz} Hz)`;
      } else if (eType === 'binaural_beat' && !speakerSafeEQ) {
        const startBeatHz = spec.entrainment.startFrequencyHz ?? (spec.entrainment.frequencyHz || 10);
        const hasExplicitPair = spec.entrainment.carrierLeftHz !== undefined;
        const centerHz = hasExplicitPair
          ? spec.entrainment.carrierLeftHz!
          : computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220);
        const leftHz = hasExplicitPair
          ? spec.entrainment.carrierLeftHz!
          : Number((centerHz - startBeatHz / 2).toFixed(2));
        const rightHz = hasExplicitPair
          ? spec.entrainment.carrierRightHz ?? Number((leftHz + startBeatHz).toFixed(2))
          : Number((centerHz + startBeatHz / 2).toFixed(2));
        this.beatCenterHz = centerHz;
        this.beatSymmetric = !hasExplicitPair;
        this.primaryCarrierHz = Number(((leftHz + rightHz) / 2).toFixed(2));

        const oscL = ctx.createOscillator();
        const oscR = ctx.createOscillator();
        oscL.type = 'sine';
        oscR.type = 'sine';
        oscL.frequency.setValueAtTime(leftHz, now);
        oscR.frequency.setValueAtTime(rightHz, now);

        const panL = ctx.createStereoPanner();
        const panR = ctx.createStereoPanner();
        panL.pan.value = -1;
        panR.pan.value = 1;

        const warmLp = ctx.createBiquadFilter();
        warmLp.type = 'lowpass';
        warmLp.frequency.value = 1200;
        warmLp.Q.value = 0.6;

        oscL.connect(panL);
        oscR.connect(panR);
        panL.connect(warmLp);
        panR.connect(warmLp);
        warmLp.connect(stimGain);
        oscL.start(now);
        oscR.start(now);
        this.beatOscL = oscL;
        this.beatOscR = oscR;
        this.activeSources.push(oscL, oscR);
        this.carrierLabel = `${leftHz} Hz L / ${rightHz} Hz R (${startBeatHz} Hz Beat)`;
      } else if (eType === 'monaural_beat' || (eType === 'binaural_beat' && speakerSafeEQ)) {
        const startBeatHz = spec.entrainment.startFrequencyHz ?? (spec.entrainment.frequencyHz || 10);
        const hasExplicitPair = spec.entrainment.carrierLeftHz !== undefined;
        const centerHz = hasExplicitPair
          ? spec.entrainment.carrierLeftHz!
          : computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220);
        const leftHz = hasExplicitPair
          ? spec.entrainment.carrierLeftHz!
          : Number((centerHz - startBeatHz / 2).toFixed(2));
        const rightHz = hasExplicitPair
          ? spec.entrainment.carrierRightHz ?? Number((leftHz + startBeatHz).toFixed(2))
          : Number((centerHz + startBeatHz / 2).toFixed(2));
        this.beatCenterHz = centerHz;
        this.beatSymmetric = !hasExplicitPair;
        this.primaryCarrierHz = Number(((leftHz + rightHz) / 2).toFixed(2));

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(leftHz, now);
        osc2.frequency.setValueAtTime(rightHz, now);

        const mix = ctx.createGain();
        mix.gain.value = 0.5;
        const warmLp = ctx.createBiquadFilter();
        warmLp.type = 'lowpass';
        warmLp.frequency.value = speakerSafeEQ ? 760 : 1200;
        warmLp.Q.value = 0.6;

        osc1.connect(mix);
        osc2.connect(mix);
        mix.connect(warmLp);
        warmLp.connect(stimGain);
        osc1.start(now);
        osc2.start(now);
        this.beatOscL = osc1;
        this.beatOscR = osc2;
        this.activeSources.push(osc1, osc2);
        this.carrierLabel = `${leftHz} + ${rightHz} Hz Monaural (${startBeatHz} Hz Beat)`;
      }

      stimGain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetLevel), now + 1.8);
    } else if (eType === 'amplitude_modulation') {
      this.carrierLabel = `${spec.entrainment.frequencyHz} Hz LR4 AM (${spec.entrainment.modulationBandHz[0]}–${spec.entrainment.modulationBandHz[1]} Hz)`;
    } else if (eType === 'hrv_breathing_swell') {
      this.carrierLabel = `0.10 Hz Vagal Swell (10 s breath cycle)`;
    } else {
      this.carrierLabel = 'Pure Musical Protocol';
    }

    // 3. Exact SNR-Calibrated Colored Noise Layer (White, Pink, Brown, Soft Rain)
    if (spec.noise.color !== 'none' && spec.noise.snrDb > -34) {
      const noiseBuf = createCalibratedNoiseBuffer(ctx, spec.noise.color, 6);
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = spec.noise.bandpassHz?.[0] ?? (spec.noise.color === 'brown' ? 40 : 100);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      const defaultLp =
        spec.noise.color === 'brown'
          ? 540
          : spec.noise.color === 'white'
            ? 6200
            : spec.noise.color === 'soft_rain'
              ? 2400
              : 2200;
      lp.frequency.value = speakerSafeEQ
        ? Math.min(680, spec.noise.bandpassHz?.[1] ?? defaultLp)
        : spec.noise.bandpassHz?.[1] ?? defaultLp;

      const nGain = ctx.createGain();
      const targetNoise = this.computeNoiseTargetGain();
      nGain.gain.setValueAtTime(0.0001, now);
      nGain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetNoise), now + 1.6);

      noiseSrc.connect(hp);
      hp.connect(lp);
      lp.connect(nGain);
      nGain.connect(masterDestination);
      noiseSrc.start(now);

      this.noiseGain = nGain;
      this.activeSources.push(noiseSrc);
    }

    return { hrvBusInput };
  }

  private computeEffectiveHrvDepth(): number {
    if (!this.spec || this.isControlTrial || this.scienceMuted || this.hrvBaseDepth <= 0) return 0;
    const phaseScale = this.pureStimulusMode ? 1.0 : this.phaseModFactor;
    return Math.min(0.68, Math.max(0, this.hrvBaseDepth * this.modMult * phaseScale));
  }

  private computeStimulusTargetGain(): number {
    if (!this.spec || this.isControlTrial || this.scienceMuted) return 0.0001;
    const baseDepth = Math.max(0.1, Math.min(0.8, this.spec.entrainment.modulationDepth || 0.26));
    const type = this.spec.entrainment.type;
    let base = 0.08;
    if (type === 'gamma_40hz_clicks') base = this.pureStimulusMode ? 0.28 : 0.165;
    else if (type === 'isochronic_pulse') base = this.pureStimulusMode ? 0.26 : 0.15;
    else if (type === 'binaural_beat' || type === 'monaural_beat') {
      base = this.pureStimulusMode ? 0.26 : 0.135;
    }
    const phaseScale = this.pureStimulusMode ? 1.0 : this.phaseModFactor;
    return Math.min(0.42, Math.max(0.0001, base * (0.68 + baseDepth * 0.95) * this.modMult * phaseScale));
  }

  public getPrimaryCarrierHz(): number | null {
    return this.primaryCarrierHz;
  }

  private computeNoiseTargetGain(): number {
    if (!this.spec || this.scienceMuted || this.spec.noise.color === 'none' || this.spec.noise.snrDb <= -34) {
      return 0.0001;
    }
    const linear = snrDbToLinearGain(this.spec.noise.snrDb);
    const boosted = this.pureStimulusMode ? Math.min(0.68, linear * 1.35) : linear;
    const capped = this.speakerSafeEQ ? Math.min(0.06, boosted) : boosted;
    return Math.max(0.0001, capped * this.intensityMult);
  }

  public setScienceMuted(muted: boolean): void {
    this.scienceMuted = muted;
    this.refreshLevels();
  }

  public setPureStimulusMode(pure: boolean): void {
    this.pureStimulusMode = pure;
    this.refreshLevels();
  }

  public setModMultiplier(mult: number): void {
    this.modMult = Math.max(0, Math.min(1.65, mult));
    this.refreshLevels();
  }

  public setIntensityMultiplier(mult: number): void {
    this.intensityMult = Math.max(0.45, Math.min(1.55, mult));
    this.refreshLevels();
  }

  public updateProgress(progressRatio: number, phaseModFactor: number): void {
    this.phaseModFactor = Math.max(0.45, Math.min(1.05, phaseModFactor));
    const spec = this.spec;
    if (
      this.ctx &&
      spec &&
      !this.isControlTrial &&
      spec.entrainment.startFrequencyHz !== undefined &&
      (spec.entrainment.type === 'binaural_beat' || spec.entrainment.type === 'monaural_beat') &&
      this.beatOscL &&
      this.beatOscR
    ) {
      const rampRatio = Math.min(1, Math.max(0, progressRatio) / 0.12);
      const liveBeatHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (spec.entrainment.frequencyHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
      this.currentHz = liveBeatHz;
      const leftHz = this.beatSymmetric
        ? Number((this.beatCenterHz - liveBeatHz / 2).toFixed(2))
        : this.beatCenterHz;
      const rightHz = this.beatSymmetric
        ? Number((this.beatCenterHz + liveBeatHz / 2).toFixed(2))
        : Number((leftHz + liveBeatHz).toFixed(2));
      const now = this.ctx.currentTime;
      this.beatOscL.frequency.setTargetAtTime(leftHz, now, 0.4);
      this.beatOscR.frequency.setTargetAtTime(rightHz, now, 0.4);
      this.carrierLabel =
        spec.entrainment.type === 'binaural_beat' && !this.speakerSafeEQ
          ? `${leftHz} Hz L / ${rightHz} Hz R (${liveBeatHz} Hz Beat)`
          : `${leftHz} + ${rightHz} Hz Monaural (${liveBeatHz} Hz Beat)`;
    }
    this.refreshLevels();
  }

  private refreshLevels(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.stimulusGain) {
      this.stimulusGain.gain.setTargetAtTime(this.computeStimulusTargetGain(), now, 0.25);
    }
    if (this.noiseGain) {
      this.noiseGain.gain.setTargetAtTime(this.computeNoiseTargetGain(), now, 0.25);
    }
    if (this.hrvCarrierGain && this.hrvDepthGain) {
      const effHrv = this.computeEffectiveHrvDepth();
      this.hrvCarrierGain.gain.setTargetAtTime(1 - effHrv / 2, now, 0.35);
      this.hrvDepthGain.gain.setTargetAtTime(effHrv / 2, now, 0.35);
    }
  }

  public getTelemetry(elapsedSec: number): StimulusTelemetry {
    const hrvHz =
      this.spec?.entrainment.type === 'hrv_breathing_swell'
        ? this.spec.entrainment.frequencyHz || 0.1
        : this.spec?.entrainment.hrvBreathHz ?? 0;
    const hrvActive = hrvHz > 0 && !this.speakerSafeEQ && !this.isControlTrial;
    let hrvBreathPhase: 'inhale' | 'exhale' | null = null;
    let hrvBreathProgress = 0;

    if (hrvActive) {
      const cyclePos = (elapsedSec * hrvHz) % 1;
      hrvBreathPhase = cyclePos < 0.5 ? 'inhale' : 'exhale';
      hrvBreathProgress = cyclePos < 0.5 ? cyclePos * 2 : (1 - cyclePos) * 2;
    }

    return {
      entrainmentType: this.spec?.entrainment.type ?? 'amplitude_modulation',
      activeHz: this.currentHz,
      carrierLabel: this.carrierLabel,
      noiseColor: this.spec?.noise.color ?? 'none',
      noiseSnrDb: this.spec?.noise.snrDb ?? -36,
      hrvActive,
      hrvBreathPhase,
      hrvBreathProgress,
    };
  }

  public stop(): void {
    for (const s of this.activeSources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    this.stimulusGain = null;
    this.noiseGain = null;
    this.hrvCarrierGain = null;
    this.hrvDepthGain = null;
    this.hrvBaseDepth = 0;
    this.beatOscL = null;
    this.beatOscR = null;
    this.beatCenterHz = 200;
    this.beatSymmetric = false;
    this.primaryCarrierHz = null;
    this.phaseModFactor = 1.0;
    this.scienceMuted = false;
    this.ctx = null;
  }
}
