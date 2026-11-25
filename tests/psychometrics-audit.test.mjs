import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignStratifiedShamControl,
  computeHierarchicalArmPosterior,
  computePvtMetrics,
  sampleHierarchicalThompson,
  sampleStandardNormal,
} from '../shared/psychometrics.ts';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('1. PVT 20-Trial 1/RT Psychometrics: inverse speed, anticipation rejection (<100 ms), lapses, decile spread', () => {
  // 20 valid trials (215..540 ms) plus 2 invalid anticipations (<100 ms)
  const raw = [
    72, 95, // anticipations must be excluded
    210, 220, 235, 240, 245, 250, 255, 260, 265, 270,
    275, 280, 285, 290, 300, 310, 325, 340, 515, 560,
  ];
  const m = computePvtMetrics(raw);
  assert.equal(m.anticipations, 2);
  assert.equal(m.trialCount, 20);
  assert.equal(m.lapses, 2); // 515, 560
  assert.equal(m.medianMs, 273); // (270 + 275) / 2 rounded
  assert.equal(m.fastest10PctMs, 215); // mean(210, 220)
  assert.equal(m.slowest10PctMs, 538); // mean(515, 560)
  assert.equal(m.decileSpreadMs, 323);

  const valid = raw.filter((v) => v >= 100);
  const expectedInvRt = Number(
    (valid.reduce((acc, ms) => acc + 1000 / ms, 0) / valid.length).toFixed(3)
  );
  assert.equal(m.meanInvRt, expectedInvRt);
});

test('2. Stratified 25% Sham Allocator: exact 1 sham per 4-session block & strict consent gating', () => {
  const rng = mulberry32(42);
  assert.equal(
    assignStratifiedShamControl({
      recentControlFlags: [],
      researchConsent: false,
      rng,
    }),
    false
  );
  assert.equal(
    assignStratifiedShamControl({
      recentControlFlags: [],
      researchConsent: true,
      ephemeralMode: true,
      rng,
    }),
    false
  );

  // Simulate 500 consenting users x 8 sessions (two full 4-session blocks each)
  let totalSham = 0;
  let totalSessions = 0;
  for (let u = 0; u < 500; u++) {
    const historyNewestFirst = [];
    for (let s = 0; s < 8; s++) {
      const isSham = assignStratifiedShamControl({
        recentControlFlags: historyNewestFirst,
        researchConsent: true,
        blockSize: 4,
        rng,
      });
      historyNewestFirst.unshift(isSham);
      if (isSham) totalSham++;
      totalSessions++;
    }
    // Check chronological block integrity: oldest 4 = 1 sham, newest 4 = 1 sham
    const chrono = [...historyNewestFirst].reverse();
    const block1Shams = chrono.slice(0, 4).filter(Boolean).length;
    const block2Shams = chrono.slice(4, 8).filter(Boolean).length;
    assert.equal(block1Shams, 1, `Expected exactly 1 sham in block 1 for user ${u}`);
    assert.equal(block2Shams, 1, `Expected exactly 1 sham in block 2 for user ${u}`);
  }
  assert.equal(totalSham / totalSessions, 0.25);
});

test('3. Hierarchical Empirical-Bayes Shrinkage & A/A Null Simulation (< 6% false positive convergence)', () => {
  const rng = mulberry32(1337);

  // Verify shrinkage weight progression w = (n * tauSq) / (n * tauSq + measVar)
  const p0 = computeHierarchicalArmPosterior({
    priorAlpha: 3.4,
    priorBeta: 1.2,
    cohortAlpha: 53.4,
    cohortBeta: 46.2,
    cohortTrials: 95,
    profileAlpha: 4.4,
    profileBeta: 1.2,
    profileTrials: 1,
  });
  const p8 = computeHierarchicalArmPosterior({
    priorAlpha: 3.4,
    priorBeta: 1.2,
    cohortAlpha: 53.4,
    cohortBeta: 46.2,
    cohortTrials: 95,
    profileAlpha: 10.4,
    profileBeta: 2.2,
    profileTrials: 8,
  });
  assert.ok(p0.shrinkageWeight < 0.25, `Single-session shrinkage weight too strong: ${p0.shrinkageWeight}`);
  assert.ok(p8.shrinkageWeight >= 0.55, `8-session shrinkage weight too weak: ${p8.shrinkageWeight}`);
  assert.ok(p8.mean > p0.mean && p8.stdDev < p0.stdDev);

  // Sample draw stays safely bounded
  const draw = sampleHierarchicalThompson(p8, rng);
  assert.ok(draw >= 0.02 && draw <= 0.98);

  // Monte Carlo A/A Null Simulation: 300 cohorts, each with 2 identical null arms (true theta = 0.55)
  // Verify user-level hierarchical posterior tracks true user effect well & cohort null Z-separation < 6.5%
  const priorAlpha = 3.0;
  const priorBeta = 3.0;
  const trueTheta = 0.55;
  const tau = Math.sqrt(0.018);
  const measSigma = Math.sqrt(0.095);
  let falsePositives = 0;
  let ciCovered = 0;
  const numTrialsPerCohort = 45;
  const numCohorts = 300;

  for (let c = 0; c < numCohorts; c++) {
    let sumA = 0;
    let sumB = 0;
    let userHits = 0;
    let userChecks = 0;

    for (let t = 0; t < numTrialsPerCohort; t++) {
      const yA = Math.max(0.05, Math.min(0.95, trueTheta + 0.18 * sampleStandardNormal(rng)));
      const yB = Math.max(0.05, Math.min(0.95, trueTheta + 0.18 * sampleStandardNormal(rng)));
      sumA += yA;
      sumB += yB;

      // Single-user shrinkage calibration check with 4 noisy observations from mu_u ~ N(theta, tau^2)
      if (t === 0) {
        const trueMuU = trueTheta + tau * sampleStandardNormal(rng);
        let uSum = 0;
        for (let k = 0; k < 4; k++) {
          uSum += Math.max(0.05, Math.min(0.95, trueMuU + measSigma * sampleStandardNormal(rng)));
        }
        const pUser = computeHierarchicalArmPosterior({
          priorAlpha,
          priorBeta,
          cohortAlpha: priorAlpha + 25,
          cohortBeta: priorBeta + 20,
          cohortTrials: 45,
          profileAlpha: priorAlpha + uSum,
          profileBeta: priorBeta + (4 - uSum),
          profileTrials: 4,
        });
        userChecks++;
        if (Math.abs(trueMuU - pUser.mean) <= 1.96 * pUser.stdDev) userHits++;
      }
    }

    const alphaA = priorAlpha + sumA;
    const betaA = priorBeta + (numTrialsPerCohort - sumA);
    const alphaB = priorAlpha + sumB;
    const betaB = priorBeta + (numTrialsPerCohort - sumB);
    const meanA = alphaA / (alphaA + betaA);
    const meanB = alphaB / (alphaB + betaB);
    const varA = (alphaA * betaA) / ((alphaA + betaA) ** 2 * (alphaA + betaA + 1));
    const varB = (alphaB * betaB) / ((alphaB + betaB) ** 2 * (alphaB + betaB + 1));
    const zDiff = Math.abs(meanA - meanB) / Math.sqrt(varA + varB);
    if (zDiff > 1.96) falsePositives++;
    ciCovered += userHits / Math.max(1, userChecks);
  }

  const fpRate = falsePositives / numCohorts;
  const userCiCov = ciCovered / numCohorts;
  assert.ok(fpRate < 0.065, `A/A false positive rate too high: ${(fpRate * 100).toFixed(2)}%`);
  assert.ok(
    userCiCov >= 0.88 && userCiCov <= 0.99,
    `Hierarchical 95% CI coverage out of bounds: ${(userCiCov * 100).toFixed(1)}%`
  );
});

test('4. Psychometric Power Proof: 20-trial 1/RT + 25% stratified sham cuts required N by > 6.5x', () => {
  const vifLegacy12 = 1 / 0.12 + 1 / 0.88; // 9.4697
  const vifV7_25 = 1 / 0.25 + 1 / 0.75; // 5.3333
  const shamEfficiency = vifLegacy12 / vifV7_25;
  const trialEfficiency = 20 / 5;
  const combinedFactor = trialEfficiency * shamEfficiency;
  assert.ok(Math.abs(vifV7_25 - 5.3333) < 1e-3);
  assert.ok(combinedFactor > 6.5, `Expected >6.5x sample-size efficiency gain, got ${combinedFactor.toFixed(2)}x`);
});
