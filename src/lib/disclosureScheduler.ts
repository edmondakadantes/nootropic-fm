import type { UserProfile } from '../../shared/types';

export const DISCLOSURE_STORAGE_KEY = 'nootropic_fm_local_disclosure_v1';

export interface LocalDisclosureState {
  completedSessions: number;
  dismissedHuggins: boolean;
  dismissedQrPass: boolean;
  dismissedSelfStudy: boolean;
  silentHintShown: boolean;
  hugginsVerified: boolean;
}

export type MemoryMaturityStage = 'cold_start' | 'calibrating' | 'validated_proof';

export interface DisclosurePrompts {
  state: LocalDisclosureState;
  isDayOneZeroFriction: boolean;
  showSessionOneSilentToast: boolean;
  showPrePlayHugginsCard: boolean;
  showPostDebriefQrPrompt: boolean;
  showSelfStudyOptInPrompt: boolean;
  showPvtLabBadge: boolean;
}

const DEFAULT_STATE: LocalDisclosureState = {
  completedSessions: 0,
  dismissedHuggins: false,
  dismissedQrPass: false,
  dismissedSelfStudy: false,
  silentHintShown: false,
  hugginsVerified: false,
};

function emitDisclosureUpdate(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nootropic-disclosure-updated'));
  }
}

export function readDisclosureState(): LocalDisclosureState {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_STATE };
    const raw = localStorage.getItem(DISCLOSURE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<LocalDisclosureState>;
    return {
      completedSessions: Math.max(0, Math.floor(Number(parsed.completedSessions) || 0)),
      dismissedHuggins: Boolean(parsed.dismissedHuggins),
      dismissedQrPass: Boolean(parsed.dismissedQrPass),
      dismissedSelfStudy: Boolean(parsed.dismissedSelfStudy),
      silentHintShown: Boolean(parsed.silentHintShown),
      hugginsVerified: Boolean(parsed.hugginsVerified),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeDisclosureState(next: LocalDisclosureState): LocalDisclosureState {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISCLOSURE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore storage errors
  }
  emitDisclosureUpdate();
  return next;
}

export function recordCompletedLocalSession(): LocalDisclosureState {
  const prev = readDisclosureState();
  return writeDisclosureState({
    ...prev,
    completedSessions: prev.completedSessions + 1,
  });
}

export function markSilentHintShown(): LocalDisclosureState {
  const prev = readDisclosureState();
  if (prev.silentHintShown) return prev;
  return writeDisclosureState({
    ...prev,
    silentHintShown: true,
  });
}

export function markHugginsVerified(passed = true): LocalDisclosureState {
  const prev = readDisclosureState();
  return writeDisclosureState({
    ...prev,
    hugginsVerified: passed,
    dismissedHuggins: passed ? true : prev.dismissedHuggins,
  });
}

export function dismissDisclosurePrompt(
  kind: 'huggins' | 'qr_pass' | 'self_study'
): LocalDisclosureState {
  const prev = readDisclosureState();
  if (kind === 'huggins') {
    return writeDisclosureState({ ...prev, dismissedHuggins: true });
  }
  if (kind === 'qr_pass') {
    return writeDisclosureState({ ...prev, dismissedQrPass: true });
  }
  return writeDisclosureState({ ...prev, dismissedSelfStudy: true });
}

export function computeDisclosurePrompts(input: {
  profile: UserProfile | null;
  syncCode?: string | null;
  hugginsVerified?: boolean;
}): DisclosurePrompts {
  const state = readDisclosureState();
  const hugginsDone = Boolean(input.hugginsVerified || state.hugginsVerified);
  const completed = Math.max(state.completedSessions, input.profile?.sessionCount ?? 0);

  return {
    state,
    isDayOneZeroFriction: !input.profile && completed === 0,
    showSessionOneSilentToast: completed === 0 && !state.silentHintShown,
    showPrePlayHugginsCard: completed >= 1 && !hugginsDone && !state.dismissedHuggins,
    showPostDebriefQrPrompt:
      completed >= 2 && Boolean(input.profile && input.syncCode) && !state.dismissedQrPass,
    showSelfStudyOptInPrompt:
      completed >= 2 &&
      (!input.profile || !input.profile.researchConsent) &&
      !state.dismissedSelfStudy,
    showPvtLabBadge: completed >= 3,
  };
}

export function resolveMemoryMaturityStage(learnedSessions: number): MemoryMaturityStage {
  if (learnedSessions >= 8) return 'validated_proof';
  if (learnedSessions >= 4) return 'calibrating';
  return 'cold_start';
}
