import { useEffect, useRef } from 'react';

export type FieldMood = 'default' | 'focus' | 'driving' | 'calm' | 'flow' | 'sleep';

interface AmbientFieldProps {
  mood?: FieldMood;
  activePulse?: boolean;
}

const MOOD_PALETTES: Record<FieldMood, { c1: string; c2: string; c3: string; glow: string }> = {
  default: { c1: '34, 211, 238', c2: '129, 140, 248', c3: '56, 189, 248', glow: 'rgba(34, 211, 238, 0.14)' },
  focus: { c1: '34, 211, 238', c2: '59, 130, 246', c3: '165, 180, 252', glow: 'rgba(56, 189, 248, 0.16)' },
  driving: { c1: '245, 158, 11', c2: '34, 211, 238', c3: '251, 191, 36', glow: 'rgba(245, 158, 11, 0.13)' },
  calm: { c1: '52, 211, 153', c2: '34, 211, 238', c3: '45, 212, 191', glow: 'rgba(52, 211, 153, 0.13)' },
  flow: { c1: '129, 140, 248', c2: '192, 132, 252', c3: '56, 189, 248', glow: 'rgba(129, 140, 248, 0.16)' },
  sleep: { c1: '99, 102, 241', c2: '168, 85, 247', c3: '59, 130, 246', glow: 'rgba(99, 102, 241, 0.12)' },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  phase: number;
}

/**
 * Full-bleed 60fps interactive bioluminescent soundwave & neural particle backdrop.
 * Gives instant visual impact in the first 2 seconds while staying feather-light on CPU.
 */
export function AmbientField({ mood = 'default', activePulse = false }: AmbientFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moodRef = useRef<FieldMood>(mood);
  const pulseRef = useRef<boolean>(activePulse);
  moodRef.current = mood;
  pulseRef.current = activePulse;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let rafId = 0;
    let t = 0;

    const pointer = { x: width * 0.5, y: height * 0.35, tx: width * 0.5, ty: height * 0.35 };

    const particles: Particle[] = Array.from({ length: 42 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.24 - 0.05,
      r: 1.1 + Math.random() * 2.1,
      alpha: 0.18 + Math.random() * 0.45,
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });

    const render = () => {
      t += prefersReduced ? 0.002 : pulseRef.current ? 0.022 : 0.012;
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;

      const pal = MOOD_PALETTES[moodRef.current];
      ctx.clearRect(0, 0, width, height);

      // Soft cursor-following luminous aurora bloom
      const aura = ctx.createRadialGradient(
        pointer.x,
        pointer.y,
        10,
        pointer.x,
        pointer.y,
        Math.max(width, height) * 0.48
      );
      aura.addColorStop(0, pal.glow);
      aura.addColorStop(0.5, `rgba(${pal.c2}, 0.05)`);
      aura.addColorStop(1, 'rgba(5, 7, 13, 0)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, width, height);

      // Secondary deep ambient bloom top-right
      const bloom2 = ctx.createRadialGradient(
        width * 0.82,
        height * 0.14,
        10,
        width * 0.82,
        height * 0.14,
        width * 0.42
      );
      bloom2.addColorStop(0, `rgba(${pal.c2}, 0.12)`);
      bloom2.addColorStop(1, 'rgba(5, 7, 13, 0)');
      ctx.fillStyle = bloom2;
      ctx.fillRect(0, 0, width, height);

      // 3 Layered Flowing Harmonic Soundwave Ribbons
      const waveConfigs = [
        { yBase: height * 0.24, amp: 34, freq: 0.0026, speed: 1.0, rgb: pal.c1, opacity: 0.2 },
        { yBase: height * 0.30, amp: 24, freq: 0.0038, speed: -0.75, rgb: pal.c2, opacity: 0.17 },
        { yBase: height * 0.78, amp: 28, freq: 0.0022, speed: 0.65, rgb: pal.c3, opacity: 0.12 },
      ];

      for (const w of waveConfigs) {
        ctx.beginPath();
        const pointerInfluence = ((pointer.y / Math.max(1, height)) - 0.5) * 32;
        for (let x = 0; x <= width; x += 14) {
          const distCursor = Math.exp(-Math.pow((x - pointer.x) / 340, 2));
          const y =
            w.yBase +
            Math.sin(x * w.freq + t * w.speed) * w.amp +
            Math.cos(x * w.freq * 1.9 - t * w.speed * 1.3) * (w.amp * 0.38) +
            distCursor * pointerInfluence;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, `rgba(${w.rgb}, 0)`);
        grad.addColorStop(0.22, `rgba(${w.rgb}, ${w.opacity})`);
        grad.addColorStop(0.78, `rgba(${w.rgb}, ${w.opacity})`);
        grad.addColorStop(1, `rgba(${w.rgb}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = pulseRef.current ? 1.8 : 1.25;
        ctx.stroke();
      }

      // Drifting Neural Synapse Particles & Subtle Filaments
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!prefersReduced) {
          p.x += p.vx * (pulseRef.current ? 1.5 : 1);
          p.y += p.vy * (pulseRef.current ? 1.5 : 1);
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        const twinkle = 0.55 + 0.45 * Math.sin(t * 2 + p.phase);
        ctx.fillStyle = `rgba(${i % 2 === 0 ? pal.c1 : pal.c2}, ${(p.alpha * twinkle).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        // Connect nearby particles with ultra-delicate neural lines
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 14500) {
            const lineAlpha = (1 - d2 / 14500) * 0.085;
            ctx.strokeStyle = `rgba(${pal.c1}, ${lineAlpha.toFixed(3)})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
