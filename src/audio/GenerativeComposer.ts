import {
  midiToHz,
  type InstrumentPalette,
  type PercussionMode,
  type StudyMusicSpec,
  type TonalMode,
} from '../../shared/studySpec';

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
  private speakerSafeEQ = false;

  private padBus: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private pulseBus: GainNode | null = null;
  private cleanSubBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private delaySend: GainNode | null = null;

  private activePadOscs: OscillatorNode[] = [];
  private activePadGains: GainNode[] = [];
  private filterLfo: OscillatorNode | null = null;
  private chordTimer: number | null = null;
  private stepTimer: number | null = null;

  private isPlaying = false;
  private progressRatio = 0;
  private antiMonotonyActive = false;
  private intensityMult = 1.0;

  private chordIdx = 0;
  private stepCount = 0;
  private nextStepTime = 0;
  private fractal = new PinkFractalWalk();
  private kickPattern: boolean[] = buildEuclideanPattern(16, 4);
  private hatPattern: boolean[] = buildEuclideanPattern(16, 6);

  public start(opts: {
    ctx: AudioContext;
    musicSpec: StudyMusicSpec;
    proceduralMaster: AudioNode;
    cleanSubBus: GainNode;
    reverbSend: GainNode;
    delaySend: GainNode;
    speakerSafeEQ: boolean;
  }): void {
    this.stop();
    const { ctx, musicSpec, proceduralMaster, cleanSubBus, reverbSend, delaySend, speakerSafeEQ } = opts;
    this.ctx = ctx;
    this.musicSpec = structuredClone(musicSpec);
    this.palette = musicSpec.instrumentPalette;
    this.speakerSafeEQ = speakerSafeEQ;
    this.cleanSubBus = cleanSubBus;
    this.reverbSend = reverbSend;
    this.delaySend = delaySend;
    this.chordIdx = 0;
    this.stepCount = 0;
    this.progressRatio = 0;
    this.isPlaying = true;

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
    this.spawnMarkovChord(0);

    // Harmonic evolution timer (adapts to tempo: slower & spacious for calm/sleep, tighter for focus)
    const chordIntervalMs =
      musicSpec.bpm === 0 || musicSpec.bpm <= 68
        ? 14500
        : Math.max(7000, Math.round((60 / musicSpec.bpm) * 16 * 1000)); // 4 bars of 4/4
    this.chordTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.musicSpec) return;
      this.advanceMarkovChord();
    }, chordIntervalMs);

    this.nextStepTime = ctx.currentTime + 0.25;
    this.stepTimer = window.setInterval(() => this.scheduleLiveSteps(), 40);
  }

  private rebuildRhythmPatterns(perc: PercussionMode, density: number): void {
    if (perc === 'none') {
      this.kickPattern = new Array(16).fill(false);
      this.hatPattern = new Array(16).fill(false);
    } else if (perc === 'minimal_soft') {
      this.kickPattern = buildEuclideanPattern(16, 2);
      this.hatPattern = buildEuclideanPattern(16, Math.max(2, Math.round(density * 5)));
    } else {
      this.kickPattern = buildEuclideanPattern(16, 4);
      this.hatPattern = buildEuclideanPattern(16, Math.max(4, Math.round(density * 9)));
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
      const target =
        this.computeCutoffHz() *
        (0.88 + 0.22 * this.intensityMult) *
        (antiMonotonyActive ? 1.14 : 1.0);
      this.padFilter.frequency.setTargetAtTime(
        Math.max(420, Math.min(4800, target)),
        this.ctx.currentTime,
        0.55
      );
    }
  }

  public setPalette(palette: InstrumentPalette): void {
    this.palette = palette;
    if (this.musicSpec) {
      this.musicSpec.instrumentPalette = palette;
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.padBus?.gain.setTargetAtTime(this.getPalettePadGain(), now, 0.45);
    this.pulseBus?.gain.setTargetAtTime(this.getPalettePulseGain(), now, 0.35);
    this.padFilter?.frequency.setTargetAtTime(this.computeCutoffHz(), now, 0.45);
    this.updateReverbSend();
    this.spawnMarkovChord(this.chordIdx);
  }

  public setIntensityMultiplier(mult: number): void {
    this.intensityMult = Math.max(0.45, Math.min(1.55, mult));
    if (this.ctx && this.pulseBus) {
      this.pulseBus.gain.setTargetAtTime(this.getPalettePulseGain(), this.ctx.currentTime, 0.2);
    }
  }

  public pause(): void {
    this.isPlaying = false;
  }

  public resume(): void {
    if (!this.ctx) return;
    this.isPlaying = true;
    this.nextStepTime = this.ctx.currentTime + 0.1;
  }

  private computeCutoffHz(): number {
    const base = this.musicSpec?.spectralLowPassHz ?? 1650;
    if (this.palette === 'felt_piano') return Math.min(base, 1450);
    if (this.palette === 'warm_rhodes') return Math.min(base, 1650);
    if (this.palette === 'cinematic_strings') return Math.min(base * 1.08, 2200);
    return base;
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
        this.palette === 'ambient_water' || this.palette === 'deep_electronic' ? 0.24 : 0.14;
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

  private advanceMarkovChord(): void {
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
    this.spawnMarkovChord(nextIdx);
  }

  private spawnMarkovChord(nextIdx: number): void {
    if (!this.ctx || !this.padBus || !this.musicSpec) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.chordIdx = nextIdx;

    const degree = this.getCurrentChord();
    const rootMidi = this.musicSpec.rootMidi + degree.rootOffset;
    const tuning = this.musicSpec.tuningA4Hz;

    // Crossfade previous voices smoothly
    const prevOscs = this.activePadOscs;
    const prevGains = this.activePadGains;
    for (const g of prevGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 4.2);
      } catch {
        // ignore
      }
    }
    window.setTimeout(() => {
      for (const osc of prevOscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      }
    }, 4500);

    const nextOscs: OscillatorNode[] = [];
    const nextGains: GainNode[] = [];
    const isStrings = this.palette === 'cinematic_strings';

    degree.intervals.forEach((semi, voiceIdx) => {
      const freq = midiToHz(rootMidi + semi, tuning);
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
        const amp = voiceIdx === 0 ? 0.19 : isStrings ? 0.032 : 0.062;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(amp, now + (isStrings ? 4.8 : 3.4));

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

    this.activePadOscs = nextOscs;
    this.activePadGains = nextGains;
  }

  private scheduleLiveSteps(): void {
    if (!this.ctx || !this.pulseBus || !this.musicSpec || !this.isPlaying) return;
    const ctx = this.ctx;
    const liveBpm = this.getCurrentBpm();
    // In beatless mode (bpm === 0), drift notes slowly at an organic 56 BPM pulse with zero percussion
    const clockBpm = liveBpm > 0 ? liveBpm : 56;
    const eighthDur = 60 / clockBpm / 2;
    const lookahead = 0.18;

    while (this.nextStepTime < ctx.currentTime + lookahead) {
      const step = this.stepCount % 16;
      const swing =
        (this.palette === 'warm_rhodes' || this.palette === 'felt_piano') && step % 2 === 1
          ? eighthDur * 0.12
          : 0;
      const humanMicro = (Math.random() - 0.5) * 0.008;
      const t = Math.max(ctx.currentTime + 0.01, this.nextStepTime + swing + humanMicro);
      const lift = this.antiMonotonyActive ? 1.2 : 1.0;
      const perc = liveBpm === 0 ? 'none' : this.musicSpec.percussion;

      // 1. Percussion Layer (strictly obeys study's percussion lock!)
      if (perc !== 'none') {
        if (this.kickPattern[step]) {
          this.triggerWarmSubKick(t, (step === 0 ? 0.46 : 0.34) * (perc === 'minimal_soft' ? 0.65 : 1.0));
        }
        if (this.hatPattern[step] && !this.speakerSafeEQ) {
          this.triggerBrushedAirHat(t, 0.024 * (perc === 'minimal_soft' ? 0.6 : 1.0));
        }
      }

      // 2. Clean Sub-Bass Anchor (only for rhythmic/electronic/rhodes focus modes)
      if (
        perc !== 'none' &&
        (this.palette === 'deep_electronic' || this.palette === 'warm_rhodes') &&
        (step === 0 || step === 6 || step === 8 || step === 14)
      ) {
        this.triggerCleanBass(t, step === 14 ? 7 : 0, 0.21, eighthDur * 1.5);
      }

      // 3. 1/f Pink-Fractal Melodic & Harmonic Voice (Never loops identically!)
      const noteProb =
        liveBpm === 0
          ? 0.24
          : Math.max(0.18, Math.min(0.68, 0.22 + this.musicSpec.density * 0.45));
      const isStrongBeat = step === 0 || step === 4 || step === 8 || step === 12;
      if ((isStrongBeat && Math.random() < noteProb + 0.25) || Math.random() < noteProb * 0.55) {
        this.triggerMelodicVoice(t, step, lift);
      }

      // Occasional warm chord comp on beat 1 or syncopated offbeat
      if (step === 0 && (this.stepCount % 32 === 0 || Math.random() < 0.45)) {
        this.triggerHarmonicVoicing(t, 0.1 * lift);
      }

      this.nextStepTime += eighthDur;
      this.stepCount++;
    }
  }

  private pickFractalNoteHz(octaveShift = 12): number {
    if (!this.musicSpec) return 261.63;
    const scale = SCALE_INTERVALS[this.musicSpec.tonalMode] ?? SCALE_INTERVALS.suspended;
    const degree = this.getCurrentChord();
    const walk = this.fractal.next(); // smooth 0..1
    const idx = Math.min(scale.length - 1, Math.floor(walk * scale.length));
    const midi = this.musicSpec.rootMidi + degree.rootOffset + scale[idx] + octaveShift;
    return midiToHz(midi, this.musicSpec.tuningA4Hz);
  }

  private triggerMelodicVoice(time: number, step: number, lift: number): void {
    if (!this.ctx || !this.pulseBus || !this.musicSpec) return;
    const freq = this.pickFractalNoteHz(this.palette === 'ambient_water' ? 24 : 12);
    const vel = (0.09 + Math.random() * 0.065) * lift * this.intensityMult;

    if (this.palette === 'felt_piano') {
      this.playFeltPianoNote(time, freq, vel);
    } else if (this.palette === 'warm_rhodes') {
      this.playRhodesTineNote(time, freq, vel * 0.92);
    } else if (this.palette === 'nylon_acoustic') {
      this.playNylonPluckNote(time, freq, vel * 1.05);
    } else if (this.palette === 'deep_electronic') {
      this.playElectronicPluck(time, freq, vel * 0.85, step);
    } else {
      // cinematic_strings & ambient_water: pure shimmering resonant bell/harmonic
      this.playGlassHarmonic(time, freq, vel * 0.8, step);
    }
  }

  private triggerHarmonicVoicing(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus || !this.musicSpec) return;
    const degree = this.getCurrentChord();
    const tuning = this.musicSpec.tuningA4Hz;
    const notes = degree.intervals.slice(1, 4);
    notes.forEach((semi, idx) => {
      const freq = midiToHz(this.musicSpec!.rootMidi + degree.rootOffset + semi + 12, tuning);
      const offset = idx * 0.028;
      if (this.palette === 'warm_rhodes') {
        this.playRhodesTineNote(time + offset, freq, amp * 0.55);
      } else if (this.palette === 'nylon_acoustic') {
        this.playNylonPluckNote(time + offset, freq, amp * 0.55);
      } else {
        this.playFeltPianoNote(time + offset, freq, amp * 0.52);
      }
    });
  }

  private playFeltPianoNote(time: number, freq: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc1.type = 'triangle';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 2, time);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(1850, this.computeCutoffHz() * 1.1), time);
    lp.frequency.exponentialRampToValueAtTime(340, time + 1.6);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 2.2);

    pan.pan.value = Math.max(-0.5, Math.min(0.5, ((freq - 320) / 500) * 0.4));

    const overtoneGain = this.ctx.createGain();
    overtoneGain.gain.value = 0.22;

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
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, time);
    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * 2, time);

    // Classic FM Rhodes bell transient
    modGain.gain.setValueAtTime(freq * 0.75, time);
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
    const osc = this.ctx.createOscillator();
    const oscSub = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(freq * 0.5, time);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(2600, this.computeCutoffHz() * 1.4), time);
    lp.frequency.exponentialRampToValueAtTime(420, time + 0.65);
    lp.Q.value = 1.4;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.006);
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
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(2400, this.computeCutoffHz() * 1.2), time);
    lp.frequency.exponentialRampToValueAtTime(320, time + 0.34);
    lp.Q.value = 2.0;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * 0.72, time + 0.01);
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
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

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

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMult, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.2, dur));

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.cleanSubBus);
    osc.start(time);
    osc.stop(time + dur + 0.06);
  }

  private triggerBrushedAirHat(time: number, amp: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const osc = this.ctx.createOscillator();
    const bp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1450, time);
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 1.4;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(amp * this.intensityMult, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(bp);
    bp.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + 0.055);
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.chordTimer !== null) {
      window.clearInterval(this.chordTimer);
      this.chordTimer = null;
    }
    if (this.stepTimer !== null) {
      window.clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
    try {
      this.filterLfo?.stop();
      for (const osc of this.activePadOscs) osc.stop();
    } catch {
      // ignore
    }
    this.activePadOscs = [];
    this.activePadGains = [];
    this.filterLfo = null;
    this.padBus = null;
    this.padFilter = null;
    this.pulseBus = null;
    this.ctx = null;
  }
}
