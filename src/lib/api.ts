import type { ExecutableStudySpec } from '../../shared/studySpec';
import type { ConciergeVoiceOption } from '../../shared/voiceConcierge';
import type {
  AcousticParams,
  AppRuntimeConfig,
  AudioSourceType,
  CohortIntelligenceCard,
  CurrentState,
  CustomTrackInfo,
  DatasetInquiryPayload,
  DebriefPayload,
  EnergyTier,
  GlobalRetentionFunnel,
  LiveAdjustment,
  MusicGenreChoice,
  OutputDevice,
  ParsedCheckIn,
  ProtocolRecommendation,
  ResearchInsights,
  ResolvedGenre,
  SessionEnvironment,
  SessionRecord,
  StudyLeaderboardEntry,
  TargetState,
  UserProfile,
} from '../../shared/types';

import {
  getOrCreateWsClientId,
  isNativeMobileApp,
  resolveDefaultApiBase,
} from './platform';

export const API_BASE = resolveDefaultApiBase();

export const PROFILE_STORAGE_KEY = 'nootropic_fm_profile_id_v1';
export const PROFILE_TOKEN_KEY = 'nootropic_fm_profile_token_v2';
export const PROFILE_SYNC_CODE_KEY = 'nootropic_fm_sync_code_v2';
export const PROFILE_EXPIRES_KEY = 'nootropic_fm_profile_expires_v2';
const PROFILE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90-day client storage TTL

export function saveStoredProfileAuth(profileId: string, token?: string, syncCode?: string): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
    if (token) {
      localStorage.setItem(PROFILE_TOKEN_KEY, token);
    }
    if (syncCode) {
      localStorage.setItem(PROFILE_SYNC_CODE_KEY, syncCode);
    }
    localStorage.setItem(PROFILE_EXPIRES_KEY, String(Date.now() + PROFILE_TTL_MS));
  } catch {
    // ignore storage quota / private mode
  }
}

export function getStoredProfileAuth(): {
  profileId: string;
  token: string | null;
  syncCode: string | null;
} | null {
  try {
    const profileId = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!profileId) return null;
    const exp = Number(localStorage.getItem(PROFILE_EXPIRES_KEY) ?? '0');
    if (exp > 0 && Date.now() > exp) {
      clearStoredProfileAuth();
      return null;
    }
    const token = localStorage.getItem(PROFILE_TOKEN_KEY);
    const syncCode = localStorage.getItem(PROFILE_SYNC_CODE_KEY);
    return { profileId, token, syncCode };
  } catch {
    return null;
  }
}

export function clearStoredProfileAuth(): void {
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(PROFILE_TOKEN_KEY);
    localStorage.removeItem(PROFILE_SYNC_CODE_KEY);
    localStorage.removeItem(PROFILE_EXPIRES_KEY);
  } catch {
    // ignore
  }
}

function getProfileTokenHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem(PROFILE_TOKEN_KEY);
    return token ? { 'x-profile-token': token } : {};
  } catch {
    return {};
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: isNativeMobileApp() ? 'include' : 'same-origin',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...getProfileTokenHeader(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    apiFetch<{ ok: boolean; version: string; mode: string; hasLiveMusicGen: boolean }>('/api/health'),

  getConfig: () => apiFetch<{ config: AppRuntimeConfig }>('/api/config'),

  saveProfile: (profile: Partial<UserProfile>) =>
    apiFetch<{ profile: UserProfile; profileToken?: string; syncCode?: string }>('/api/profile', {
      method: 'POST',
      body: JSON.stringify(profile),
    }),

  getProfile: (id: string) =>
    apiFetch<{
      profile: UserProfile;
      pendingDebrief: SessionRecord | null;
      profileToken?: string;
      syncCode?: string;
    }>(`/api/profile/${encodeURIComponent(id)}`),

  restoreIdentity: (syncCode: string) =>
    apiFetch<{
      profile: UserProfile;
      profileToken: string;
      syncCode: string;
      pendingDebrief: SessionRecord | null;
    }>('/api/identity/restore', {
      method: 'POST',
      body: JSON.stringify({ syncCode }),
    }),

  getCurrentSession: () =>
    apiFetch<{
      authenticated: boolean;
      profile: UserProfile | null;
      pendingDebrief: SessionRecord | null;
    }>('/api/identity/me'),

  signOutSession: () =>
    apiFetch<{ ok: boolean }>('/api/identity/signout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteProfile: (id: string) =>
    apiFetch<{ ok: boolean; deletedProfileId: string }>(`/api/profile/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  parseCheckIn: (text: string, profile?: Partial<UserProfile> | null) =>
    apiFetch<{ parsed: ParsedCheckIn }>('/api/parse', {
      method: 'POST',
      body: JSON.stringify({ text, profile }),
    }),

  startProtocol: (payload: {
    profileId?: string;
    ephemeralMode?: boolean;
    ephemeralProfile?: Partial<UserProfile>;
    rawInputText: string;
    currentState: CurrentState;
    microStateId?: string;
    microStateLabel?: string;
    arousalPct?: number;
    clarityPct?: number;
    baselineScore: number;
    targetState: TargetState;
    customGoalText?: string;
    customGoalSlug?: string;
    customGoalLabel?: string;
    environment: SessionEnvironment;
    device: OutputDevice;
    durationMin: number;
    ageOverride?: number;
    requestedGenre?: MusicGenreChoice;
    customGenreInput?: string;
  }) =>
    apiFetch<{ recommendation: ProtocolRecommendation }>('/api/protocol/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateCustomMusic: (payload: {
    customGenre: string;
    energyTier: EnergyTier;
    targetState: TargetState;
    bpm?: number;
    harmonicMode?: AcousticParams['harmonicMode'];
    speakerSafeEQ?: boolean;
    noiseSensitivity?: 'low' | 'medium' | 'high';
    sessionId?: string;
  }) =>
    apiFetch<{
      status: 'ready' | 'generating' | 'unavailable' | 'cap_reached' | 'rate_limited' | 'failed';
      fromCache?: boolean;
      message?: string;
      pollAfterMs?: number;
      track?: {
        id: string;
        genreSlug: string;
        displayLabel: string;
        energyTier: EnergyTier;
        url: string;
        provider: string;
        bpm: number;
      };
    }>('/api/music/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMusicStatus: (slug: string, energy: EnergyTier) =>
    apiFetch<{
      status: string;
      error?: string | null;
      track?: CustomTrackInfo;
    }>(`/api/music/status?slug=${encodeURIComponent(slug)}&energy=${encodeURIComponent(energy)}`),

  saveProgress: (payload: {
    sessionId: string;
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
  }) =>
    apiFetch<{ ok: boolean; completionRatio: number }>('/api/session/progress', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /**
   * Cross-browser navigator.sendBeacon (text/plain Blob avoids CORS OPTIONS preflight drops on iOS Safari).
   */
  sendSessionBeacon: (payload: {
    sessionId: string;
    event: 'visibility' | 'pagehide' | 'milestone' | 'milestone_25' | 'milestone_50' | 'milestone_75' | 'milestone_90';
    actualDurationSec: number;
    audioStarted: boolean;
    liveAdjustments: LiveAdjustment[];
  }): void => {
    if (!payload.sessionId || payload.sessionId.startsWith('eph_')) return;
    const url = `${API_BASE}/api/session/beacon`;
    const body = JSON.stringify(payload);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(url, blob);
        return;
      }
    } catch {
      // fall through to keepalive fetch
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: true,
    }).catch(() => {});
  },

  updateSessionGenre: (payload: {
    sessionId: string;
    genre: string;
    customGenreSlug?: string | null;
    audioSource?: AudioSourceType;
    atSec?: number;
    params?: AcousticParams;
  }) =>
    apiFetch<{ ok: boolean; genre: string; instantSwapRecorded?: boolean }>('/api/session/genre', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitDebrief: (payload: DebriefPayload) =>
    apiFetch<{
      ok: boolean;
      learningUpdate: {
        sessionId: string;
        armId: string;
        armName: string;
        cohortKey: string;
        cohortLabel: string;
        delta: number;
        reward: number;
        cohortSuccessRatePct: number;
        cohortTrials: number;
        profileSuccessRatePct: number;
        profileTrials: number;
        wasControlTrial: boolean;
        preferredModMult: number;
        learnedGenre?: ResolvedGenre;
        learnedGenreLabel?: string;
        learnedGenreFitPct?: number;
      };
    }>('/api/session/debrief', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  dismissPending: (sessionId: string, actualDurationSec?: number) =>
    apiFetch<{ ok: boolean; retentionOutcome?: string | null }>('/api/session/dismiss', {
      method: 'POST',
      body: JSON.stringify({ sessionId, actualDurationSec }),
    }),

  getInsights: (profileId?: string) =>
    apiFetch<{ insights: ResearchInsights }>(
      `/api/insights${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`
    ),

  getAudioCatalog: () =>
    apiFetch<{
      tracksByGenre: Record<
        ResolvedGenre,
        Array<{
          key: string;
          name: string;
          url: string;
          size: number;
          energy: EnergyTier;
          bpm?: number;
          lufs?: number;
          rootMidi?: number;
          keyLabel?: string;
          opusUrl?: string;
          aacUrl?: string;
          subHarmonicBpm?: number;
          alignedBandsHz?: number[];
          downbeatOffsetMs?: number;
          sampleRate?: number;
          v7Remastered?: boolean;
          durationSec?: number;
        }>
      >;
      customTracks?: CustomTrackInfo[];
    }>('/api/audio/catalog'),

  getStudyPresets: () =>
    apiFetch<{ presets: ExecutableStudySpec[] }>('/api/studies/presets'),

  getStudyLeaderboard: () =>
    apiFetch<{ leaderboard: StudyLeaderboardEntry[] }>('/api/studies/leaderboard'),

  saveSessionPvt: (payload: {
    sessionId: string;
    phase: 'pre' | 'post';
    medianMs: number;
    lapses: number;
    meanInvRt?: number;
    trialCount?: number;
    refreshHz?: number;
    decileSpreadMs?: number;
  }) =>
    apiFetch<{ ok: boolean; medianMs: number; lapses: number; meanInvRt?: number | null }>('/api/session/pvt', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveSessionBiomarkers: (payload: {
    sessionId: string;
    tappingCvPct?: number;
    tappingMeanItiMs?: number;
    hrvRmssdMs?: number;
    hrvLfRatio?: number;
  }) =>
    apiFetch<{ ok: boolean }>('/api/session/biomarkers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  searchMedicalStudies: (query: string) =>
    apiFetch<{
      results: Array<{
        id: string;
        source: 'core' | 'pubmed' | 'europepmc' | 'clinicaltrials';
        title: string;
        authors: string;
        journal: string;
        year: string;
        url: string;
        doi?: string;
        pmid?: string;
        pmcid?: string;
        nctId?: string;
        abstractText: string;
        hasFullAbstract: boolean;
      }>;
    }>('/api/studies/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),

  compileMedicalStudy: (payload: {
    queryOrText: string;
    presetId?: string;
    pmid?: string;
    doi?: string;
    nctId?: string;
    abstractOverride?: string;
    titleOverride?: string;
    device?: OutputDevice;
    environment?: SessionEnvironment;
    preferredGenre?: ResolvedGenre;
    profileId?: string;
    ephemeralMode?: boolean;
  }) =>
    apiFetch<{
      spec: ExecutableStudySpec;
      recommendation: ProtocolRecommendation;
      fromCache: boolean;
    }>('/api/studies/compile', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getLyriaRealtimeToken: () =>
    apiFetch<{
      available: boolean;
      token?: string;
      expiresAt?: string;
      model?: string;
      reason?: string;
    }>('/api/music/realtime-token', {
      method: 'POST',
      headers: { 'x-ws-client-id': getOrCreateWsClientId() },
      body: JSON.stringify({}),
    }),

  getCohortIntelligence: () =>
    apiFetch<{
      cohorts: CohortIntelligenceCard[];
      globalRetention: GlobalRetentionFunnel;
      totalLiveCohorts: number;
    }>('/api/intelligence/cohorts'),

  submitDatasetInquiry: (payload: DatasetInquiryPayload) =>
    apiFetch<{ ok: boolean; inquiryId: string }>('/api/intelligence/inquire', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  claimQuickTryProfile: (payload: {
    occupationLabel: string;
    age: number;
    gender?: UserProfile['gender'];
    currentState: CurrentState;
    targetState: TargetState;
    environment: SessionEnvironment;
    device: OutputDevice;
    plannedDurationMin: number;
    actualDurationSec: number;
    armId: string;
    armName: string;
    studySpecId?: string;
    musicGenre: string;
    energyTier: EnergyTier;
    acousticParams: AcousticParams;
    citedStudyIds: string[];
  }) =>
    apiFetch<{
      profile: UserProfile;
      profileToken: string;
      syncCode: string;
      sessionId: string;
    }>('/api/session/claim-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createStripeCheckout: (payload: {
    plan: 'monthly' | 'annual';
    profileId?: string;
    email?: string;
  }) =>
    apiFetch<{
      url: string;
      checkoutSessionId: string;
      profile?: UserProfile;
      profileToken?: string;
      syncCode?: string;
    }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyStripeCheckout: (checkoutSessionId: string) =>
    apiFetch<{
      ok: boolean;
      paid: boolean;
      planTier: 'free' | 'pro';
      proUntil: string | null;
      profile?: UserProfile | null;
    }>('/api/billing/verify', {
      method: 'POST',
      body: JSON.stringify({ checkoutSessionId }),
    }),

  openStripePortal: (profileId: string) =>
    apiFetch<{ url: string }>('/api/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  getVoiceConciergeVoices: () =>
    apiFetch<{
      available: boolean;
      provider: string;
      defaultVoiceId: string;
      voices: ConciergeVoiceOption[];
    }>('/api/voice/voices'),

  getVoiceConciergeCue: (payload: {
    cueType: 'intro_full' | 'intro_short' | 'outro_landing';
    firstName?: string | null;
    voiceId?: string | null;
    currentState: CurrentState;
    targetState: TargetState;
    armId: string;
    modulationHz: number;
    genre: ResolvedGenre;
    isDriving: boolean;
    device?: OutputDevice;
    timeBucket?: string;
    durationMin?: number;
  }) =>
    apiFetch<{
      available: boolean;
      cueType: 'intro_full' | 'intro_short' | 'outro_landing';
      greetingUrl?: string;
      bodyUrl?: string;
      breathPauseMs: number;
      transcript: string;
      fromCache?: boolean;
      provider?: string;
      voiceId?: string;
    }>('/api/voice/concierge', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  joinHardwareWaitlist: (payload: {
    email: string;
    productCode: 'earbuds_01_usb_c' | 'earbuds_pro_hrv' | 'sound_system_01';
    profileId?: string;
  }) =>
    apiFetch<{
      ok: boolean;
      queueNumber: number;
      productCode: string;
    }>('/api/hardware/waitlist', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
