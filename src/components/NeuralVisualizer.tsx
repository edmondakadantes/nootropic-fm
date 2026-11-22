import { useEffect, useRef } from 'react';
import type { PsychoacousticEngine } from '../audio/PsychoacousticEngine';

interface NeuralVisualizerProps {
  engine: PsychoacousticEngine;
  isPlaying: boolean;
  safetyMode: boolean;
  modulationHz: number;
}

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
      const width = Math.max(240, Math.floor(rect.width));
      const height = Math.max(120, Math.floor(rect.height));

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Subtle horizon line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const hasAudio = isPlaying && engine.getFrequencyData(freqData) && engine.getTimeDomainData(timeData);
      phase += isPlaying ? 0.045 : 0.012;

      const primaryColor = safetyMode ? '#f59e0b' : '#22d3ee';
      const secondaryColor = safetyMode ? '#38bdf8' : '#818cf8';

      // Frequency bars backdrop
      const barCount = 48;
      const barWidth = width / barCount;
      for (let i = 0; i < barCount; i++) {
        const val = hasAudio ? freqData[i] / 255 : (Math.sin(phase + i * 0.25) * 0.5 + 0.5) * 0.12;
        const barH = Math.max(3, val * height * 0.58);
        const x = i * barWidth + barWidth * 0.2;
        const y = (height - barH) / 2;

        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, safetyMode ? 'rgba(245, 158, 11, 0.35)' : 'rgba(34, 211, 238, 0.35)');
        grad.addColorStop(1, 'rgba(129, 140, 248, 0.08)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(2, barWidth * 0.55), barH, 3);
        ctx.fill();
      }

      // Live neural waveform ribbon
      const waveGrad = ctx.createLinearGradient(0, 0, width, 0);
      waveGrad.addColorStop(0, primaryColor);
      waveGrad.addColorStop(0.55, secondaryColor);
      waveGrad.addColorStop(1, primaryColor);

      ctx.strokeStyle = waveGrad;
      ctx.lineWidth = 2.4;
      ctx.beginPath();

      for (let x = 0; x <= width; x += 3) {
        const normX = x / width;
        const envelope = Math.sin(normX * Math.PI);
        const sampleIdx = Math.min(timeData.length - 1, Math.floor(normX * timeData.length));
        const liveOffset = hasAudio ? ((timeData[sampleIdx] - 128) / 128) * (height * 0.34) : 0;
        const modWave =
          Math.sin(normX * Math.max(4, modulationHz * 0.85) + phase * 1.9) *
          (isPlaying ? 10 : 4) *
          envelope;
        const y = height / 2 + liveOffset * envelope + modWave;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [engine, isPlaying, safetyMode, modulationHz]);

  return (
    <canvas
      ref={canvasRef}
      className="h-36 w-full rounded-xl bg-[#060911]/80 border border-slate-800/80"
      aria-label="Vizualizare unde psihoacustice live"
    />
  );
}
