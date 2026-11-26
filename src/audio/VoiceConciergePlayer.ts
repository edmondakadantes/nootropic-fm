/**
 * Studio Voice Concierge WebAudio Player
 *
 * Fetches & decodes the 2-part R2-cached Voice Concierge clips (`greetingUrl` + `bodyUrl`),
 * trims dead encoder silence for human-natural breath cadence, normalizes vocal loudness
 * so Layer-1 scientific waves never hit the master safety limiter, shapes vocals through a
 * clear, intimate close-mic studio EQ chain (85 Hz HPF + 195 Hz warmth + 2.9 kHz presence +
 * 6.8 kHz de-ess + subtle room reflection), and coordinates whisper-soft ducking + 5.5s swell on Layer-2 music.
 */

export const VOCAL_TARGET_RMS = 0.195; // -14.2 dBFS clear upfront close-mic speech
export const VOCAL_PEAK_CEILING = 0.56; // Worst-case sum: 0.56*(0.82+0.045) + 0.68*0.12 + 0.19 = 0.756 < 0.8913
export const VOICE_DRY_GAIN = 0.82;
export const VOICE_EARLY_GAIN = 0.045;
export const MUSIC_VOICE_DUCK_GAIN = 0.12; // -18.4 dB soft velvet background bed while Monique speaks
export const MUSIC_FADE_IN_AFTER_VOICE_SEC = 5.5; // Smooth 5.5s dB-linear swell after Monique finishes

function trimAndNormalizeVocalBuffer(ctx: AudioContext, raw: AudioBuffer): AudioBuffer {
  const channels = raw.numberOfChannels;
  const totalLen = raw.length;
  const sr = raw.sampleRate;
  if (totalLen < Math.floor(sr * 0.08) || channels < 1) return raw;

  const silenceThreshold = 0.003;
  let firstActive = totalLen;
  let lastActive = 0;

  for (let ch = 0; ch < channels; ch++) {
    const data = raw.getChannelData(ch);
    for (let i = 0; i < totalLen; i++) {
      if (Math.abs(data[i]) > silenceThreshold) {
        if (i < firstActive) firstActive = i;
        break;
      }
    }
    for (let i = totalLen - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > silenceThreshold) {
        if (i > lastActive) lastActive = i;
        break;
      }
    }
  }

  if (firstActive >= lastActive) return raw;

  const padSamples = Math.floor(sr * 0.02); // 20 ms natural breath cushion on each side
  const startIdx = Math.max(0, firstActive - padSamples);
  const endIdx = Math.min(totalLen, lastActive + padSamples);
  const outLen = Math.max(1, endIdx - startIdx);

  let sumSq = 0;
  let count = 0;
  let maxAbs = 0;
  for (let ch = 0; ch < channels; ch++) {
    const data = raw.getChannelData(ch);
    for (let i = startIdx; i < endIdx; i++) {
      const s = data[i];
      const a = Math.abs(s);
      if (a > maxAbs) maxAbs = a;
      if (a > silenceThreshold) {
        sumSq += s * s;
        count++;
      }
    }
  }

  const activeRms = count > 0 ? Math.sqrt(sumSq / count) : 0.1;
  const desiredGain = activeRms > 0.001 ? VOCAL_TARGET_RMS / activeRms : 1.0;
  const peakSafeGain = maxAbs > 0.001 ? VOCAL_PEAK_CEILING / maxAbs : 1.0;
  const scale = Math.max(0.25, Math.min(2.6, desiredGain, peakSafeGain));

  const out = ctx.createBuffer(channels, outLen, sr);
  for (let ch = 0; ch < channels; ch++) {
    const src = raw.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < outLen; i++) {
      const v = src[startIdx + i] * scale;
      dst[i] = Math.abs(v) > VOCAL_PEAK_CEILING ? Math.tanh(v / VOCAL_PEAK_CEILING) * VOCAL_PEAK_CEILING : v;
    }
  }
  return out;
}

export class VoiceConciergePlayer {
  private ctx: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private inputNode: AudioNode | null = null;
  private voiceGain: GainNode | null = null;
  private endTimer: number | null = null;
  private playToken = 0;
  private onSpeakingChange?: (speaking: boolean, skipped?: boolean) => void;
  private bufferCache = new Map<string, AudioBuffer>();

  public attach(
    ctx: AudioContext,
    destination: AudioNode,
    reverbSend?: AudioNode | null,
    onSpeakingChange?: (speaking: boolean, skipped?: boolean) => void
  ): void {
    this.stop();
    this.ctx = ctx;
    this.onSpeakingChange = onSpeakingChange;

    // Clear intimate close-mic studio vocal chain
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = Math.min(ctx.sampleRate * 0.2, 85);
    hpf.Q.value = 0.707;

    const warmthShelf = ctx.createBiquadFilter();
    warmthShelf.type = 'lowshelf';
    warmthShelf.frequency.value = Math.min(ctx.sampleRate * 0.25, 195);
    warmthShelf.gain.value = 1.2;

    const presenceLift = ctx.createBiquadFilter();
    presenceLift.type = 'peaking';
    presenceLift.frequency.value = Math.min(ctx.sampleRate * 0.4, 2900);
    presenceLift.Q.value = 0.95;
    presenceLift.gain.value = 1.8;

    const deEss = ctx.createBiquadFilter();
    deEss.type = 'peaking';
    deEss.frequency.value = Math.min(ctx.sampleRate * 0.42, 6800);
    deEss.Q.value = 2.0;
    deEss.gain.value = -1.8;

    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = Math.min(ctx.sampleRate * 0.44, 12500);
    airLp.Q.value = 0.707;

    const gain = ctx.createGain();
    gain.gain.value = VOICE_DRY_GAIN;

    // Subtle self-contained stereo studio room reflection (works across Studio Mix, Endless Stream & Live Synth)
    const earlyL = ctx.createDelay(0.1);
    const earlyR = ctx.createDelay(0.1);
    earlyL.delayTime.value = 0.029;
    earlyR.delayTime.value = 0.043;
    const earlyLp = ctx.createBiquadFilter();
    earlyLp.type = 'lowpass';
    earlyLp.frequency.value = Math.min(ctx.sampleRate * 0.44, 2600);
    const earlyGain = ctx.createGain();
    earlyGain.gain.value = VOICE_EARLY_GAIN;
    const merger = ctx.createChannelMerger(2);

    hpf.connect(warmthShelf);
    warmthShelf.connect(presenceLift);
    presenceLift.connect(deEss);
    deEss.connect(airLp);
    airLp.connect(gain);

    airLp.connect(earlyLp);
    earlyLp.connect(earlyL);
    earlyLp.connect(earlyR);
    earlyL.connect(merger, 0, 0);
    earlyR.connect(merger, 0, 1);
    merger.connect(earlyGain);
    earlyGain.connect(destination);
    gain.connect(destination);

    if (reverbSend) {
      const revSend = ctx.createGain();
      revSend.gain.value = 0.045;
      airLp.connect(revSend);
      revSend.connect(reverbSend);
    }

    this.voiceGain = gain;
    this.inputNode = hpf;
  }

  private async fetchAndDecode(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      if (ab.byteLength < 512 || !this.ctx) return null;
      const decoded = await this.ctx.decodeAudioData(ab.slice(0));
      if (!this.ctx) return null;
      const conditioned = trimAndNormalizeVocalBuffer(this.ctx, decoded);
      this.bufferCache.set(url, conditioned);
      return conditioned;
    } catch {
      return null;
    }
  }

  public async playTwoPartCue(opts: {
    greetingUrl: string;
    bodyUrl: string;
    breathPauseMs?: number;
    initialDelayMs?: number;
  }): Promise<boolean> {
    if (!this.ctx || !this.voiceGain) return false;
    const token = ++this.playToken;
    this.cancelActiveVoices(0.12);

    const [greetBuf, bodyBuf] = await Promise.all([
      this.fetchAndDecode(opts.greetingUrl),
      this.fetchAndDecode(opts.bodyUrl),
    ]);

    if (token !== this.playToken || !this.ctx || !this.voiceGain || !greetBuf || !bodyBuf) {
      return false;
    }

    const ctx = this.ctx;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const delaySec = Math.max(0.08, (opts.initialDelayMs ?? 280) / 1000);
    const breathSec = Math.max(0.14, (opts.breathPauseMs ?? 250) / 1000);
    const startAt = ctx.currentTime + delaySec;
    const bodyStartAt = startAt + greetBuf.duration + breathSec;
    const totalEndAt = bodyStartAt + bodyBuf.duration;

    this.voiceGain.gain.cancelScheduledValues(ctx.currentTime);
    this.voiceGain.gain.setValueAtTime(VOICE_DRY_GAIN, ctx.currentTime);

    const greetSrc = ctx.createBufferSource();
    greetSrc.buffer = greetBuf;
    const greetEnv = ctx.createGain();
    greetEnv.gain.setValueAtTime(0.0001, startAt);
    greetEnv.gain.linearRampToValueAtTime(1.0, startAt + Math.min(0.045, greetBuf.duration * 0.2));
    greetEnv.gain.setValueAtTime(1.0, Math.max(startAt + 0.045, startAt + greetBuf.duration - 0.055));
    greetEnv.gain.linearRampToValueAtTime(0.0001, startAt + greetBuf.duration);
    greetSrc.connect(greetEnv);
    greetEnv.connect(this.inputNode ?? this.voiceGain);

    const bodySrc = ctx.createBufferSource();
    bodySrc.buffer = bodyBuf;
    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(0.0001, bodyStartAt);
    bodyEnv.gain.linearRampToValueAtTime(1.0, bodyStartAt + Math.min(0.055, bodyBuf.duration * 0.15));
    bodyEnv.gain.setValueAtTime(1.0, Math.max(bodyStartAt + 0.055, totalEndAt - 0.075));
    bodyEnv.gain.linearRampToValueAtTime(0.0001, totalEndAt);
    bodySrc.connect(bodyEnv);
    bodyEnv.connect(this.inputNode ?? this.voiceGain);

    const finishCue = () => {
      if (this.endTimer !== null) {
        window.clearTimeout(this.endTimer);
        this.endTimer = null;
      }
      if (token === this.playToken) {
        this.activeSources = [];
        this.onSpeakingChange?.(false, false);
      }
    };

    bodySrc.onended = finishCue;
    this.activeSources = [greetSrc, bodySrc];
    this.onSpeakingChange?.(true, false);

    greetSrc.start(startAt);
    bodySrc.start(bodyStartAt);

    // Generous fallback safety timer in case AudioContext closes before `onended`
    const safetyWaitMs = Math.max(2000, Math.round((totalEndAt - ctx.currentTime + 15.0) * 1000));
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
    }
    this.endTimer = window.setTimeout(finishCue, safetyWaitMs);

    return true;
  }

  public cancelActiveVoices(fadeSec = 0.18): void {
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    const prev = this.activeSources;
    this.activeSources = [];
    for (const s of prev) {
      s.onended = null;
    }
    if (prev.length > 0 && this.ctx && this.voiceGain) {
      const now = this.ctx.currentTime;
      try {
        this.voiceGain.gain.cancelScheduledValues(now);
        this.voiceGain.gain.setValueAtTime(this.voiceGain.gain.value, now);
        this.voiceGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      } catch {
        // ignore
      }
      window.setTimeout(() => {
        for (const s of prev) {
          try {
            s.stop();
            s.disconnect();
          } catch {
            // ignore
          }
        }
      }, Math.round((fadeSec + 0.05) * 1000));
      this.onSpeakingChange?.(false, true);
    }
  }

  public stop(): void {
    this.playToken++;
    this.cancelActiveVoices(0.05);
    this.bufferCache.clear();
    try {
      this.voiceGain?.disconnect();
    } catch {
      // ignore
    }
    this.voiceGain = null;
    this.ctx = null;
  }
}
