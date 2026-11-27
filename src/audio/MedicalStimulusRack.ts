import {
  computeHarmonicCarrierHz,
  snrDbToLinearGain,
  type EntrainmentType,
  type ExecutableStudySpec,
} from '../../shared/studySpec';
import type { NoiseColor } from '../../shared/types';
import {
  BUTTERWORTH_LP_HP_Q_DB,
  NOISE_CALIBRATED_RMS,
  calibrateFilteredStereoNoiseRms,
  normalizeStereoBufferRms,
} from './dspMath';

export type GammaStimulusMode = 'harmonic_mbi' | 'gamma_chirp' | 'clinical_clicks';

export interface StimulusTelemetry {
  entrainmentType: EntrainmentType;
  activeHz: number;
  carrierLabel: string;
  noiseColor: NoiseColor;
  noiseSnrDb: number;
  hrvActive: boolean;
  hrvBreathPhase: 'inhale' | 'exhale' | null;
  hrvBreathProgress: number; // 0..1
  gammaMode: GammaStimulusMode;
}

/**
 * Generates seamless 6-second colored noise buffer supporting TRUE White, Pink, Brown, and Soft Rain
 * with equal-power overlap-add loop seam (0.00 dB dip, 0 repeated samples) and calibrated RMS (-17.08 dBFS).
 * When `bandpass` is provided, calibrates the pre-filter amplitude so POST-biquad output RMS matches `NOISE_CALIBRATED_RMS`.
 */
export function createCalibratedNoiseBuffer(
  ctx: AudioContext,
  color: Exclude<NoiseColor, 'none'>,
  durationSec = 6,
  bandpass?: { hpHz: number; lpHz: number }
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1024, Math.round(sampleRate * durationSec));
  const fade = Math.min(2048, Math.floor(length / 8));
  const totalGen = length + fade;
  const warmup = color === 'white' ? 0 : Math.min(4800, length);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(totalGen);
    const out = buffer.getChannelData(ch);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    let lastBrown = 0;

    for (let i = -warmup; i < totalGen; i++) {
      const white = Math.random() * 2 - 1;
      let sampleVal = 0;
      if (color === 'white') {
        sampleVal = white * 0.24;
      } else if (color === 'brown') {
        lastBrown = (lastBrown + 0.02 * white) / 1.02;
        sampleVal = lastBrown * 3.1;
      } else {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
        sampleVal =
          color === 'soft_rain'
            ? pink * (0.48 + 0.10 * Math.sin((2 * Math.PI * ((i + length) % length)) / length + ch * Math.PI))
            : pink;
      }
      if (i >= 0) raw[i] = sampleVal;
    }

    // For `soft_rain`, layer evenly-spaced stochastic multi-surface water droplets & leaf patters
    // so Layer-1 `soft_rain` sounds like gentle organic rainfall rather than flat pink-noise hiss,
    // while keeping uniform frame-by-frame RMS parity across head & body for zero-seam looping.
    if (color === 'soft_rain') {
      const bucketFrames = Math.max(240, Math.round(sampleRate * 0.012)); // ~83 micro-impacts/sec uniform grid
      let bucketIdx = 0;
      for (let pos = 0; pos + bucketFrames < totalGen; pos += bucketFrames, bucketIdx++) {
        const jitter = Math.floor(Math.random() * (bucketFrames * 0.65));
        const start = pos + jitter;
        const isPlink = (bucketIdx + ch * 3) % 6 === 2;
        const dropLen = Math.min(
          totalGen - start,
          Math.max(18, Math.round(sampleRate * (isPlink ? 0.011 : 0.005)))
        );
        const rawBaseHz = isPlink ? 720 + Math.random() * 1450 : 1200 + Math.random() * 2800;
        const baseHz = Math.min(sampleRate * 0.32, rawBaseHz);
        const amp = isPlink ? 0.036 + Math.random() * 0.022 : 0.024 + Math.random() * 0.018;
        let phase = Math.random() * Math.PI * 2;
        let lp = 0;
        for (let j = 0; j < dropLen; j++) {
          const u = j / dropLen;
          const atk = Math.min(1, j / Math.max(3, sampleRate * 0.0005));
          const env = atk * Math.exp(-u * (isPlink ? 5.6 : 7.4)) * (u > 0.88 ? (1 - u) / 0.12 : 1);
          phase += (2 * Math.PI * baseHz * (isPlink ? 1 + 0.32 * u : 1)) / sampleRate;
          if (isPlink) {
            const slap = u < 0.15 ? (Math.random() * 2 - 1) * (1 - u / 0.15) * 0.35 : 0;
            raw[start + j] += (Math.sin(phase) * 0.78 + slap) * amp * env;
          } else {
            const n = Math.random() * 2 - 1;
            lp += 0.34 * (n - lp);
            raw[start + j] += (lp * 0.72 + Math.sin(phase) * 0.28) * amp * env;
          }
        }
      }
    }

    // Copy main body and fold extra tail onto head with true equal-power sin/cos crossfade
    out.set(raw.subarray(0, length));
    for (let i = 0; i < fade; i++) {
      const theta = ((i + 0.5) / fade) * Math.PI * 0.5;
      out[i] = raw[i] * Math.sin(theta) + raw[length + i] * Math.cos(theta);
    }
  }

  if (bandpass) {
    calibrateFilteredStereoNoiseRms(
      buffer.getChannelData(0),
      buffer.getChannelData(1),
      sampleRate,
      bandpass.hpHz,
      bandpass.lpHz,
      NOISE_CALIBRATED_RMS
    );
  } else {
    normalizeStereoBufferRms(buffer.getChannelData(0), buffer.getChannelData(1), NOISE_CALIBRATED_RMS);
  }
  return buffer;
}

/**
 * Sample-accurate looping AudioBuffer for 40 Hz GENUS raised-cosine tone bursts
 * OR trapezoidal Isochronic pulses (ZERO timer jitter, ZERO phase click!).
 */
export function createPeriodicPulseBuffer(
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
  const safeHz = Math.max(0.25, Math.min(80, opts.pulseRateHz));
  const cycles = safeHz < 2 ? Math.max(1, Math.round(safeHz * 4)) : Math.max(1, Math.round(safeHz));
  const loopSec = cycles / safeHz;
  const totalSamples = Math.max(256, Math.round(loopSec * rate));
  const actualLoopSec = totalSamples / rate;
  const buf = ctx.createBuffer(2, totalSamples, rate);

  const periodSamples = totalSamples / cycles;
  const duty = Math.max(0.02, Math.min(0.85, opts.dutyCycle));
  const pulseSamples = Math.max(8, periodSamples * duty);
  const rampSamples = Math.max(4, Math.min(pulseSamples * 0.22, rate * 0.004));

  // Snap carrier frequency to exact integer multiple of ACTUAL buffer loop duration for 0.000 rad seam jump
  const carrierCycles = Math.max(1, Math.round(opts.carrierHz * actualLoopSec));
  const exactCarrierHz = carrierCycles / actualLoopSec;

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
    // Warm fundamental + ultra-soft octave shimmer (clamped < 0.44 * fs for 16 kHz Bluetooth HFP)
    const safeC = Math.min(rate * 0.44, exactCarrierHz);
    const tone =
      safeC * 2 < rate * 0.44
        ? Math.sin(2 * Math.PI * safeC * t) * 0.85 + Math.sin(2 * Math.PI * safeC * 2 * t) * 0.15
        : Math.sin(2 * Math.PI * safeC * t);
    const sample = tone * env;
    left[i] = sample;
    right[i] = sample;
  }

  return buf;
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
  private dynamicMusicScale = 1.0;

  private activeSources: AudioScheduledSourceNode[] = [];
  private stimulusGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private hrvCarrierGain: GainNode | null = null;
  private hrvExtraGains: GainNode[] = [];
  private hrvDepthGain: GainNode | null = null;
  private hrvPeriodicGate: GainNode | null = null;
  private hrvShamGate: GainNode | null = null;
  private hrvBaseDepth = 0;
  private beatOscL: OscillatorNode | null = null;
  private beatOscR: OscillatorNode | null = null;
  private clinicalSynthNode: AudioWorkletNode | null = null;
  private clinicalSynthWarmLp: BiquadFilterNode | null = null;
  private noiseCarrierNotch: BiquadFilterNode | null = null;
  private workletsReady = false;
  private gammaMode: GammaStimulusMode = 'harmonic_mbi';
  private forceMonaural = false;
  private bluetoothSafe = false;
  private overrideFreqHz: number | null = null;
  private plannedSec = 1500;
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
    workletsReady?: boolean;
    gammaMode?: GammaStimulusMode;
    forceMonaural?: boolean;
    bluetoothSafe?: boolean;
    alphaIafHz?: number;
    plannedSec?: number;
  }): { hrvBusInput: GainNode | null } {
    this.stop();
    const {
      ctx,
      spec,
      masterDestination,
      speakerSafeEQ,
      isControlTrial,
      pureStimulusMode,
      stimulusTap,
      workletsReady = false,
      gammaMode,
      forceMonaural = false,
      bluetoothSafe = false,
      alphaIafHz,
      plannedSec = 1500,
    } = opts;
    this.ctx = ctx;
    this.spec = spec;
    this.speakerSafeEQ = speakerSafeEQ;
    this.isControlTrial = isControlTrial;
    this.pureStimulusMode = pureStimulusMode;
    this.workletsReady = Boolean(workletsReady && typeof AudioWorkletNode !== 'undefined');
    this.gammaMode = gammaMode ?? (pureStimulusMode ? 'clinical_clicks' : 'harmonic_mbi');
    this.forceMonaural = forceMonaural;
    this.bluetoothSafe = bluetoothSafe;
    this.overrideFreqHz =
      typeof alphaIafHz === 'number' && Number.isFinite(alphaIafHz) ? alphaIafHz : null;
    this.plannedSec = Math.max(60, plannedSec);
    this.scienceMuted = false;
    this.phaseModFactor = 1.0;
    this.dynamicMusicScale = 1.0;
    this.primaryCarrierHz = null;
    const isAlphaSpec = spec.entrainment.frequencyHz >= 8 && spec.entrainment.frequencyHz <= 12;
    const effectiveTargetHz =
      isAlphaSpec && this.overrideFreqHz !== null ? this.overrideFreqHz : spec.entrainment.frequencyHz;
    this.currentHz = spec.entrainment.startFrequencyHz ?? effectiveTargetHz;

    const now = ctx.currentTime;

    // 1. Optional 0.1 Hz HRV / Vagal Breathing Envelope Bus (10 s cycle = 6 breaths/min)
    const hrvHz =
      spec.entrainment.type === 'hrv_breathing_swell'
        ? spec.entrainment.frequencyHz || 0.1
        : spec.entrainment.hrvBreathHz ?? 0;

    let hrvBusInput: GainNode | null = null;
    if (hrvHz > 0 && !speakerSafeEQ) {
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

      const hrvPeriodicGate = ctx.createGain();
      hrvPeriodicGate.gain.setValueAtTime(isControlTrial ? 0 : 1, now);
      hrvLfo.connect(hrvPeriodicGate);

      // Active Aperiodic Sham for 0.10 Hz HRV: two incommensurate ultra-slow oscillators (0.037 + 0.061 Hz)
      // strictly outside the 0.08–0.12 Hz Mayer-wave baroreflex resonance band so Science Only remains blinded.
      const hrvShamGate = ctx.createGain();
      hrvShamGate.gain.setValueAtTime(isControlTrial ? 1 : 0, now);
      const hrvShamSpecs: Array<[number, number]> = [
        [0.037, 0.58],
        [0.061, 0.42],
      ];
      for (const [sHz, sWeight] of hrvShamSpecs) {
        const sOsc = ctx.createOscillator();
        sOsc.type = 'sine';
        sOsc.frequency.setValueAtTime(sHz, now);
        const sGain = ctx.createGain();
        sGain.gain.setValueAtTime(sWeight, now);
        sOsc.connect(sGain);
        sGain.connect(hrvShamGate);
        sOsc.start(now);
        this.activeSources.push(sOsc);
      }

      const hrvDepth = ctx.createGain();
      hrvDepth.gain.setValueAtTime(effHrv / 2, now);

      hrvPeriodicGate.connect(hrvDepth);
      hrvShamGate.connect(hrvDepth);
      hrvDepth.connect(hrvGain.gain);
      hrvLfo.start(now);

      this.activeSources.push(hrvLfo);
      this.hrvCarrierGain = hrvGain;
      this.hrvDepthGain = hrvDepth;
      this.hrvPeriodicGate = hrvPeriodicGate;
      this.hrvShamGate = hrvShamGate;
      hrvBusInput = hrvGain;
    }

    // 2. Discrete Clinical Entrainment Generators (40 Hz GENUS, Isochronic, Binaural, Monaural)
    const eType = spec.entrainment.type;
    if (eType !== 'none' && eType !== 'amplitude_modulation' && eType !== 'hrv_breathing_swell') {
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
        const duty = spec.entrainment.dutyCycle ?? 0.048;
        const useHarmonicMbi = this.gammaMode === 'harmonic_mbi';
        const useChirp = this.gammaMode === 'gamma_chirp';
        const carrierHz = useHarmonicMbi
          ? Math.round(computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220))
          : spec.entrainment.carrierLeftHz ??
            Math.round(computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 520));
        this.primaryCarrierHz = carrierHz;

        if (this.workletsReady) {
          const synth = new AudioWorkletNode(ctx, 'nootropic-clinical-synth', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          const nyqMax = ctx.sampleRate * 0.44;
          lp.frequency.value = Math.min(
            nyqMax,
            useHarmonicMbi ? 2200 : useChirp ? 3400 : Math.min(3600, carrierHz * 4.5)
          );
          lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
          synth.port.postMessage({
            type: 'config',
            mode: isControlTrial
              ? 'aperiodic_sham'
              : useHarmonicMbi
                ? 'gamma_mbi'
                : useChirp
                  ? 'gamma_chirp'
                  : 'gamma_clicks',
            rateHz,
            startRateHz: rateHz,
            rampSec: 0,
            carrierHz,
            dutyCycle: duty,
            depth: 0.72,
            bluetoothSafe: this.bluetoothSafe,
          });
          synth.connect(lp);
          lp.connect(stimGain);
          this.clinicalSynthNode = synth;
          this.clinicalSynthWarmLp = lp;
        } else if (isControlTrial) {
          this.mountFallbackAperiodicSham(
            ctx,
            carrierHz,
            useHarmonicMbi ? 2200 : Math.min(3600, carrierHz * 4.5),
            stimGain,
            now
          );
        } else {
          const buf = createPeriodicPulseBuffer(ctx, {
            pulseRateHz: rateHz,
            carrierHz,
            dutyCycle: useHarmonicMbi ? 0.45 : useChirp ? 0.32 : duty,
            mode: 'gamma_click',
          });
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;

          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = Math.min(
            ctx.sampleRate * 0.44,
            useHarmonicMbi ? 2200 : Math.min(3600, carrierHz * 4.5)
          );
          lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

          src.connect(lp);
          lp.connect(stimGain);
          src.start(now);
          this.activeSources.push(src);
        }
        this.carrierLabel = useHarmonicMbi
          ? `${rateHz} Hz Gamma-MBI Harmonic @ ${carrierHz} Hz`
          : useChirp
            ? `${rateHz} Hz Gamma Chirp (8 ms Sweep @ ${carrierHz} Hz)`
            : `${rateHz} Hz GENUS · ${(duty * (1000 / rateHz)).toFixed(1)} ms @ ${carrierHz} Hz (Lab)`;
      } else if (eType === 'theta_gamma_cfc' && !speakerSafeEQ) {
        const rateHz = effectiveTargetHz || 6;
        const startRateHz = spec.entrainment.startFrequencyHz ?? 14;
        const rampSec =
          spec.entrainment.startFrequencyHz !== undefined
            ? Math.min(240, Math.max(45, this.plannedSec * 0.2))
            : 0;
        const carrierHz = Math.round(
          computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220)
        );
        this.primaryCarrierHz = carrierHz;

        if (this.workletsReady) {
          const synth = new AudioWorkletNode(ctx, 'nootropic-clinical-synth', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = Math.min(ctx.sampleRate * 0.44, 2400);
          lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
          synth.port.postMessage({
            type: 'config',
            mode: isControlTrial ? 'aperiodic_sham' : 'theta_gamma_cfc',
            rateHz,
            startRateHz,
            rampSec,
            carrierHz,
            depth: Math.max(0.35, Math.min(0.88, (spec.entrainment.modulationDepth || 0.42) * 1.65)),
            bluetoothSafe: this.bluetoothSafe,
          });
          synth.connect(lp);
          lp.connect(stimGain);
          this.clinicalSynthNode = synth;
          this.clinicalSynthWarmLp = lp;
        } else if (isControlTrial) {
          this.mountFallbackAperiodicSham(ctx, carrierHz, 2200, stimGain, now);
        } else {
          const buf = createPeriodicPulseBuffer(ctx, {
            pulseRateHz: rateHz,
            carrierHz,
            dutyCycle: 0.48,
            mode: 'isochronic',
          });
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = Math.min(ctx.sampleRate * 0.44, 2200);
          lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
          src.connect(lp);
          lp.connect(stimGain);
          src.start(now);
          this.activeSources.push(src);
        }
        this.carrierLabel =
          startRateHz !== rateHz
            ? `${startRateHz}→${rateHz} Hz Theta × 40 Hz Gamma CFC @ ${carrierHz} Hz`
            : `${rateHz} Hz Theta × 40 Hz Gamma CFC @ ${carrierHz} Hz`;
      } else if (eType === 'isochronic_pulse') {
        const rateHz = effectiveTargetHz || 14;
        const carrierHz =
          spec.entrainment.carrierLeftHz ??
          Number(computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220).toFixed(2));
        const duty = spec.entrainment.dutyCycle ?? 0.5;
        this.primaryCarrierHz = carrierHz;

        if (this.workletsReady) {
          const synth = new AudioWorkletNode(ctx, 'nootropic-clinical-synth', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = Math.min(ctx.sampleRate * 0.44, speakerSafeEQ ? 720 : 1800);
          lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
          synth.port.postMessage({
            type: 'config',
            mode: isControlTrial ? 'aperiodic_sham' : 'isochronic',
            rateHz,
            startRateHz: spec.entrainment.startFrequencyHz ?? rateHz,
            rampSec:
              spec.entrainment.startFrequencyHz !== undefined
                ? Math.min(90, Math.max(30, this.plannedSec * 0.15))
                : 0,
            carrierHz,
            dutyCycle: duty,
            bluetoothSafe: this.bluetoothSafe,
          });
          synth.connect(lp);
          lp.connect(stimGain);
          this.clinicalSynthNode = synth;
          this.clinicalSynthWarmLp = lp;
        } else if (isControlTrial) {
          this.mountFallbackAperiodicSham(ctx, carrierHz, speakerSafeEQ ? 720 : 1800, stimGain, now);
        } else {
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
          lp.frequency.value = Math.min(ctx.sampleRate * 0.44, speakerSafeEQ ? 720 : 1800);
          lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

          src.connect(lp);
          lp.connect(stimGain);
          src.start(now);
          this.activeSources.push(src);
        }
        this.carrierLabel = `${rateHz} Hz Isochronic (${Math.round(duty * 100)}% duty @ ${carrierHz} Hz)`;
      } else if (eType === 'binaural_beat' || eType === 'monaural_beat') {
        const endBeatHz = effectiveTargetHz || 10;
        const startBeatHz = spec.entrainment.startFrequencyHz ?? endBeatHz;
        const hasExplicitPair = spec.entrainment.carrierLeftHz !== undefined;
        const defaultCenterHz = computeHarmonicCarrierHz(spec.music.rootMidi, spec.music.tuningA4Hz, 220);
        const leftHz = hasExplicitPair
          ? spec.entrainment.carrierLeftHz!
          : Number((defaultCenterHz - startBeatHz / 2).toFixed(2));
        const rightHz = hasExplicitPair
          ? spec.entrainment.carrierRightHz ?? Number((leftHz + startBeatHz).toFixed(2))
          : Number((defaultCenterHz + startBeatHz / 2).toFixed(2));
        this.beatSymmetric = !hasExplicitPair;
        this.primaryCarrierHz = Number(((leftHz + rightHz) / 2).toFixed(2));
        this.beatCenterHz = this.primaryCarrierHz;

        const useBinaural = eType === 'binaural_beat' && !speakerSafeEQ && !this.forceMonaural;

        if (this.workletsReady) {
          const synth = new AudioWorkletNode(ctx, 'nootropic-clinical-synth', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          const warmLp = ctx.createBiquadFilter();
          warmLp.type = 'lowpass';
          warmLp.frequency.value = Math.min(ctx.sampleRate * 0.44, speakerSafeEQ ? 760 : 1200);
          warmLp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
          synth.port.postMessage({
            type: 'config',
            mode: isControlTrial ? 'aperiodic_sham' : useBinaural ? 'binaural' : 'monaural',
            rateHz: endBeatHz,
            startRateHz: startBeatHz,
            rampSec:
              spec.entrainment.startFrequencyHz !== undefined
                ? Math.min(90, Math.max(30, this.plannedSec * 0.15))
                : 0,
            carrierHz: this.primaryCarrierHz,
            carrierLeftHz: leftHz,
            carrierRightHz: rightHz,
            bluetoothSafe: this.bluetoothSafe,
          });
          synth.connect(warmLp);
          warmLp.connect(stimGain);
          this.clinicalSynthNode = synth;
          this.clinicalSynthWarmLp = warmLp;
        } else if (isControlTrial) {
          this.mountFallbackAperiodicSham(
            ctx,
            this.primaryCarrierHz,
            speakerSafeEQ ? 760 : 1200,
            stimGain,
            now
          );
        } else {
          const nyqMax = ctx.sampleRate * 0.44;
          const oscL = ctx.createOscillator();
          const oscR = ctx.createOscillator();
          oscL.type = 'sine';
          oscR.type = 'sine';
          oscL.frequency.setValueAtTime(Math.min(nyqMax, leftHz), now);
          oscR.frequency.setValueAtTime(Math.min(nyqMax, rightHz), now);

          const warmLp = ctx.createBiquadFilter();
          warmLp.type = 'lowpass';
          warmLp.frequency.value = Math.min(nyqMax, speakerSafeEQ ? 760 : 1200);
          warmLp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

          if (useBinaural) {
            const panL = ctx.createStereoPanner();
            const panR = ctx.createStereoPanner();
            panL.pan.value = -1;
            panR.pan.value = 1;
            oscL.connect(panL);
            oscR.connect(panR);
            panL.connect(warmLp);
            panR.connect(warmLp);
          } else {
            const mix = ctx.createGain();
            mix.gain.value = 0.5;
            oscL.connect(mix);
            oscR.connect(mix);
            mix.connect(warmLp);
          }

          warmLp.connect(stimGain);
          oscL.start(now);
          oscR.start(now);
          this.beatOscL = oscL;
          this.beatOscR = oscR;
          this.activeSources.push(oscL, oscR);
        }
        this.carrierLabel = useBinaural
          ? `${leftHz} Hz L / ${rightHz} Hz R (${startBeatHz} Hz Beat)`
          : `${leftHz} + ${rightHz} Hz Monaural (${startBeatHz} Hz Beat)`;
      }

      if (targetLevel <= 0.0002) {
        stimGain.gain.setValueAtTime(0, now);
      } else {
        stimGain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetLevel), now + 1.8);
      }
    } else if (eType === 'amplitude_modulation') {
      this.carrierLabel = `${effectiveTargetHz} Hz LR4 AM (${spec.entrainment.modulationBandHz[0]}–${spec.entrainment.modulationBandHz[1]} Hz)`;
    } else if (eType === 'hrv_breathing_swell') {
      this.carrierLabel = `0.10 Hz Vagal Swell (10 s breath cycle)`;
    } else {
      this.carrierLabel = 'Pure Musical Protocol';
    }

    // 3. Exact SNR-Calibrated Colored Noise Layer (White, Pink, Brown, Soft Rain) + ±30 Hz Binaural Carrier Notch
    if (spec.noise.color !== 'none' && spec.noise.snrDb > -34) {
      const nyqMax = ctx.sampleRate * 0.44;
      const hpHz = Math.min(
        nyqMax * 0.5,
        spec.noise.bandpassHz?.[0] ?? (spec.noise.color === 'brown' ? 40 : 100)
      );
      const defaultLp =
        spec.noise.color === 'brown'
          ? 540
          : spec.noise.color === 'white'
            ? 6200
            : spec.noise.color === 'soft_rain'
              ? 2400
              : 2200;
      const lpHz = Math.min(
        nyqMax,
        speakerSafeEQ
          ? Math.min(680, spec.noise.bandpassHz?.[1] ?? defaultLp)
          : spec.noise.bandpassHz?.[1] ?? defaultLp
      );

      const noiseBuf = createCalibratedNoiseBuffer(ctx, spec.noise.color, 6, { hpHz, lpHz });
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = hpHz;
      hp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lpHz;
      lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

      // ±30 Hz carrier notch clears masking noise around dichotic binaural carriers (Ingendoh 2023)
      const noiseCarrierNotch = ctx.createBiquadFilter();
      noiseCarrierNotch.type = 'peaking';
      const notchHz = Math.max(80, Math.min(nyqMax, Math.min(1800, this.primaryCarrierHz ?? 220)));
      noiseCarrierNotch.frequency.setValueAtTime(notchHz, now);
      noiseCarrierNotch.Q.setValueAtTime(Math.max(5.0, notchHz / 28), now);
      const wantNotch =
        eType === 'binaural_beat' && !speakerSafeEQ && !this.forceMonaural && Boolean(this.primaryCarrierHz);
      noiseCarrierNotch.gain.setValueAtTime(wantNotch ? -28 : 0, now);

      const nGain = ctx.createGain();
      const targetNoise = this.computeNoiseTargetGain();
      nGain.gain.setValueAtTime(0.0001, now);
      nGain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetNoise), now + 1.6);

      noiseSrc.connect(hp);
      hp.connect(lp);
      lp.connect(noiseCarrierNotch);
      noiseCarrierNotch.connect(nGain);
      nGain.connect(masterDestination);
      noiseSrc.start(now);

      this.noiseCarrierNotch = noiseCarrierNotch;
      this.noiseGain = nGain;
      this.activeSources.push(noiseSrc);
    }

    return { hrvBusInput };
  }

  private mountFallbackAperiodicSham(
    ctx: AudioContext,
    carrierHz: number,
    warmLpCutoffHz: number,
    stimGain: AudioNode,
    now: number
  ): void {
    const nyqMax = ctx.sampleRate * 0.44;
    const safeF0 = Math.max(90, Math.min(nyqMax * 0.85, Math.min(540, carrierHz || 220)));
    const shamEnv = ctx.createGain();
    shamEnv.gain.setValueAtTime(0.76, now);

    const shamOscs: Array<[number, number]> = [
      [0.17, 0.1],
      [0.29, 0.08],
      [0.43, 0.06],
    ];
    for (const [lfoHz, lfoAmp] of shamOscs) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(lfoHz, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(lfoAmp, now);
      lfo.connect(lfoGain);
      lfoGain.connect(shamEnv.gain);
      lfo.start(now);
      this.activeSources.push(lfo);
    }

    const warmLp = ctx.createBiquadFilter();
    warmLp.type = 'lowpass';
    warmLp.frequency.value = Math.min(nyqMax, warmLpCutoffHz);
    warmLp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

    const partials: Array<[number, number]> = [
      [1.0, 0.56],
      [1.5, 0.14],
      [2.0, 0.1],
    ];
    for (const [mult, weight] of partials) {
      if (safeF0 * mult >= nyqMax) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(safeF0 * mult, now);
      const pGain = ctx.createGain();
      pGain.gain.setValueAtTime(weight, now);
      osc.connect(pGain);
      pGain.connect(shamEnv);
      osc.start(now);
      this.activeSources.push(osc);
    }

    shamEnv.connect(warmLp);
    warmLp.connect(stimGain);
  }

  private resolveActiveSynthMode(): string {
    if (!this.spec) return 'off';
    if (this.isControlTrial) return 'aperiodic_sham';
    const eType = this.spec.entrainment.type;
    if (eType === 'gamma_40hz_clicks') {
      return this.gammaMode === 'harmonic_mbi'
        ? 'gamma_mbi'
        : this.gammaMode === 'gamma_chirp'
          ? 'gamma_chirp'
          : 'gamma_clicks';
    }
    if (eType === 'theta_gamma_cfc') return 'theta_gamma_cfc';
    if (eType === 'isochronic_pulse') return 'isochronic';
    if (eType === 'binaural_beat') {
      return !this.speakerSafeEQ && !this.forceMonaural ? 'binaural' : 'monaural';
    }
    if (eType === 'monaural_beat') return 'monaural';
    return 'off';
  }

  private computeEffectiveHrvDepth(): number {
    if (!this.spec || this.scienceMuted || this.hrvBaseDepth <= 0) return 0;
    const phaseScale = this.pureStimulusMode ? 1.0 : this.phaseModFactor;
    const shamScale = this.isControlTrial ? 0.85 : 1.0;
    return Math.min(0.68, Math.max(0, this.hrvBaseDepth * this.modMult * phaseScale * shamScale));
  }

  private computeStimulusTargetGain(): number {
    if (!this.spec || this.scienceMuted) return 0;
    const baseDepth = Math.max(0.1, Math.min(0.8, this.spec.entrainment.modulationDepth || 0.26));
    const type = this.spec.entrainment.type;
    let base = 0.08;
    if (type === 'gamma_40hz_clicks') {
      base =
        this.gammaMode === 'harmonic_mbi'
          ? this.pureStimulusMode
            ? 0.31
            : 0.145
          : this.pureStimulusMode
            ? 0.27
            : 0.18;
    } else if (type === 'theta_gamma_cfc') base = this.pureStimulusMode ? 0.3 : 0.165;
    else if (type === 'isochronic_pulse') base = this.pureStimulusMode ? 0.25 : 0.165;
    else if (type === 'binaural_beat' || type === 'monaural_beat') {
      base = this.pureStimulusMode ? 0.25 : 0.155;
    }
    const phaseScale = this.pureStimulusMode ? 1.0 : this.phaseModFactor;
    const dynScale = this.pureStimulusMode ? 1.0 : this.dynamicMusicScale;
    return Math.min(0.48, Math.max(0.0001, base * (0.72 + baseDepth * 0.98) * this.modMult * phaseScale * dynScale));
  }

  public setGammaMode(mode: GammaStimulusMode): void {
    this.gammaMode = mode;
    if (!this.spec || this.spec.entrainment.type !== 'gamma_40hz_clicks' || this.speakerSafeEQ) return;
    const rateHz = this.spec.entrainment.frequencyHz || 40;
    const duty = this.spec.entrainment.dutyCycle ?? 0.048;
    const useMbi = mode === 'harmonic_mbi';
    const useChirp = mode === 'gamma_chirp';
    const carrierHz = useMbi
      ? Math.round(computeHarmonicCarrierHz(this.spec.music.rootMidi, this.spec.music.tuningA4Hz, 220))
      : this.spec.entrainment.carrierLeftHz ??
        Math.round(computeHarmonicCarrierHz(this.spec.music.rootMidi, this.spec.music.tuningA4Hz, 520));
    this.primaryCarrierHz = carrierHz;
    if (this.clinicalSynthNode) {
      this.clinicalSynthNode.port.postMessage({
        type: 'setMode',
        mode: this.resolveActiveSynthMode(),
        bluetoothSafe: this.bluetoothSafe,
      });
      this.clinicalSynthNode.port.postMessage({ type: 'retune', carrierHz });
    }
    if (this.clinicalSynthWarmLp && this.ctx) {
      this.clinicalSynthWarmLp.frequency.setTargetAtTime(
        Math.min(
          this.ctx.sampleRate * 0.44,
          useMbi ? 2200 : useChirp ? 3400 : Math.min(3600, carrierHz * 4.5)
        ),
        this.ctx.currentTime,
        0.15
      );
    }
    this.carrierLabel = useMbi
      ? `${rateHz} Hz Gamma-MBI Harmonic @ ${carrierHz} Hz`
      : useChirp
        ? `${rateHz} Hz Gamma Chirp (8 ms Sweep @ ${carrierHz} Hz)`
        : `${rateHz} Hz GENUS · ${(duty * (1000 / rateHz)).toFixed(1)} ms @ ${carrierHz} Hz (Lab)`;
    this.refreshLevels(0.18);
  }

  public setForceMonaural(force: boolean): void {
    this.forceMonaural = force;
    if (!this.spec || !this.ctx) return;
    const eType = this.spec.entrainment.type;
    if (eType !== 'binaural_beat') return;
    const useBinaural = !this.speakerSafeEQ && !force;
    if (this.clinicalSynthNode) {
      this.clinicalSynthNode.port.postMessage({
        type: 'setMode',
        mode: this.resolveActiveSynthMode(),
        bluetoothSafe: this.bluetoothSafe,
      });
    }
    if (this.noiseCarrierNotch) {
      this.noiseCarrierNotch.gain.setTargetAtTime(
        useBinaural && this.primaryCarrierHz ? -28 : 0,
        this.ctx.currentTime,
        0.18
      );
    }
    const beatHz = this.currentHz || this.overrideFreqHz || this.spec.entrainment.frequencyHz || 10;
    const half = beatHz / 2;
    const lHz = Number((this.beatCenterHz - half).toFixed(2));
    const rHz = Number((this.beatCenterHz + half).toFixed(2));
    this.carrierLabel = useBinaural
      ? `${lHz} Hz L / ${rHz} Hz R (${beatHz} Hz Beat)`
      : `${lHz} + ${rHz} Hz Monaural (${beatHz} Hz Beat)`;
  }

  public setBluetoothSafe(safe: boolean): void {
    this.bluetoothSafe = safe;
    if (this.clinicalSynthNode) {
      this.clinicalSynthNode.port.postMessage({ type: 'setMode', bluetoothSafe: safe });
    }
  }

  public setOverrideFrequencyHz(hz: number): void {
    this.overrideFreqHz = hz;
    if (!this.spec) return;
    const eType = this.spec.entrainment.type;
    this.currentHz = hz;
    if (this.clinicalSynthNode) {
      this.clinicalSynthNode.port.postMessage({ type: 'setRate', rateHz: hz });
    }
    if (eType === 'amplitude_modulation') {
      this.carrierLabel = `${hz} Hz LR4 AM (${this.spec.entrainment.modulationBandHz[0]}–${this.spec.entrainment.modulationBandHz[1]} Hz)`;
    } else if ((eType === 'binaural_beat' || eType === 'monaural_beat') && this.beatSymmetric) {
      const lHz = Number((this.beatCenterHz - hz / 2).toFixed(2));
      const rHz = Number((this.beatCenterHz + hz / 2).toFixed(2));
      this.carrierLabel =
        eType === 'binaural_beat' && !this.speakerSafeEQ && !this.forceMonaural
          ? `${lHz} Hz L / ${rHz} Hz R (${hz} Hz Beat)`
          : `${lHz} + ${rHz} Hz Monaural (${hz} Hz Beat)`;
    }
  }

  public createHrvGainBranch(): GainNode | null {
    if (!this.ctx || !this.hrvDepthGain) return null;
    const branch = this.ctx.createGain();
    const effHrv = this.computeEffectiveHrvDepth();
    branch.gain.setValueAtTime(1 - effHrv / 2, this.ctx.currentTime);
    this.hrvDepthGain.connect(branch.gain);
    this.hrvExtraGains.push(branch);
    return branch;
  }

  public getPrimaryCarrierHz(): number | null {
    return this.primaryCarrierHz;
  }

  public setDynamicMusicEnvelope(_scale: number): void {
    // STRICT LAYER-1 SCIENCE INVARIANCE: Layer 1 scientific stimulus & calibrated noise floor
    // must remain 100% constant in amplitude and frequency across all Layer 2 music genre swaps.
    this.dynamicMusicScale = 1.0;
  }

  public retuneToMusicalRoot(rootMidi: number, tuningA4Hz: 440 | 432): number | null {
    if (!this.ctx || !this.spec || this.isControlTrial) return this.primaryCarrierHz;
    if (this.spec.entrainment.carrierLeftHz !== undefined) {
      return this.primaryCarrierHz;
    }
    this.spec.music.rootMidi = rootMidi;
    const eType = this.spec.entrainment.type;
    if (
      (eType === 'gamma_40hz_clicks' || eType === 'theta_gamma_cfc') &&
      !this.speakerSafeEQ &&
      this.clinicalSynthNode
    ) {
      const targetCenter =
        eType === 'theta_gamma_cfc' || this.gammaMode === 'harmonic_mbi' ? 220 : 520;
      const newCarrierHz = Math.round(computeHarmonicCarrierHz(rootMidi, tuningA4Hz, targetCenter));
      this.primaryCarrierHz = newCarrierHz;
      this.clinicalSynthNode.port.postMessage({ type: 'retune', carrierHz: newCarrierHz });
      return this.primaryCarrierHz;
    }
    if (eType === 'binaural_beat' || eType === 'monaural_beat') {
      const newCenterHz = computeHarmonicCarrierHz(rootMidi, tuningA4Hz, 220);
      this.beatCenterHz = newCenterHz;
      const beatHz = this.currentHz || this.overrideFreqHz || this.spec.entrainment.frequencyHz || 10;
      const leftHz = Number((newCenterHz - beatHz / 2).toFixed(2));
      const rightHz = Number((newCenterHz + beatHz / 2).toFixed(2));
      this.primaryCarrierHz = Number(((leftHz + rightHz) / 2).toFixed(2));
      const now = this.ctx.currentTime;
      if (this.clinicalSynthNode) {
        this.clinicalSynthNode.port.postMessage({
          type: 'retune',
          carrierHz: this.primaryCarrierHz,
          carrierLeftHz: leftHz,
          carrierRightHz: rightHz,
        });
      }
      const nyqMax = this.ctx.sampleRate * 0.44;
      if (this.beatOscL && this.beatOscR) {
        this.beatOscL.frequency.setTargetAtTime(Math.min(nyqMax, leftHz), now, 0.45);
        this.beatOscR.frequency.setTargetAtTime(Math.min(nyqMax, rightHz), now, 0.45);
      }
      if (this.noiseCarrierNotch) {
        const clampedNotch = Math.min(nyqMax, this.primaryCarrierHz);
        this.noiseCarrierNotch.frequency.setTargetAtTime(clampedNotch, now, 0.45);
        this.noiseCarrierNotch.Q.setTargetAtTime(Math.max(5.0, clampedNotch / 28), now, 0.45);
      }
      this.carrierLabel =
        eType === 'binaural_beat' && !this.speakerSafeEQ && !this.forceMonaural
          ? `${leftHz} Hz L / ${rightHz} Hz R (${beatHz} Hz Beat)`
          : `${leftHz} + ${rightHz} Hz Monaural (${beatHz} Hz Beat)`;
    }
    return this.primaryCarrierHz;
  }

  private computeNoiseTargetGain(): number {
    if (!this.spec || this.scienceMuted || this.spec.noise.color === 'none' || this.spec.noise.snrDb <= -34) {
      return 0;
    }
    const linear = snrDbToLinearGain(this.spec.noise.snrDb);
    const eType = this.spec.entrainment.type;
    // In isolated Science Only mode on active rhythmic protocols, keep unmodulated noise subtle so the rhythmic wave stays crisp
    const pureScale =
      eType === 'none' || this.spec.noise.snrDb >= -14 ? 1.25 : 0.28;
    const dynScale = this.pureStimulusMode ? pureScale : 0.78 + 0.28 * this.dynamicMusicScale;
    const boosted = Math.min(0.68, linear * dynScale);
    const capped = this.speakerSafeEQ ? Math.min(0.06, boosted) : boosted;
    return Math.max(0, capped * this.intensityMult);
  }

  public setScienceMuted(muted: boolean): void {
    this.scienceMuted = muted;
    this.refreshLevels(0.065);
  }

  public setPureStimulusMode(pure: boolean): void {
    this.pureStimulusMode = pure;
    this.refreshLevels(0.065);
  }

  public setControlTrial(flag: boolean): void {
    this.isControlTrial = flag;
    if (this.clinicalSynthNode) {
      this.clinicalSynthNode.port.postMessage({
        type: 'setMode',
        mode: this.resolveActiveSynthMode(),
        bluetoothSafe: this.bluetoothSafe,
      });
    }
    if (this.ctx) {
      const now = this.ctx.currentTime;
      smoothSetParam(this.hrvPeriodicGate?.gain, flag ? 0 : 1, now, 0.08);
      smoothSetParam(this.hrvShamGate?.gain, flag ? 1 : 0, now, 0.08);
    }
    this.refreshLevels(0.065);
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
      (this.clinicalSynthNode || (this.beatOscL && this.beatOscR))
    ) {
      const isAlpha = spec.entrainment.frequencyHz >= 8 && spec.entrainment.frequencyHz <= 12;
      const targetEndHz =
        isAlpha && this.overrideFreqHz !== null ? this.overrideFreqHz : spec.entrainment.frequencyHz;
      const rampSec = Math.min(90, Math.max(30, this.plannedSec * 0.15));
      const elapsedSec = Math.max(0, progressRatio) * this.plannedSec;
      const rampRatio = rampSec > 0 ? Math.min(1, elapsedSec / rampSec) : 1;
      const liveBeatHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (targetEndHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
      this.currentHz = liveBeatHz;
      const leftHz = Number((this.beatCenterHz - liveBeatHz / 2).toFixed(2));
      const rightHz = Number((leftHz + liveBeatHz).toFixed(2));
      if (this.beatOscL && this.beatOscR) {
        const now = this.ctx.currentTime;
        const nyqMax = this.ctx.sampleRate * 0.44;
        this.beatOscL.frequency.setTargetAtTime(Math.min(nyqMax, leftHz), now, 0.4);
        this.beatOscR.frequency.setTargetAtTime(Math.min(nyqMax, rightHz), now, 0.4);
      }
      this.carrierLabel =
        spec.entrainment.type === 'binaural_beat' && !this.speakerSafeEQ && !this.forceMonaural
          ? `${leftHz} Hz L / ${rightHz} Hz R (${liveBeatHz} Hz Beat)`
          : `${leftHz} + ${rightHz} Hz Monaural (${liveBeatHz} Hz Beat)`;
    } else if (
      spec &&
      !this.isControlTrial &&
      spec.entrainment.type === 'isochronic_pulse' &&
      spec.entrainment.startFrequencyHz !== undefined
    ) {
      const targetEndHz = spec.entrainment.frequencyHz || 14;
      const rampSec = Math.min(90, Math.max(30, this.plannedSec * 0.15));
      const elapsedSec = Math.max(0, progressRatio) * this.plannedSec;
      const rampRatio = rampSec > 0 ? Math.min(1, elapsedSec / rampSec) : 1;
      const liveIsoHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (targetEndHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
      this.currentHz = liveIsoHz;
      const dutyPct = Math.round((spec.entrainment.dutyCycle ?? 0.5) * 100);
      this.carrierLabel = `${liveIsoHz} Hz Isochronic (${dutyPct}% duty @ ${this.primaryCarrierHz ?? 220} Hz)`;
    } else if (
      spec &&
      !this.isControlTrial &&
      spec.entrainment.type === 'theta_gamma_cfc' &&
      spec.entrainment.startFrequencyHz !== undefined
    ) {
      const rampRatio = Math.min(1, Math.max(0, progressRatio) / 0.2);
      const liveThetaHz = Number(
        (
          spec.entrainment.startFrequencyHz +
          (spec.entrainment.frequencyHz - spec.entrainment.startFrequencyHz) * rampRatio
        ).toFixed(2)
      );
      this.currentHz = liveThetaHz;
      this.carrierLabel = `${liveThetaHz} Hz Theta × 40 Hz Gamma CFC @ ${this.primaryCarrierHz ?? 220} Hz`;
    }
    this.refreshLevels();
  }

  private refreshLevels(timeConst = 0.16): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.stimulusGain) {
      const targetStim = this.scienceMuted ? 0 : this.computeStimulusTargetGain();
      smoothSetParam(this.stimulusGain.gain, targetStim, now, timeConst);
    }
    if (this.noiseGain) {
      const wantNoise =
        !this.scienceMuted &&
        Boolean(this.spec && this.spec.noise.color !== 'none' && this.spec.noise.snrDb > -34);
      smoothSetParam(
        this.noiseGain.gain,
        wantNoise ? this.computeNoiseTargetGain() : 0,
        now,
        timeConst
      );
    }
    if (this.hrvCarrierGain && this.hrvDepthGain) {
      const effHrv = this.computeEffectiveHrvDepth();
      smoothSetParam(this.hrvCarrierGain.gain, 1 - effHrv / 2, now, Math.min(0.25, timeConst * 1.5));
      for (const extra of this.hrvExtraGains) {
        smoothSetParam(extra.gain, 1 - effHrv / 2, now, Math.min(0.25, timeConst * 1.5));
      }
      smoothSetParam(this.hrvDepthGain.gain, effHrv / 2, now, Math.min(0.25, timeConst * 1.5));
    }
  }

  public getTelemetry(elapsedSec: number): StimulusTelemetry {
    const hrvHz =
      this.spec?.entrainment.type === 'hrv_breathing_swell'
        ? this.spec.entrainment.frequencyHz || 0.1
        : this.spec?.entrainment.hrvBreathHz ?? 0;
    const hrvActive = hrvHz > 0 && !this.speakerSafeEQ;
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
      gammaMode: this.gammaMode,
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
    try {
      if (this.clinicalSynthNode) {
        this.clinicalSynthNode.port.postMessage({ type: 'stop' });
        this.clinicalSynthNode.disconnect();
      }
      this.clinicalSynthWarmLp?.disconnect();
      this.noiseCarrierNotch?.disconnect();
    } catch {
      // ignore
    }
    this.activeSources = [];
    this.clinicalSynthNode = null;
    this.clinicalSynthWarmLp = null;
    this.noiseCarrierNotch = null;
    this.stimulusGain = null;
    this.noiseGain = null;
    this.hrvCarrierGain = null;
    this.hrvExtraGains = [];
    this.hrvDepthGain = null;
    this.hrvPeriodicGate = null;
    this.hrvShamGate = null;
    this.hrvBaseDepth = 0;
    this.beatOscL = null;
    this.beatOscR = null;
    this.beatCenterHz = 200;
    this.beatSymmetric = false;
    this.primaryCarrierHz = null;
    this.phaseModFactor = 1.0;
    this.dynamicMusicScale = 1.0;
    this.scienceMuted = false;
    this.ctx = null;
  }
}
