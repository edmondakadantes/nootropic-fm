/**
 * Real-Time Studio DSP AudioWorklet Suite (`nootropic.fm` v6.1):
 *   1. `nootropic-crossfeed-processor`   — M/S-Balanced Bauer/Linkwitz Headphone Crossfeed (0.000 dB mono error)
 *   2. `nootropic-lookahead-limiter`     — True 5.0 ms Lookahead Stereo-Linked Brickwall Limiter (-0.80 dBFS ceiling)
 *   3. `nootropic-wsola-processor`       — Stereo Phase-Locked WSOLA Pitch & Time Engine (ring + buffer modes)
 *   4. `nootropic-lyria-stream-processor`— Ring-buffered 4-pt Catmull-Rom Cubic Resampler + Cosine Underrun Guard
 *   5. `nootropic-env-follower`          — Background-immune Audio-Thread Stereo RMS Envelope Follower
 */

export const DSP_WORKLET_CODE = `
class NootropicCrossfeedProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'crossLevel', defaultValue: 0.18, minValue: 0, maxValue: 0.35, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.fc = 680;
    const k = Math.tan((Math.PI * this.fc) / sampleRate);
    const norm = 1 / (1 + k);
    this.lpB0 = k * norm;
    this.lpB1 = k * norm;
    this.lpA1 = (k - 1) * norm;

    this.lpX1 = 0;
    this.lpY1 = 0;

    // Exact 260 us interaural time delay (ITD) with fractional interpolation
    this.delaySamples = 0.00026 * sampleRate;
    this.delayMask = 63; // power-of-2 size 64 supports up to ~246 kHz sampleRate
    this.delayRing = new Float32Array(64);
    this.delayWrite = 0;

    this.smoothEnabled = 1;
    this.slew = 1 - Math.exp(-1 / (0.008 * sampleRate));
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;

    if (!inp || inp.length === 0 || !inp[0]) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    const targetEn = parameters.enabled[0];
    const crossLevel = parameters.crossLevel[0];

    const dFloor = Math.floor(this.delaySamples);
    const dFrac = this.delaySamples - dFloor;
    const mask = this.delayMask;
    const b0 = this.lpB0;
    const b1 = this.lpB1;
    const a1 = this.lpA1;

    for (let i = 0; i < outL.length; i++) {
      this.smoothEnabled += (targetEn - this.smoothEnabled) * this.slew;
      const l = inL[i];
      const r = inR[i];
      // Mid-Side balanced Bauer/Linkwitz topology:
      // diff = R - L => when L === R (mono/center), diff === 0 => 0.000 dB error at ALL frequencies!
      const diff = r - l;
      const lpOut = b0 * diff + b1 * this.lpX1 - a1 * this.lpY1;
      this.lpX1 = diff;
      this.lpY1 = lpOut;

      this.delayRing[this.delayWrite] = lpOut;
      const idx0 = (this.delayWrite - dFloor) & mask;
      const idx1 = (idx0 - 1) & mask;
      const delayed = this.delayRing[idx0] + (this.delayRing[idx1] - this.delayRing[idx0]) * dFrac;
      this.delayWrite = (this.delayWrite + 1) & mask;

      const bleed = crossLevel * this.smoothEnabled * delayed;
      outL[i] = l + bleed;
      if (outR) outR[i] = r - bleed;
    }
    return true;
  }
}

class NootropicLookaheadLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: 0.91201084, minValue: 0.2, maxValue: 0.99, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.laLen = Math.max(32, Math.round(0.005 * sampleRate)); // True 5.0 ms lookahead
    this.ringL = new Float32Array(this.laLen);
    this.ringR = new Float32Array(this.laLen);
    this.dqCap = this.laLen + 2;
    this.dqIdx = new Int32Array(this.dqCap);
    this.dqVal = new Float32Array(this.dqCap);
    this.dqHead = 0;
    this.dqTail = 0;
    this.writeIdx = 0;
    this.sampleCount = 0;
    this.gain = 1.0;

    // 0.6 ms attack settles >99.97% across the 5.0 ms lookahead window before peak arrives
    this.atkCoef = 1 - Math.exp(-1 / (0.0006 * sampleRate));
    this.relCoef = 1 - Math.exp(-1 / (0.11 * sampleRate));
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;

    if (!inp || inp.length === 0 || !inp[0]) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    const ceiling = parameters.ceiling[0];
    const laLen = this.laLen;
    const dqCap = this.dqCap;

    for (let i = 0; i < outL.length; i++) {
      const sL = inL[i];
      const sR = inR[i];
      const dL = this.ringL[this.writeIdx];
      const dR = this.ringR[this.writeIdx];
      this.ringL[this.writeIdx] = sL;
      this.ringR[this.writeIdx] = sR;

      const peak = Math.max(Math.abs(sL), Math.abs(sR));

      // O(1) amortized monotonic decreasing deque for future lookahead peak window
      while (this.dqTail !== this.dqHead) {
        const prevSlot = (this.dqTail - 1 + dqCap) % dqCap;
        if (this.dqVal[prevSlot] <= peak) {
          this.dqTail = prevSlot;
        } else {
          break;
        }
      }
      this.dqIdx[this.dqTail] = this.sampleCount;
      this.dqVal[this.dqTail] = peak;
      this.dqTail = (this.dqTail + 1) % dqCap;

      const minValidIdx = this.sampleCount - laLen + 1;
      while (this.dqHead !== this.dqTail && this.dqIdx[this.dqHead] < minValidIdx) {
        this.dqHead = (this.dqHead + 1) % dqCap;
      }

      const winPeak = this.dqHead !== this.dqTail ? this.dqVal[this.dqHead] : 0;
      const targetGain = winPeak > ceiling ? ceiling / winPeak : 1.0;

      if (targetGain < this.gain) {
        this.gain += (targetGain - this.gain) * this.atkCoef;
      } else {
        this.gain += (targetGain - this.gain) * this.relCoef;
      }

      // Hard single-sample invariant guard against residual 0.02% exponential tail
      const dPeak = Math.max(Math.abs(dL), Math.abs(dR));
      const appliedGain = dPeak * this.gain > ceiling && dPeak > 0 ? ceiling / dPeak : this.gain;

      outL[i] = dL * appliedGain;
      if (outR) outR[i] = dR * appliedGain;

      this.writeIdx = (this.writeIdx + 1) % laLen;
      this.sampleCount++;
    }
    return true;
  }
}

class NootropicWsolaProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchRatio', defaultValue: 1.0, minValue: 0.72, maxValue: 1.38, automationRate: 'k-rate' },
      { name: 'tempoRatio', defaultValue: 1.0, minValue: 0.72, maxValue: 1.38, automationRate: 'k-rate' },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const pOpts = (options && options.processorOptions) || {};
    this.mode = pOpts.mode === 'buffer' ? 'buffer' : 'ring';
    this.sourceScale = Number(pOpts.sourceScale) > 0 ? Number(pOpts.sourceScale) : 1.0;

    const srScale = sampleRate >= 88200 ? 2 : 1;
    this.W = 2048 * srScale;
    this.Hs = 1024 * srScale;
    this.DELTA_MAX = 512 * srScale;
    this.DELAY_BASE = 3840 * srScale;
    this.RING_SIZE = (this.mode === 'buffer' ? 65536 : 32768) * srScale;
    this.RING_MASK = this.RING_SIZE - 1;

    this.hann = new Float32Array(this.W);
    for (let i = 0; i < this.W; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.W));
    }

    this.ringL = new Float32Array(this.RING_SIZE);
    this.ringR = new Float32Array(this.RING_SIZE);
    this.olaL = new Float32Array(this.W);
    this.olaR = new Float32Array(this.W);
    this.prevTailL = new Float32Array(this.Hs);
    this.prevTailR = new Float32Array(this.Hs);

    this.writePos = 0;
    this.olaIdx = 0;
    this.hasPrev = false;

    // Buffer-mode state
    this.inputCursor = 0;
    this.sourceEnded = false;
    this.eofSent = false;
    this.eofFadeSamples = 0;
    this.requestedChunks = false;
    this.lastProgressPos = 0;
    this.stopped = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'chunk' && msg.left && msg.right) {
        const len = Math.min(msg.left.length, msg.right.length);
        for (let i = 0; i < len; i++) {
          const slot = this.writePos & this.RING_MASK;
          this.ringL[slot] = msg.left[i];
          this.ringR[slot] = msg.right[i];
          this.writePos++;
        }
        this.requestedChunks = false;
      } else if (msg.type === 'end') {
        const padCount = Math.ceil(this.W * 1.5) + this.DELTA_MAX + 16;
        for (let i = 0; i < padCount; i++) {
          const slot = (this.writePos + i) & this.RING_MASK;
          this.ringL[slot] = 0;
          this.ringR[slot] = 0;
        }
        this.sourceEnded = true;
      } else if (msg.type === 'stop') {
        this.stopped = true;
      } else if (msg.type === 'reset') {
        this.ringL.fill(0);
        this.ringR.fill(0);
        this.olaL.fill(0);
        this.olaR.fill(0);
        this.prevTailL.fill(0);
        this.prevTailR.fill(0);
        this.writePos = 0;
        this.olaIdx = 0;
        this.hasPrev = false;
        this.inputCursor = 0;
        this.sourceEnded = false;
        this.eofSent = false;
        this.eofFadeSamples = 0;
        this.requestedChunks = false;
        this.lastProgressPos = 0;
        this.stopped = false;
      }
    };
  }

  readCubic(ring, pos) {
    const mask = this.RING_MASK;
    const i1 = Math.floor(pos);
    const t = pos - i1;
    const y0 = ring[(i1 - 1) & mask];
    const y1 = ring[i1 & mask];
    const y2 = ring[(i1 + 1) & mask];
    const y3 = ring[(i1 + 2) & mask];
    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + c0;
  }

  findBestStereoDelta(nominalStart, step, minDelta, maxDelta) {
    if (!this.hasPrev || Math.abs(step - 1.0) < 0.0002 && this.mode === 'ring') {
      return 0;
    }
    const Hs = this.Hs;
    let refE = 0;
    for (let k = 0; k < Hs; k += 4) {
      const l = this.prevTailL[k];
      const r = this.prevTailR[k];
      refE += l * l + r * r;
    }
    if (refE <= 1e-8) return 0;

    let bestDelta = 0;
    let bestCorr = -Infinity;
    const ringL = this.ringL;
    const ringR = this.ringR;

    for (let d = minDelta; d <= maxDelta; d += 4) {
      let num = 0;
      let candE = 0;
      const base = nominalStart + d;
      for (let k = 0; k < Hs; k += 4) {
        const p = base + k * step;
        const cL = this.readCubic(ringL, p);
        const cR = this.readCubic(ringR, p);
        num += this.prevTailL[k] * cL + this.prevTailR[k] * cR;
        candE += cL * cL + cR * cR;
      }
      const score = num / (Math.sqrt(refE * candE) + 1e-9);
      if (score > bestCorr) {
        bestCorr = score;
        bestDelta = d;
      }
    }

    const coarseBest = bestDelta;
    const fineLo = Math.max(minDelta, coarseBest - 3);
    const fineHi = Math.min(maxDelta, coarseBest + 3);
    for (let d = fineLo; d <= fineHi; d++) {
      let num = 0;
      let candE = 0;
      const base = nominalStart + d;
      for (let k = 0; k < Hs; k += 2) {
        const p = base + k * step;
        const cL = this.readCubic(ringL, p);
        const cR = this.readCubic(ringR, p);
        num += this.prevTailL[k] * cL + this.prevTailR[k] * cR;
        candE += cL * cL + cR * cR;
      }
      const score = num / (Math.sqrt(refE * candE) + 1e-9);
      if (score > bestCorr) {
        bestCorr = score;
        bestDelta = d;
      }
    }
    return bestDelta;
  }

  synthGrain(nominalStart, step, minDelta, maxDelta) {
    const W = this.W;
    const Hs = this.Hs;
    const bestDelta = this.findBestStereoDelta(nominalStart, step, minDelta, maxDelta);
    const start = nominalStart + bestDelta;
    const ringL = this.ringL;
    const ringR = this.ringR;
    const isUnity = Math.abs(step - 1.0) < 0.0002;

    for (let k = 0; k < W; k++) {
      const p = start + k * step;
      let sL, sR;
      if (isUnity && Math.abs(p - Math.round(p)) < 1e-4) {
        const slot = Math.round(p) & this.RING_MASK;
        sL = ringL[slot];
        sR = ringR[slot];
      } else {
        sL = this.readCubic(ringL, p);
        sR = this.readCubic(ringR, p);
      }
      const w = this.hann[k];
      this.olaL[k] += sL * w;
      this.olaR[k] += sR * w;
      if (k >= Hs) {
        this.prevTailL[k - Hs] = sL;
        this.prevTailR[k - Hs] = sR;
      }
    }
    this.hasPrev = true;
  }

  shiftOlaHalf() {
    const Hs = this.Hs;
    for (let k = 0; k < Hs; k++) {
      this.olaL[k] = this.olaL[k + Hs];
      this.olaR[k] = this.olaR[k + Hs];
      this.olaL[k + Hs] = 0;
      this.olaR[k + Hs] = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return !this.stopped;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    if (this.stopped) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return false;
    }

    const pitchRatio = parameters.pitchRatio[0];
    const tempoRatio = parameters.tempoRatio[0];
    const bypass = parameters.bypass[0] >= 0.5;

    if (this.mode === 'ring') {
      const inp = inputs[0];
      if (!inp || inp.length === 0 || !inp[0]) {
        outL.fill(0);
        if (outR) outR.fill(0);
        return true;
      }
      const inL = inp[0];
      const inR = inp.length > 1 ? inp[1] : inp[0];
      const minPrimed = this.DELAY_BASE + this.DELTA_MAX + Math.ceil(this.W * 1.38);

      for (let i = 0; i < outL.length; i++) {
        const sL = inL[i];
        const sR = inR[i];
        const slot = this.writePos & this.RING_MASK;
        this.ringL[slot] = sL;
        this.ringR[slot] = sR;
        this.writePos++;

        if (bypass) {
          outL[i] = sL;
          if (outR) outR[i] = sR;
          continue;
        }

        if (this.writePos < minPrimed) {
          outL[i] = 0;
          if (outR) outR[i] = 0;
          continue;
        }

        if (this.olaIdx === 0) {
          const nominalStart = this.writePos - this.DELAY_BASE;
          this.synthGrain(nominalStart, pitchRatio, -this.DELTA_MAX, this.DELTA_MAX);
        }
        outL[i] = this.olaL[this.olaIdx];
        if (outR) outR[i] = this.olaR[this.olaIdx];
        this.olaIdx++;
        if (this.olaIdx >= this.Hs) {
          this.shiftOlaHalf();
          this.olaIdx = 0;
        }
      }
      return true;
    }

    // Buffer mode (AudioBuffer playback with decoupled tempoRatio + pitchRatio)
    const step = pitchRatio * this.sourceScale;
    const minNeededAhead = Math.ceil(this.W * step) + this.DELTA_MAX + 8;
    const requestThreshold = Math.floor(this.RING_SIZE * 0.55);

    if (!this.sourceEnded && !this.requestedChunks && (this.writePos - this.inputCursor) < requestThreshold) {
      this.requestedChunks = true;
      this.port.postMessage({ type: 'need_chunk' });
    }

    for (let i = 0; i < outL.length; i++) {
      const avail = this.writePos - this.inputCursor;
      if (this.olaIdx === 0 && avail < minNeededAhead && !this.sourceEnded) {
        outL[i] = 0;
        if (outR) outR[i] = 0;
        continue;
      }

      if (this.sourceEnded && avail <= 0) {
        if (!this.eofSent) {
          this.eofSent = true;
          this.port.postMessage({ type: 'eof' });
        }
        if (this.olaIdx < this.Hs && this.eofFadeSamples < 256) {
          const fade = 1 - this.eofFadeSamples / 256;
          outL[i] = this.olaL[this.olaIdx] * fade;
          if (outR) outR[i] = this.olaR[this.olaIdx] * fade;
          this.olaIdx++;
          this.eofFadeSamples++;
        } else {
          outL[i] = 0;
          if (outR) outR[i] = 0;
        }
        continue;
      }

      if (this.olaIdx === 0) {
        const maxBack = Math.min(this.DELTA_MAX, Math.floor(this.inputCursor));
        const maxFwd = this.sourceEnded
          ? 0
          : Math.min(
              this.DELTA_MAX,
              Math.max(0, Math.floor(this.writePos - this.inputCursor - Math.ceil(this.W * step) - 2))
            );
        this.synthGrain(this.inputCursor, step, -maxBack, maxFwd);
        this.inputCursor += tempoRatio * this.sourceScale * this.Hs;
        if (this.inputCursor - this.lastProgressPos >= 16384) {
          this.lastProgressPos = this.inputCursor;
          this.port.postMessage({ type: 'progress', sourceFrame: this.inputCursor });
        }
      }

      outL[i] = this.olaL[this.olaIdx];
      if (outR) outR[i] = this.olaR[this.olaIdx];
      this.olaIdx++;
      if (this.olaIdx >= this.Hs) {
        this.shiftOlaHalf();
        this.olaIdx = 0;
      }
    }
    return true;
  }
}

class NootropicLyriaStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.RING_SIZE = 262144; // ~5.46s @ 48 kHz (power of 2)
    this.RING_MASK = this.RING_SIZE - 1;
    this.ringL = new Float32Array(this.RING_SIZE);
    this.ringR = new Float32Array(this.RING_SIZE);
    this.writePos = 0;
    this.readPos = 0;
    this.primed = false;
    this.minPrimeFrames = 4800; // 100 ms @ 48 kHz
    this.maxBufferFrames = 144000; // 3.0 s overflow protection ceiling
    this.step = 48000 / sampleRate;
    this.fadeGain = 0;
    this.fadeStep = 1 / Math.max(64, Math.round(0.008 * sampleRate)); // 8 ms click-free cosine ramp
    this.prevOutL = 0;
    this.prevOutR = 0;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'pcm' && data.left && data.right) {
        const len = Math.min(data.left.length, data.right.length);
        for (let i = 0; i < len; i++) {
          const slot = this.writePos & this.RING_MASK;
          this.ringL[slot] = data.left[i];
          this.ringR[slot] = data.right[i];
          this.writePos++;
        }
        const buffered = this.writePos - this.readPos;
        if (buffered > this.maxBufferFrames) {
          // Catch up cleanly to ~1.2s buffered if network bursts far ahead
          this.readPos = this.writePos - 57600;
        }
        if (!this.primed && this.writePos - this.readPos >= this.minPrimeFrames) {
          this.primed = true;
        }
      } else if (data.type === 'clear') {
        this.writePos = 0;
        this.readPos = 0;
        this.primed = false;
        this.fadeGain = 0;
        this.prevOutL = 0;
        this.prevOutR = 0;
        this.ringL.fill(0);
        this.ringR.fill(0);
      }
    };
  }

  readCubic(ring, pos) {
    const mask = this.RING_MASK;
    const i1 = Math.floor(pos);
    const t = pos - i1;
    const y0 = ring[(i1 - 1) & mask];
    const y1 = ring[i1 & mask];
    const y2 = ring[(i1 + 1) & mask];
    const y3 = ring[(i1 + 2) & mask];
    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + c0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const outL = out[0];
    const outR = out[1];

    if (!this.primed) {
      for (let i = 0; i < outL.length; i++) {
        this.prevOutL *= 0.96;
        this.prevOutR *= 0.96;
        outL[i] = this.prevOutL;
        outR[i] = this.prevOutR;
      }
      return true;
    }

    const fadeOutMargin = Math.max(256, Math.round(0.01 * 48000));
    for (let i = 0; i < outL.length; i++) {
      const rem = this.writePos - this.readPos;
      if (rem < 4) {
        this.primed = false;
        this.fadeGain = 0;
        this.prevOutL *= 0.94;
        this.prevOutR *= 0.94;
        outL[i] = this.prevOutL;
        outR[i] = this.prevOutR;
        continue;
      }

      if (rem < fadeOutMargin) {
        this.fadeGain = Math.max(0, this.fadeGain - this.fadeStep);
      } else if (this.fadeGain < 1) {
        this.fadeGain = Math.min(1, this.fadeGain + this.fadeStep);
      }
      const env = 0.5 * (1 - Math.cos(Math.PI * this.fadeGain));

      const sL = this.readCubic(this.ringL, this.readPos) * env;
      const sR = this.readCubic(this.ringR, this.readPos) * env;
      outL[i] = sL;
      outR[i] = sR;
      this.prevOutL = sL;
      this.prevOutR = sR;
      this.readPos += this.step;
    }
    return true;
  }
}

class NootropicEnvFollower extends AudioWorkletProcessor {
  constructor() {
    super();
    this.winFrames = Math.max(1024, Math.round(0.09 * sampleRate)); // ~90 ms report cadence
    this.accSq = 0;
    this.count = 0;
    this.smoothedRms = 0.165;
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || inp.length === 0 || !inp[0]) return true;
    const inL = inp[0];
    const inR = inp.length > 1 ? inp[1] : inp[0];
    for (let i = 0; i < inL.length; i++) {
      const l = inL[i];
      const r = inR[i];
      this.accSq += 0.5 * (l * l + r * r);
      this.count++;
    }
    if (this.count >= this.winFrames) {
      const rms = Math.sqrt(this.accSq / this.count);
      const alpha = rms > this.smoothedRms ? 0.28 : 0.14;
      this.smoothedRms += alpha * (rms - this.smoothedRms);
      this.port.postMessage({ type: 'env', rms: this.smoothedRms });
      this.accSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('nootropic-crossfeed-processor', NootropicCrossfeedProcessor);
registerProcessor('nootropic-lookahead-limiter', NootropicLookaheadLimiter);
registerProcessor('nootropic-wsola-processor', NootropicWsolaProcessor);
registerProcessor('nootropic-lyria-stream-processor', NootropicLyriaStreamProcessor);
registerProcessor('nootropic-env-follower', NootropicEnvFollower);
`;

const loadedWorkletContexts = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Registers the entire v6.1 Studio DSP AudioWorklet bundle at most ONCE per AudioContext,
 * preventing duplicate `registerProcessor` NotSupportedError on mid-session mode switches.
 */
export function ensureDspWorkletsLoaded(ctx: BaseAudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) return Promise.resolve(false);
  const existing = loadedWorkletContexts.get(ctx);
  if (existing) return existing;

  const promise = (async () => {
    const blob = new Blob([DSP_WORKLET_CODE], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(blobUrl);
      return true;
    } catch {
      return false;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  })();

  loadedWorkletContexts.set(ctx, promise);
  return promise;
}
