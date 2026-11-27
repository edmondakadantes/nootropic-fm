import type { AppRuntimeConfig, UserProfile } from '../../shared/types';

export type PrivacyMode = 'local_only' | 'synced_consented';

export interface PrivacyResolution {
  mode: PrivacyMode;
  ephemeralMode: boolean;
  gpcDetected: boolean;
  regionOptInRequired: boolean;
  statusLabel: 'Local-Only' | 'Synced';
}

export const NOOTROPIC_LOCAL_KEY_PREFIX = 'nootropic_fm_';

export function browserHasGpc(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  } catch {
    return false;
  }
}

export function resolvePrivacyState(input: {
  profile: UserProfile | null;
  runtimeConfig?: AppRuntimeConfig | null;
  gpcSignal?: boolean;
}): PrivacyResolution {
  const gpcDetected = typeof input.gpcSignal === 'boolean' ? input.gpcSignal : browserHasGpc();
  const regionOptInRequired = Boolean(input.runtimeConfig?.regionRequiresOptIn ?? true);
  const hasConsentedProfile = Boolean(input.profile?.id && input.profile.researchConsent === true);
  const mode: PrivacyMode = hasConsentedProfile ? 'synced_consented' : 'local_only';

  return {
    mode,
    ephemeralMode: !hasConsentedProfile,
    gpcDetected,
    regionOptInRequired,
    statusLabel: hasConsentedProfile ? 'Synced' : 'Local-Only',
  };
}

export function exportLocalStudioDataJson(): string {
  const exported: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    app: 'nootropic.fm',
    gpcDetected: browserHasGpc(),
    localKeys: {} as Record<string, unknown>,
  };

  if (typeof localStorage === 'undefined') {
    return JSON.stringify(exported, null, 2);
  }

  const keysMap: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(NOOTROPIC_LOCAL_KEY_PREFIX)) continue;
    // Never export raw auth bearer tokens into a downloaded JSON diagnostics file
    if (key.includes('token') || key.includes('auth')) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      keysMap[key] = JSON.parse(raw);
    } catch {
      keysMap[key] = raw;
    }
  }
  exported.localKeys = keysMap;
  return JSON.stringify(exported, null, 2);
}

export function eraseAllLocalStudioData(): void {
  const clearPrefixed = (store: Storage | undefined) => {
    if (!store) return;
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(NOOTROPIC_LOCAL_KEY_PREFIX)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((k) => store.removeItem(k));
  };

  try {
    clearPrefixed(typeof localStorage !== 'undefined' ? localStorage : undefined);
  } catch {
    // ignore storage errors
  }
  try {
    clearPrefixed(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  } catch {
    // ignore storage errors
  }
}
