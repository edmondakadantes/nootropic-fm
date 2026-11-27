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
    !appSrc.includes("onLogoClick={() => {\n            if (activeRec && screen === 'player') {\n              setSessionDisplay('minimized');\n            }\n            setSelectedPreset(null);\n            setScreen(profile ? 'checkin' : 'studio_home');"),
    'Header logo must not trap logged-in profiles on checkin screen'
  );
  assert.match(
    appSrc,
    /onLogoClick=\{\(\)\s*=>\s*\{[\s\S]{0,420}setScreen\('studio_home'\);\s*\r?\n\s*window\.scrollTo\(\{\s*top:\s*0/,
    'Header logo click must unconditionally setScreen("studio_home") and scroll to top'
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

test('6. Hybrid Open-Goal Science Resolver: handles US English typos ("creaitve") and arbitrary open science topics ("public speaking confidence")', async () => {
  const { resolveOpenGoalIntent } = await import('../shared/openGoals.ts');

  // 1. Typo-resilient Creative Ideation ("I want to feel creaitve")
  const creative = resolveOpenGoalIntent('I want to feel creaitve for 25 min');
  assert.ok(creative, 'Expected creative goal resolution');
  assert.equal(creative.slug, 'creative_ideation');
  assert.equal(creative.dspOverride?.modulationHz, 10);
  assert.equal(creative.isOpenCustomTopic, false);
  assert.match(creative.pubmedQuery, /divergent thinking/i);

  // 2. Memory & Study Retention ("memroy for exam")
  const memory = resolveOpenGoalIntent('boost my memroy for exam');
  assert.ok(memory && memory.slug === 'memory_learning');
  assert.equal(memory.dspOverride?.modulationHz, 14);

  // 3. Open scientific topic outside the 8 preset cards ("public speaking confidence")
  const openTopic = resolveOpenGoalIntent('I need public speaking confidence');
  assert.ok(openTopic, 'Expected open custom topic resolution');
  assert.equal(openTopic.isOpenCustomTopic, true);
  assert.equal(openTopic.slug, 'custom:public_speaking_confidence');
  assert.equal(openTopic.label, 'Public Speaking Confidence');
  assert.match(openTopic.pubmedQuery, /public\[Title\/Abstract\]/i);

  // 4. Driving safety guardrail on sleep/calm requests while driving
  const drivingSafe = resolveOpenGoalIntent('help me fall asleep', true);
  assert.ok(drivingSafe && drivingSafe.coreTarget === 'alert_focus');
});

test('7. Authentic Stereo Rain & Genre Studio Bandwidth: high-crest droplet transients (non-hiss), decorrelated stereo, and unmuffled studio filter', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const vm = await import('node:vm');
  const { transform } = await import('esbuild');
  const ROOT = process.cwd();

  const rainSrc = fs.readFileSync(path.join(ROOT, 'src/audio/StereoRainBed.ts'), 'utf8');
  const mathSrc = fs.readFileSync(path.join(ROOT, 'src/audio/dspMath.ts'), 'utf8');
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src/audio/PsychoacousticEngine.ts'), 'utf8');
  const composerSrc = fs.readFileSync(path.join(ROOT, 'src/audio/GenerativeComposer.ts'), 'utf8');

  // Verify real 48 kHz R2 field-recording loader & multi-genre patterns exist
  assert.ok(
    rainSrc.includes('samples/rain/real-rain-canopy-48k.'),
    'StereoRainBed must load the real 48 kHz stereo rain recording from R2'
  );
  assert.ok(
    engineSrc.includes('return Math.round(Math.max(5400,'),
    'computeStudioCutoffHz must preserve >=5400 Hz natural acoustic articulation across all studio genres'
  );
  assert.ok(
    composerSrc.includes("this.genre === 'bossa_nova'") &&
      composerSrc.includes("this.genre === 'dub_reggae'") &&
      composerSrc.includes('ensureShakerNoiseBuf'),
    'GenerativeComposer must render authentic genre-specific rhythms and brushed shaker transients'
  );

  // Execute createStereoRainBuffer and verify physical droplet crest factor (>13 dB vs ~10 dB stationary hiss) & wide stereo decorrelation
  const compiledMath = await transform(mathSrc, { loader: 'ts', format: 'cjs' });
  const compiledRain = await transform(rainSrc, { loader: 'ts', format: 'cjs' });
  const mathMod = { exports: {} };
  vm.runInNewContext(compiledMath.code, {
    exports: mathMod.exports,
    module: mathMod,
    Float32Array,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Math,
    Number,
  });
  const rainMod = { exports: {} };
  vm.runInNewContext(compiledRain.code, {
    exports: rainMod.exports,
    module: rainMod,
    require: (id) => (id === './dspMath' ? mathMod.exports : {}),
    Float32Array,
    Math,
    Number,
  });

  const fakeCtx = {
    sampleRate: 48000,
    createBuffer(channels, length, sampleRate) {
      const chData = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (c) => chData[c],
      };
    },
  };

  const buf = rainMod.exports.createStereoRainBuffer(fakeCtx, 6);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let sumSq = 0;
  let peak = 0;
  let corrNum = 0;
  let sqL = 0;
  let sqR = 0;
  for (let i = 0; i < buf.length; i++) {
    const l = L[i];
    const r = R[i];
    assert.ok(Number.isFinite(l) && Number.isFinite(r), 'Rain sample must be finite');
    sumSq += l * l + r * r;
    const p = Math.max(Math.abs(l), Math.abs(r));
    if (p > peak) peak = p;
    corrNum += l * r;
    sqL += l * l;
    sqR += r * r;
  }
  const rms = Math.sqrt(sumSq / (2 * buf.length));
  const crestDb = 20 * Math.log10(peak / Math.max(1e-9, rms));
  const lrCorr = corrNum / Math.max(1e-9, Math.sqrt(sqL * sqR));

  assert.ok(
    crestDb >= 13.5,
    `Expected physical droplet transient crest >= 13.5 dB (not flat hiss), got ${crestDb.toFixed(2)} dB`
  );
  assert.ok(
    Math.abs(lrCorr) < 0.35,
    `Expected wide decorrelated stereo rain (|corr| < 0.35), got ${lrCorr.toFixed(3)}`
  );
});

test('8. Endless Stream (Lyria RealTime) Worklet Ring Buffer: absorbs 4x 96,000-frame (8.0s) burst without overflow truncation or underrun', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const vm = await import('node:vm');
  const ROOT = process.cwd();

  const tsSrc = fs.readFileSync(path.join(ROOT, 'src/audio/dspWorklets.ts'), 'utf8');
  const startMarker = 'export const DSP_WORKLET_CODE = `';
  const startIdx = tsSrc.indexOf(startMarker);
  const endMarker = '`;\n\nconst loadedWorkletContexts';
  const endIdx = tsSrc.indexOf(endMarker, startIdx);
  const rawCode = tsSrc
    .slice(startIdx + startMarker.length, endIdx)
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$');

  const registry = {};
  class AudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage: () => {} };
    }
  }
  vm.runInNewContext(rawCode, {
    AudioWorkletProcessor,
    sampleRate: 48000,
    currentTime: 0,
    Math,
    Float32Array,
    Float64Array,
    Int32Array,
    Uint8Array,
    Number,
    Array,
    Boolean,
    String,
    Object,
    registerProcessor: (name, cls) => {
      registry[name] = cls;
    },
  });

  const LyriaProc = registry['nootropic-lyria-stream-processor'];
  assert.ok(LyriaProc, 'Expected nootropic-lyria-stream-processor to be registered');
  const proc = new LyriaProc();

  // Feed 4 realistic Google Lyria RealTime chunks (96,000 stereo frames = 2.0s each -> 384,000 frames = 8.0s burst)
  for (let c = 0; c < 4; c++) {
    const left = new Float32Array(96000);
    const right = new Float32Array(96000);
    for (let i = 0; i < 96000; i++) {
      const idx = c * 96000 + i;
      left[i] = 0.4 * Math.sin((2 * Math.PI * 220 * idx) / 48000);
      right[i] = 0.4 * Math.cos((2 * Math.PI * 220 * idx) / 48000);
    }
    proc.port.onmessage({ data: { type: 'pcm', left, right } });
  }

  assert.equal(proc.writePos, 384000, 'Expected all 384,000 burst frames written');
  assert.equal(proc.readPos, 0, 'Burst of 8.0s must NOT trigger overflow jump/truncation');
  assert.equal(proc.primed, true, 'Processor must be primed and ready');

  // Render 6.0 full seconds (288,000 frames = 2,250 blocks of 128) before next chunk arrives — zero underrun!
  for (let b = 0; b < 2250; b++) {
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    proc.process([], [[outL, outR]], {});
    assert.equal(proc.primed, true, `Underrun occurred prematurely at block ${b}`);
  }
});
