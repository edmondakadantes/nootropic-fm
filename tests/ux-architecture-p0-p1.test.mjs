/**
 * nootropic.fm — P0 + P1 UX Architecture Unit & Static Audit Suite
 *
 * Covers:
 *  1) privacyGuard: GPC + regional opt-in invariants, token-safe JSON export, complete prefix erasure.
 *  2) disclosureScheduler: Day-1 zero-friction (N=0), Session #2 Huggins (N=1),
 *     Session #3 Self-Study + QR (N=2), Session #4 PVT Lab badge (N=3), 3-stage Memory Maturity.
 *  3) pinnedProtocols: Pin/unpin/toggle semantics & MAX_PINNED_PROTOCOLS (8) cap.
 *  4) Per-session blinding invariant in DebriefView + compliance hygiene across src/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function installMockBrowserStorage() {
  const makeStore = () => {
    const map = new Map();
    return {
      get length() {
        return map.size;
      },
      key(idx) {
        return Array.from(map.keys())[idx] ?? null;
      },
      getItem(k) {
        return map.has(k) ? map.get(k) : null;
      },
      setItem(k, v) {
        map.set(String(k), String(v));
      },
      removeItem(k) {
        map.delete(String(k));
      },
      clear() {
        map.clear();
      },
    };
  };
  const ls = makeStore();
  const ss = makeStore();
  const events = [];
  const prev = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    window: globalThis.window,
    CustomEvent: globalThis.CustomEvent,
  };
  globalThis.localStorage = ls;
  globalThis.sessionStorage = ss;
  globalThis.CustomEvent = class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.window = {
    dispatchEvent(evt) {
      events.push(evt.type);
      return true;
    },
  };
  return {
    ls,
    ss,
    events,
    restore() {
      globalThis.localStorage = prev.localStorage;
      globalThis.sessionStorage = prev.sessionStorage;
      globalThis.window = prev.window;
      globalThis.CustomEvent = prev.CustomEvent;
    },
  };
}

const {
  resolvePrivacyState,
  exportLocalStudioDataJson,
  eraseAllLocalStudioData,
} = await import('../src/lib/privacyGuard.ts');
const {
  DISCLOSURE_STORAGE_KEY,
  readDisclosureState,
  recordCompletedLocalSession,
  markHugginsVerified,
  dismissDisclosurePrompt,
  computeDisclosurePrompts,
  resolveMemoryMaturityStage,
} = await import('../src/lib/disclosureScheduler.ts');
const {
  MAX_PINNED_PROTOCOLS,
  PINNED_PROTOCOLS_STORAGE_KEY,
  readPinnedProtocols,
  isProtocolPinned,
  pinStudyProtocol,
  togglePinStudyProtocol,
} = await import('../src/lib/pinnedProtocols.ts');

test('privacyGuard enforces Local-Only GPC default, safe JSON export, and prefix erasure', () => {
  const env = installMockBrowserStorage();
  try {
    const anonGpc = resolvePrivacyState({
      profile: null,
      runtimeConfig: {
        regionRequiresOptIn: true,
        countryCode: 'DE',
        customLiveGenAvailable: false,
        lyriaRealtimeAvailable: false,
        workersAiCompilerAvailable: false,
        stripeBillingAvailable: false,
        musicProvider: 'cache_only',
        dailyCapMax: 0,
        dailyCapRemaining: 0,
        popularCustomVibes: [],
      },
      gpcSignal: true,
    });
    assert.equal(anonGpc.mode, 'local_only');
    assert.equal(anonGpc.ephemeralMode, true);
    assert.equal(anonGpc.gpcDetected, true);
    assert.equal(anonGpc.statusLabel, 'Local-Only');

    const synced = resolvePrivacyState({
      profile: {
        id: 'prof_1',
        age: 30,
        gender: 'female',
        role: 'founder',
        defaultDevice: 'headphones',
        noiseSensitivity: 'medium',
        preferredModMult: 1,
        researchConsent: true,
        planTier: 'free',
        sessionCount: 4,
        successCount: 3,
        favoriteGenres: ['nootropic_trance'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      gpcSignal: false,
    });
    assert.equal(synced.mode, 'synced_consented');
    assert.equal(synced.ephemeralMode, false);
    assert.equal(synced.statusLabel, 'Synced');

    env.ls.setItem('nootropic_fm_profile_token', 'secret-bearer-token-123');
    env.ls.setItem('nootropic_fm_auth_v1', 'secret-auth');
    env.ls.setItem(DISCLOSURE_STORAGE_KEY, JSON.stringify({ completedSessions: 2 }));
    env.ls.setItem('unrelated_app_key', 'keep-me');
    env.ss.setItem('nootropic_fm_temp', 'wipe-me');
    env.ss.setItem('other_tab_state', 'keep-session');

    const exported = JSON.parse(exportLocalStudioDataJson());
    assert.equal(exported.app, 'nootropic.fm');
    assert.ok(exported.localKeys[DISCLOSURE_STORAGE_KEY], 'Non-secret studio keys must export');
    assert.equal(exported.localKeys.nootropic_fm_profile_token, undefined, 'Token keys must never export');
    assert.equal(exported.localKeys.nootropic_fm_auth_v1, undefined, 'Auth keys must never export');

    eraseAllLocalStudioData();
    assert.equal(env.ls.getItem(DISCLOSURE_STORAGE_KEY), null);
    assert.equal(env.ls.getItem('nootropic_fm_profile_token'), null);
    assert.equal(env.ls.getItem('unrelated_app_key'), 'keep-me');
    assert.equal(env.ss.getItem('nootropic_fm_temp'), null);
    assert.equal(env.ss.getItem('other_tab_state'), 'keep-session');
  } finally {
    env.restore();
  }
});

test('disclosureScheduler gates progressive cards across sessions 1..4 and Memory stages 0..8+', () => {
  const env = installMockBrowserStorage();
  try {
    const day1 = computeDisclosurePrompts({ profile: null, syncCode: null });
    assert.equal(day1.isDayOneZeroFriction, true);
    assert.equal(day1.showSessionOneSilentToast, true);
    assert.equal(day1.showPrePlayHugginsCard, false);
    assert.equal(day1.showSelfStudyOptInPrompt, false);
    assert.equal(day1.showPvtLabBadge, false);

    recordCompletedLocalSession();
    const s2 = computeDisclosurePrompts({ profile: null, syncCode: null });
    assert.equal(s2.state.completedSessions, 1);
    assert.equal(s2.isDayOneZeroFriction, false);
    assert.equal(s2.showPrePlayHugginsCard, true);
    assert.equal(s2.showSelfStudyOptInPrompt, false);

    markHugginsVerified(true);
    const s2Verified = computeDisclosurePrompts({ profile: null, syncCode: null });
    assert.equal(s2Verified.showPrePlayHugginsCard, false);

    recordCompletedLocalSession();
    const s3 = computeDisclosurePrompts({ profile: null, syncCode: 'NFM-TEST-2027' });
    assert.equal(s3.state.completedSessions, 2);
    assert.equal(s3.showSelfStudyOptInPrompt, true);
    assert.equal(s3.showPvtLabBadge, false);

    dismissDisclosurePrompt('self_study');
    assert.equal(readDisclosureState().dismissedSelfStudy, true);

    recordCompletedLocalSession();
    const s4 = computeDisclosurePrompts({ profile: null, syncCode: null });
    assert.equal(s4.state.completedSessions, 3);
    assert.equal(s4.showPvtLabBadge, true);

    assert.equal(resolveMemoryMaturityStage(0), 'cold_start');
    assert.equal(resolveMemoryMaturityStage(3), 'cold_start');
    assert.equal(resolveMemoryMaturityStage(4), 'calibrating');
    assert.equal(resolveMemoryMaturityStage(7), 'calibrating');
    assert.equal(resolveMemoryMaturityStage(8), 'validated_proof');
    assert.equal(resolveMemoryMaturityStage(12), 'validated_proof');
  } finally {
    env.restore();
  }
});

test('pinnedProtocols enforces cap 8, deduplication, and toggle behavior', () => {
  const env = installMockBrowserStorage();
  try {
    const mkEntry = (idx) => ({
      id: `study_${idx}`,
      title: `Study ${idx}`,
      citation: `Author (${2020 + idx})`,
      targetState: 'deep_flow',
      modulationHz: 15,
      durationMin: 25,
      requestedGenre: 'deep_electronic',
      recommendationTemplate: {
        sessionId: `ses_${idx}`,
        ephemeralMode: true,
        isControlTrial: false,
        isExploration: false,
        confidencePct: 80,
        cohortTrials: 0,
        cohortLabel: '18–95',
        currentState: 'calm_neutral',
        baselineScore: 3,
        targetState: 'deep_flow',
        environment: 'office',
        device: 'headphones',
        plannedDurationMin: 25,
        safetyMode: false,
        safetyWarnings: [],
        audioSource: 'studio_library',
        fallbackCoreGenre: 'deep_electronic',
        rationale: 'Test',
        personalizationSummary: [],
        formulaIngredients: [],
        arm: { id: 'a1', name: 'Test Arm', studyIds: [] },
        params: {
          genre: 'deep_electronic',
          energyTier: 'focus',
          bpm: 120,
          modulationHz: 15,
          modulationDepth: 0.3,
          crossoverHz: 190,
          upperCrossoverHz: 4500,
          stereoAmSpread: true,
          speakerSafeEQ: false,
          binauralOffsetHz: 0,
          noiseColor: 'pink',
          noiseLevel: 0.08,
          harmonicMode: 'warm_min9',
          rootNoteHz: 110,
          pulseIntensity: 0.5,
          filterCutoffHz: 2400,
        },
        studies: [],
        livePubMedPapers: [],
      },
      pinnedAt: new Date().toISOString(),
    });

    for (let i = 1; i <= 10; i++) {
      pinStudyProtocol(mkEntry(i));
    }
    const items = readPinnedProtocols();
    assert.equal(items.length, MAX_PINNED_PROTOCOLS);
    assert.equal(items[0].id, 'study_10', 'Most recent pin appears first');
    assert.equal(isProtocolPinned('study_1'), false, 'Oldest entries roll off beyond cap 8');

    const unpinned = togglePinStudyProtocol(mkEntry(10));
    assert.equal(unpinned.pinned, false);
    assert.equal(isProtocolPinned('study_10'), false);

    assert.ok(env.ls.getItem(PINNED_PROTOCOLS_STORAGE_KEY));
    assert.ok(env.events.includes('nootropic-pins-updated'));
  } finally {
    env.restore();
  }
});

test('DebriefView preserves per-session N-of-1 blinding and src enforces hygiene', () => {
  const debriefSrc = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'DebriefView.tsx'),
    'utf8'
  );
  assert.ok(!/Blinded Active Control/i.test(debriefSrc), 'DebriefView must never unblind Sham per session');
  assert.ok(!/Active Study Arm/i.test(debriefSrc), 'DebriefView must never unblind Active vs Sham per session');
  assert.ok(
    debriefSrc.includes('Blinded N-of-1 Self-Study'),
    'DebriefView must present blinded N-of-1 study status'
  );
});
