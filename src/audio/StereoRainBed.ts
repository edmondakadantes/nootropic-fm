import { BUTTERWORTH_LP_HP_Q_DB } from './dspMath';

/**
 * Studio-Grade Physical Stereo Rainfall & Organic Raindrop Synthesizer (Web Audio API).
 * Ensures the "Soft Rain & Nature" genre ALWAYS delivers rich, unmistakable, cozy stereo rain
 * across Studio Mix, Infinite Live AI, and Live Composer — never buried under ambient synth pads.
 *
 * Three physical acoustic layers:
 *   1. Decorrelated Stereo Rain Sheet (warm pink-tilted shower with gentle L/R wind-gust swells)
 *   2. Organic Stereo Raindrop Patter (Minnaert acoustic bubble upward-chirp droplets + micro-splashes)
 *   3. Cozy Indoor Warmth (ultra-soft low-passed distant rain rumble)
 */

function createStereoRainBuffer(ctx: AudioContext, durationSec = 12): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const fade = Math.min(Math.floor(rate * 0.5), Math.floor(length / 8));
  const totalGen = length + fade;
  const buffer = ctx.createBuffer(2, length, rate);

  // Deterministic PRNG so rain density is consistently rich across sessions
  let seed = 0x51a7c0de;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Layer 1 & 3: Decorrelated stereo rain sheet + cozy low-end warmth with true overlap-add loop fold
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(totalGen);
    const out = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let brown = 0;
    let prev = 0;
    const gustPhase1 = ch * 2.1;
    const gustPhase2 = ch * 1.3 + 0.7;

    for (let i = 0; i < totalGen; i++) {
      const w = rand() * 2 - 1;
      // Paul Kellet pink filter (natural -3 dB/oct rainfall spectrum)
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.055;
      b6 = w * 0.115926;

      // Subtle high-frequency foliage mist (1st-order highpass of white noise)
      const mist = (w - prev) * 0.032;
      prev = w;

      // Cozy distant warm low-end shower bed
      brown = (brown + 0.018 * w) / 1.018;
      const warmth = brown * 0.42;

      // Slow organic rain-gust breathing (seamless integer cycles across `length`)
      const tNorm = (i % length) / length;
      const gust =
        0.84 +
        0.11 * Math.sin(tNorm * Math.PI * 2 * 1 + gustPhase1) +
        0.05 * Math.sin(tNorm * Math.PI * 2 * 2 + gustPhase2);

      raw[i] = (pink * 0.78 + mist * 0.45) * gust + warmth * 0.28;
    }

    // Copy main body and fold extra tail onto head via equal-power sin/cos (0 repeated samples, 0 seam click!)
    out.set(raw.subarray(0, length));
    for (let i = 0; i < fade; i++) {
      const theta = ((i + 0.5) / fade) * Math.PI * 0.5;
      out[i] = raw[i] * Math.sin(theta) + raw[length + i] * Math.cos(theta);
    }
  }

  // Layer 2: Organic Individual Stereo Raindrops wrapped seamlessly across loop boundary
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const addDroplet = (
    startSample: number,
    baseHz: number,
    durSec: number,
    amp: number,
    pan: number, // -1..+1
    hasBubbleChirp: boolean
  ) => {
    const dropLen = Math.max(24, Math.floor(durSec * rate));
    const gainL = Math.cos(((pan + 1) * Math.PI) / 4) * amp;
    const gainR = Math.sin(((pan + 1) * Math.PI) / 4) * amp;
    let phase = 0;

    for (let j = 0; j < dropLen; j++) {
      const idx = (startSample + j) % length;
      const u = j / dropLen;
      // Fast natural attack (0.8 ms) + smooth exponential decay + clean zero taper on final 10%
      const attack = Math.min(1, j / Math.max(4, rate * 0.0008));
      const endTaper = u > 0.9 ? (1 - u) / 0.1 : 1;
      const decay = Math.exp(-u * 6.5) * endTaper;
      const env = attack * decay;

      let sample = 0;
      if (hasBubbleChirp) {
        // Real Minnaert bubble physics: tiny water droplets rise slightly in pitch as they resonate!
        const instHz = baseHz * (1 + 0.36 * u);
        phase += (2 * Math.PI * instHz) / rate;
        const click = u < 0.14 ? (rand() * 2 - 1) * (1 - u / 0.14) * 0.35 : 0;
        sample = (Math.sin(phase) * 0.75 + click) * env;
      } else {
        // Soft leaf/window patter grain
        const instHz = baseHz * (1 + 0.12 * u);
        phase += (2 * Math.PI * instHz) / rate;
        sample = ((rand() * 2 - 1) * 0.55 + Math.sin(phase) * 0.45) * env;
      }

      left[idx] += sample * gainL;
      right[idx] += sample * gainR;
    }
  };

  // ~260 soft background foliage/window patters across 12 seconds (~22/sec)
  for (let d = 0; d < 260; d++) {
    const pos = Math.floor(rand() * length);
    const freq = 1400 + rand() * 3400;
    const dur = 0.006 + rand() * 0.011;
    const amp = 0.05 + rand() * 0.11;
    const pan = rand() * 2 - 1;
    addDroplet(pos, freq, dur, amp, pan, false);
  }

  // ~52 distinct close cozy water-drop plinks across 12 seconds (~4.3/sec)
  for (let d = 0; d < 52; d++) {
    const pos = Math.floor(rand() * length);
    const freq = 850 + rand() * 1900;
    const dur = 0.012 + rand() * 0.018;
    const amp = 0.08 + rand() * 0.14;
    const pan = (rand() * 2 - 1) * 0.88;
    addDroplet(pos, freq, dur, amp, pan, true);
  }

  return buffer;
}

export class StereoRainBed {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private cachedBuffer: AudioBuffer | null = null;
  private cachedRate = 0;
  private active = false;
  private speakerSafe = false;
  private intensityMult = 1.0;

  public attach(ctx: AudioContext, destination: AudioNode, speakerSafe: boolean): void {
    this.stop();
    this.ctx = ctx;
    this.speakerSafe = speakerSafe;

    if (!this.cachedBuffer || this.cachedRate !== ctx.sampleRate) {
      this.cachedBuffer = createStereoRainBuffer(ctx, 12);
      this.cachedRate = ctx.sampleRate;
    }

    const src = ctx.createBufferSource();
    src.buffer = this.cachedBuffer;
    src.loop = true;

    // Sculpted cozy rainfall EQ: warm, spatial, zero harsh sibilance
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

    const deHarsh = ctx.createBiquadFilter();
    deHarsh.type = 'peaking';
    deHarsh.frequency.value = 2650;
    deHarsh.Q.value = 0.9;
    deHarsh.gain.value = -3.2;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = speakerSafe ? 2200 : 6400;
    lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);

    src.connect(hp);
    hp.connect(deHarsh);
    deHarsh.connect(lp);
    lp.connect(gain);
    gain.connect(destination);

    src.start(ctx.currentTime);
    this.source = src;
    this.rainGain = gain;
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.applyGain();
  }

  public setIntensityMultiplier(mult: number): void {
    this.intensityMult = Math.max(0.5, Math.min(1.5, mult));
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.ctx || !this.rainGain) return;
    const now = this.ctx.currentTime;
    const baseGain = this.speakerSafe ? 0.24 : 0.66;
    const target = this.active ? Math.min(0.88, baseGain * (0.8 + 0.2 * this.intensityMult)) : 0.0001;
    this.rainGain.gain.setTargetAtTime(target, now, this.active ? 0.65 : 0.45);
  }

  public stop(): void {
    try {
      this.source?.stop();
      this.source?.disconnect();
      this.rainGain?.disconnect();
    } catch {
      // ignore
    }
    this.source = null;
    this.rainGain = null;
    this.ctx = null;
    this.active = false;
  }
}
