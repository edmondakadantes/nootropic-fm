import { buildLyriaRealtimeConfig, type ExecutableStudySpec } from '../../shared/studySpec';

export type LyriaRealtimeStatus = 'idle' | 'connecting' | 'streaming' | 'unavailable' | 'error';

const WORKLET_PROCESSOR_CODE = `
class LyriaPcmStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.bufferedFrames = 0;
    this.primed = false;
    this.minPrimeFrames = 4800; // ~100ms jitter buffer at 48kHz
    this.step = 48000 / sampleRate; // Smoothly resample 48kHz Lyria PCM to browser AudioContext rate
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'pcm') {
        this.queue.push({ left: e.data.left, right: e.data.right, offset: 0 });
        this.bufferedFrames += e.data.left.length;
        if (this.bufferedFrames >= this.minPrimeFrames) {
          this.primed = true;
        }
      } else if (e.data && e.data.type === 'clear') {
        this.queue = [];
        this.bufferedFrames = 0;
        this.primed = false;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const outL = out[0];
    const outR = out[1];

    if (!this.primed || this.queue.length === 0) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    for (let i = 0; i < outL.length; i++) {
      if (this.queue.length === 0) {
        outL[i] = 0;
        outR[i] = 0;
        this.primed = false;
      } else {
        const chunk = this.queue[0];
        const idx = Math.floor(chunk.offset);
        const frac = chunk.offset - idx;
        const nextIdx = Math.min(chunk.left.length - 1, idx + 1);
        outL[i] = chunk.left[idx] + (chunk.left[nextIdx] - chunk.left[idx]) * frac;
        outR[i] = chunk.right[idx] + (chunk.right[nextIdx] - chunk.right[idx]) * frac;
        chunk.offset += this.step;
        while (this.queue.length > 0 && this.queue[0].offset >= this.queue[0].left.length) {
          const overflow = this.queue[0].offset - this.queue[0].left.length;
          this.bufferedFrames = Math.max(0, this.bufferedFrames - this.queue[0].left.length);
          this.queue.shift();
          if (this.queue.length > 0) {
            this.queue[0].offset += overflow;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('lyria-pcm-stream-processor', LyriaPcmStreamProcessor);
`;

function decodeBase64Pcm16Stereo(b64: string): { left: Float32Array; right: Float32Array } {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const frames = Math.floor(int16.length / 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0, j = 0; i < frames; i++, j += 2) {
    left[i] = int16[j] / 32768;
    right[i] = int16[j + 1] / 32768;
  }
  return { left, right };
}

/**
 * Plug-and-Play Google Lyria RealTime (`lyria-realtime-exp`) WebSocket + AudioWorklet client.
 * Connects directly from browser using a short-lived ephemeral token minted by `/api/music/realtime-token`,
 * streams 48 kHz Stereo PCM into `destinationBus` (entering our 3-Band LR4 Medical DSP Rack!),
 * and gracefully reports `'unavailable'` when running in $0/month mode.
 */
export class LyriaRealtimeClient {
  private ws: WebSocket | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private outputGain: GainNode | null = null;
  private status: LyriaRealtimeStatus = 'idle';
  private onStatusChange?: (status: LyriaRealtimeStatus, note?: string) => void;

  public async connect(opts: {
    ctx: AudioContext;
    destinationBus: AudioNode;
    token: string;
    model: string;
    spec: ExecutableStudySpec;
    apiBase?: string;
    onStatusChange?: (status: LyriaRealtimeStatus, note?: string) => void;
  }): Promise<boolean> {
    this.stop();
    this.onStatusChange = opts.onStatusChange;
    this.setStatus('connecting', 'Connecting to Google Lyria RealTime stream...');

    if (!opts.ctx.audioWorklet) {
      this.setStatus('unavailable', 'AudioWorklet unsupported in this browser; using Live Generative Composer.');
      return false;
    }

    try {
      const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        await opts.ctx.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      const workletNode = new AudioWorkletNode(opts.ctx, 'lyria-pcm-stream-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const outGain = opts.ctx.createGain();
      outGain.gain.setValueAtTime(0.0001, opts.ctx.currentTime);
      workletNode.connect(outGain);
      outGain.connect(opts.destinationBus);

      this.workletNode = workletNode;
      this.outputGain = outGain;

      const httpBase = (opts.apiBase || window.location.origin).replace(/\/+$/, '');
      const wsBase = httpBase.replace(/^http/i, 'ws');
      const wsUrl = `${wsBase}/api/music/realtime-ws?ticket=${encodeURIComponent(opts.token)}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const lyriaCfg = buildLyriaRealtimeConfig(opts.spec);

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        let sentStart = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };

        const timeout = window.setTimeout(() => {
          if (!settled) {
            this.setStatus('error', 'Lyria RealTime handshake timed out — using Live Generative Composer.');
            this.stop();
            finish(false);
          }
        }, 10000);

        ws.onopen = () => {
          // 1. Setup model first; wait for server's setupComplete before steering & PLAY
          ws.send(JSON.stringify({ setup: { model: opts.model || 'models/lyria-realtime-exp' } }));
        };

        ws.onmessage = async (evt) => {
          try {
            let raw: string;
            if (typeof evt.data === 'string') {
              raw = evt.data;
            } else if (evt.data instanceof ArrayBuffer) {
              raw = new TextDecoder().decode(evt.data);
            } else if (evt.data instanceof Blob) {
              raw = await evt.data.text();
            } else {
              raw = String(evt.data);
            }
            const msg = JSON.parse(raw) as {
              setupComplete?: Record<string, unknown>;
              serverContent?: {
                audioChunks?: Array<{ data?: string }>;
              };
            };

            if (msg.setupComplete && !sentStart) {
              sentStart = true;
              // 2. Send weighted prompts from ExecutableStudySpec
              ws.send(
                JSON.stringify({
                  clientContent: {
                    weightedPrompts: lyriaCfg.weightedPrompts,
                  },
                })
              );
              // 3. Send exact study BPM, scale, density, brightness, muteDrums lock
              ws.send(
                JSON.stringify({
                  musicGenerationConfig: {
                    bpm: lyriaCfg.config.bpm,
                    density: lyriaCfg.config.density,
                    brightness: lyriaCfg.config.brightness,
                    scale: lyriaCfg.config.scale,
                    muteBass: lyriaCfg.config.muteBass,
                    muteDrums: lyriaCfg.config.muteDrums,
                    guidance: lyriaCfg.config.guidance,
                    temperature: 1.0,
                  },
                })
              );
              // 4. Start live streaming playback
              ws.send(JSON.stringify({ playbackControl: 'PLAY' }));
              return;
            }

            const chunks = msg.serverContent?.audioChunks ?? [];
            if (chunks.length > 0 && this.workletNode) {
              for (const ch of chunks) {
                if (!ch.data) continue;
                const { left, right } = decodeBase64Pcm16Stereo(ch.data);
                this.workletNode.port.postMessage(
                  { type: 'pcm', left, right },
                  [left.buffer, right.buffer]
                );
              }
              if (this.status !== 'streaming') {
                window.clearTimeout(timeout);
                this.setStatus('streaming', 'Google Lyria RealTime AI streaming live through 3-Band LR4 DSP');
                this.outputGain?.gain.exponentialRampToValueAtTime(0.92, opts.ctx.currentTime + 1.5);
                finish(true);
              }
            }
          } catch {
            // ignore non-audio control frames
          }
        };

        ws.onerror = () => {
          window.clearTimeout(timeout);
          this.setStatus('error', 'Lyria RealTime stream error — falling back cleanly to Live Generative Composer.');
          finish(false);
        };

        ws.onclose = () => {
          window.clearTimeout(timeout);
          if (this.status === 'connecting') {
            this.setStatus('unavailable', 'Lyria RealTime closed — running on $0 Live Generative Composer.');
            finish(false);
          }
        };
      });
    } catch {
      this.setStatus('error', 'Could not initialize Lyria RealTime — using Live Generative Composer.');
      this.stop();
      return false;
    }
  }

  /**
   * Steers live Lyria RealTime density & brightness as user adjusts controls mid-session.
   */
  public steer(spec: ExecutableStudySpec, intensityMult: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const cfg = buildLyriaRealtimeConfig(spec);
    const density = Math.max(0.1, Math.min(0.95, cfg.config.density * intensityMult));
    const brightness = Math.max(0.1, Math.min(0.95, cfg.config.brightness * (0.85 + 0.15 * intensityMult)));
    try {
      this.ws.send(
        JSON.stringify({
          musicGenerationConfig: {
            bpm: cfg.config.bpm,
            density: Number(density.toFixed(2)),
            brightness: Number(brightness.toFixed(2)),
            scale: cfg.config.scale,
            muteBass: cfg.config.muteBass,
            muteDrums: cfg.config.muteDrums,
            guidance: cfg.config.guidance,
            temperature: 1.0,
          },
        })
      );
    } catch {
      // ignore transient ws error
    }
  }

  private setStatus(status: LyriaRealtimeStatus, note?: string): void {
    this.status = status;
    this.onStatusChange?.(status, note);
  }

  public getStatus(): LyriaRealtimeStatus {
    return this.status;
  }

  public stop(): void {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ playbackControl: 'STOP' }));
        }
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'clear' });
        this.workletNode.disconnect();
      } catch {
        // ignore
      }
      this.workletNode = null;
    }
    if (this.outputGain) {
      try {
        this.outputGain.disconnect();
      } catch {
        // ignore
      }
      this.outputGain = null;
    }
    this.status = 'idle';
  }
}
