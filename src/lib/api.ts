import type {
  CurrentState,
  DebriefPayload,
  LiveAdjustment,
  OutputDevice,
  ParsedCheckIn,
  ProtocolRecommendation,
  ResearchInsights,
  SessionEnvironment,
  SessionRecord,
  TargetState,
  UserProfile,
} from '../../shared/types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
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
  health: () => apiFetch<{ ok: boolean; mode: string; hasGemini: boolean }>('/api/health'),

  saveProfile: (profile: Partial<UserProfile>) =>
    apiFetch<{ profile: UserProfile }>('/api/profile', {
      method: 'POST',
      body: JSON.stringify(profile),
    }),

  getProfile: (id: string) =>
    apiFetch<{ profile: UserProfile; pendingDebrief: SessionRecord | null }>(
      `/api/profile/${encodeURIComponent(id)}`
    ),

  parseCheckIn: (text: string, profile?: Partial<UserProfile> | null) =>
    apiFetch<{ parsed: ParsedCheckIn }>('/api/parse', {
      method: 'POST',
      body: JSON.stringify({ text, profile }),
    }),

  startProtocol: (payload: {
    profileId: string;
    rawInputText: string;
    currentState: CurrentState;
    baselineScore: number;
    targetState: TargetState;
    environment: SessionEnvironment;
    device: OutputDevice;
    durationMin: number;
    ageOverride?: number;
  }) =>
    apiFetch<{ recommendation: ProtocolRecommendation }>('/api/protocol/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveProgress: (payload: {
    sessionId: string;
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
  }) =>
    apiFetch<{ ok: boolean; completionRatio: number }>('/api/session/progress', {
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
        cohortLabelRo: string;
        delta: number;
        reward: number;
        cohortSuccessRatePct: number;
        cohortTrials: number;
        profileSuccessRatePct: number;
        profileTrials: number;
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
};
