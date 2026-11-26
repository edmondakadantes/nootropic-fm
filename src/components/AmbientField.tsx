import { useEffect, useRef } from 'react';

export type FieldMood = 'default' | 'focus' | 'driving' | 'calm' | 'flow' | 'sleep';

interface AmbientFieldProps {
  mood?: FieldMood;
  activePulse?: boolean;
  themeMode?: 'daylight' | 'night';
}

/**
 * Architectural Studio Acoustic Calibration Surface.
 * Renders a matte carbon (Night) or warm alabaster (Daylight) calibration grid with 0% idle RAF CPU drain,
 * and a single subtle 1px phosphor reference trace across the upper third only while audio is actively playing.
 */
export function AmbientField({
  mood = 'default',
  activePulse = false,
  themeMode = 'night',
}: AmbientFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moodRef = useRef<FieldMood>(mood);
  const pulseRef = useRef<boolean>(activePulse);
  const themeRef = useRef<'daylight' | 'night'>(themeMode);
  moodRef.current = mood;
  pulseRef.current = activePulse;
  themeRef.current = themeMode;

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

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, width, height);

      const isDay = themeRef.current === 'daylight';

      // Subtle warm top-center overhead studio wash
      const wash = ctx.createRadialGradient(
        width * 0.5,
        0,
        0,
        width * 0.5,
        0,
        Math.max(width, height) * 0.62
      );
      wash.addColorStop(0, isDay ? 'rgba(4, 120, 87, 0.035)' : 'rgba(243, 241, 236, 0.025)');
      wash.addColorStop(1, isDay ? 'rgba(244, 241, 234, 0)' : 'rgba(10, 11, 12, 0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      // Crisp 48px studio calibration drafting grid (subtle precision ticks)
      const spacing = 48;
      const tickColor = isDay ? 'rgba(20, 22, 25, 0.055)' : 'rgba(255, 255, 255, 0.03)';
      ctx.fillStyle = tickColor;
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      for (let x = spacing / 2; x < width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
          if (((Math.round(x / spacing) + Math.round(y / spacing)) & 3) === 0) {
            ctx.beginPath();
            ctx.moveTo(x - 3, y);
            ctx.lineTo(x + 3, y);
            ctx.moveTo(x, y - 3);
            ctx.lineTo(x, y + 3);
            ctx.stroke();
          }
        }
      }

      // Single crisp 1px phosphor reference trace ONLY while audio playback is active
      if (pulseRef.current && !prefersReduced) {
        const yBase = height * 0.3;
        const amp = 18;
        const traceRgb =
          moodRef.current === 'driving'
            ? isDay
              ? '180, 83, 9'
              : '245, 158, 11'
            : isDay
              ? '4, 120, 87'
              : '52, 211, 153';
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, `rgba(${traceRgb}, 0)`);
        grad.addColorStop(0.2, `rgba(${traceRgb}, ${isDay ? '0.16' : '0.08'})`);
        grad.addColorStop(0.8, `rgba(${traceRgb}, ${isDay ? '0.16' : '0.08'})`);
        grad.addColorStop(1, `rgba(${traceRgb}, 0)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const y = yBase + Math.sin(x * 0.0045 + t) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    const renderLoop = () => {
      t += 0.025;
      drawFrame();
      if (pulseRef.current && !prefersReduced) {
        rafId = requestAnimationFrame(renderLoop);
      }
    };

    const onResize = () => {
      resize();
      drawFrame();
    };

    resize();
    drawFrame();
    window.addEventListener('resize', onResize);

    if (activePulse && !prefersReduced) {
      rafId = requestAnimationFrame(renderLoop);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, [activePulse, themeMode]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
