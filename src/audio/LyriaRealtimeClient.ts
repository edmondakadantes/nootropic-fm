import { buildLyriaRealtimeConfig, type ExecutableStudySpec } from '../../shared/studySpec';
import type { ResolvedGenre } from '../../shared/types';

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
  private intentionalStop = false;
  private activeGenre: ResolvedGenre | undefined;
  private activeSpec: ExecutableStudySpec | null = null;
  private activeCtx: AudioContext | null = null;
  private activeApiBase = '';
  private fetchFreshToken?: () => Promise<{ token: string; model?: string } | null>;
  private reconnectCount = 0;
  private reconnectTimer: number | null = null;
  private lastSentBpm = 0;

  public async connect(opts: {
    ctx: AudioContext;
    destinationBus: AudioNode;
    token: string;
    model: string;
    spec: ExecutableStudySpec;
    genre?: ResolvedGenre;
    apiBase?: string;
    fetchFreshToken?: () => Promise<{ token: string; model?: string } | null>;
    onStatusChange?: (status: LyriaRealtimeStatus, note?: string) => void;
  }): Promise<boolean> {
    this.stop();
    this.intentionalStop = false;
    this.reconnectCount = 0;
    this.activeCtx = opts.ctx;
    this.activeSpec = opts.spec;
    this.activeGenre = opts.genre;
    this.activeApiBase = opts.apiBase ?? '';
    this.fetchFreshToken = opts.fetchFreshToken;
    this.onStatusChange = opts.onStatusChange;
    this.setStatus('connecting', 'Connecting to Endless Stream...');

    if (!opts.ctx.audioWorklet) {
      this.setStatus('unavailable', 'AudioWorklet unsupported in this browser. Playing Studio Mix.');
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

      return await this.openSocket(opts.token, opts.model);
    } catch {
      this.setStatus('error', 'Could not initialize Endless Stream. Continuing smoothly on Studio Mix.');
      this.stop();
      return false;
    }
  }

  private async openSocket(token: string, model: string): Promise<boolean> {
    if (!this.activeCtx || !this.activeSpec || this.intentionalStop) return false;

    const httpBase = (this.activeApiBase || window.location.origin).replace(/\/+$/, '');
    const wsBase = httpBase.replace(/^http/i, 'ws');
    const wsUrl = `${wsBase}/api/music/realtime-ws?ticket=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    const lyriaCfg = buildLyriaRealtimeConfig(this.activeSpec, this.activeGenre);

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
          this.setStatus('error', 'Endless Stream handshake timed out. Continuing on Studio Mix.');
          this.stop();
          finish(false);
        }
      }, 10000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ setup: { model: model || 'models/lyria-realtime-exp' } }));
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
            ws.send(
              JSON.stringify({
                clientContent: {
                  weightedPrompts: lyriaCfg.weightedPrompts,
                },
              })
            );
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
            this.lastSentBpm = lyriaCfg.config.bpm;
            ws.send(JSON.stringify({ playbackControl: 'PLAY' }));
            return;
          }

          const chunks = msg.serverContent?.audioChunks ?? [];
          if (chunks.length > 0 && this.workletNode && this.activeCtx) {
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
              this.reconnectCount = 0;
              this.setStatus('streaming', 'Endless Stream active through 3-Band LR4 DSP');
              this.outputGain?.gain.exponentialRampToValueAtTime(0.92, this.activeCtx.currentTime + 1.5);
              finish(true);
            }
          }
        } catch {
          // ignore non-audio control frames
        }
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        if (!settled) {
          this.setStatus('error', 'Endless Stream connection interrupted. Continuing seamlessly on Studio Mix.');
          finish(false);
        }
      };

      ws.onclose = () => {
        window.clearTimeout(timeout);
        if (this.intentionalStop) {
          finish(false);
          return;
        }
        if (!settled) {
          this.setStatus('unavailable', 'Endless Stream unavailable. Continuing on Studio Mix.');
          finish(false);
          return;
        }
        // Seamless auto-reconnect for 30–60 min long sessions (Google WS sessions can refresh every ~10-15 min)
        if (this.status === 'streaming' && this.fetchFreshToken && this.reconnectCount < 6) {
          this.reconnectCount++;
          this.setStatus('connecting', 'Refreshing Endless Stream seamlessly...');
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.intentionalStop || !this.fetchFreshToken) return;
            void this.fetchFreshToken()
              .then((fresh) => {
                if (this.intentionalStop) return;
                if (fresh?.token) {
                  void this.openSocket(fresh.token, fresh.model ?? 'models/lyria-realtime-exp');
                } else {
                  this.setStatus('unavailable', 'Continuing smoothly on Studio Mix.');
                }
              })
              .catch(() => {
                if (!this.intentionalStop) {
                  this.setStatus('unavailable', 'Continuing smoothly on Studio Mix.');
                }
              });
          }, 900);
        } else if (this.status === 'streaming') {
          this.setStatus('unavailable', 'Endless Stream session ended. Continuing smoothly on Studio Mix.');
        }
      };
    });
  }

  /**
   * Smoothly morphs the active live Infinite AI stream to a new curated genre in <2 seconds.
   */
  public setGenre(genre: ResolvedGenre, spec: ExecutableStudySpec, intensityMult = 1.0, liveBpm?: number): void {
    this.activeGenre = genre;
    this.activeSpec = spec;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const cfg = buildLyriaRealtimeConfig(spec, genre, liveBpm);
    const density = Math.max(0.15, Math.min(0.92, cfg.config.density * intensityMult));
    const brightness = Math.max(0.18, Math.min(0.92, cfg.config.brightness * (0.85 + 0.15 * intensityMult)));
    try {
      this.ws.send(
        JSON.stringify({
          clientContent: {
            weightedPrompts: cfg.weightedPrompts,
          },
        })
      );
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
      this.lastSentBpm = cfg.config.bpm;
    } catch {
      // ignore transient ws error
    }
  }

  /**
   * Steers live Lyria RealTime density & brightness as user adjusts controls mid-session.
   */
  public steer(spec: ExecutableStudySpec, intensityMult: number, genre?: ResolvedGenre, liveBpm?: number): void {
    this.activeSpec = spec;
    if (genre) this.activeGenre = genre;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const cfg = buildLyriaRealtimeConfig(spec, this.activeGenre, liveBpm);
    const density = Math.max(0.15, Math.min(0.92, cfg.config.density * intensityMult));
    const brightness = Math.max(0.18, Math.min(0.92, cfg.config.brightness * (0.85 + 0.15 * intensityMult)));
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
      this.lastSentBpm = cfg.config.bpm;
    } catch {
      // ignore transient ws error
    }
  }

  /**
   * Updates live Lyria RealTime tempo during Iso-Principle BPM ramps (throttled to >= 2 BPM delta).
   */
  public updateBpm(spec: ExecutableStudySpec, liveBpm: number, intensityMult = 1.0): void {
    this.activeSpec = spec;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'streaming') return;
    const cfg = buildLyriaRealtimeConfig(spec, this.activeGenre, liveBpm);
    if (Math.abs(cfg.config.bpm - this.lastSentBpm) < 2) return;
    const density = Math.max(0.15, Math.min(0.92, cfg.config.density * intensityMult));
    const brightness = Math.max(0.18, Math.min(0.92, cfg.config.brightness * (0.85 + 0.15 * intensityMult)));
    this.lastSentBpm = cfg.config.bpm;
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
    this.intentionalStop = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.lastSentBpm = 0;
    this.status = 'idle';
  }
}
