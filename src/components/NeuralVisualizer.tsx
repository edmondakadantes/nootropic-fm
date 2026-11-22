import { useEffect, useRef } from 'react';
import type { PsychoacousticEngine } from '../audio/PsychoacousticEngine';

interface NeuralVisualizerProps {
  engine: PsychoacousticEngine;
  isPlaying: boolean;
  safetyMode: boolean;
  modulationHz: number;
}

/**
 * Dual-layer 60fps Live Psychoacoustic Visualizer:
 * Central audio-reactive radial resonance halo + flowing dual-ribbon harmonic waveforms.
 */
export function NeuralVisualizer({
  engine,
  isPlaying,
  safetyMode,
  modulationHz,
}: NeuralVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freqData = new Uint8Array(128);
    const timeData = new Uint8Array(128);
    let rafId = 0;
    let phase = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(260, Math.floor(rect.width));
      const height = Math.max(180, Math.floor(rect.height));

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const hasAudio =
        isPlaying && engine.getFrequencyData(freqData) && engine.getTimeDomainData(timeData);

      phase += isPlaying ? 0.042 : 0.012;

      // Average low-mid energy for central breathing halo
      let energy = 0.14;
      if (hasAudio) {
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += freqData[i];
        energy = Math.min(1, sum / (32 * 210));
      } else {
        energy = 0.14 + 0.06 * Math.sin(phase * 1.4);
      }

      const c1 = safetyMode ? '245, 158, 11' : '34, 211, 238';
      const c2 = safetyMode ? '56, 189, 248' : '129, 140, 248';
      const primaryHex = safetyMode ? '#f59e0b' : '#22d3ee';
      const secondaryHex = safetyMode ? '#38bdf8' : '#a5b4fc';

      // Ambient central radial bloom
      const haloR = Math.min(width, height) * (0.36 + energy * 0.14);
      const bloom = ctx.createRadialGradient(cx, cy, 4, cx, cy, haloR * 1.45);
      bloom.addColorStop(0, `rgba(${c1}, ${(0.22 + energy * 0.25).toFixed(3)})`);
      bloom.addColorStop(0.5, `rgba(${c2}, 0.08)`);
      bloom.addColorStop(1, 'rgba(6, 9, 17, 0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);

      // Flowing dual harmonic ribbons across full width
      for (let layer = 0; layer < 2; layer++) {
        const waveGrad = ctx.createLinearGradient(0, 0, width, 0);
        waveGrad.addColorStop(0, `rgba(${layer === 0 ? c1 : c2}, 0)`);
        waveGrad.addColorStop(0.2, layer === 0 ? primaryHex : secondaryHex);
        waveGrad.addColorStop(0.8, layer === 0 ? secondaryHex : primaryHex);
        waveGrad.addColorStop(1, `rgba(${layer === 0 ? c2 : c1}, 0)`);

        ctx.strokeStyle = waveGrad;
        ctx.lineWidth = layer === 0 ? 2.1 : 1.25;
        ctx.globalAlpha = layer === 0 ? 0.92 : 0.45;
        ctx.beginPath();

        for (let x = 0; x <= width; x += 3) {
          const normX = x / width;
          const env = Math.sin(normX * Math.PI);
          const idx = Math.min(timeData.length - 1, Math.floor(normX * timeData.length));
          const liveDelta = hasAudio ? ((timeData[idx] - 128) / 128) * (height * 0.36) : 0;
          const amRipple =
            Math.sin(normX * Math.max(5, modulationHz * 0.9) + phase * (layer === 0 ? 2.1 : -1.5)) *
            (isPlaying ? 12 + energy * 10 : 5) *
            env;
          const y = cy + (layer === 0 ? 1 : -0.65) * (liveDelta * env + amRipple);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Central Radial Spectrum Mandala
      const baseR = Math.min(width, height) * 0.24;
      const spokes = 64;
      for (let i = 0; i < spokes; i++) {
        const angle = (i / spokes) * Math.PI * 2 - Math.PI / 2 + phase * 0.12;
        const bin = hasAudio ? freqData[i % 48] / 255 : (Math.sin(phase * 1.8 + i * 0.3) * 0.5 + 0.5) * 0.22;
        const len = 5 + bin * (Math.min(width, height) * 0.19);
        const x1 = cx + Math.cos(angle) * baseR;
        const y1 = cy + Math.sin(angle) * baseR;
        const x2 = cx + Math.cos(angle) * (baseR + len);
        const y2 = cy + Math.sin(angle) * (baseR + len);

        ctx.strokeStyle = i % 2 === 0 ? `rgba(${c1}, ${(0.45 + bin * 0.55).toFixed(2)})` : `rgba(${c2}, ${(0.35 + bin * 0.5).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Inner luminous ring
      ctx.strokeStyle = `rgba(${c1}, 0.55)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Core Hz readout centered inside mandala
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.font = '600 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${modulationHz} Hz`, cx, cy - 5);
      ctx.fillStyle = `rgba(${c1}, 0.85)`;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillText(isPlaying ? 'LIVE AM' : 'PAUSED', cx, cy + 11);

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [engine, isPlaying, safetyMode, modulationHz]);

  return (
    <canvas
      ref={canvasRef}
      className="h-52 sm:h-60 w-full rounded-2xl bg-[#050811]/85 border border-slate-800/80 shadow-inner"
      aria-label="Live psychoacoustic waveform and radial frequency visualizer"
    />
  );
}
