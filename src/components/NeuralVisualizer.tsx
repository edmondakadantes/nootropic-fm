import { useEffect, useRef } from 'react';
import type { PsychoacousticEngine } from '../audio/PsychoacousticEngine';

interface NeuralVisualizerProps {
  engine: PsychoacousticEngine;
  isPlaying: boolean;
  safetyMode: boolean;
  modulationHz: number;
  themeMode?: 'daylight' | 'night';
}

const BAND_COUNT = 36;

/**
 * 36-Band Studio Spectrum & Peak-Hold Analyzer:
 * Driven by live Web Audio FFT frequency bins with calibrated dB gridlines,
 * smooth ballistic decay, peak-hold caps, and authentic resting floor when paused.
 */
export function NeuralVisualizer({
  engine,
  isPlaying,
  safetyMode,
  modulationHz,
  themeMode = 'night',
}: NeuralVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef<'daylight' | 'night'>(themeMode);
  themeRef.current = themeMode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freqData = new Uint8Array(128);
    const bandLevels = new Float32Array(BAND_COUNT);
    const peakCaps = new Float32Array(BAND_COUNT);
    const peakHoldTicks = new Uint8Array(BAND_COUNT);
    let rafId = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(260, Math.floor(rect.width));
      const height = Math.max(96, Math.floor(rect.height));
      const isDay = themeRef.current === 'daylight';

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Background recessed panel
      ctx.fillStyle = isDay ? '#E8EFF7' : '#070809';
      ctx.fillRect(0, 0, width, height);

      const padLeft = 36;
      const padRight = 12;
      const padTop = 24;
      const padBottom = 8;
      const plotW = Math.max(120, width - padLeft - padRight);
      const plotH = Math.max(52, height - padTop - padBottom);

      // Horizontal dB calibration gridlines (-6, -18, -36 dB)
      const dbMarks = [
        { label: '-6', norm: 0.85 },
        { label: '-18', norm: 0.55 },
        { label: '-36', norm: 0.25 },
      ];
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const mark of dbMarks) {
        const y = Math.round(padTop + plotH * (1 - mark.norm)) + 0.5;
        ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();

        ctx.fillStyle = isDay ? '#334155' : 'rgba(163, 163, 158, 0.55)';
        ctx.fillText(mark.label, padLeft - 6, y);
      }

      // Baseline floor
      ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.24)' : 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(padLeft, padTop + plotH + 0.5);
      ctx.lineTo(padLeft + plotW, padTop + plotH + 0.5);
      ctx.stroke();

      const hasAudio = isPlaying && engine.getFrequencyData(freqData);
      const slotW = plotW / BAND_COUNT;
      const barW = Math.max(2, Math.floor(slotW * 0.68));
      const offsetX = Math.floor((slotW - barW) / 2);

      let anyMoving = isPlaying;

      for (let b = 0; b < BAND_COUNT; b++) {
        // Log-weighted index across bins 0..63 so bass + mid + upper frequencies balance visually
        const normBand = b / (BAND_COUNT - 1);
        const rawIdx = Math.min(63, Math.floor(Math.pow(normBand, 1.35) * 63));
        const nextIdx = Math.min(63, Math.floor(Math.pow((b + 1) / BAND_COUNT, 1.35) * 63));
        let target = 0;
        if (hasAudio) {
          let sum = 0;
          let count = 0;
          for (let k = rawIdx; k <= Math.max(rawIdx, nextIdx); k++) {
            sum += freqData[k];
            count++;
          }
          target = Math.min(1, sum / (Math.max(1, count) * 235));
        }

        // Fast attack, smooth studio VU ballistic release
        if (target >= bandLevels[b]) {
          bandLevels[b] = bandLevels[b] + (target - bandLevels[b]) * 0.45;
        } else {
          bandLevels[b] = bandLevels[b] * 0.86;
          if (bandLevels[b] < 0.004) bandLevels[b] = 0;
        }

        // Peak-hold cap
        if (bandLevels[b] >= peakCaps[b]) {
          peakCaps[b] = bandLevels[b];
          peakHoldTicks[b] = 18;
        } else if (peakHoldTicks[b] > 0) {
          peakHoldTicks[b]--;
        } else {
          peakCaps[b] = Math.max(bandLevels[b], peakCaps[b] * 0.91);
          if (peakCaps[b] < 0.004) peakCaps[b] = 0;
        }

        if (bandLevels[b] > 0.004 || peakCaps[b] > 0.004) {
          anyMoving = true;
        }

        const x = Math.round(padLeft + b * slotW + offsetX);
        const levelH = Math.max(isPlaying ? 2 : 0, Math.round(bandLevels[b] * plotH));

        if (levelH > 0) {
          const yTop = padTop + plotH - levelH;
          // Segmented 3px-step bars with 1px gap
          const segH = 3;
          const gap = 1;
          for (let sy = padTop + plotH - segH; sy >= yTop; sy -= segH + gap) {
            const heightNorm = (padTop + plotH - sy) / plotH;
            if (safetyMode) {
              if (isDay) {
                ctx.fillStyle = heightNorm > 0.84 ? '#1E40AF' : 'rgba(29, 78, 216, 0.84)';
              } else {
                ctx.fillStyle = heightNorm > 0.84 ? '#F59E0B' : 'rgba(245, 158, 11, 0.82)';
              }
            } else if (isDay) {
              ctx.fillStyle =
                heightNorm > 0.84
                  ? '#0369A1'
                  : heightNorm > 0.62
                    ? '#047857'
                    : 'rgba(4, 120, 87, 0.76)';
            } else {
              ctx.fillStyle =
                heightNorm > 0.84
                  ? '#F59E0B'
                  : heightNorm > 0.65
                    ? 'rgba(52, 211, 153, 0.95)'
                    : 'rgba(52, 211, 153, 0.68)';
            }
            ctx.fillRect(x, sy, barW, segH);
          }
        } else {
          // Subtle quiet resting tick at 0 floor when standby
          ctx.fillStyle = isDay ? 'rgba(15, 23, 42, 0.28)' : 'rgba(255, 255, 255, 0.08)';
          ctx.fillRect(x, padTop + plotH - 1, barW, 1);
        }

        // Peak-hold cap indicator
        if (peakCaps[b] > 0.015) {
          const peakY = Math.round(padTop + plotH - peakCaps[b] * plotH);
          ctx.fillStyle = isDay ? '#0F172A' : '#F3F1EC';
          ctx.fillRect(x, Math.max(padTop, peakY - 2), barW, 2);
        }
      }

      // Instrument Header Overlay inside canvas
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isDay ? '#0F172A' : 'rgba(163, 163, 158, 0.85)';
      ctx.fillText('SPECTRUM ANALYZER · 3-BAND LR4', 12, 8);

      ctx.textAlign = 'right';
      ctx.fillStyle = isPlaying
        ? safetyMode
          ? isDay
            ? '#1E40AF'
            : '#F59E0B'
          : isDay
            ? '#047857'
            : '#34D399'
        : isDay
          ? '#475569'
          : 'rgba(142, 142, 136, 0.75)';
      const statusText = modulationHz > 0
        ? `${modulationHz} HZ · ${isPlaying ? 'ACTIVE' : 'STANDBY'}`
        : isPlaying ? 'ACTIVE' : 'STANDBY';
      ctx.fillText(statusText, width - 12, 8);

      ctx.restore();
      if (anyMoving || isPlaying) {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [engine, isPlaying, safetyMode, modulationHz, themeMode]);

  return (
    <canvas
      ref={canvasRef}
      className={`h-24 sm:h-28 w-full rounded-xl border ${
        themeMode === 'daylight'
          ? 'border-slate-300 bg-[#E8EFF7]'
          : 'border-white/10 bg-[#070809]'
      }`}
      aria-label="Live 36-band studio spectrum and peak-hold analyzer"
    />
  );
}
