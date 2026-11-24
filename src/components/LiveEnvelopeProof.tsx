import { useEffect, useRef, useState } from 'react';
import { Activity, Radio, Waves } from 'lucide-react';
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
  isPureWave?: boolean;
  onTogglePureWave?: () => void;
}

interface ScopeReadout {
  rmsDbfs: string;
  peakDbfs: string;
  peakHz: number | null;
  sampleRateKhz: string;
  windowMs: string;
  stereoCorr: string;
}

/**
 * 100% Genuine Dual-Mode Web Audio Laboratory Oscilloscope (ZERO simulated curves):
 * - Y(t) Dual-Trace: Trigger-stabilized CH1 master waveform (#34D399) + CH2 measured 3s RMS envelope (#F59E0B).
 * - X/Y Lissajous Vectorscope: Live Left vs. Right stereo phase plot with real Pearson correlation readout.
 */
export function LiveEnvelopeProof({
  engine,
  isPlaying,
  entrainmentType,
  frequencyHz,
  depth,
  carrierLabel,
  tuningA4Hz,
  isPureWave = false,
  onTogglePureWave,
}: LiveEnvelopeProofProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scopeMode, setScopeMode] = useState<'dual_trace' | 'xy_lissajous'>('dual_trace');
  const [readout, setReadout] = useState<ScopeReadout>({
    rmsDbfs: '−∞',
    peakDbfs: '−∞',
    peakHz: null,
    sampleRateKhz: '48.0',
    windowMs: '10.7',
    stereoCorr: '+1.00',
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const waveBuf = new Float32Array(2048);
    const modBuf = new Float32Array(1024);
    const leftBuf = new Float32Array(1024);
    const rightBuf = new Float32Array(1024);
    const envHistoryLen = 180; // ~3 seconds at 60 fps of real measured RMS envelope
    const envHistory = new Float32Array(envHistoryLen);
    let envWriteIdx = 0;
    let raf = 0;
    let lastMetricAt = 0;

    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      const hasWave = Boolean(engine && isPlaying && engine.getScopeWaveform(waveBuf));
      const useModTap = entrainmentType === 'amplitude_modulation' && !isPureWave;
      const hasMod = Boolean(
        engine && isPlaying && (useModTap ? engine.getScopeModBand(modBuf) : false)
      );
      const hasStereo = Boolean(
        engine && isPlaying && engine.getScopeStereoXY(leftBuf, rightBuf)
      );

      let masterRms = 0;
      let peakAbs = 0;
      let corrStr = '—';
      const displaySamples = 512;

      if (hasWave) {
        let sumSq = 0;
        for (let i = 0; i < waveBuf.length; i++) {
          const s = waveBuf[i];
          sumSq += s * s;
          const a = Math.abs(s);
          if (a > peakAbs) peakAbs = a;
        }
        masterRms = Math.sqrt(sumSq / waveBuf.length);

        let envRms = masterRms;
        if (hasMod) {
          let mSq = 0;
          for (let i = 0; i < modBuf.length; i++) {
            mSq += modBuf[i] * modBuf[i];
          }
          envRms = Math.sqrt(mSq / modBuf.length);
        }

        envHistory[envWriteIdx] = envRms;
        envWriteIdx = (envWriteIdx + 1) % envHistoryLen;
      }

      let peakLR = 0;
      if (hasStereo) {
        let sumLR = 0;
        let sumLL = 0;
        let sumRR = 0;
        for (let i = 0; i < displaySamples; i++) {
          const l = leftBuf[i];
          const r = rightBuf[i];
          sumLR += l * r;
          sumLL += l * l;
          sumRR += r * r;
          const absL = Math.abs(l);
          const absR = Math.abs(r);
          if (absL > peakLR) peakLR = absL;
          if (absR > peakLR) peakLR = absR;
        }
        const denom = Math.sqrt(sumLL * sumRR);
        if (denom > 1e-6) {
          const corr = Math.max(-1, Math.min(1, sumLR / denom));
          corrStr = `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`;
        }
      }

      if (scopeMode === 'dual_trace') {
        // Laboratory CRT graticule grid (8 vertical x 4 horizontal divisions)
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.09)';
        ctx.lineWidth = 1;
        for (let gx = 1; gx < 8; gx++) {
          const x = (gx / 8) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let gy = 1; gy < 4; gy++) {
          const y = (gy / 4) * h;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Center zero-volt baseline & subtle axis ticks
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        for (let tx = 0; tx < 32; tx++) {
          const x = (tx / 32) * w;
          ctx.beginPath();
          ctx.moveTo(x, h / 2 - 2);
          ctx.lineTo(x, h / 2 + 2);
          ctx.stroke();
        }

        if (hasWave) {
          // Rising zero-crossing trigger stabilization (like a hardware Tektronix scope)
          let triggerIdx = 0;
          const maxTriggerSearch = waveBuf.length - displaySamples - 1;
          for (let i = 1; i < maxTriggerSearch; i++) {
            if (waveBuf[i - 1] <= 0 && waveBuf[i] > 0.002) {
              triggerIdx = i;
              break;
            }
          }

          // Dynamic auto-range gain so quiet Pure Sound Waves are still crisp & readable
          const visualGain = peakAbs > 0.004 ? Math.min(4.5, 0.42 / Math.max(0.08, peakAbs)) : 1.0;

          // TRACE 1 (Phosphor Green): Trigger-stabilized Real-Time Master Waveform
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.92)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (let i = 0; i < displaySamples; i++) {
            const x = (i / (displaySamples - 1)) * w;
            const v = Math.max(-1, Math.min(1, waveBuf[triggerIdx + i] * visualGain));
            const y = h / 2 - v * (h * 0.43);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // TRACE 2 (Tungsten Amber): Real Measured RMS Amplitude Envelope History (~3s)
          let maxEnv = 0.02;
          for (let i = 0; i < envHistoryLen; i++) {
            if (envHistory[i] > maxEnv) maxEnv = envHistory[i];
          }
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (let i = 0; i < envHistoryLen; i++) {
            const histIdx = (envWriteIdx + i) % envHistoryLen;
            const norm = Math.min(1, envHistory[histIdx] / Math.max(0.03, maxEnv * 1.15));
            const x = (i / (envHistoryLen - 1)) * w;
            const y = h - 6 - norm * (h - 14);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        } else {
          // Flat zero line when paused — authentic zero-signal behavior
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();
        }
      } else {
        // X/Y LISSAJOUS STEREOPHONIC VECTORSCOPE
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.43;

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.11)';
        ctx.lineWidth = 1;
        // Outer & 50% rings
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        // Horizontal (L), Vertical (R), and 45deg M / S axes
        ctx.beginPath();
        ctx.moveTo(cx - radius - 8, cy);
        ctx.lineTo(cx + radius + 8, cy);
        ctx.moveTo(cx, cy - radius - 8);
        ctx.lineTo(cx, cy + radius + 8);
        const diag = radius * 0.78;
        ctx.moveTo(cx - diag, cy + diag);
        ctx.lineTo(cx + diag, cy - diag);
        ctx.moveTo(cx - diag, cy - diag);
        ctx.lineTo(cx + diag, cy + diag);
        ctx.stroke();

        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(163, 163, 158, 0.65)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('L', cx - radius - 16, cy);
        ctx.fillText('R', cx + radius + 16, cy);
        ctx.fillText('M', cx + diag + 10, cy - diag - 6);
        ctx.fillText('S', cx - diag - 10, cy - diag - 6);

        if (hasStereo && peakLR > 0.002) {
          const xyGain = Math.min(4.2, 0.82 / Math.max(0.08, peakLR));
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
          ctx.lineWidth = 1.45;
          ctx.beginPath();
          for (let i = 0; i < displaySamples; i++) {
            const lx = Math.max(-1, Math.min(1, leftBuf[i] * xyGain));
            const ry = Math.max(-1, Math.min(1, rightBuf[i] * xyGain));
            const x = cx + lx * radius;
            const y = cy - ry * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        } else {
          // Stationary CRT electron beam dot when paused or near-silent
          ctx.fillStyle = isPlaying ? '#34D399' : '#F3F1EC';
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (hasWave && now - lastMetricAt > 160 && engine) {
        lastMetricAt = now;
        const sr = engine.getSampleRate();
        const rmsDb = masterRms > 0.00001 ? `${(20 * Math.log10(masterRms)).toFixed(1)}` : '−∞';
        const peakDb = peakAbs > 0.00001 ? `${(20 * Math.log10(peakAbs)).toFixed(1)}` : '−∞';
        setReadout({
          rmsDbfs: rmsDb,
          peakDbfs: peakDb,
          peakHz: engine.getMeasuredPeakHz(),
          sampleRateKhz: (sr / 1000).toFixed(1),
          windowMs: ((displaySamples / sr) * 1000).toFixed(1),
          stereoCorr: corrStr,
        });
      }

      if (isPlaying) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, [engine, isPlaying, entrainmentType, isPureWave, scopeMode]);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 sm:p-4 space-y-2.5">
      {/* Scope Header + Y(t) / X-Y Toggle + 1-Tap Pure Signal Audition */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 font-mono-tech text-[10px]">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[#F3F1EC]">
              <Activity className="h-3.5 w-3.5 text-[#34D399]" />
              Oscilloscope · {scopeMode === 'dual_trace' ? 'Dual Trace' : 'X/Y Vector'}
            </span>
            <span className="rounded border border-emerald-400/35 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#34D399]">
              Live Measured · Zero Simulation
            </span>
          </div>
          <div className="font-mono-tech text-[10px] text-[#8E8E88]">
            {ENTRAINMENT_LABELS[entrainmentType]}
            {frequencyHz > 0 ? ` · ${frequencyHz} Hz` : ''}
            {depth > 0 ? ` (${Math.round(depth * 100)}% depth)` : ''} · {carrierLabel} · A={tuningA4Hz} Hz
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-white/12 bg-[#141518] p-0.5 font-mono-tech text-[10px]">
            <button
              type="button"
              onClick={() => setScopeMode('dual_trace')}
              className={`rounded-md px-2 py-1 font-semibold transition ${
                scopeMode === 'dual_trace'
                  ? 'bg-[#22252A] text-[#F3F1EC]'
                  : 'text-[#8E8E88] hover:text-[#D4D4CE]'
              }`}
            >
              Y(t) Wave
            </button>
            <button
              type="button"
              onClick={() => setScopeMode('xy_lissajous')}
              className={`rounded-md px-2 py-1 font-semibold transition ${
                scopeMode === 'xy_lissajous'
                  ? 'bg-[#22252A] text-[#34D399]'
                  : 'text-[#8E8E88] hover:text-[#D4D4CE]'
              }`}
            >
              X/Y Lissajous
            </button>
          </div>

          {onTogglePureWave && (
            <button
              type="button"
              onClick={onTogglePureWave}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ${
                isPureWave
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-white/15 bg-[#16181C] text-[#F3F1EC] hover:border-emerald-400/50 hover:bg-[#1B1E24]'
              }`}
            >
              {isPureWave ? <Radio className="h-3 w-3" /> : <Waves className="h-3 w-3 text-[#34D399]" />}
              {isPureWave ? 'Back to Music Mix' : 'Isolate Pure Wave'}
            </button>
          )}
        </div>
      </div>

      {/* Dual-Mode Lab Oscilloscope Canvas */}
      <canvas
        ref={canvasRef}
        width={640}
        height={128}
        className="h-32 w-full rounded-lg border border-white/10 bg-[#050706]"
      />

      {/* Legend + Live Hardware Readouts */}
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tech text-[10px] text-[#8E8E88]">
        {scopeMode === 'dual_trace' ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#34D399]" />
              CH1 Waveform ({readout.windowMs} ms)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
              CH2 Measured RMS Envelope (3s)
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#34D399]" />
              CH1 L / CH2 R Vector · Corr{' '}
              <strong className="text-[#F3F1EC]">{readout.stereoCorr}</strong>
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 text-[#D4D4CE]">
          <span>{readout.sampleRateKhz} kHz</span>
          <span>RMS {readout.rmsDbfs} dBFS</span>
          <span>Peak {readout.peakDbfs} dBFS</span>
          {readout.peakHz !== null && (
            <span className="text-[#34D399]">FFT Peak {readout.peakHz} Hz</span>
          )}
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-[#7E7E78]">
        Tap <strong className="text-[#D4D4CE]">Isolate Pure Wave</strong> anytime to mute background
        music and verify the exact frequency with any external oscilloscope or spectrum analyzer
        (e.g. Audacity, Spectroid).
      </p>
    </div>
  );
}
