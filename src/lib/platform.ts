/**
 * Native Mobile (Capacitor / Google Play) runtime detection, API routing,
 * and Android Foreground MediaPlayback Service bridge.
 */

export interface NootropicNativeBridgeApi {
  getStoreChannel?: () => string;
  onAudioStateChanged?: (state: 'playing' | 'paused' | 'stopped', title: string, subtitle: string) => void;
  openPlayStoreSubscriptions?: () => void;
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    NootropicNativeBridge?: NootropicNativeBridgeApi;
    __nootropicNativeMediaAction?: (action: 'play' | 'pause' | 'stop') => void;
  }
}

export function isNativeMobileApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env?.VITE_CAPACITOR_NATIVE === 'true') return true;
  if (window.NootropicNativeBridge) return true;
  if (typeof window.Capacitor?.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
    return true;
  }
  return false;
}

export function isNativePlayStoreApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env?.VITE_PLAY_STORE_BUILD === 'true') return true;
  if (window.NootropicNativeBridge?.getStoreChannel?.() === 'google_play') return true;
  if (window.Capacitor?.getPlatform?.() === 'android' && isNativeMobileApp()) return true;
  return false;
}

export function resolveDefaultApiBase(): string {
  const explicit = (import.meta.env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
  if (explicit) return explicit;
  if (isNativeMobileApp()) return 'https://www.nootropic.fm';
  return '';
}

const WS_CLIENT_ID_KEY = 'nootropic_fm_ws_cid_v1';
let memoryWsClientId = '';

export function getOrCreateWsClientId(): string {
  if (memoryWsClientId) return memoryWsClientId;
  try {
    const existing = sessionStorage.getItem(WS_CLIENT_ID_KEY);
    if (existing && /^[a-f0-9]{24,64}$/i.test(existing)) {
      memoryWsClientId = existing;
      return existing;
    }
  } catch {
    // ignore storage errors
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const generated = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  memoryWsClientId = generated;
  try {
    sessionStorage.setItem(WS_CLIENT_ID_KEY, generated);
  } catch {
    // ignore
  }
  return generated;
}

export function notifyNativeAudioState(
  state: 'playing' | 'paused' | 'stopped',
  title = 'nootropic.fm',
  subtitle = 'Study-Backed Psychoacoustic Audio'
): void {
  if (typeof window === 'undefined') return;
  try {
    window.NootropicNativeBridge?.onAudioStateChanged?.(state, title, subtitle);
  } catch {
    // ignore bridge errors
  }
}

export function bindNativeMediaActionHandler(
  handler: ((action: 'play' | 'pause' | 'stop') => void) | null
): void {
  if (typeof window === 'undefined') return;
  window.__nootropicNativeMediaAction = handler ?? undefined;
}
