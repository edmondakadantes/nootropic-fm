/**
 * Lightweight 48 kHz WebAudio interactive 30-second proof engine for nootropic.fm Flagship Showcase.
 * Lets visitors compare Flat consumer sound vs. 6x40 Hz Signature Mode vs. Huggins 600 Hz Dichotic Seal Test.
 */

export type ShowcaseDemoMode = 'flat' | 'signature_6x40' | 'huggins_600';

export class ShowcaseMiniDemo {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private hugginsGain: GainNode | null = null;
  private oscNodes: AudioNode[] = [];
  private stopTimer: number | null = null;
  private running = false;
  private currentMode: ShowcaseDemoMode = 'signature_6x40';
  private onAutoStop?: () => void;

  public isPlaying(): boolean {
    return this.running;
  }

  public getMode(): ShowcaseDemoMode {
    return this.currentMode;
  }

  public async start(
    mode: ShowcaseDemoMode,
    opts?: { durationMs?: number; onAutoStop?: () => void }
  ): Promise<void> {
    this.stop();
    this.currentMode = mode;
    this.onAutoStop = opts?.onAutoStop;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 48000 });
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.35);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;

    master.connect(analyser);
    analyser.connect(ctx.destination);
    this.masterGain = master;
    this.analyser = analyser;

    // 1. Warm A2-E3-B3-C#4 pad bus (filtered inside 190-4500 Hz cortical window)
    const padGain = ctx.createGain();
    padGain.gain.value = mode === 'huggins_600' ? 0.0001 : 0.72;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowpass';
    lowShelf.frequency.value = 3400;
    lowShelf.Q.value = 0.707;

    const splitL = ctx.createGain();
    const splitR = ctx.createGain();
    const merger = ctx.createChannelMerger(2);

    splitL.connect(merger, 0, 0);
    splitR.connect(merger, 0, 1);
    merger.connect(lowShelf);
    lowShelf.connect(padGain);
    padGain.connect(master);

    this.padGain = padGain;

    const chordFreqs = [110.0, 164.81, 220.0, 246.94, 277.18, 329.63];
    for (let i = 0; i < chordFreqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'triangle' : 'sine';
      osc.frequency.value = chordFreqs[i];
      osc.detune.value = (i % 2 === 0 ? -1 : 1) * (i * 1.4);
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = i < 2 ? 0.22 : 0.14;
      osc.connect(voiceGain);
      voiceGain.connect(splitL);
      voiceGain.connect(splitR);
      osc.start();
      this.oscNodes.push(osc, voiceGain);
    }

    // 40 Hz Gamma nested shimmer + 6 Hz Theta amplitude modulation for Signature Mode
    const lfo6L = ctx.createOscillator();
    lfo6L.frequency.value = 6.0;
    const lfo6DepthL = ctx.createGain();
    lfo6DepthL.gain.value = mode === 'signature_6x40' ? 0.22 : 0.0;
    lfo6L.connect(lfo6DepthL);
    lfo6DepthL.connect(splitL.gain);
    lfo6L.start();

    const lfo6R = ctx.createOscillator();
    lfo6R.frequency.value = 6.0;
    const lfo6DepthR = ctx.createGain();
    lfo6DepthR.gain.value = mode === 'signature_6x40' ? 0.22 : 0.0;
    lfo6R.connect(lfo6DepthR);
    lfo6DepthR.connect(splitR.gain);
    lfo6R.start();

    // 40 Hz harmonic pulse
    const lfo40 = ctx.createOscillator();
    lfo40.frequency.value = 40.0;
    const lfo40Depth = ctx.createGain();
    lfo40Depth.gain.value = mode === 'signature_6x40' ? 0.16 : 0.0;
    lfo40.connect(lfo40Depth);
    lfo40Depth.connect(splitL.gain);
    lfo40Depth.connect(splitR.gain);
    lfo40.start();

    // 0.10 Hz Mayer wave gentle stereo drift
    const mayer = ctx.createOscillator();
    mayer.frequency.value = 0.1;
    const mayerDepthL = ctx.createGain();
    const mayerDepthR = ctx.createGain();
    mayerDepthL.gain.value = mode === 'signature_6x40' ? 0.12 : 0.0;
    mayerDepthR.gain.value = mode === 'signature_6x40' ? -0.12 : 0.0;
    mayer.connect(mayerDepthL);
    mayer.connect(mayerDepthR);
    mayerDepthL.connect(splitL.gain);
    mayerDepthR.connect(splitR.gain);
    mayer.start();

    // 2. Huggins 600 Hz Dichotic Phase Verification bus (pink noise + Right-only 180-deg all-pass at 600 Hz)
    const bufferLen = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      ch[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    const hugginsBus = ctx.createGain();
    hugginsBus.gain.value = mode === 'huggins_600' ? 0.85 : 0.0001;
    this.hugginsGain = hugginsBus;

    const hugMerger = ctx.createChannelMerger(2);
    const ap1 = ctx.createBiquadFilter();
    ap1.type = 'allpass';
    ap1.frequency.value = 600;
    ap1.Q.value = 10;

    const ap2 = ctx.createBiquadFilter();
    ap2.type = 'allpass';
    ap2.frequency.value = 600;
    ap2.Q.value = 10;

    // Gentle 2 Hz rhythmic gate on the phase-shifted ear makes the 600 Hz illusion crystal-clear in earbuds
    const apGain = ctx.createGain();
    apGain.gain.value = 0.95;

    noiseSrc.connect(hugMerger, 0, 0);
    noiseSrc.connect(ap1);
    ap1.connect(ap2);
    ap2.connect(apGain);
    apGain.connect(hugMerger, 0, 1);
    hugMerger.connect(hugginsBus);
    hugginsBus.connect(master);
    noiseSrc.start();

    this.oscNodes.push(
      lfo6L,
      lfo6DepthL,
      lfo6R,
      lfo6DepthR,
      lfo40,
      lfo40Depth,
      mayer,
      mayerDepthL,
      mayerDepthR,
      noiseSrc,
      ap1,
      ap2,
      apGain,
      splitL,
      splitR,
      merger,
      lowShelf,
      padGain,
      hugginsBus,
      hugMerger
    );

    // Store modulation depth controls cleanly via instance map on this object
    this.depthControls = {
      lfo6DepthL,
      lfo6DepthR,
      lfo40Depth,
      mayerDepthL,
      mayerDepthR,
    };

    this.running = true;
    const durationMs = opts?.durationMs ?? 30_000;
    this.stopTimer = window.setTimeout(() => {
      this.stop();
      this.onAutoStop?.();
    }, durationMs);
  }

  private depthControls: {
    lfo6DepthL: GainNode;
    lfo6DepthR: GainNode;
    lfo40Depth: GainNode;
    mayerDepthL: GainNode;
    mayerDepthR: GainNode;
  } | null = null;

  public setMode(mode: ShowcaseDemoMode): void {
    this.currentMode = mode;
    if (!this.ctx || !this.running || !this.padGain || !this.hugginsGain || !this.depthControls) {
      return;
    }
    const t = this.ctx.currentTime;
    const isSig = mode === 'signature_6x40';
    const isHug = mode === 'huggins_600';

    this.padGain.gain.setTargetAtTime(isHug ? 0.0001 : 0.72, t, 0.08);
    this.hugginsGain.gain.setTargetAtTime(isHug ? 0.85 : 0.0001, t, 0.08);

    this.depthControls.lfo6DepthL.gain.setTargetAtTime(isSig ? 0.22 : 0, t, 0.08);
    this.depthControls.lfo6DepthR.gain.setTargetAtTime(isSig ? 0.22 : 0, t, 0.08);
    this.depthControls.lfo40Depth.gain.setTargetAtTime(isSig ? 0.16 : 0, t, 0.08);
    this.depthControls.mayerDepthL.gain.setTargetAtTime(isSig ? 0.12 : 0, t, 0.08);
    this.depthControls.mayerDepthR.gain.setTargetAtTime(isSig ? -0.12 : 0, t, 0.08);
  }

  public getWaveformSamples(out: Float32Array<ArrayBuffer>): boolean {
    if (!this.analyser || !this.running) return false;
    this.analyser.getFloatTimeDomainData(out);
    return true;
  }

  public stop(): void {
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.running = false;
    this.depthControls = null;
    this.padGain = null;
    this.hugginsGain = null;

    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
      } catch {
        // ignore
      }
    }

    for (const node of this.oscNodes) {
      try {
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.oscNodes = [];

    if (this.ctx) {
      const closingCtx = this.ctx;
      this.ctx = null;
      this.analyser = null;
      this.masterGain = null;
      void closingCtx.close().catch(() => {});
    }
  }
}
