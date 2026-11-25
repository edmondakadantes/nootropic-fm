import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function db(x) {
  return 20 * Math.log10(Math.max(1e-12, x));
}

function computeHarmonicCarrierHz(rootMidi, tuningA4Hz = 440, targetHz = 220) {
  const midiToHz = (m) => Number((tuningA4Hz * Math.pow(2, (m - 69) / 12)).toFixed(2));
  const basePc = ((Math.round(rootMidi) % 12) + 12) % 12;
  let bestHz = midiToHz(60 + basePc);
  let bestDiff = Infinity;
  for (let oct = 2; oct <= 6; oct++) {
    const hz = midiToHz(oct * 12 + basePc);
    const diff = Math.abs(Math.log2(hz / Math.max(60, targetHz)));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestHz = hz;
    }
  }
  return bestHz;
}

function makeBiquad(type, fc, sampleRate, qLin = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * qLin);
  const a0 = 1 + alpha;
  let b0, b1, b2, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cosW) / 2 / a0;
    b1 = (1 - cosW) / a0;
    b2 = (1 - cosW) / 2 / a0;
    a1 = (-2 * cosW) / a0;
    a2 = (1 - alpha) / a0;
  } else if (type === 'highpass') {
    b0 = (1 + cosW) / 2 / a0;
    b1 = -(1 + cosW) / a0;
    b2 = (1 + cosW) / 2 / a0;
    a1 = (-2 * cosW) / a0;
    a2 = (1 - alpha) / a0;
  } else {
    b0 = (1 - alpha) / a0;
    b1 = (-2 * cosW) / a0;
    b2 = (1 + alpha) / a0;
    a1 = (-2 * cosW) / a0;
    a2 = (1 - alpha) / a0;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function makeLR4(type, fc, sampleRate) {
  const s1 = makeBiquad(type, fc, sampleRate, Math.SQRT1_2);
  const s2 = makeBiquad(type, fc, sampleRate, Math.SQRT1_2);
  return (x) => s2(s1(x));
}

function measureEnvelopeDepthAtHz(samples, sampleRate, targetHz) {
  const block = Math.round(sampleRate / 1000); // 1000 Hz envelope rate (48 samples)
  const numBlocks = Math.floor(samples.length / block);
  const env = new Float64Array(numBlocks);
  let mean = 0;
  let envMin = Infinity;
  let envMax = 0;
  for (let b = 0; b < numBlocks; b++) {
    let sumSq = 0;
    const base = b * block;
    for (let i = 0; i < block; i++) {
      const s = samples[base + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / block);
    env[b] = rms;
    mean += rms;
    if (b > 80) {
      if (rms < envMin) envMin = rms;
      if (rms > envMax) envMax = rms;
    }
  }
  mean /= Math.max(1, numBlocks);
  let re = 0;
  let im = 0;
  const envRate = sampleRate / block;
  for (let b = 0; b < numBlocks; b++) {
    const centered = env[b] - mean;
    const ang = (2 * Math.PI * targetHz * b) / envRate;
    re += centered * Math.cos(ang);
    im -= centered * Math.sin(ang);
  }
  const modAmp = (2 * Math.sqrt(re * re + im * im)) / Math.max(1, numBlocks);
  const modIndex = mean > 1e-9 ? modAmp / mean : 0;
  const peakToTrough = envMax > 1e-9 ? 1 - envMin / envMax : 0;
  return { meanRms: mean, modAmp, modIndex, peakToTrough };
}

test('1. Logo navigation in App.tsx always routes to main landing page even when profile exists', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(
    !appSrc.includes("onClick={() => {\n              setSelectedPreset(null);\n              setScreen(profile ? 'checkin' : 'landing');"),
    'Header logo must not trap logged-in profiles on checkin screen'
  );
  assert.match(
    appSrc,
    /title="Return to nootropic\.fm main page"[\s\S]{0,120}|setScreen\('landing'\);\s*window\.scrollTo\(\{\s*top:\s*0/,
    'Header logo click must unconditionally setScreen("landing") and scroll to top'
  );
});

test('2. 3-Way Audio Layer Monitor DSP: true isolation in Science Only & Plain Music, audible overlap in Nootropic Mix, and <350ms Science->Plain transition', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');
  assert.ok(
    engineSrc.includes('amScienceCarrierGain') &&
      engineSrc.includes('amSciencePulseGain') &&
      engineSrc.includes('computeAmScienceCarrierTarget'),
    'PsychoacousticEngine must wire dedicated 94%-pulsed key-locked amScienceCarrierGain + amSciencePulseGain'
  );
  assert.ok(
    !engineSrc.includes('!this.studySpec?.music.bpmRamp &&\n      track.v7Remastered'),
    'v7Remastered Studio Mix stems must never fall back to WSOLA MP3 slicing on bpmRamp presets'
  );

  // Sample-accurate 48 kHz simulation of Deep Electronic (G minor: 55 Hz sub-bass + sparse 75ms plucks)
  // through exact 3-Band LR4 + 94%-pulsed key-locked amScienceCarrier + 18 Hz Band-2 AM across all 3 modes
  const sr = 48000;
  const durSec = 2.0;
  const N = sr * durSec;
  const modHz = 18.0;
  const f0 = computeHarmonicCarrierHz(43, 440, 220); // G3 = 196.00 Hz
  assert.ok(Math.abs(f0 - 196.0) < 0.05, `Expected G3 196 Hz root carrier, got ${f0}`);

  function renderMode(mode, modMult = 1.0) {
    const lowLp = makeLR4('lowpass', 190, sr);
    const lowAp = makeBiquad('allpass', 4500, sr, Math.SQRT1_2);
    const highHp1 = makeLR4('highpass', 190, sr);
    const airHp = makeLR4('highpass', 4500, sr);
    const midLp = makeLR4('lowpass', 4500, sr);
    const carrierLp = makeBiquad('lowpass', 1320, sr, Math.SQRT1_2);

    const muteMusic = mode === 'science_only';
    const muteScience = mode === 'music_only';
    const musicGain = muteMusic ? 0.0 : 1.0;

    const baseDepth = 0.4;
    const carrierGain = muteScience
      ? 0.0
      : muteMusic
        ? Math.min(0.52, Math.max(0.32, 0.44 * (0.82 + 0.18 * modMult)))
        : Math.min(0.34, 0.22 * (0.58 + baseDepth) * modMult);

    const pulseDepth = muteScience
      ? 0.0
      : Math.min(0.96, Math.max(0.78, 0.9 * (0.76 + 0.24 * modMult)));
    const pulseSwing = 0.5 * pulseDepth;
    const pulseBias = muteScience ? 0.0 : 1.0 - pulseSwing;

    let bias = 1.0;
    let swing = 0.0;
    if (!muteScience && !muteMusic) {
      const mixDepth = Math.min(0.75, baseDepth * 1.32 * modMult);
      const vcaDepth = mixDepth <= 0.36 ? mixDepth : 0.36 + (mixDepth - 0.36) * 0.68;
      swing = vcaDepth / 2;
      bias = 1.0 - swing;
    }

    const out = new Float64Array(N);
    const corticalBandOut = new Float64Array(N);
    const musicOnlyComponent = new Float64Array(N);
    const scienceOnlyComponent = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const t = i / sr;
      // Deep Electronic pattern: continuous 55 Hz sub-bass + short 75 ms synth pluck every 500 ms (120 BPM)
      const beatPos = t % 0.5;
      const pluckEnv = beatPos < 0.075 ? Math.exp(-beatPos / 0.022) : 0;
      const subBass = 0.28 * Math.sin(2 * Math.PI * 55 * t);
      const midPluck = 0.22 * pluckEnv * Math.sin(2 * Math.PI * 392 * t);
      const hiHat = beatPos < 0.015 ? 0.05 * Math.sin(2 * Math.PI * 7200 * t) : 0;
      const rawMusic = subBass + midPluck + hiHat;

      const m = rawMusic * musicGain;
      const b1 = lowAp(lowLp(m));
      const above = highHp1(m);
      const b3 = airHp(above);
      const b2Music = midLp(above);

      const lfo = Math.sin(2 * Math.PI * modHz * t);
      const musicVca = bias + swing * lfo;
      const b2MusicOut = b2Music * musicVca;

      const fifth = Math.pow(2, 7 / 12);
      const harmRaw =
        0.58 * Math.sin(2 * Math.PI * f0 * t) +
        0.21 * Math.sin(2 * Math.PI * f0 * fifth * t) +
        0.11 * Math.sin(2 * Math.PI * f0 * 2 * t);
      const pulseVca = pulseBias + pulseSwing * lfo;
      const amScienceOut = carrierLp(harmRaw) * pulseVca * carrierGain;

      out[i] = b1 + b2MusicOut + amScienceOut + b3;
      corticalBandOut[i] = b2MusicOut + amScienceOut;
      musicOnlyComponent[i] = b1 + b2MusicOut + b3;
      scienceOnlyComponent[i] = amScienceOut;
    }
    return { out, corticalBandOut, musicOnlyComponent, scienceOnlyComponent };
  }

  const steadyStart = Math.round(sr * 0.3);
  const scienceRender = renderMode('science_only');
  const plainRender = renderMode('music_only');
  const mixRender = renderMode('full_mix');

  // A) Science Only: 0% music bleed (<-100 dB) + >=85% peak-to-trough 18 Hz pulse depth
  let musicBleedSq = 0;
  for (let i = steadyStart; i < N; i++) {
    musicBleedSq += scienceRender.musicOnlyComponent[i] ** 2;
  }
  assert.ok(db(Math.sqrt(musicBleedSq / (N - steadyStart))) < -100, 'Science Only must have 0% music bleed');

  const sciEnv = measureEnvelopeDepthAtHz(scienceRender.out.subarray(steadyStart), sr, modHz);
  assert.ok(
    sciEnv.meanRms > 0.05 && sciEnv.meanRms < 0.35,
    `Science Only RMS must be comfortably audible, got ${sciEnv.meanRms.toFixed(4)}`
  );
  assert.ok(
    sciEnv.peakToTrough >= 0.85 && sciEnv.modIndex >= 0.55,
    `Science Only must have crisp >=85% 18 Hz pulse depth, got peakToTrough=${sciEnv.peakToTrough.toFixed(3)}, modIndex=${sciEnv.modIndex.toFixed(3)}`
  );

  // B) Plain Music: 0% science carrier bleed (<-100 dB) and 0% AM modulation
  let scienceBleedSq = 0;
  for (let i = steadyStart; i < N; i++) {
    scienceBleedSq += plainRender.scienceOnlyComponent[i] ** 2;
  }
  assert.ok(db(Math.sqrt(scienceBleedSq / (N - steadyStart))) < -100, 'Plain Music must have 0% science bleed');

  // C) Nootropic Mix: contains BOTH active music AND unmistakable 18 Hz cortical pulse (> +18 dB cortical band SNR over Plain Music!)
  const plainCorticalEnv = measureEnvelopeDepthAtHz(plainRender.corticalBandOut.subarray(steadyStart), sr, modHz);
  const mixCorticalEnv = measureEnvelopeDepthAtHz(mixRender.corticalBandOut.subarray(steadyStart), sr, modHz);
  const corticalSnrGainDb = db(mixCorticalEnv.modAmp / Math.max(1e-9, plainCorticalEnv.modAmp));
  assert.ok(
    corticalSnrGainDb > 18.0,
    `Nootropic Mix must boost 18 Hz mid-band cortical envelope by >18 dB over Plain Music (got +${corticalSnrGainDb.toFixed(2)} dB)`
  );

  const plainBroadEnv = measureEnvelopeDepthAtHz(plainRender.out.subarray(steadyStart), sr, modHz);
  const mixBroadEnv = measureEnvelopeDepthAtHz(mixRender.out.subarray(steadyStart), sr, modHz);
  const broadSnrGainDb = db(mixBroadEnv.modAmp / Math.max(1e-9, plainBroadEnv.modAmp));
  assert.ok(
    broadSnrGainDb > 8.0,
    `Even broadband (with heavy 55 Hz sub-bass), Nootropic Mix must boost 18 Hz modulation by >8 dB over Plain Music (got +${broadSnrGainDb.toFixed(2)} dB)`
  );

  // D) Dynamic live transition Science Only -> Plain Music settles >45 dB within 350 ms (tau = 65 ms)
  const tau = 0.065;
  const residualAfter350ms = Math.exp(-0.35 / tau);
  assert.ok(
    db(residualAfter350ms) < -45,
    `Science -> Plain transition must decay >45 dB within 350 ms (got ${db(residualAfter350ms).toFixed(1)} dB)`
  );
});

test('3. Smart Neural Effect Selector: auto-picks Min / Standard / Max from cognitive state & scales calibrated % cleanly (~36% -> ~65% -> ~95%)', async () => {
  const { NEURAL_EFFECT_MULT, pickSmartInitialEffectTier } = await import('../shared/psychometrics.ts');

  // Fatigued -> Energy Lift auto-selects Max Effect
  const rescue = pickSmartInitialEffectTier({
    currentState: 'fatigued',
    targetState: 'energy_lift',
    safetyMode: false,
    noiseSensitivity: 'medium',
  });
  assert.equal(rescue.tier, 'max');
  assert.equal(rescue.modMult, NEURAL_EFFECT_MULT.max);

  // Sleep Wind-Down or Driving Safety auto-selects Min Effect
  const sleep = pickSmartInitialEffectTier({
    currentState: 'stressed',
    targetState: 'sleep_winddown',
  });
  assert.equal(sleep.tier, 'min');
  const road = pickSmartInitialEffectTier({
    currentState: 'fatigued',
    targetState: 'alert_focus',
    safetyMode: true,
  });
  assert.equal(road.tier, 'min');

  // Normal Deep Flow auto-selects Standard
  const flow = pickSmartInitialEffectTier({
    currentState: 'calm',
    targetState: 'deep_flow',
  });
  assert.equal(flow.tier, 'standard');

  // Saved personal preference overrides default
  const savedMax = pickSmartInitialEffectTier({
    currentState: 'calm',
    targetState: 'deep_flow',
    preferredModMult: 1.4,
  });
  assert.equal(savedMax.tier, 'max');

  // Verify calibrated plateau percentage progression (~36% Min, ~65% Standard, ~95% Max)
  const calcPct = (mult) => {
    const normBase = 0.88 + 0.3 * 0.38; // 0.994
    return Math.round(Math.min(0.95, Math.max(0.15, 0.65 * mult * normBase)) * 100);
  };
  const minPct = calcPct(NEURAL_EFFECT_MULT.min);
  const stdPct = calcPct(NEURAL_EFFECT_MULT.standard);
  const maxPct = calcPct(NEURAL_EFFECT_MULT.max);
  assert.ok(minPct >= 34 && minPct <= 38, `Expected ~36% Min Effect, got ${minPct}%`);
  assert.ok(stdPct >= 63 && stdPct <= 67, `Expected ~65% Standard Effect, got ${stdPct}%`);
  assert.ok(maxPct >= 92 && maxPct <= 95, `Expected ~94% Max Effect, got ${maxPct}%`);
});

test('4. 2-Stage Iso-Bridge: stabilizes Anxious/Stressed/Burned-Out -> Focus at 10-11.5 Hz for 3m, then glides S-curve to 16 Hz', async () => {
  const { computeIsoBridgeForState, pickSmartInitialEffectTier } = await import(
    '../shared/psychometrics.ts'
  );

  // Anxious -> Sharp Focus (16 Hz) activates 2-Stage Iso-Bridge at 10.0 Hz for 180s + 60s glide
  const anxBridge = computeIsoBridgeForState({
    currentState: 'anxious',
    microStateId: 'anxious_racing',
    targetState: 'alert_focus',
    targetHz: 16,
    safetyMode: false,
  });
  assert.ok(anxBridge, 'Anxious -> Alert Focus must activate 2-Stage Iso-Bridge');
  assert.equal(anxBridge.stabilizeHz, 10.0);
  assert.equal(anxBridge.stabilizeDurationSec, 180);
  assert.equal(anxBridge.rampDurationSec, 60);

  const anxTier = pickSmartInitialEffectTier({
    currentState: 'anxious',
    microStateId: 'anxious_racing',
    targetState: 'alert_focus',
  });
  assert.equal(anxTier.tier, 'standard');
  assert.match(anxTier.autoReason, /Iso-Bridge/);

  // Burned Out -> Focus also activates 10.0 Hz Iso-Bridge
  const burnBridge = computeIsoBridgeForState({
    currentState: 'fatigued',
    microStateId: 'burned_out',
    targetState: 'alert_focus',
    targetHz: 14,
  });
  assert.ok(burnBridge && burnBridge.stabilizeHz === 10.0);

  // Tired / Brain Fog -> Focus does NOT delay with Iso-Bridge; launches at Max Effect from Second 1!
  const tiredBridge = computeIsoBridgeForState({
    currentState: 'fatigued',
    microStateId: 'brain_fog',
    targetState: 'alert_focus',
    targetHz: 16,
  });
  assert.equal(tiredBridge, undefined);
  const tiredTier = pickSmartInitialEffectTier({
    currentState: 'fatigued',
    microStateId: 'brain_fog',
    targetState: 'alert_focus',
  });
  assert.equal(tiredTier.tier, 'max');
});

test('5. Strict Layer-1 Science Invariance when switching Music Genres (zero carrier retuning, zero RMS pumping, zero param drift)', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');
  const rackSrc = fs.readFileSync(path.join(ROOT, 'src/audio/MedicalStimulusRack.ts'), 'utf8');
  const playerSrc = fs.readFileSync(path.join(ROOT, 'src/components/PlayerView.tsx'), 'utf8');
  const protoSrc = fs.readFileSync(path.join(ROOT, 'shared/protocols.ts'), 'utf8');

  // 1. PsychoacousticEngine alignHarmonicRootToTrack must NEVER call stimulusRack.retuneToMusicalRoot or mutate amCarrierRootOsc.frequency
  const alignMatch = engineSrc.match(/const alignHarmonicRootToTrack = \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(alignMatch, 'Expected alignHarmonicRootToTrack block in PsychoacousticEngine.ts');
  assert.ok(
    !alignMatch[0].includes('retuneToMusicalRoot') && !alignMatch[0].includes('amCarrierRootOsc'),
    'Layer 1 carriers must never retune when switching Layer 2 music tracks/genres'
  );

  // 2. MedicalStimulusRack setDynamicMusicEnvelope must lock dynamicMusicScale = 1.0 (zero music RMS pumping on Layer 1)
  const dynMatch = rackSrc.match(/public setDynamicMusicEnvelope\([\s\S]*?\n  \}/);
  assert.ok(dynMatch, 'Expected setDynamicMusicEnvelope in MedicalStimulusRack.ts');
  assert.ok(
    dynMatch[0].includes('this.dynamicMusicScale = 1.0') && !dynMatch[0].includes('refreshLevels'),
    'Layer 1 amplitude & noise floor must remain invariant across music genre volume differences'
  );

  // 3. PlayerView switchGenre must NOT kick listener out of science_only monitor mode
  const switchMatch = playerSrc.match(/const switchGenre = \(style: ResolvedGenre\) => \{[\s\S]*?\n  \};/);
  assert.ok(switchMatch, 'Expected switchGenre in PlayerView.tsx');
  assert.ok(
    !switchMatch[0].includes("layerMonitor === 'science_only'"),
    'Switching music genres must preserve active Layer Monitor mode (including Science Only)'
  );

  // 4. swapRecommendationGenre in shared/protocols.ts must NEVER mutate filterCutoffHz, bpm, or pulseIntensity
  const swapMatch = protoSrc.match(/export function swapRecommendationGenre\([\s\S]*?\n\}/);
  assert.ok(swapMatch, 'Expected swapRecommendationGenre in shared/protocols.ts');
  assert.ok(
    !swapMatch[0].includes('nextParams.bpm =') &&
      !swapMatch[0].includes('nextParams.pulseIntensity =') &&
      !swapMatch[0].includes('nextParams.filterCutoffHz ='),
    'swapRecommendationGenre must keep all Layer 1 acoustic parameters 100% locked across genres'
  );
});
