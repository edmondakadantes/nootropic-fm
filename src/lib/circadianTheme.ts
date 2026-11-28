export type CircadianPreference = 'auto' | 'daylight' | 'night';
export type ResolvedThemeMode = 'daylight' | 'night';

const CIRCADIAN_STORAGE_KEY = 'nootropic_fm_circadian_v1';

export function resolveCircadianTheme(
  pref: CircadianPreference,
  now = new Date()
): ResolvedThemeMode {
  if (pref === 'daylight' || pref === 'night') return pref;
  const hour = now.getHours();
  return hour >= 7 && hour < 19 ? 'daylight' : 'night';
}

export function readCircadianPreference(): CircadianPreference {
  try {
    const raw = localStorage.getItem(CIRCADIAN_STORAGE_KEY);
    if (raw === 'daylight' || raw === 'night' || raw === 'auto') return raw;
    return 'auto';
  } catch {
    return 'auto';
  }
}

export function writeCircadianPreference(pref: CircadianPreference): void {
  try {
    localStorage.setItem(CIRCADIAN_STORAGE_KEY, pref);
  } catch {
    // ignore storage restrictions
  }
}

export function applyDocumentTheme(mode: ResolvedThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle('dark', mode === 'night');
  root.classList.toggle('light', mode === 'daylight');
  root.style.colorScheme = mode === 'daylight' ? 'light' : 'dark';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', mode === 'daylight' ? '#F1F5F9' : '#0A0B0C');
  }
}

export function initCircadianThemeSync(): ResolvedThemeMode {
  const mode = resolveCircadianTheme(readCircadianPreference());
  applyDocumentTheme(mode);
  return mode;
}
