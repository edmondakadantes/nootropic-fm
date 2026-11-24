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
  layerMode?: 'full_mix' | 'science_only' | 'music_only';
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
 * - Y(t) Dual-Trace: Separated Tektronix lanes with trigger-stabilized CH1 master waveform (#34D399)
 *   and 240 Hz sub-window measured CH2 envelope (#FBBF24) with phosphor CRT bloom.
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
  layerMode = 'full_mix',
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

  const livePropsRef = useRef({
    entrainmentType,
    frequencyHz,
    depth,
    layerMode,
    isPureWave,
  });
  livePropsRef.current = {
    entrainmentType,
    frequencyHz,
    depth,
    layerMode,
    isPureWave,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const waveBuf = new Float32Array(2048);
    const modBuf = new Float32Array(1024);
    const leftBuf = new Float32Array(1024);
    const rightBuf = new Float32Array(1024);
    const envHistoryLen = 180;
    const envHistory = new Float32Array(envHistoryLen);
    let envWriteIdx = 0;
    let lastFrameMs = 0;
    let envAccSq = 0;
    let envAccCount = 0;
    let smoothedEnv = 0;
    let raf = 0;
    let lastMetricAt = 0;

    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(172, Math.floor(rect.height));
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const {
        entrainmentType: curEntrainment,
        frequencyHz: curFreqHz,
        depth: curDepth,
        layerMode: curLayerMode,
        isPureWave: curPureWave,
      } = livePropsRef.current;
      const slowBreath = curFreqHz > 0 && curFreqHz <= 1.5;
      const isMusicBypassed = curLayerMode === 'music_only';
      const isIsolated = curPureWave || curLayerMode === 'science_only';

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Recessed dark-phosphor CRT surface with subtle center vignette glow
      ctx.fillStyle = '#030706';
      ctx.fillRect(0, 0, w, h);
      const bgGlow = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.65);
      bgGlow.addColorStop(0, 'rgba(52, 211, 153, 0.05)');
      bgGlow.addColorStop(1, 'rgba(3, 7, 6, 0)');
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, w, h);

      const hasWave = Boolean(engine && isPlaying && engine.getScopeWaveform(waveBuf));
      const useModTap = curEntrainment !== 'none' && !curPureWave;
      const hasMod = Boolean(
        engine && isPlaying && (useModTap ? engine.getScopeModBand(modBuf) : false)
      );
      const hasStereo = Boolean(
        engine && isPlaying && engine.getScopeStereoXY(leftBuf, rightBuf)
      );

      let masterRms = 0;
      let peakAbs = 0;
      let corrStr = '--';
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

        const sr = engine?.getSampleRate() || 48000;
        const targetEnvRateHz = slowBreath ? 36 : 240;
        const blockSize = Math.max(64, Math.round(sr / targetEnvRateHz));
        const srcBuf = hasMod ? modBuf : waveBuf;
        const dtSec =
          lastFrameMs > 0
            ? Math.min(0.042, Math.max(0.004, (now - lastFrameMs) / 1000))
            : 1 / 60;
        lastFrameMs = now;

        const elapsedSamples = Math.min(
          srcBuf.length,
          Math.max(64, Math.round(dtSec * sr))
        );
        const startIdx = srcBuf.length - elapsedSamples;
        for (let i = startIdx; i < srcBuf.length; i++) {
          const v = srcBuf[i];
          envAccSq += v * v;
          envAccCount++;
          if (envAccCount >= blockSize) {
            const blockRms = Math.sqrt(envAccSq / envAccCount);
            smoothedEnv =
              smoothedEnv === 0 ? blockRms : smoothedEnv * 0.38 + blockRms * 0.62;
            envHistory[envWriteIdx] = smoothedEnv;
            envWriteIdx = (envWriteIdx + 1) % envHistoryLen;
            envAccSq = 0;
            envAccCount = 0;
          }
        }
      } else {
        lastFrameMs = 0;
        envAccSq = 0;
        envAccCount = 0;
        smoothedEnv = 0;
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
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.14)';
        ctx.lineWidth = 1;
        for (let gx = 1; gx < 8; gx++) {
          const x = Math.round((gx / 8) * w) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let gy = 1; gy < 4; gy++) {
          const y = Math.round((gy / 4) * h) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Upper Lane (CH1 Master Waveform): 0% .. 53% height
        const ch1MidY = Math.round(h * 0.3) + 0.5;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.24)';
        ctx.beginPath();
        ctx.moveTo(0, ch1MidY);
        ctx.lineTo(w, ch1MidY);
        ctx.stroke();
        for (let tx = 0; tx < 32; tx++) {
          const x = (tx / 32) * w;
          ctx.beginPath();
          ctx.moveTo(x, ch1MidY - 2.5);
          ctx.lineTo(x, ch1MidY + 2.5);
          ctx.stroke();
        }

        // Channel Divider between CH1 and CH2
        const divY = Math.round(h * 0.55) + 0.5;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.moveTo(0, divY);
        ctx.lineTo(w, divY);
        ctx.stroke();
        ctx.restore();

        // Lower Lane (CH2 Measured Cortical Envelope): 57% .. 100% height
        const ch2BaseY = h - 8;
        const ch2SpanH = h * 0.36;

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

          // Dynamic auto-range gain so quiet Pure Sound Waves remain crisp & readable
          const visualGain =
            peakAbs > 0.004 ? Math.min(4.8, 0.44 / Math.max(0.08, peakAbs)) : 1.0;

          // TRACE 1 (Phosphor Green): Outer bloom halo + crisp core beam
          ctx.beginPath();
          for (let i = 0; i < displaySamples; i++) {
            const x = (i / (displaySamples - 1)) * w;
            const v = Math.max(-1, Math.min(1, waveBuf[triggerIdx + i] * visualGain));
            const y = ch1MidY - v * (h * 0.2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.26)';
          ctx.lineWidth = 5;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.strokeStyle = '#34D399';
          ctx.lineWidth = 2.1;
          ctx.stroke();

          // TRACE 2 (Tungsten Amber / Muted Slate on Bypass): Measured Sub-Window Envelope
          let maxEnv = 0.025;
          for (let i = 0; i < envHistoryLen; i++) {
            if (envHistory[i] > maxEnv) maxEnv = envHistory[i];
          }
          const envScale = Math.max(0.025, maxEnv * 1.12);

          // Subtle filled envelope area under CH2 trace
          const envGrad = ctx.createLinearGradient(0, ch2BaseY - ch2SpanH, 0, ch2BaseY);
          if (isMusicBypassed) {
            envGrad.addColorStop(0, 'rgba(148, 163, 184, 0.08)');
            envGrad.addColorStop(1, 'rgba(148, 163, 184, 0.01)');
          } else {
            envGrad.addColorStop(0, 'rgba(245, 158, 11, 0.16)');
            envGrad.addColorStop(1, 'rgba(245, 158, 11, 0.01)');
          }

          ctx.beginPath();
          for (let i = 0; i < envHistoryLen; i++) {
            const histIdx = (envWriteIdx + i) % envHistoryLen;
            const norm = Math.min(1, envHistory[histIdx] / envScale);
            const x = (i / (envHistoryLen - 1)) * w;
            const y = ch2BaseY - norm * ch2SpanH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = isMusicBypassed
            ? 'rgba(148, 163, 184, 0.16)'
            : 'rgba(251, 191, 36, 0.24)';
          ctx.lineWidth = 4.5;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.strokeStyle = isMusicBypassed ? '#94A3B8' : '#FBBF24';
          ctx.lineWidth = 2.1;
          ctx.stroke();

          ctx.lineTo(w, ch2BaseY);
          ctx.lineTo(0, ch2BaseY);
          ctx.closePath();
          ctx.fillStyle = envGrad;
          ctx.fill();
        } else {
          // Steady CRT standby zero lines when paused
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(0, ch1MidY);
          ctx.lineTo(w, ch1MidY);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(251, 191, 36, 0.28)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, ch2BaseY);
          ctx.lineTo(w, ch2BaseY);
          ctx.stroke();
        }

        // In-Screen CRT HUD Overlay Labels
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#34D399';
        ctx.fillText('CH1 WAVEFORM', 10, 10);

        ctx.fillStyle = isMusicBypassed ? '#94A3B8' : '#FBBF24';
        ctx.fillText(
          isMusicBypassed
            ? 'CH2 RAW DYNAMICS (0% SCIENCE)'
            : `CH2 ENVELOPE (${slowBreath ? '5.0s' : '750ms'})`,
          10,
          divY + 8
        );

        ctx.textAlign = 'right';
        let statusHud = '';
        if (!isPlaying) {
          statusHud = 'STANDBY';
          ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
        } else if (isMusicBypassed) {
          statusHud = 'SCIENCE BYPASSED · 0%';
          ctx.fillStyle = '#94A3B8';
        } else if (isIsolated) {
          statusHud = `SCIENCE ISOLATED · ${curFreqHz > 0 ? `${curFreqHz} HZ · ` : ''}${Math.round(curDepth * 100)}%`;
          ctx.fillStyle = '#FBBF24';
        } else {
          statusHud = `${curFreqHz > 0 ? `${curFreqHz} HZ · ` : ''}${Math.round(curDepth * 100)}% DEPTH`;
          ctx.fillStyle = '#34D399';
        }
        ctx.fillText(statusHud, w - 10, 10);
      } else {
        // X/Y LISSAJOUS STEREOPHONIC VECTORSCOPE
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.42;

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.17)';
        ctx.lineWidth = 1;
        // Outer & 50% polar rings
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

        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(163, 163, 158, 0.78)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('L', cx - radius - 16, cy);
        ctx.fillText('R', cx + radius + 16, cy);
        ctx.fillText('M', cx + diag + 11, cy - diag - 7);
        ctx.fillText('S', cx - diag - 11, cy - diag - 7);

        if (hasStereo && peakLR > 0.002) {
          const xyGain = Math.min(4.2, 0.82 / Math.max(0.08, peakLR));
          ctx.beginPath();
          for (let i = 0; i < displaySamples; i++) {
            const lx = Math.max(-1, Math.min(1, leftBuf[i] * xyGain));
            const ry = Math.max(-1, Math.min(1, rightBuf[i] * xyGain));
            const x = cx + lx * radius;
            const y = cy - ry * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.24)';
          ctx.lineWidth = 4.5;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.strokeStyle = '#34D399';
          ctx.lineWidth = 1.9;
          ctx.stroke();
        } else {
          // Stationary CRT electron beam dot when paused or near-silent
          ctx.fillStyle = isPlaying ? '#34D399' : '#F3F1EC';
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#34D399';
        ctx.fillText('X/Y VECTORSCOPE', 10, 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = isPlaying ? '#34D399' : 'rgba(148, 163, 184, 0.85)';
        ctx.fillText(isPlaying ? `CORR ${corrStr}` : 'STANDBY', w - 10, 10);
      }

      ctx.restore();

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
  }, [engine, isPlaying, scopeMode]);

  const isSlowBreath = frequencyHz > 0 && frequencyHz <= 1.5;
  const isMusicOnly = layerMode === 'music_only';
  const ch2WindowLabel = isSlowBreath ? '5.0s' : '750 ms';

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-[#080B0A] p-4 sm:p-5 shadow-[0_0_32px_rgba(16,185,129,0.07),inset_0_1px_0_rgba(52,211,153,0.14)] space-y-3">
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
            {isMusicOnly ? ' (Bypassed · 0%)' : depth > 0 ? ` (${Math.round(depth * 100)}% depth)` : ''} · {carrierLabel} · A={tuningA4Hz} Hz
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

      {/* Dual-Mode HiDPI Lab Oscilloscope Canvas */}
      <canvas
        ref={canvasRef}
        width={640}
        height={192}
        className="h-44 sm:h-52 w-full rounded-xl border border-emerald-400/25 bg-[#030706]"
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
              <span className={`h-2 w-2 rounded-full ${isMusicOnly ? 'bg-[#94A3B8]' : 'bg-[#FBBF24]'}`} />
              {isMusicOnly ? `CH2 Raw Dynamics (${ch2WindowLabel})` : `CH2 Measured RMS Envelope (${ch2WindowLabel})`}
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
