import type { FieldMood } from './AmbientField';

interface SonicOrbProps {
  mood?: FieldMood;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const ORB_GRADIENTS: Record<FieldMood, { core: string; ring: string; glow: string }> = {
  default: {
    core: 'from-cyan-300 via-sky-400 to-indigo-500',
    ring: 'border-cyan-300/35',
    glow: 'shadow-[0_0_80px_rgba(34,211,238,0.45)]',
  },
  focus: {
    core: 'from-cyan-300 via-blue-400 to-indigo-500',
    ring: 'border-cyan-400/40',
    glow: 'shadow-[0_0_90px_rgba(56,189,248,0.5)]',
  },
  driving: {
    core: 'from-amber-300 via-orange-400 to-cyan-400',
    ring: 'border-amber-300/40',
    glow: 'shadow-[0_0_90px_rgba(245,158,11,0.45)]',
  },
  calm: {
    core: 'from-emerald-300 via-teal-400 to-cyan-500',
    ring: 'border-emerald-300/40',
    glow: 'shadow-[0_0_90px_rgba(52,211,153,0.45)]',
  },
  flow: {
    core: 'from-indigo-300 via-violet-400 to-cyan-400',
    ring: 'border-indigo-300/40',
    glow: 'shadow-[0_0_90px_rgba(129,140,248,0.48)]',
  },
  sleep: {
    core: 'from-indigo-400 via-purple-500 to-slate-700',
    ring: 'border-purple-400/30',
    glow: 'shadow-[0_0_80px_rgba(139,92,246,0.35)]',
  },
};

export function SonicOrb({ mood = 'default', size = 'md', label }: SonicOrbProps) {
  const g = ORB_GRADIENTS[mood];
  const dim =
    size === 'sm' ? 'h-16 w-16' : size === 'lg' ? 'h-32 w-32 sm:h-36 sm:w-36' : 'h-24 w-24 sm:h-28 sm:w-28';
  const coreDim =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-16 w-16 sm:h-20 sm:w-20' : 'h-12 w-12 sm:h-14 sm:w-14';

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      <div className={`relative flex items-center justify-center ${dim}`}>
        {/* Expanding resonance ripples */}
        <span className={`animate-ripple absolute inset-0 rounded-full border ${g.ring}`} />
        <span className={`animate-ripple-delayed absolute inset-0 rounded-full border ${g.ring}`} />

        {/* Rotating orbital rings */}
        <svg
          className="animate-orbit absolute inset-0 h-full w-full opacity-70"
          viewBox="0 0 120 120"
          fill="none"
        >
          <circle
            cx="60"
            cy="60"
            r="52"
            stroke="url(#orbGrad1)"
            strokeWidth="1.2"
            strokeDasharray="10 8 40 12"
          />
          <circle cx="60" cy="8" r="2.6" fill="#67e8f9" />
          <defs>
            <linearGradient id="orbGrad1" x1="0" y1="0" x2="120" y2="120">
              <stop stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="1" stopColor="#818cf8" stopOpacity="0.15" />
            </linearGradient>
          </defs>
        </svg>

        <svg
          className="animate-orbit-rev absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)] opacity-55"
          viewBox="0 0 100 100"
          fill="none"
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            stroke="url(#orbGrad2)"
            strokeWidth="1"
            strokeDasharray="4 9 22 9"
          />
          <defs>
            <linearGradient id="orbGrad2" x1="100" y1="0" x2="0" y2="100">
              <stop stopColor="#a5b4fc" stopOpacity="0.85" />
              <stop offset="1" stopColor="#22d3ee" stopOpacity="0.1" />
            </linearGradient>
          </defs>
        </svg>

        {/* Breathing glowing core */}
        <div
          className={`animate-orb relative rounded-full bg-gradient-to-br ${g.core} ${g.glow} ${coreDim} flex items-center justify-center`}
        >
          <div className="h-[58%] w-[58%] rounded-full bg-white/30 blur-[3px]" />
        </div>
      </div>

      {label && (
        <span className="font-mono-tech mt-3 text-[11px] uppercase tracking-[0.22em] text-cyan-200/75">
          {label}
        </span>
      )}
    </div>
  );
}
