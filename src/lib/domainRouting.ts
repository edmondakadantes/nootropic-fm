import { isNativeMobileApp } from './platform';

export type SurfaceMode = 'showcase' | 'studio';

const SHOWCASE_HOSTS = new Set(['nootropic.fm', 'www.nootropic.fm']);

export function resolveSurfaceMode(input?: {
  hostname?: string;
  search?: string;
  isNative?: boolean;
}): SurfaceMode {
  const isNative = input?.isNative ?? isNativeMobileApp();
  const hostname = (
    input?.hostname ??
    (typeof window !== 'undefined' ? window.location.hostname : '')
  ).toLowerCase();
  const search =
    input?.search ??
    (typeof window !== 'undefined' ? window.location.search : '');

  try {
    const params = new URLSearchParams(search);
    const explicit = params.get('surface')?.toLowerCase();
    if (explicit === 'showcase') return 'showcase';
    if (explicit === 'studio' || params.get('studio') === '1') return 'studio';
  } catch {
    // ignore malformed query strings
  }

  if (isNative) return 'studio';
  if (SHOWCASE_HOSTS.has(hostname)) return 'showcase';
  return 'studio';
}

export function buildStudioUrl(
  opts?: {
    launch?: string;
    target?: string;
    durationMin?: number;
    screen?: 'studylab' | 'insights';
  },
  loc?: { hostname?: string; origin?: string }
): string {
  const hostname = (
    loc?.hostname ??
    (typeof window !== 'undefined' ? window.location.hostname : '')
  ).toLowerCase();
  const origin =
    loc?.origin ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://app.nootropic.fm');

  const isShowcaseProdHost = SHOWCASE_HOSTS.has(hostname);
  const base = isShowcaseProdHost ? 'https://app.nootropic.fm/' : `${origin.replace(/\/$/, '')}/`;
  const params = new URLSearchParams();
  if (!isShowcaseProdHost) {
    params.set('surface', 'studio');
  }
  if (opts?.launch) params.set('launch', opts.launch);
  if (opts?.target) params.set('target', opts.target);
  if (typeof opts?.durationMin === 'number' && Number.isFinite(opts.durationMin)) {
    params.set('duration', String(Math.round(opts.durationMin)));
  }
  if (opts?.screen) params.set('view', opts.screen);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildShowcaseUrl(loc?: { hostname?: string; origin?: string }): string {
  const hostname = (
    loc?.hostname ??
    (typeof window !== 'undefined' ? window.location.hostname : '')
  ).toLowerCase();
  const origin =
    loc?.origin ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://www.nootropic.fm');

  if (hostname === 'app.nootropic.fm') {
    return 'https://www.nootropic.fm/';
  }
  return `${origin.replace(/\/$/, '')}/?surface=showcase`;
}

export function resolveLegacyShowcaseRedirect(loc: {
  hostname?: string;
  search?: string;
  hash?: string;
}): string | null {
  const hostname = (loc.hostname ?? '').toLowerCase();
  if (!SHOWCASE_HOSTS.has(hostname)) return null;

  const search = loc.search ?? '';
  const hash = loc.hash ?? '';

  if (/^#sync=[A-Za-z0-9-]+$/i.test(hash)) {
    return `https://app.nootropic.fm/${search}${hash}`;
  }

  try {
    const params = new URLSearchParams(search);
    const billing = params.get('billing');
    if (billing === 'success' || params.get('session_id')?.startsWith('cs_')) {
      return `https://app.nootropic.fm/${search}${hash}`;
    }
    if (params.get('launch') || params.get('target') || params.get('view')) {
      return `https://app.nootropic.fm/${search}${hash}`;
    }
  } catch {
    // ignore malformed query string
  }

  return null;
}
