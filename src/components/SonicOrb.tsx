import type { FieldMood } from './AmbientField';

interface SonicOrbProps {
  mood?: FieldMood;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

/**
 * Compact Studio Signal Calibration Badge (replaces glowing chatbot orb).
 * Renders a crisp 36x16 dark CRT micro-window + engraved monospace hardware readout.
 */
export function SonicOrb({ mood = 'default', label }: SonicOrbProps) {
  const waveColor = mood === 'driving' ? '#F59E0B' : '#34D399';
  const displayLabel = (label && label.trim()) || '48.0 KHZ · STUDIO DSP';

  return (
    <div className="inline-flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0F1013] px-3 py-1.5 select-none">
      <div className="flex h-4 w-9 shrink-0 items-center justify-center rounded border border-white/10 bg-[#060807] px-1">
        <svg viewBox="0 0 32 12" className="h-3 w-full" fill="none" aria-hidden="true">
          <line x1="0" y1="6" x2="32" y2="6" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
          <path
            d="M 1 6 Q 5 1 8.5 6 T 16 6 T 23.5 6 T 31 6"
            stroke={waveColor}
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className="font-mono-tech text-[10px] uppercase tracking-[0.16em] text-[#A3A39E]">
        {displayLabel}
      </span>
    </div>
  );
}
