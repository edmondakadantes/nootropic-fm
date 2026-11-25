import type { InstrumentPalette } from '../../shared/studySpec';
import { BUTTERWORTH_LP_HP_Q_DB } from './dspMath';

/**
 * Exact MIDI notes uploaded permanently to Cloudflare R2 (`samples/<palette>/<midi>.mp3`):
 * - felt_piano: Salamander Yamaha C5 Grand Piano (Alexander Holm, CC-BY 3.0)
 * - warm_rhodes / nylon_acoustic / cinematic_strings / ambient_water / deep_electronic:
 *   FluidR3 GM Real Instrument Multi-Samples (CC-BY 3.0)
 */
export const PALETTE_SAMPLE_MIDIS: Record<InstrumentPalette, number[]> = {
  felt_piano: [36, 42, 48, 54, 60, 66, 72],
  warm_rhodes: [36, 42, 48, 54, 60, 66, 72],
  nylon_acoustic: [40, 48, 54, 60, 66, 72],
  cinematic_strings: [36, 42, 48, 54, 60, 66, 72],
  ambient_water: [48, 54, 60, 66, 72, 78],
  deep_electronic: [36, 42, 48, 54, 60, 66, 72],
};

export class StudioSampler {
  private ctx: AudioContext | null = null;
  private apiBase = '';
  private bank = new Map<InstrumentPalette, Map<number, AudioBuffer>>();
  private loadingPalettes = new Set<InstrumentPalette>();

  public attach(ctx: AudioContext, apiBase = ''): void {
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.bank.clear();
      this.loadingPalettes.clear();
    }
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  public async preloadPalette(palette: InstrumentPalette): Promise<boolean> {
    if (!this.ctx) return false;
    const existing = this.bank.get(palette);
    const midis = PALETTE_SAMPLE_MIDIS[palette];
    if (existing && existing.size >= Math.min(3, midis.length)) {
      return true;
    }
    if (this.loadingPalettes.has(palette)) return false;
    this.loadingPalettes.add(palette);

    const ctxRef = this.ctx;
    const map = existing ?? new Map<number, AudioBuffer>();
    this.bank.set(palette, map);

    try {
      await Promise.all(
        midis.map(async (midi) => {
          if (map.has(midi)) return;
          try {
            const url = `${this.apiBase}/api/audio/stream/samples/${palette}/${midi}.mp3`;
            const res = await fetch(url);
            if (!res.ok) return;
            const arr = await res.arrayBuffer();
            if (this.ctx !== ctxRef) return;
            const decoded = await ctxRef.decodeAudioData(arr);
            if (this.ctx === ctxRef) {
              map.set(midi, decoded);
            }
          } catch {
            // graceful per-note fallback
          }
        })
      );
      return map.size >= 2;
    } finally {
      this.loadingPalettes.delete(palette);
    }
  }

  public isPaletteReady(palette: InstrumentPalette): boolean {
    const m = this.bank.get(palette);
    return Boolean(m && m.size >= 2);
  }

  /**
   * Triggers a real recorded studio instrument note with nearest-sample pitch shift
   * and exact A=432 Hz (-31.77 cents) or A=440 Hz tuning!
   * Returns true if played via real R2 studio sample, false if still loading.
   */
  public playNote(opts: {
    palette: InstrumentPalette;
    midi: number;
    time: number;
    gain: number;
    durationSec: number;
    attackSec?: number;
    pan?: number;
    tuningA4Hz: 440 | 432;
    cutoffHz?: number;
    destination: AudioNode;
  }): boolean {
    if (!this.ctx) return false;
    const map = this.bank.get(opts.palette);
    if (!map || map.size === 0) return false;

    // Pick closest recorded studio sample to keep pitch shift within ±3–4 semitones (natural timbre!)
    let bestMidi = -1;
    let bestDist = Infinity;
    for (const m of map.keys()) {
      const dist = Math.abs(m - opts.midi);
      if (dist < bestDist) {
        bestDist = dist;
        bestMidi = m;
      }
    }
    const buf = map.get(bestMidi);
    if (!buf) return false;

    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const semitoneDiff = opts.midi - bestMidi;
    const tuningRatio = opts.tuningA4Hz === 432 ? 432 / 440 : 1.0;
    src.playbackRate.setValueAtTime(Math.pow(2, semitoneDiff / 12) * tuningRatio, opts.time);

    const env = ctx.createGain();
    const atk = Math.max(0.005, opts.attackSec ?? (opts.palette === 'cinematic_strings' ? 1.1 : 0.015));
    const maxBufPlayDur = Math.max(atk + 0.08, buf.duration / Math.max(0.5, src.playbackRate.value) - 0.03);
    const dur = Math.max(atk + 0.12, Math.min(maxBufPlayDur, opts.durationSec));
    const peak = Math.max(0.005, Math.min(0.65, opts.gain));

    env.gain.setValueAtTime(0.0001, opts.time);
    env.gain.linearRampToValueAtTime(peak, opts.time + atk);
    env.gain.setValueAtTime(peak * 0.88, opts.time + Math.max(atk + 0.05, dur * 0.65));
    env.gain.exponentialRampToValueAtTime(0.0001, opts.time + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.8, Math.min(0.8, opts.pan ?? 0));

    if (opts.cutoffHz && opts.cutoffHz < 12000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opts.cutoffHz, opts.time);
      lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;
      src.connect(lp);
      lp.connect(env);
    } else {
      src.connect(env);
    }

    env.connect(panner);
    panner.connect(opts.destination);

    src.start(opts.time);
    src.stop(opts.time + dur + 0.04);
    return true;
  }

  public clear(): void {
    this.bank.clear();
    this.loadingPalettes.clear();
    this.ctx = null;
  }
}
