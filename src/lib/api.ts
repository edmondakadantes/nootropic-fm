import type { ExecutableStudySpec } from '../../shared/studySpec';
import type {
  AcousticParams,
  AppRuntimeConfig,
  AudioSourceType,
  CurrentState,
  CustomTrackInfo,
  DebriefPayload,
  EnergyTier,
  LiveAdjustment,
  MusicGenreChoice,
  OutputDevice,
  ParsedCheckIn,
  ProtocolRecommendation,
  ResearchInsights,
  ResolvedGenre,
  SessionEnvironment,
  SessionRecord,
  TargetState,
  UserProfile,
} from '../../shared/types';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

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
    event: 'visibility' | 'pagehide' | 'milestone';
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
      };
    }>('/api/session/debrief', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  dismissPending: (sessionId: string) =>
    apiFetch<{ ok: boolean }>('/api/session/dismiss', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  getInsights: (profileId?: string) =>
    apiFetch<{ insights: ResearchInsights }>(
      `/api/insights${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`
    ),

  getAudioCatalog: () =>
    apiFetch<{
      tracksByGenre: Record<
        ResolvedGenre,
        Array<{ key: string; name: string; url: string; size: number; energy: EnergyTier }>
      >;
      customTracks?: CustomTrackInfo[];
    }>('/api/audio/catalog'),

  getStudyPresets: () =>
    apiFetch<{ presets: ExecutableStudySpec[] }>('/api/studies/presets'),

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
      body: JSON.stringify({}),
    }),
};
