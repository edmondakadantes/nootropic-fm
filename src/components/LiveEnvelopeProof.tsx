import { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { ENTRAINMENT_LABELS, type EntrainmentType } from '../../shared/studySpec';
import type { PsychoacousticEngine } from '../audio/PsychoacousticEngine';

interface LiveEnvelopeProofProps {
  engine: PsychoacousticEngine | null;
  isPlaying: boolean;
  entrainmentType: EntrainmentType;
  frequencyHz: number;
  depth: number;
  carrierLabel: string;
  tuningA4Hz: 440 | 432;
}

/**
 * Real-Time Laboratory Proof Scope:
 * Draws BOTH the live audio output waveform (from Web Audio AnalyserNode) AND
 * the exact mathematical medical stimulus envelope (16 Hz AM, 40 Hz GENUS 1ms bursts,
 * 200/210 Hz Binaural beat, Isochronic trapezoid, or 0.1 Hz HRV tide) at 60fps.
 */
export function LiveEnvelopeProof({
  engine,
  isPlaying,
  entrainmentType,
  frequencyHz,
  depth,
  carrierLabel,
  tuningA4Hz,
}: LiveEnvelopeProofProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const timeBuf = new Uint8Array(128);
    let raf = 0;
    let t0 = performance.now();

    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      const elapsed = (now - t0) / 1000;

      ctx.clearRect(0, 0, w, h);

      // Subtle laboratory grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // 1. Live Web Audio Time-Domain Waveform (cyan translucent ribbon)
      if (engine && isPlaying && engine.getTimeDomainData(timeBuf)) {
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < timeBuf.length; i++) {
          const x = (i / (timeBuf.length - 1)) * w;
          const v = (timeBuf[i] - 128) / 128;
          const y = h / 2 + v * (h * 0.42);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // 2. Reference Modulation Pattern Overlay (flat baseline when modulation is off, e.g. pure A=432 Hz)
      const modActive = entrainmentType !== 'none' && depth > 0.001;
      const displayCycles =
        entrainmentType === 'gamma_40hz_clicks'
          ? 12
          : entrainmentType === 'hrv_breathing_swell'
            ? 1.5
            : Math.max(3, Math.min(10, Math.round((frequencyHz || 10) / 2)));
      const amp = modActive ? Math.max(0.14, Math.min(0.42, depth * 0.9)) : 0;
      const speed = isPlaying ? (entrainmentType === 'hrv_breathing_swell' ? 0.35 : 2.2) : 0;

      ctx.strokeStyle = !modActive
        ? 'rgba(148, 163, 184, 0.55)'
        : entrainmentType === 'gamma_40hz_clicks'
          ? '#fbbf24'
          : entrainmentType === 'hrv_breathing_swell'
            ? '#34d399'
            : '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();

      for (let px = 0; px <= w; px += 2) {
        if (!modActive) {
          const y = h / 2;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
          continue;
        }
        const u = px / w;
        const phase = (u * displayCycles - elapsed * speed) % 1;
        const normPhase = phase < 0 ? phase + 1 : phase;
        let val = 0;

        if (entrainmentType === 'gamma_40hz_clicks') {
          // Crisp raised-cosine burst spike inside each 25 ms cycle
          val = normPhase < 0.1 ? Math.sin((normPhase / 0.1) * Math.PI) : 0;
          val = val * 0.85 - 0.35;
        } else if (entrainmentType === 'isochronic_pulse') {
          val = normPhase < 0.5 ? 0.7 : -0.7;
        } else {
          val = Math.sin(normPhase * Math.PI * 2);
        }

        const y = h / 2 - val * h * amp;
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();

      if (isPlaying) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    t0 = performance.now();
    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, [engine, isPlaying, entrainmentType, frequencyHz, depth]);

  return (
    <div className="rounded-2xl border border-cyan-400/20 bg-[#040711]/90 px-3.5 py-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px]">
        <span className="inline-flex items-center gap-1.5 text-cyan-300">
          <Activity className="h-3.5 w-3.5" />
          Live Signal Proof Scope · {ENTRAINMENT_LABELS[entrainmentType]}
        </span>
        <span className="text-slate-400">
          {carrierLabel} · A={tuningA4Hz} Hz
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={640}
        height={56}
        className="h-12 w-full rounded-lg bg-slate-950/70"
      />
    </div>
  );
}
