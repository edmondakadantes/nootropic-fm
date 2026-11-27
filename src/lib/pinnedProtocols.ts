import type { MusicGenreChoice, ProtocolRecommendation, TargetState } from '../../shared/types';

export const PINNED_PROTOCOLS_STORAGE_KEY = 'nootropic_fm_pinned_protocols_v1';
export const MAX_PINNED_PROTOCOLS = 8;

export interface PinnedStudyProtocol {
  id: string;
  title: string;
  citation: string;
  doi?: string;
  targetState: TargetState;
  modulationHz: number;
  durationMin: number;
  requestedGenre: MusicGenreChoice;
  recommendationTemplate: ProtocolRecommendation;
  pinnedAt: string;
}

function emitPinsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nootropic-pins-updated'));
  }
}

export function readPinnedProtocols(): PinnedStudyProtocol[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PINNED_PROTOCOLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PinnedStudyProtocol =>
        Boolean(item && typeof item.id === 'string' && typeof item.title === 'string' && item.recommendationTemplate)
    );
  } catch {
    return [];
  }
}

function writePinnedProtocols(items: PinnedStudyProtocol[]): PinnedStudyProtocol[] {
  const trimmed = items.slice(0, MAX_PINNED_PROTOCOLS);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PINNED_PROTOCOLS_STORAGE_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // ignore storage errors
  }
  emitPinsUpdated();
  return trimmed;
}

export function isProtocolPinned(id: string): boolean {
  return readPinnedProtocols().some((item) => item.id === id);
}

export function pinStudyProtocol(entry: PinnedStudyProtocol): PinnedStudyProtocol[] {
  const existing = readPinnedProtocols().filter((item) => item.id !== entry.id);
  return writePinnedProtocols([entry, ...existing]);
}

export function unpinStudyProtocol(id: string): PinnedStudyProtocol[] {
  const existing = readPinnedProtocols().filter((item) => item.id !== id);
  return writePinnedProtocols(existing);
}

export function togglePinStudyProtocol(entry: PinnedStudyProtocol): {
  pinned: boolean;
  items: PinnedStudyProtocol[];
} {
  if (isProtocolPinned(entry.id)) {
    return { pinned: false, items: unpinStudyProtocol(entry.id) };
  }
  return { pinned: true, items: pinStudyProtocol(entry) };
}
