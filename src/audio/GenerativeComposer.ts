import {
  midiToHz,
  type InstrumentPalette,
  type PercussionMode,
  type StudyMusicSpec,
  type TonalMode,
} from '../../shared/studySpec';
import type { ResolvedGenre } from '../../shared/types';
import { BUTTERWORTH_LP_HP_Q_DB } from './dspMath';
import { StudioSampler } from './StudioSampler';

interface ChordDegree {
  rootOffset: number; // semitones above key root
  intervals: number[]; // lush voice intervals above degree root
  nextWeights: Array<{ idx: number; weight: number }>;
}

/**
 * Markov Harmonic Transition Graphs per Tonal Mode.
 * Produces endless, smooth, non-looping harmonic evolution with minimal voice-leading jumps.
 */
const MARKOV_CHORD_GRAPHS: Record<TonalMode, ChordDegree[]> = {
  major: [
    // 0: Imaj9
    { rootOffset: 0, intervals: [0, 7, 11, 14, 16], nextWeights: [{ idx: 1, weight: 0.35 }, { idx: 2, weight: 0.35 }, { idx: 3, weight: 0.2 }, { idx: 4, weight: 0.1 }] },
    // 1: vi9
    { rootOffset: 9, intervals: [0, 7, 10, 14, 15], nextWeights: [{ idx: 2, weight: 0.45 }, { idx: 3, weight: 0.35 }, { idx: 0, weight: 0.2 }] },
    // 2: IVmaj9
    { rootOffset: 5, intervals: [0, 7, 11, 14, 16], nextWeights: [{ idx: 4, weight: 0.45 }, { idx: 0, weight: 0.3 }, { idx: 3, weight: 0.25 }] },
    // 3: ii11
    { rootOffset: 2, intervals: [0, 7, 10, 14, 17], nextWeights: [{ idx: 4, weight: 0.55 }, { idx: 0, weight: 0.25 }, { idx: 1, weight: 0.2 }] },
    // 4: V9sus4
    { rootOffset: 7, intervals: [0, 5, 10, 14, 19], nextWeights: [{ idx: 0, weight: 0.6 }, { idx: 1, weight: 0.25 }, { idx: 2, weight: 0.15 }] },
  ],
  minor: [
    // 0: i9
    { rootOffset: 0, intervals: [0, 7, 10, 14, 15], nextWeights: [{ idx: 1, weight: 0.35 }, { idx: 2, weight: 0.35 }, { idx: 3, weight: 0.3 }] },
    // 1: bVImaj9
    { rootOffset: 8, intervals: [0, 7, 11, 14, 16], nextWeights: [{ idx: 3, weight: 0.4 }, { idx: 2, weight: 0.35 }, { idx: 0, weight: 0.25 }] },
    // 2: iv11
    { rootOffset: 5, intervals: [0, 7, 10, 14, 17], nextWeights: [{ idx: 3, weight: 0.45 }, { idx: 0, weight: 0.35 }, { idx: 4, weight: 0.2 }] },
    // 3: bVII9
    { rootOffset: 10, intervals: [0, 7, 10, 14, 16], nextWeights: [{ idx: 0, weight: 0.55 }, { idx: 4, weight: 0.25 }, { idx: 1, weight: 0.2 }] },
    // 4: bIIImaj9
    { rootOffset: 3, intervals: [0, 7, 11, 14, 16], nextWeights: [{ idx: 1, weight: 0.45 }, { idx: 2, weight: 0.35 }, { idx: 0, weight: 0.2 }] },
  ],
  dorian: [
    { rootOffset: 0, intervals: [0, 7, 10, 14, 17], nextWeights: [{ idx: 1, weight: 0.45 }, { idx: 2, weight: 0.35 }, { idx: 3, weight: 0.2 }] },
    { rootOffset: 5, intervals: [0, 7, 10, 14, 16], nextWeights: [{ idx: 0, weight: 0.45 }, { idx: 3, weight: 0.35 }, { idx: 2, weight: 0.2 }] },
    { rootOffset: 10, intervals: [0, 7, 11, 14, 16], nextWeights: [{ idx: 0, weight: 0.5 }, { idx: 1, weight: 0.3 }, { idx: 3, weight: 0.2 }] },
    { rootOffset: 2, intervals: [0, 7, 10, 14, 15], nextWeights: [{ idx: 1, weight: 0.45 }, { idx: 0, weight: 0.4 }, { idx: 2, weight: 0.15 }] },
  ],
  suspended: [
    { rootOffset: 0, intervals: [0, 7, 14, 19, 24], nextWeights: [{ idx: 1, weight: 0.4 }, { idx: 2, weight: 0.35 }, { idx: 3, weight: 0.25 }] },
    { rootOffset: 5, intervals: [0, 7, 12, 14, 19], nextWeights: [{ idx: 3, weight: 0.4 }, { idx: 0, weight: 0.35 }, { idx: 2, weight: 0.25 }] },
    { rootOffset: 9, intervals: [0, 7, 10, 14, 19], nextWeights: [{ idx: 1, weight: 0.45 }, { idx: 3, weight: 0.35 }, { idx: 0, weight: 0.2 }] },
    { rootOffset: 7, intervals: [0, 5, 12, 14, 19], nextWeights: [{ idx: 0, weight: 0.55 }, { idx: 2, weight: 0.25 }, { idx: 1, weight: 0.2 }] },
  ],
  pentatonic: [
    { rootOffset: 0, intervals: [0, 7, 12, 14, 16], nextWeights: [{ idx: 1, weight: 0.4 }, { idx: 2, weight: 0.35 }, { idx: 3, weight: 0.25 }] },
    { rootOffset: 7, intervals: [0, 5, 12, 14, 19], nextWeights: [{ idx: 2, weight: 0.4 }, { idx: 0, weight: 0.4 }, { idx: 3, weight: 0.2 }] },
    { rootOffset: 9, intervals: [0, 7, 12, 14, 15], nextWeights: [{ idx: 3, weight: 0.45 }, { idx: 0, weight: 0.35 }, { idx: 1, weight: 0.2 }] },
    { rootOffset: 5, intervals: [0, 7, 12, 14, 16], nextWeights: [{ idx: 0, weight: 0.5 }, { idx: 1, weight: 0.35 }, { idx: 2, weight: 0.15 }] },
  ],
  drone: [
    { rootOffset: 0, intervals: [0, 7, 12, 14, 19], nextWeights: [{ idx: 1, weight: 0.5 }, { idx: 2, weight: 0.5 }] },
    { rootOffset: 0, intervals: [0, 5, 12, 17, 19], nextWeights: [{ idx: 0, weight: 0.6 }, { idx: 2, weight: 0.4 }] },
    { rootOffset: 0, intervals: [0, 7, 12, 19, 24], nextWeights: [{ idx: 0, weight: 0.6 }, { idx: 1, weight: 0.4 }] },
  ],
};

const SCALE_INTERVALS: Record<TonalMode, number[]> = {
  major: [0, 2, 4, 7, 9, 11, 14, 16],
  minor: [0, 2, 3, 7, 8, 10, 14, 15],
  dorian: [0, 2, 3, 5, 7, 9, 10, 14],
  suspended: [0, 2, 5, 7, 9, 12, 14, 19],
  pentatonic: [0, 2, 4, 7, 9, 12, 14, 16],
  drone: [0, 7, 12, 14, 19],
};

/**
 * Voss-McCartney 1/f Pink-Fractal Generator for natural, musical melodic contours.
 */
class PinkFractalWalk {
  private rows = [0.5, 0.5, 0.5, 0.5, 0.5];
  private step = 0;

  public next(): number {
    this.step++;
    let changed = this.step;
    for (let i = 0; i < this.rows.length; i++) {
      if ((changed & 1) === 1) {
        this.rows[i] = Math.random();
        break;
      }
      changed >>= 1;
    }
    const sum = this.rows.reduce((a, b) => a + b, 0);
    return sum / this.rows.length; // smooth 0..1 pink-correlated walk
  }
}

/**
 * Bjorklund Euclidean rhythm generator (distributes `pulses` evenly across `steps`).
 */
function buildEuclideanPattern(steps: number, pulses: number): boolean[] {
  const out = new Array<boolean>(steps).fill(false);
  if (pulses <= 0) return out;
  if (pulses >= steps) return out.fill(true);
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      out[i] = true;
    }
  }
  return out;
}

/**
 * Real-Time Adaptive "As We Go" Generative Music Composer ($0/mo, Zero Static Loops).
 * Strictly obeys ExecutableStudySpec.music: exact BPM & live Iso-Principle BPM ramps,
 * tonal mode, A=440/432 Hz concert tuning, percussion lock, low-pass warmth, and density.
 */
export class GenerativeComposer {
  private ctx: AudioContext | null = null;
  private musicSpec: StudyMusicSpec | null = null;
  private palette: InstrumentPalette = 'felt_piano';
  private genre: ResolvedGenre = 'lofi_keys';
  private speakerSafeEQ = false;
  private shakerNoiseBuf: AudioBuffer | null = null;

  private padBus: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private pulseBus: GainNode | null = null;
  private cleanSubBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private delaySend: GainNode | null = null;

  private activePadOscs: OscillatorNode[] = [];
  private activePadGains: GainNode[] = [];
  private filterLfo: OscillatorNode | null = null;
  private stepTimer: number | null = null;
  private clockWorkletNode: AudioWorkletNode | null = null;
  private clockSinkGain: GainNode | null = null;
  private clockWorker: Worker | null = null;
  private clockWorkerUrl: string | null = null;
  private workletsReady = false;
  private chordCleanupTimers = new Set<number>();
  private sampler = new StudioSampler();
  private usingRealSamples = false;

  private isPlaying = false;
  private standby = false;
  private progressRatio = 0;
  private antiMonotonyActive = false;
  private intensityMult = 1.0;

  private chordIdx = 0;
  private prevVoicedMidis: number[] = [];
  private stepCount = 0;
  private nextChordStep = 64;
  private nextStepTime = 0;
  private fractal = new PinkFractalWalk();
  private kickPattern: boolean[] = buildEuclideanPattern(16, 4);
  private hatPattern: boolean[] = buildEuclideanPattern(16, 6);
  private bassPattern: boolean[] = buildEuclideanPattern(16, 5);
  private lastMelodicMidi: number | null = null;
  private striatalArcPhase: 'groove' | 'riser' | 'drop' = 'groove';

  private getSamplePadScale(palette: InstrumentPalette = this.palette): number {
    return palette === 'cinematic_strings' || palette === 'ambient_water' ? 0.78 : 0.58;
  }

  private ensurePalettePreloaded(palette: InstrumentPalette): void {
    this.usingRealSamples = this.sampler.isPaletteReady(palette);
    void this.sampler.preloadPalette(palette).then((ready) => {
      if (ready && this.isPlaying && !this.standby && this.palette === palette) {
        this.usingRealSamples = true;
        if (this.ctx && this.padBus) {
          this.padBus.gain.setTargetAtTime(
            this.getPalettePadGain() * this.getSamplePadScale(palette),
            this.ctx.currentTime,
            0.6
          );
        }
      }
    });
  }

  public start(opts: {
    ctx: AudioContext;
    musicSpec: StudyMusicSpec;
    genre?: ResolvedGenre;
    proceduralMaster: AudioNode;
    cleanSubBus: GainNode;
    reverbSend: GainNode;
    delaySend: GainNode;
    speakerSafeEQ: boolean;
    sampleApiBase?: string;
    deferStart?: boolean;
    workletsReady?: boolean;
  }): void {
    this.stop();
    const {
      ctx,
      musicSpec,
      genre,
      proceduralMaster,
      cleanSubBus,
      reverbSend,
      delaySend,
      speakerSafeEQ,
      sampleApiBase,
      deferStart = false,
      workletsReady = false,
    } = opts;
    this.ctx = ctx;
    this.workletsReady = workletsReady;
    this.musicSpec = structuredClone(musicSpec);
    this.palette = musicSpec.instrumentPalette;
    this.genre = genre ?? 'lofi_keys';
    this.speakerSafeEQ = speakerSafeEQ;
    this.cleanSubBus = cleanSubBus;
    this.reverbSend = reverbSend;
    this.delaySend = delaySend;
    this.chordIdx = 0;
    this.prevVoicedMidis = [];
    this.lastMelodicMidi = null;
    this.striatalArcPhase = 'groove';
    this.stepCount = 0;
    this.progressRatio = 0;
    this.usingRealSamples = false;
    this.isPlaying = true;
    this.standby = deferStart;

    // Attach real studio R2 multi-sampler (~180-550 KB per palette)
    this.sampler.attach(ctx, sampleApiBase ?? '');

    this.rebuildRhythmPatterns(musicSpec.percussion, musicSpec.density);

    const now = ctx.currentTime;

    // Warm harmonic pad bus with subtle slow breathing filter LFO
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.setValueAtTime(this.computeCutoffHz(), now);
    padFilter.Q.value = this.palette === 'cinematic_strings' ? 1.15 : 0.7;

    const filterLfo = ctx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = 0.062;
    const filterLfoGain = ctx.createGain();
    filterLfoGain.gain.value = Math.min(280, this.computeCutoffHz() * 0.16);
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(padFilter.frequency);
    filterLfo.start(now);
    this.filterLfo = filterLfo;

    const padBus = ctx.createGain();
    padBus.gain.setValueAtTime(this.getPalettePadGain(), now);
    padBus.connect(padFilter);
    padFilter.connect(proceduralMaster);
    padFilter.connect(reverbSend);

    const pulseBus = ctx.createGain();
    pulseBus.gain.setValueAtTime(this.getPalettePulseGain(), now);
    pulseBus.connect(proceduralMaster);
    pulseBus.connect(delaySend);
    pulseBus.connect(reverbSend);

    this.padBus = padBus;
    this.padFilter = padFilter;
    this.pulseBus = pulseBus;

    this.updateReverbSend();
    this.nextChordStep = musicSpec.bpm === 0 || musicSpec.bpm <= 68 ? 32 : 64;

    if (!deferStart) {
      this.ensurePalettePreloaded(this.palette);
      this.spawnMarkovChord(0, now);
      this.nextStepTime = ctx.currentTime + 0.12;
      this.startSchedulerClock();
    }
  }

  public setStandby(standby: boolean): void {
    if (this.standby === standby) return;
    this.standby = standby;
    if (!this.ctx) return;
    if (standby) {
      this.stopSchedulerClock();
      const now = this.ctx.currentTime;
      const prevOscs = this.activePadOscs;
      const prevGains = this.activePadGains;
      this.activePadOscs = [];
      this.activePadGains = [];
      for (const g of prevGains) {
        try {
          const p = g.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
          if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
          else {
            p.cancelScheduledValues(now);
            p.setValueAtTime(Math.max(0.0001, p.value), now);
          }
          p.exponentialRampToValueAtTime(0.0001, now + 1.1);
        } catch {
          // ignore
        }
      }
      if (prevOscs.length > 0) {
        const cleanupId = window.setTimeout(() => {
          this.chordCleanupTimers.delete(cleanupId);
          for (const osc of prevOscs) {
            try {
              osc.stop();
              osc.disconnect();
            } catch {
              // ignore
            }
          }
        }, 1250);
        this.chordCleanupTimers.add(cleanupId);
      }
    } else if (this.isPlaying) {
      this.ensurePalettePreloaded(this.palette);
      if (this.activePadOscs.length === 0) {
        this.spawnMarkovChord(this.chordIdx, this.ctx.currentTime);
      }
      this.nextStepTime = this.ctx.currentTime + 0.08;
      this.startSchedulerClock();
    }
  }

  private startSchedulerClock(): void {
    this.stopSchedulerClock();
    // 1. Primary v7.1 AudioWorklet clock (driven by the audio rendering thread — immune to tab/lock throttling)
    if (this.workletsReady && this.ctx) {
      try {
        const clockNode = new AudioWorkletNode(this.ctx, 'nootropic-clock-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { intervalMs: 40 },
        });
        const silentSink = this.ctx.createGain();
        silentSink.gain.value = 0;
        clockNode.connect(silentSink);
        silentSink.connect(this.ctx.destination);
        clockNode.port.onmessage = () => this.scheduleLiveSteps();
        clockNode.port.postMessage('start');
        this.clockWorkletNode = clockNode;
        this.clockSinkGain = silentSink;
        return;
      } catch {
        // graceful fallback to Web Worker timer below
      }
    }
    // 2. Fallback Web Worker timer avoids browser 1000ms background tab setInterval throttling
    if (typeof Worker !== 'undefined') {
      try {
        const workerCode =
          'let t=null;self.onmessage=function(e){if(e.data==="start"){if(t)clearInterval(t);t=setInterval(function(){self.postMessage("tick")},40);}else if(e.data==="stop"){if(t){clearInterval(t);t=null;}}};';
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        worker.onmessage = () => this.scheduleLiveSteps();
        worker.postMessage('start');
        this.clockWorker = worker;
        this.clockWorkerUrl = url;
        return;
      } catch {
        // graceful fallback to window.setInterval below
      }
    }
    this.stepTimer = window.setInterval(() => this.scheduleLiveSteps(), 40);
  }

  private stopSchedulerClock(): void {
    if (this.clockWorkletNode) {
      try {
        this.clockWorkletNode.port.postMessage('stop');
        this.clockWorkletNode.port.onmessage = null;
        this.clockWorkletNode.disconnect();
      } catch {
        // ignore
      }
      this.clockWorkletNode = null;
    }
    if (this.clockSinkGain) {
      try {
        this.clockSinkGain.disconnect();
      } catch {
        // ignore
      }
      this.clockSinkGain = null;
    }
    if (this.clockWorker) {
      try {
        this.clockWorker.postMessage('stop');
        this.clockWorker.terminate();
      } catch {
        // ignore
      }
      this.clockWorker = null;
    }
    if (this.clockWorkerUrl) {
      URL.revokeObjectURL(this.clockWorkerUrl);
      this.clockWorkerUrl = null;
    }
    if (this.stepTimer !== null) {
      window.clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
  }

  private rebuildRhythmPatterns(perc: PercussionMode, density: number): void {
    if (perc === 'none') {
      this.kickPattern = new Array(16).fill(false);
      this.hatPattern = new Array(16).fill(false);
      this.bassPattern = new Array(16).fill(false);
    } else if (perc === 'minimal_soft') {
      this.kickPattern = buildEuclideanPattern(16, 2);
      this.hatPattern = buildEuclideanPattern(16, Math.max(2, Math.round(density * 5)));
      this.bassPattern = buildEuclideanPattern(16, 3);
    } else {
      this.kickPattern = buildEuclideanPattern(16, 4);
      this.hatPattern = buildEuclideanPattern(16, Math.max(4, Math.round(density * 9)));
      this.bassPattern = buildEuclideanPattern(16, 5);
    }
  }

  public getStriatalArcPhase(): 'groove' | 'riser' | 'drop' {
    return this.striatalArcPhase;
  }

  public setTuningA4Hz(hz: 432 | 440): void {
    if (this.musicSpec) {
      this.musicSpec.tuningA4Hz = hz;
    }
  }

  public getCurrentBpm(): number {
    if (!this.musicSpec) return 0;
    if (this.musicSpec.bpmRamp) {
      const { start, end } = this.musicSpec.bpmRamp;
      const cur = start + (end - start) * Math.min(1, Math.max(0, this.progressRatio));
      return Math.round(cur);
    }
    if (this.musicSpec.bpm <= 0) return 0;
    return Math.round(this.musicSpec.bpm);
  }

  public updateProgress(progressRatio: number, antiMonotonyActive: boolean): void {
    this.progressRatio = Math.min(1, Math.max(0, progressRatio));
    this.antiMonotonyActive = antiMonotonyActive;
    if (this.ctx && this.padFilter) {
      const nyqMax = this.ctx.sampleRate * 0.44;
      const target =
        this.computeCutoffHz() *
        (0.88 + 0.22 * this.intensityMult) *
        (antiMonotonyActive ? 1.14 : 1.0);
      this.padFilter.frequency.setTargetAtTime(
        Math.min(nyqMax, Math.max(420, Math.min(4800, target))),
        this.ctx.currentTime,
        0.55
      );
    }
  }

  public isUsingRealSamples(): boolean {
    return this.usingRealSamples;
  }

  public setGenre(genre: ResolvedGenre, palette?: InstrumentPalette): void {
    this.genre = genre;
    this.setPalette(palette ?? this.palette);
  }

  public setPalette(palette: InstrumentPalette): void {
    this.palette = palette;
    if (this.musicSpec) {
      this.musicSpec.instrumentPalette = palette;
    }
    this.usingRealSamples = this.sampler.isPaletteReady(palette);
    if (!this.standby) {
      this.ensurePalettePreloaded(palette);
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.padBus?.gain.setTargetAtTime(
      this.getPalettePadGain() * (this.usingRealSamples ? this.getSamplePadScale(palette) : 1.0),
      now,
      0.35
    );
    this.pulseBus?.gain.setTargetAtTime(this.getPalettePulseGain(), now, 0.25);
    this.padFilter?.frequency.setTargetAtTime(this.computeCutoffHz(), now, 0.35);
    this.updateReverbSend();
    if (!this.standby) {
      this.spawnMarkovChord(this.chordIdx);
    }
  }

  public setIntensityMultiplier(mult: number): void {
    this.intensityMult = Math.max(0.45, Math.min(1.55, mult));
    if (this.ctx && this.pulseBus) {
      this.pulseBus.gain.setTargetAtTime(this.getPalettePulseGain(), this.ctx.currentTime, 0.2);
    }
  }

  public pause(): void {
    this.isPlaying = false;
    this.stopSchedulerClock();
  }

  public resume(): void {
    if (!this.ctx) return;
    this.isPlaying = true;
    if (!this.standby) {
      this.ensurePalettePreloaded(this.palette);
      if (this.activePadOscs.length === 0) {
        this.spawnMarkovChord(this.chordIdx, this.ctx.currentTime);
      }
      this.nextStepTime = this.ctx.currentTime + 0.1;
      this.startSchedulerClock();
    }
  }

  private computeCutoffHz(): number {
    const nyqMax = this.ctx ? this.ctx.sampleRate * 0.44 : 4800;
    const base = this.musicSpec?.spectralLowPassHz ?? 1650;
    let cutoff = base;
    if (this.palette === 'felt_piano') cutoff = Math.min(base, 1550);
    else if (this.palette === 'warm_rhodes') cutoff = Math.min(Math.max(base, 1400), 1850);
    else if (this.palette === 'deep_electronic') cutoff = Math.min(Math.max(base, 1950), 2800);
    else if (this.palette === 'cinematic_strings') cutoff = Math.min(Math.max(base * 1.12, 1800), 2600);
    return Math.min(nyqMax, cutoff);
  }

  private getPalettePadGain(): number {
    if (this.palette === 'cinematic_strings') return 0.48;
    if (this.palette === 'ambient_water') return 0.34;
    if (this.palette === 'deep_electronic') return 0.32;
    return 0.36;
  }

  private getPalettePulseGain(): number {
    const density = this.musicSpec?.density ?? 0.45;
    const base = 0.38 + density * 0.38;
    return Math.min(0.88, base * this.intensityMult);
  }

  private updateReverbSend(): void {
    if (!this.ctx || !this.reverbSend) return;
    const level =
      this.palette === 'cinematic_strings'
        ? 0.62
        : this.palette === 'ambient_water'
          ? 0.56
          : this.palette === 'felt_piano'
            ? 0.46
            : this.palette === 'nylon_acoustic'
              ? 0.42
              : 0.3;
    this.reverbSend.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
    if (this.delaySend) {
      const delayLevel =
        this.genre === 'nootropic_trance'
          ? 0.34
          : this.palette === 'ambient_water' || this.palette === 'deep_electronic'
            ? 0.24
            : 0.14;
      this.delaySend.gain.setTargetAtTime(delayLevel, this.ctx.currentTime, 0.4);
    }
  }

  private getActiveGraph(): ChordDegree[] {
    const mode = this.musicSpec?.tonalMode ?? 'suspended';
    return MARKOV_CHORD_GRAPHS[mode] ?? MARKOV_CHORD_GRAPHS.suspended;
  }

  private getCurrentChord(): ChordDegree {
    const graph = this.getActiveGraph();
    return graph[this.chordIdx % graph.length];
  }

  private advanceMarkovChord(atTime?: number): void {
    const graph = this.getActiveGraph();
    const cur = graph[this.chordIdx % graph.length];
    let r = Math.random();
    let nextIdx = (this.chordIdx + 1) % graph.length;
    for (const edge of cur.nextWeights) {
      r -= edge.weight;
      if (r <= 0) {
        nextIdx = edge.idx % graph.length;
        break;
      }
    }
    this.spawnMarkovChord(nextIdx, atTime);
  }

  private spawnMarkovChord(nextIdx: number, atTime?: number): void {
    if (!this.ctx || !this.padBus || !this.musicSpec) return;
    const ctx = this.ctx;
    const now = Math.max(ctx.currentTime, atTime ?? ctx.currentTime);
    this.chordIdx = nextIdx;

    const degree = this.getCurrentChord();
    const rootMidi = this.musicSpec.rootMidi + degree.rootOffset;
    const tuning = this.musicSpec.tuningA4Hz;

    // Crossfade previous voices smoothly (cancelAndHoldAtTime avoids future-scheduled gain snaps)
    const prevOscs = this.activePadOscs;
    const prevGains = this.activePadGains;
    for (const g of prevGains) {
      try {
        const p = g.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
        if (typeof p.cancelAndHoldAtTime === 'function') {
          p.cancelAndHoldAtTime(now);
        } else {
          p.cancelScheduledValues(now);
          p.setValueAtTime(Math.max(0.0001, p.value), now);
        }
        p.setTargetAtTime(0.0001, now, 0.55);
      } catch {
        // ignore
      }
    }
    const stopDelayMs = Math.max(3200, Math.round((now - ctx.currentTime + 3.0) * 1000));
    const cleanupId = window.setTimeout(() => {
      this.chordCleanupTimers.delete(cleanupId);
      for (const osc of prevOscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      }
    }, stopDelayMs);
    this.chordCleanupTimers.add(cleanupId);

    const nextOscs: OscillatorNode[] = [];
    const nextGains: GainNode[] = [];
    const nextVoicedMidis: number[] = [];
    const isStrings = this.palette === 'cinematic_strings';

    degree.intervals.forEach((semi, voiceIdx) => {
      let voicedMidi = rootMidi + semi;
      if (voiceIdx === 0) {
        while (voicedMidi > 50) voicedMidi -= 12;
        while (voicedMidi < 38) voicedMidi += 12;
      } else {
        while (voicedMidi > 69) voicedMidi -= 12;
        while (voicedMidi < 53) voicedMidi += 12;
        const prevMidi = this.prevVoicedMidis[voiceIdx];
        if (prevMidi !== undefined) {
          let bestMidi = voicedMidi;
          let bestDist = Math.abs(voicedMidi - prevMidi);
          for (const shift of [-12, 12]) {
            const cand = voicedMidi + shift;
            if (cand >= 48 && cand <= 76) {
              const dist = Math.abs(cand - prevMidi);
              if (dist < bestDist) {
                bestDist = dist;
                bestMidi = cand;
              }
            }
          }
          voicedMidi = bestMidi;
        }
      }
      nextVoicedMidis.push(voicedMidi);

      const freq = midiToHz(voicedMidi, tuning);
      const detunes = voiceIdx === 0 ? [0] : isStrings ? [-8, -2, 3, 9] : [-4, 4];

      detunes.forEach((detune, dIdx) => {
        const osc = ctx.createOscillator();
        osc.type =
          voiceIdx === 0
            ? 'sine'
            : isStrings
              ? 'sawtooth'
              : dIdx === 0
                ? 'triangle'
                : 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detune, now);

        const gain = ctx.createGain();
        const amp = voiceIdx === 0 ? 0.19 : isStrings ? 0.045 : 0.064;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(amp, now + (isStrings ? 1.05 : 0.72));

        const pan = ctx.createStereoPanner();
        pan.pan.value =
          voiceIdx === 0 ? 0 : (voiceIdx % 2 === 0 ? -0.48 : 0.48) * (dIdx % 2 === 0 ? 1 : -0.55);

        osc.connect(gain);
        gain.connect(pan);
        if (voiceIdx === 0 && this.cleanSubBus && freq < 185) {
          pan.connect(this.cleanSubBus);
        } else {
          pan.connect(this.padBus!);
        }
        osc.start(now);

        nextOscs.push(osc);
        nextGains.push(gain);
      });
    });

    this.prevVoicedMidis = nextVoicedMidis;
    this.activePadOscs = nextOscs;
    this.activePadGains = nextGains;
  }

  private scheduleLiveSteps(): void {
    if (!this.ctx || !this.pulseBus || !this.musicSpec || !this.isPlaying || this.standby) return;
    const ctx = this.ctx;
    const liveBpm = this.getCurrentBpm();
    // In beatless mode (bpm === 0), drift notes slowly at an organic 56 BPM pulse with zero percussion
    const clockBpm = liveBpm > 0 ? liveBpm : 56;
    const eighthDur = 60 / clockBpm / 2;
    const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const lookahead = isHidden ? 1.25 : 0.28;

    // Prevent stacked-note burst if OS woke up after long hardware sleep
    if (this.nextStepTime < ctx.currentTime - 0.12) {
      this.nextStepTime = ctx.currentTime + 0.02;
    }

    while (this.nextStepTime < ctx.currentTime + lookahead) {
      const step = this.stepCount % 16;
      const genreSuppressesDrums =
        this.genre === 'nature_rain' ||
        this.genre === 'ambient_space' ||
        this.genre === 'solo_piano' ||
        this.genre === 'cinematic_strings';
      const genreWantsGroove =
        this.genre === 'nootropic_trance' ||
        this.genre === 'deep_electronic' ||
        this.genre === 'lofi_keys' ||
        this.genre === 'dub_reggae' ||
        this.genre === 'bossa_nova' ||
        this.genre === 'jazz_rhodes';
      const perc: PercussionMode =
        liveBpm === 0 || genreSuppressesDrums
          ? 'none'
          : this.musicSpec.percussion === 'none' && genreWantsGroove
            ? 'minimal_soft'
            : this.musicSpec.percussion;

      // 32-Bar Striatal Anticipation -> Resolution Dopamine Arc (Caudate Riser -> Micro-Vacuum -> Accumbens Drop)
      const arcCycleSteps = liveBpm === 0 || liveBpm <= 72 ? 128 : 256;
      const arcPos = this.stepCount % arcCycleSteps;
      const inRiser = arcPos >= Math.floor(arcCycleSteps * 0.75);
      const inMicroVacuum = perc !== 'none' && arcPos >= arcCycleSteps - 8;
      const isDropDownbeat = this.stepCount > 0 && arcPos === 0;
      this.striatalArcPhase =
        isDropDownbeat || (this.stepCount >= arcCycleSteps && arcPos < 8)
          ? 'drop'
          : inRiser
            ? 'riser'
            : 'groove';

      const nyqMax = ctx.sampleRate * 0.44;
      const swing =
        step % 2 === 1
          ? this.palette === 'warm_rhodes'
            ? eighthDur * 0.16
            : this.palette === 'nylon_acoustic' || this.genre === 'dub_reggae' || this.genre === 'bossa_nova'
              ? eighthDur * 0.1
              : this.palette === 'felt_piano'
                ? eighthDur * 0.08
                : this.genre === 'deep_electronic'
                  ? eighthDur * 0.05
                  : this.genre === 'nootropic_trance'
                    ? eighthDur * 0.035
                    : 0
          : 0;
      const pocketDelay =
        this.palette === 'warm_rhodes' && (step % 4 === 1 || step % 4 === 3) ? 0.011 : 0;
      const rubato =
        this.palette === 'felt_piano' ? (this.fractal.next() - 0.5) * 0.022 : 0;
      const humanMicro = (Math.random() - 0.5) * 0.008;
      const t = Math.max(ctx.currentTime + 0.01, this.nextStepTime + swing + pocketDelay + rubato + humanMicro);
      const lift = this.antiMonotonyActive ? 1.2 : 1.0;

      if (isDropDownbeat) {
        const stepsPerChord = liveBpm === 0 || liveBpm <= 68 ? 32 : 64;
        this.nextChordStep = this.stepCount + stepsPerChord;
        this.spawnMarkovChord(0, t);
        if (this.genre !== 'nature_rain') {
          this.triggerHarmonicVoicing(t, 0.12 * lift);
        }
        this.padFilter?.frequency.setTargetAtTime(
          Math.min(nyqMax, this.computeCutoffHz()),
          t,
          0.35
        );
      } else if (this.stepCount >= this.nextChordStep) {
        const stepsPerChord = liveBpm === 0 || liveBpm <= 68 ? 32 : 64;
        this.nextChordStep = this.stepCount + stepsPerChord;
        const nextTime = Math.max(ctx.currentTime + 0.01, this.nextStepTime);
        if (inRiser) {
          const graph = this.getActiveGraph();
          this.spawnMarkovChord(Math.max(0, graph.length - 1), nextTime);
        } else {
          this.advanceMarkovChord(nextTime);
        }
      }

      if (inRiser && this.padFilter && step % 4 === 0) {
        const riserStart = Math.floor(arcCycleSteps * 0.75);
        const riserFrac = (arcPos - riserStart) / Math.max(1, arcCycleSteps - riserStart);
        const targetOpenHz = Math.min(nyqMax, this.computeCutoffHz() + 450 * riserFrac);
        this.padFilter.frequency.setTargetAtTime(targetOpenHz, t, 0.35);
      }

      const subArcScale = inMicroVacuum ? 0.75 : isDropDownbeat ? 1.08 : 1.0;
      const metricAccent = step === 0 || step === 8 ? 1.0 : step === 4 || step === 12 ? 0.84 : 0.64;
      const phraseBreath = 0.88 + 0.18 * Math.sin((this.stepCount / 16) * Math.PI);
      const phraseAccent = metricAccent * phraseBreath;

      // 1. Genre-Authentic Percussion Layer (strictly obeys study's percussion lock & beatless genres!)
      if (perc !== 'none') {
        if (this.genre === 'nootropic_trance') {
          // Hypnotic 4-on-the-floor velvet pulse + off-beat brushed shaker
          if (step % 4 === 0) {
            this.triggerWarmSubKick(t, 0.44 * subArcScale * (perc === 'minimal_soft' ? 0.72 : 1.0));
          }
          if (!this.speakerSafeEQ && step % 4 === 2) {
            this.triggerBrushedAirHat(t, 0.032 * phraseBreath);
          } else if (!this.speakerSafeEQ && step % 2 === 1 && Math.random() < 0.42) {
            this.triggerBrushedAirHat(t + 0.004, 0.014 * phraseBreath);
          }
        } else if (this.genre === 'bossa_nova') {
          // Classic Brazilian surdo pulse on beats 1 & 3 + soft syncopated shaker
          if (step === 0 || step === 8) {
            this.triggerWarmSubKick(t, (step === 0 ? 0.34 : 0.28) * subArcScale * (perc === 'minimal_soft' ? 0.7 : 1.0));
          }
          if (!this.speakerSafeEQ && step % 2 === 0) {
            this.triggerBrushedAirHat(t, (step % 4 === 2 ? 0.032 : 0.018) * phraseBreath);
          }
        } else if (this.genre === 'dub_reggae') {
          // One-drop / steppers warm dub kick + crisp rim click on beat 3 (step 8)
          if (step === 0 || step === 8) {
            this.triggerWarmSubKick(t, (step === 8 ? 0.44 : 0.3) * subArcScale);
          }
          if (!this.speakerSafeEQ && step === 8) {
            this.triggerWarmWoodRim(t, 0.055 * phraseBreath);
          }
          if (!this.speakerSafeEQ && step % 2 === 1) {
            this.triggerBrushedAirHat(t, 0.022 * phraseBreath);
          }
        } else {
          if (this.kickPattern[step]) {
            this.triggerWarmSubKick(t, (step === 0 ? 0.46 : 0.34) * subArcScale * (perc === 'minimal_soft' ? 0.65 : 1.0));
          }
          if (this.genre === 'lofi_keys' && !this.speakerSafeEQ && (step === 4 || step === 12)) {
            this.triggerWarmWoodRim(t + 0.006, 0.046 * phraseBreath);
          }
          if (this.hatPattern[step] && !this.speakerSafeEQ) {
            this.triggerBrushedAirHat(t, 0.028 * phraseBreath * (perc === 'minimal_soft' ? 0.65 : 1.0));
          } else if (perc === 'steady_pulse' && !this.speakerSafeEQ && step % 2 === 1 && Math.random() < 0.35) {
            this.triggerBrushedAirHat(t + 0.008, 0.014);
          }
        }
      }

      // 2. Genre-Authentic Clean Sub-Bass Anchor (<175 Hz clean sub bus with E(5,16) kinetic pocket)
      if (perc !== 'none') {
        if (this.genre === 'nootropic_trance' && (step % 4 === 2 || step === 14)) {
          this.triggerCleanBass(t, step === 14 ? 7 : 0, 0.24 * subArcScale * phraseBreath, eighthDur * 1.45);
        } else if (this.genre === 'bossa_nova' && (step === 0 || step === 6 || step === 8 || step === 14)) {
          this.triggerCleanBass(t, step >= 8 ? 7 : 0, 0.2 * subArcScale * phraseBreath, eighthDur * 1.6);
        } else if (this.genre === 'dub_reggae' && (step === 0 || step === 3 || step === 8 || step === 10)) {
          const dubSemi = step === 3 ? 5 : step === 10 ? 7 : 0;
          this.triggerCleanBass(t, dubSemi, 0.25 * subArcScale * phraseBreath, eighthDur * 1.7);
        } else if (this.genre === 'jazz_rhodes' && step % 4 === 0) {
          const walkIntervals = [0, 3, 7, 10];
          this.triggerCleanBass(t, walkIntervals[(step >> 2) % 4], 0.19 * subArcScale * phraseBreath, eighthDur * 1.8);
        } else if (
          (this.palette === 'deep_electronic' || this.palette === 'warm_rhodes') &&
          (this.bassPattern[step] || step === 14)
        ) {
          this.triggerCleanBass(t, step === 14 ? 7 : 0, 0.21 * subArcScale * phraseBreath, eighthDur * 1.5);
        }
      }

      // 3. Genre-Specific Rhythmic Comping & 1/f Pink-Fractal Melodic Voice
      if (this.genre === 'nootropic_trance' && this.stepCount % 3 === 0) {
        // 5-against-4 / 3-step Euclidean polyrhythmic trance pluck tunnel
        this.triggerMelodicVoice(t, step, lift * 1.08, phraseAccent);
        if (this.stepCount % 12 === 0) {
          this.triggerHarmonicVoicing(t, 0.105 * lift * phraseBreath);
        }
      } else if (this.genre === 'dub_reggae' && perc !== 'none' && step % 4 === 2) {
        // Signature off-beat reggae skank chord chop routed into dub delay
        this.triggerHarmonicVoicing(t, 0.11 * lift * phraseBreath);
      } else if (
        this.genre === 'bossa_nova' &&
        (step === 0 || step === 3 || step === 6 || step === 10 || step === 13)
      ) {
        // João Gilberto syncopated nylon-guitar bossa clave comping
        this.triggerHarmonicVoicing(t, 0.095 * lift * phraseBreath);
      }

      const noteProb =
        this.genre === 'nature_rain'
          ? 0.14
          : liveBpm === 0
            ? 0.24
            : Math.max(0.18, Math.min(0.68, 0.22 + this.musicSpec.density * 0.45));
      const isStrongBeat = step === 0 || step === 4 || step === 8 || step === 12;
      if ((isStrongBeat && Math.random() < noteProb + 0.22) || Math.random() < noteProb * 0.52) {
        this.triggerMelodicVoice(t, step, lift, phraseAccent);
      }

      // Occasional warm chord comp on beat 1
      if (
        step === 0 &&
        this.genre !== 'nature_rain' &&
        (this.stepCount % 32 === 0 || Math.random() < 0.42)
      ) {
        this.triggerHarmonicVoicing(t, 0.1 * lift * phraseBreath);
      }

      this.nextStepTime += eighthDur;
      this.stepCount++;
    }
  }

  private pickFractalMidi(octaveShift = 12): number {
    if (!this.musicSpec) return 60;
    const scale = SCALE_INTERVALS[this.musicSpec.tonalMode] ?? SCALE_INTERVALS.suspended;
    const degree = this.getCurrentChord();
    const walk = this.fractal.next(); // smooth 0..1 pink-fractal contour
    const idx = Math.min(scale.length - 1, Math.floor(walk * scale.length));
    let midi = Math.max(
      36,
      Math.min(81, this.musicSpec.rootMidi + degree.rootOffset + scale[idx] + octaveShift)
    );
    // Wundt 85/15 Guardrail: constrain melodic leaps <= 7 semitones (perfect fifth) so novelty never startles attention
    if (this.lastMelodicMidi !== null && Math.abs(midi - this.lastMelodicMidi) > 7) {
      if (midi - 12 >= 36 && Math.abs(midi - 12 - this.lastMelodicMidi) <= 7) {
        midi -= 12;
      } else if (midi + 12 <= 81 && Math.abs(midi + 12 - this.lastMelodicMidi) <= 7) {
        midi += 12;
      } else {
        const dir = midi > this.lastMelodicMidi ? 1 : -1;
        midi = Math.max(36, Math.min(81, this.lastMelodicMidi + dir * 7));
      }
    }
    this.lastMelodicMidi = midi;
    return midi;
  }

  private triggerMelodicVoice(time: number, step: number, lift: number, phraseAccent = 1.0): void {
    if (!this.ctx || !this.pulseBus || !this.musicSpec) return;
    const midi = this.pickFractalMidi(this.palette === 'ambient_water' ? 12 : 12);
    const freq = midiToHz(midi, this.musicSpec.tuningA4Hz);
    const vel = (0.11 + Math.random() * 0.08) * lift * phraseAccent * this.intensityMult;

    // 1. Prefer REAL recorded studio instrument multi-samples from Cloudflare R2!
    if (this.sampler.isPaletteReady(this.palette)) {
      const dur =
        this.palette === 'cinematic_strings'
          ? 4.2
          : this.palette === 'felt_piano' || this.palette === 'ambient_water'
            ? 3.2
            : 2.2;
      const cutoff =
        this.palette === 'felt_piano'
          ? Math.min(1450, this.computeCutoffHz())
          : this.palette === 'deep_electronic'
            ? Math.min(2200, this.computeCutoffHz() * 1.1)
            : this.computeCutoffHz() * 1.35;
      const played = this.sampler.playNote({
        palette: this.palette,
        midi,
        time,
        gain: Math.min(0.42, vel * 1.8),
        durationSec: dur,
        attackSec: this.palette === 'cinematic_strings' ? 0.95 : 0.015,
        pan: (Math.random() - 0.5) * 0.55,
        tuningA4Hz: this.musicSpec.tuningA4Hz,
        cutoffHz: cutoff,
        destination: this.pulseBus,
      });
      if (played) {
        this.usingRealSamples = true;
        return;
      }
    }

    // 2. Zero-latency warm synthesis fallback while R2 samples decode (~150ms)
    if (this.palette === 'felt_piano') {
      this.playFeltPianoNote(time, freq, vel);
    } else if (this.palette === 'warm_rhodes') {
      this.playRhodesTineNote(time, freq, vel * 0.92);
    } else if (this.palette === 'nylon_acoustic') {
      this.playNylonPluckNote(time, freq, vel * 1.05);
    } else if (this.palette === 'deep_electronic') {
      this.playElectronicPluck(time, freq, vel * 0.85, step);
    } else {
      this.playGlassHarmonic(time, freq, vel * 0.8, step);
    }
  }

  private triggerHarmonicVoicing(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.musicSpec) return;
    const degree = this.getCurrentChord();
    const tuning = this.musicSpec.tuningA4Hz;
    const notes = degree.intervals.slice(0, 4);

    if (this.sampler.isPaletteReady(this.palette)) {
      notes.forEach((semi, idx) => {
        const midi = Math.max(36, Math.min(76, this.musicSpec!.rootMidi + degree.rootOffset + semi + (idx === 0 ? 0 : 12)));
        const offset = idx * (this.palette === 'nylon_acoustic' ? 0.045 : 0.065);
        this.sampler.playNote({
          palette: this.palette,
          midi,
          time: time + offset,
          gain: Math.min(0.32, amp * (idx === 0 ? 1.55 : 1.15)),
          durationSec: this.palette === 'cinematic_strings' || this.palette === 'deep_electronic' ? 6.5 : 4.2,
          attackSec:
            this.palette === 'cinematic_strings' || this.palette === 'deep_electronic' ? 1.3 : 0.025,
          pan: (idx - 1.5) * 0.28,
          tuningA4Hz: tuning,
          cutoffHz: this.computeCutoffHz() * 1.15,
          destination: this.pulseBus!,
        });
      });
      this.usingRealSamples = true;
      return;
    }

    notes.slice(1, 4).forEach((semi, idx) => {
      const freq = midiToHz(this.musicSpec!.rootMidi + degree.rootOffset + semi + 12, tuning);
      const strumStep =
        this.palette === 'nylon_acoustic'
          ? 0.032
          : this.palette === 'felt_piano'
            ? 0.036
            : 0.028;
      const offset = idx * strumStep;
      const voiceWeight = idx === 1 ? 0.5 : 0.45;
      if (this.palette === 'warm_rhodes') {
        this.playRhodesTineNote(time + offset, freq, amp * (voiceWeight + 0.05));
      } else if (this.palette === 'nylon_acoustic') {
        this.playNylonPluckNote(time + offset, freq, amp * (voiceWeight + 0.05));
      } else {
        this.playFeltPianoNote(time + offset, freq, amp * voiceWeight);
      }
    });
  }

  private playFeltPianoNote(time: number, freq: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const nyqMax = this.ctx.sampleRate * 0.44;
    const safeFreq = Math.min(nyqMax, freq);
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc1.type = 'triangle';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(safeFreq, time);
    osc2.frequency.setValueAtTime(Math.min(nyqMax, safeFreq * 2), time);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(nyqMax, Math.min(1850, this.computeCutoffHz() * 1.1)), time);
    lp.frequency.exponentialRampToValueAtTime(Math.min(nyqMax, 340), time + 1.6);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 2.2);

    pan.pan.value = Math.max(-0.5, Math.min(0.5, ((safeFreq - 320) / 500) * 0.4));

    const overtoneGain = this.ctx.createGain();
    overtoneGain.gain.value = safeFreq * 2 < nyqMax ? 0.22 : 0;

    osc1.connect(lp);
    osc2.connect(overtoneGain);
    overtoneGain.connect(lp);
    lp.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 2.3);
    osc2.stop(time + 1.4);
  }

  private playRhodesTineNote(time: number, freq: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const nyqMax = this.ctx.sampleRate * 0.44;
    const safeFreq = Math.min(nyqMax, freq);
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(safeFreq, time);
    mod.type = 'sine';
    mod.frequency.setValueAtTime(Math.min(nyqMax, safeFreq * 2), time);

    // Classic FM Rhodes bell transient
    modGain.gain.setValueAtTime(safeFreq * 2 < nyqMax ? safeFreq * 0.75 : 1, time);
    modGain.gain.exponentialRampToValueAtTime(1, time + 0.35);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.65);

    pan.pan.value = (Math.random() - 0.5) * 0.55;
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);

    carrier.start(time);
    mod.start(time);
    carrier.stop(time + 1.75);
    mod.stop(time + 0.45);
  }

  private playNylonPluckNote(time: number, freq: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const nyqMax = this.ctx.sampleRate * 0.44;
    const safeFreq = Math.min(nyqMax, freq);
    const osc = this.ctx.createOscillator();
    const oscSub = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(safeFreq, time);
    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(Math.min(nyqMax, safeFreq * 0.5), time);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(nyqMax, Math.min(2600, this.computeCutoffHz() * 1.4)), time);
    lp.frequency.exponentialRampToValueAtTime(Math.min(nyqMax, 420), time + 0.65);
    lp.Q.value = 1.4;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.35);

    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.25;
    pan.pan.value = (Math.random() - 0.5) * 0.5;

    osc.connect(lp);
    oscSub.connect(subGain);
    subGain.connect(lp);
    lp.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);

    osc.start(time);
    oscSub.start(time);
    osc.stop(time + 1.45);
    oscSub.stop(time + 1.0);
  }

  private playElectronicPluck(time: number, freq: number, amp: number, step: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const nyqMax = this.ctx.sampleRate * 0.44;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(Math.min(nyqMax, freq), time);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(nyqMax, Math.min(2400, this.computeCutoffHz() * 1.2)), time);
    lp.frequency.exponentialRampToValueAtTime(Math.min(nyqMax, 320), time + 0.34);
    lp.Q.value = 2.0;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * 0.72, time + 0.013);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);

    pan.pan.value = step % 4 < 2 ? -0.35 : 0.35;
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.48);
  }

  private playGlassHarmonic(time: number, freq: number, amp: number, step: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const nyqMax = this.ctx.sampleRate * 0.44;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(Math.min(nyqMax, freq), time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 2.4);

    pan.pan.value = step % 2 === 0 ? -0.45 : 0.45;
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 2.5);
  }

  private triggerWarmSubKick(time: number, amp: number): void {
    if (!this.ctx || !this.cleanSubBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMult, time + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

    osc.connect(gain);
    gain.connect(this.cleanSubBus);
    osc.start(time);
    osc.stop(time + 0.28);

    // -1.8 dB Ghost Sidechain breathing pulse on padBus (keeps Layer-1 completely untouched!)
    if (this.padBus && !this.standby) {
      const basePad =
        this.getPalettePadGain() * (this.usingRealSamples ? this.getSamplePadScale(this.palette) : 1.0);
      const pGain = this.padBus.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      try {
        if (typeof pGain.cancelAndHoldAtTime === 'function') {
          pGain.cancelAndHoldAtTime(time);
        } else {
          pGain.cancelScheduledValues(time);
          pGain.setValueAtTime(basePad, time);
        }
        pGain.linearRampToValueAtTime(Math.max(0.001, basePad * 0.813), time + 0.018);
        pGain.setTargetAtTime(basePad, time + 0.024, 0.065);
      } catch {
        // ignore overlapping param schedules
      }
    }
  }

  private triggerCleanBass(time: number, semiOffset: number, amp: number, dur: number): void {
    if (!this.ctx || !this.cleanSubBus || !this.musicSpec) return;
    const degree = this.getCurrentChord();
    const rawFreq = midiToHz(
      this.musicSpec.rootMidi + degree.rootOffset + semiOffset - 12,
      this.musicSpec.tuningA4Hz
    );
    const freq = Math.max(46, Math.min(165, rawFreq));

    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = this.palette === 'deep_electronic' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, time);
    lp.type = 'lowpass';
    lp.frequency.value = 175;
    lp.Q.value = BUTTERWORTH_LP_HP_Q_DB;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMult, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.2, dur));

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.cleanSubBus);
    osc.start(time);
    osc.stop(time + dur + 0.06);
  }

  private ensureShakerNoiseBuf(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (this.shakerNoiseBuf && this.shakerNoiseBuf.sampleRate === this.ctx.sampleRate) {
      return this.shakerNoiseBuf;
    }
    const len = Math.max(512, Math.round(this.ctx.sampleRate * 0.08));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      data[i] = (w - prev * 0.65) * 0.6;
      prev = w;
    }
    this.shakerNoiseBuf = buf;
    return buf;
  }

  private triggerWarmWoodRim(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const osc = this.ctx.createOscillator();
    const bp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const nyqMax = this.ctx.sampleRate * 0.44;
    osc.frequency.setValueAtTime(Math.min(nyqMax, 420), time);
    osc.frequency.exponentialRampToValueAtTime(Math.min(nyqMax, 195), time + 0.028);
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(nyqMax, 680);
    bp.Q.value = 2.1;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMult, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.042);

    osc.connect(bp);
    bp.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  private triggerBrushedAirHat(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const noiseBuf = this.ensureShakerNoiseBuf();
    if (!noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(this.ctx.sampleRate * 0.44, this.genre === 'bossa_nova' ? 5400 : 4600);
    bp.Q.value = 1.35;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMult, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.048);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.pulseBus);
    src.start(time);
    src.stop(time + 0.06);
  }

  public stop(): void {
    this.isPlaying = false;
    this.stopSchedulerClock();
    for (const id of this.chordCleanupTimers) {
      window.clearTimeout(id);
    }
    this.chordCleanupTimers.clear();
    try {
      this.filterLfo?.stop();
      for (const osc of this.activePadOscs) osc.stop();
    } catch {
      // ignore
    }
    this.activePadOscs = [];
    this.activePadGains = [];
    this.prevVoicedMidis = [];
    this.lastMelodicMidi = null;
    this.striatalArcPhase = 'groove';
    this.sampler.clear();
    this.usingRealSamples = false;
    this.filterLfo = null;
    this.padBus = null;
    this.padFilter = null;
    this.pulseBus = null;
    this.ctx = null;
  }
}
