/**
 * nootropic.fm — Circadian Daylight/Night Mode, Standalone NootropicFM Lock & Earbuds-Only Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const { resolveCircadianTheme } = await import('../src/lib/circadianTheme.ts');
const { DEVICE_LABELS, STUDIO_MIX_GENRES } = await import('../shared/types.ts');
const { selectProtocolRecommendation } = await import('../shared/protocols.ts');
const { buildVoiceConciergePlan } = await import('../shared/voiceConcierge.ts');

test('resolveCircadianTheme switches automatically between Daylight (07:00-19:00) and Night (19:00-07:00)', () => {
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T10:30:00')), 'daylight');
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T18:59:00')), 'daylight');
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T19:00:00')), 'night');
  assert.equal(resolveCircadianTheme('auto', new Date('2026-11-26T03:15:00')), 'night');
  assert.equal(resolveCircadianTheme('daylight', new Date('2026-11-26T23:00:00')), 'daylight');
  assert.equal(resolveCircadianTheme('night', new Date('2026-11-26T12:00:00')), 'night');
});

test('STUDIO_MIX_GENRES cleanly isolates standalone NootropicFM Mode from the 10 Studio Mix genres', () => {
  assert.equal(STUDIO_MIX_GENRES.length, 10);
  assert.ok(!STUDIO_MIX_GENRES.includes('nootropic_trance'));
  assert.equal(DEVICE_LABELS.headphones, 'In-Ear Buds');
  assert.match(DEVICE_LABELS.speakers, /Degraded/i);
});

test('Standalone NootropicFM Mode locks 6x40 Hz arm across targets and strictly disables 25% sham control dilution', () => {
  const dummyProfile = {
    id: 'anon_trance_test',
    displayName: 'Edmond',
    age: 34,
    ageBand: '25-34',
    role: 'entrepreneur',
    texturePref: 'rhythmic_pulse',
    noiseSensitivity: 'medium',
    defaultDevice: 'headphones',
    primaryChallenge: 'distraction',
    researchConsent: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Run 20 trials even with researchConsent=true and recentControlFlags=[false, false, false]
  // (which would normally force a 100% deterministic sham control on block #4!)
  for (let i = 0; i < 12; i++) {
    const rec = selectProtocolRecommendation({
      sessionId: `ses_trance_${i}`,
      profile: dummyProfile,
      currentState: 'distracted',
      baselineScore: 2,
      targetState: 'energy_lift', // Even if earlier target was energy_lift, standalone lock enforces 6x40 Hz!
      customGoalSlug: 'trance_lock',
      environment: 'office',
      device: 'headphones',
      durationMin: 25,
      requestedGenre: 'nootropic_trance',
      cohortStats: [],
      profileStats: [],
      recentControlFlags: [false, false, false],
      allowControlTrial: true,
    });
    assert.equal(rec.arm.id, 'nootropic-trance-6x40hz');
    assert.equal(rec.params.genre, 'nootropic_trance');
    assert.equal(rec.isControlTrial, false, 'Standalone NootropicFM Mode must never be diluted by sham control');
  }
});

test('Voice Concierge explicitly reinforces In-Ear Buds seal and warns gently when on degraded speakers', () => {
  const earbudsTrance = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'Edmond',
    currentState: 'calm_neutral',
    targetState: 'deep_flow',
    armId: 'nootropic-trance-6x40hz',
    modulationHz: 6,
    genre: 'nootropic_trance',
    isDriving: false,
    device: 'headphones',
    timeBucket: 'morning',
  });
  assert.match(earbudsTrance.bodyText, /earbuds/i);

  const degradedSpeakers = buildVoiceConciergePlan({
    cueType: 'intro_full',
    firstName: 'Edmond',
    currentState: 'distracted',
    targetState: 'alert_focus',
    armId: 'beta-16hz',
    modulationHz: 16,
    genre: 'deep_electronic',
    isDriving: false,
    device: 'speakers',
    timeBucket: 'afternoon',
  });
  assert.match(degradedSpeakers.bodyText, /earbuds/i);
  assert.match(degradedSpeakers.bodyCacheSlug, /_spk$/);
});
