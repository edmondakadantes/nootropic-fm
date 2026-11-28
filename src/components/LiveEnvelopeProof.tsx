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
  themeMode?: 'daylight' | 'night';
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
  themeMode = 'night',
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
    themeMode,
  });
  livePropsRef.current = {
    entrainmentType,
    frequencyHz,
    depth,
    layerMode,
    isPureWave,
    themeMode,
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
        themeMode: curThemeMode,
      } = livePropsRef.current;
      const isDay = curThemeMode === 'daylight';
      const slowBreath = curFreqHz > 0 && curFreqHz <= 1.5;
      const isMusicBypassed = curLayerMode === 'music_only';
      const isIsolated = curPureWave || curLayerMode === 'science_only';

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // CRT surface (Night) or Crisp Lab Strip-Chart Surface (Daylight)
      ctx.fillStyle = isDay ? '#F4F8FB' : '#030706';
      ctx.fillRect(0, 0, w, h);
      const bgGlow = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.65);
      bgGlow.addColorStop(0, isDay ? 'rgba(4, 120, 87, 0.045)' : 'rgba(52, 211, 153, 0.05)');
      bgGlow.addColorStop(1, isDay ? 'rgba(244, 248, 251, 0)' : 'rgba(3, 7, 6, 0)');
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
        // Laboratory graticule grid (8 vertical x 4 horizontal divisions)
        ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.13)' : 'rgba(52, 211, 153, 0.14)';
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
        ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.28)' : 'rgba(52, 211, 153, 0.24)';
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
        ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.26)' : 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.moveTo(0, divY);
        ctx.lineTo(w, divY);
        ctx.stroke();
        ctx.restore();

        // Lower Lane (CH2 Measured Cortical Envelope): 57% .. 100% height
        const ch2BaseY = h - 8;
        const ch2SpanH = h * 0.36;

        const ch1Core = isDay ? '#047857' : '#34D399';
        const ch1Halo = isDay ? 'rgba(4, 120, 87, 0.18)' : 'rgba(52, 211, 153, 0.26)';
        const ch2Core = isMusicBypassed
          ? isDay
            ? '#64748B'
            : '#94A3B8'
          : isDay
            ? '#0369A1'
            : '#FBBF24';
        const ch2Halo = isMusicBypassed
          ? isDay
            ? 'rgba(100, 116, 139, 0.16)'
            : 'rgba(148, 163, 184, 0.16)'
          : isDay
            ? 'rgba(3, 105, 161, 0.18)'
            : 'rgba(251, 191, 36, 0.24)';

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

          // TRACE 1 (Emerald): Outer halo + crisp core beam
          ctx.beginPath();
          for (let i = 0; i < displaySamples; i++) {
            const x = (i / (displaySamples - 1)) * w;
            const v = Math.max(-1, Math.min(1, waveBuf[triggerIdx + i] * visualGain));
            const y = ch1MidY - v * (h * 0.2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = ch1Halo;
          ctx.lineWidth = 5;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.strokeStyle = ch1Core;
          ctx.lineWidth = 2.1;
          ctx.stroke();

          // TRACE 2 (Cobalt Blue in Daylight / Tungsten Amber in Night / Slate on Bypass)
          let maxEnv = 0.025;
          for (let i = 0; i < envHistoryLen; i++) {
            if (envHistory[i] > maxEnv) maxEnv = envHistory[i];
          }
          const envScale = Math.max(0.025, maxEnv * 1.12);

          // Subtle filled envelope area under CH2 trace
          const envGrad = ctx.createLinearGradient(0, ch2BaseY - ch2SpanH, 0, ch2BaseY);
          if (isMusicBypassed) {
            envGrad.addColorStop(0, isDay ? 'rgba(100, 116, 139, 0.14)' : 'rgba(148, 163, 184, 0.08)');
            envGrad.addColorStop(1, isDay ? 'rgba(100, 116, 139, 0.01)' : 'rgba(148, 163, 184, 0.01)');
          } else if (isDay) {
            envGrad.addColorStop(0, 'rgba(3, 105, 161, 0.16)');
            envGrad.addColorStop(1, 'rgba(3, 105, 161, 0.01)');
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
          ctx.strokeStyle = ch2Halo;
          ctx.lineWidth = 4.5;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.strokeStyle = ch2Core;
          ctx.lineWidth = 2.1;
          ctx.stroke();

          ctx.lineTo(w, ch2BaseY);
          ctx.lineTo(0, ch2BaseY);
          ctx.closePath();
          ctx.fillStyle = envGrad;
          ctx.fill();
        } else {
          // Steady standby zero lines when paused
          ctx.strokeStyle = isDay ? 'rgba(4, 120, 87, 0.55)' : 'rgba(52, 211, 153, 0.35)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(0, ch1MidY);
          ctx.lineTo(w, ch1MidY);
          ctx.stroke();

          ctx.strokeStyle = isDay ? 'rgba(3, 105, 161, 0.48)' : 'rgba(251, 191, 36, 0.28)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, ch2BaseY);
          ctx.lineTo(w, ch2BaseY);
          ctx.stroke();
        }

        // In-Screen HUD Overlay Labels
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = ch1Core;
        ctx.fillText('CH1 WAVEFORM', 10, 10);

        ctx.fillStyle = ch2Core;
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
          ctx.fillStyle = isDay ? '#475569' : 'rgba(148, 163, 184, 0.85)';
        } else if (isMusicBypassed) {
          statusHud = 'SCIENCE BYPASSED · 0%';
          ctx.fillStyle = isDay ? '#475569' : '#94A3B8';
        } else if (isIsolated) {
          statusHud = `SCIENCE ISOLATED · ${curFreqHz > 0 ? `${curFreqHz} HZ · ` : ''}${Math.round(curDepth * 100)}%`;
          ctx.fillStyle = isDay ? '#0369A1' : '#FBBF24';
        } else {
          statusHud = `${curFreqHz > 0 ? `${curFreqHz} HZ · ` : ''}${Math.round(curDepth * 100)}% DEPTH`;
          ctx.fillStyle = ch1Core;
        }
        ctx.fillText(statusHud, w - 10, 10);
      } else {
        // X/Y LISSAJOUS STEREOPHONIC VECTORSCOPE
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.42;

        ctx.strokeStyle = isDay ? 'rgba(15, 23, 42, 0.16)' : 'rgba(52, 211, 153, 0.17)';
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
        ctx.fillStyle = isDay ? '#475569' : 'rgba(163, 163, 158, 0.78)';
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
          ctx.strokeStyle = isDay ? 'rgba(4, 120, 87, 0.22)' : 'rgba(52, 211, 153, 0.24)';
          ctx.lineWidth = 4.5;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.strokeStyle = isDay ? '#047857' : '#34D399';
          ctx.lineWidth = 1.9;
          ctx.stroke();
        } else {
          // Stationary electron beam dot when paused or near-silent
          ctx.fillStyle = isPlaying
            ? isDay
              ? '#047857'
              : '#34D399'
            : isDay
              ? '#0F172A'
              : '#F3F1EC';
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = isDay ? '#047857' : '#34D399';
        ctx.fillText('X/Y VECTORSCOPE', 10, 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = isPlaying
          ? isDay
            ? '#047857'
            : '#34D399'
          : isDay
            ? '#475569'
            : 'rgba(148, 163, 184, 0.85)';
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
  }, [engine, isPlaying, scopeMode, themeMode]);

  const isDay = themeMode === 'daylight';
  const isSlowBreath = frequencyHz > 0 && frequencyHz <= 1.5;
  const isMusicOnly = layerMode === 'music_only';
  const ch2WindowLabel = isSlowBreath ? '5.0s' : '750 ms';

  const subtitleLine = `${ENTRAINMENT_LABELS[entrainmentType]}${
    frequencyHz > 0 ? ` · ${frequencyHz} Hz` : ''
  }${isMusicOnly ? ' (Bypassed · 0%)' : depth > 0 ? ` (${Math.round(depth * 100)}% depth)` : ''} · ${carrierLabel} · A=${tuningA4Hz} Hz`;

  return (
    <div
      className={
        isDay
          ? 'rounded-2xl border border-slate-200/90 bg-[#F8FAFC] p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3'
          : 'rounded-2xl border border-emerald-400/30 bg-[#080B0A] p-4 sm:p-5 shadow-[0_0_32px_rgba(16,185,129,0.07),inset_0_1px_0_rgba(52,211,153,0.14)] space-y-3'
      }
    >
      {/* Scope Header + Y(t) / X-Y Toggle + 1-Tap Pure Signal Audition (zero CLS across narrow mobile viewports) */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 font-mono-tech text-[10px]">
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold uppercase tracking-wider text-[#F3F1EC]">
              <Activity className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
              Oscilloscope · {scopeMode === 'dual_trace' ? 'Dual Trace' : 'X/Y Vector'}
            </span>
            <span className="whitespace-nowrap rounded border border-emerald-400/35 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#34D399]">
              Live Measured
            </span>
          </div>
          <div
            title={subtitleLine}
            className="truncate whitespace-nowrap font-mono-tech text-[10px] tabular-nums text-[#8E8E88]"
          >
            {subtitleLine}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-1.5 sm:justify-end">
          <div className="inline-flex shrink-0 rounded-lg border border-white/12 bg-[#141518] p-0.5 font-mono-tech text-[10px]">
            <button
              type="button"
              onClick={() => setScopeMode('dual_trace')}
              className={`whitespace-nowrap rounded-md px-2 py-1 font-semibold ${
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
              className={`whitespace-nowrap rounded-md px-2 py-1 font-semibold ${
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
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                isPureWave
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-white/15 bg-[#16181C] text-[#F3F1EC] hover:border-emerald-400/50 hover:bg-[#1B1E24]'
              }`}
            >
              {isPureWave ? <Radio className="h-3 w-3 shrink-0" /> : <Waves className="h-3 w-3 shrink-0 text-[#34D399]" />}
              {isPureWave ? 'Back to Mix' : 'Isolate Pure Wave'}
            </button>
          )}
        </div>
      </div>

      {/* Dual-Mode HiDPI Lab Oscilloscope Canvas */}
      <canvas
        ref={canvasRef}
        width={640}
        height={192}
        className={`h-44 sm:h-52 w-full rounded-xl border ${
          isDay ? 'border-slate-200 bg-[#F4F8FB]' : 'border-emerald-400/25 bg-[#030706]'
        }`}
      />

      {/* Fixed Single-Line Legend + Fixed 4-Column Hardware Readouts (0 px vertical shift on digit updates) */}
      <div className="space-y-1.5">
        <div className="flex h-4 items-center gap-3 overflow-hidden whitespace-nowrap font-mono-tech text-[10px] tabular-nums text-[#8E8E88]">
          {scopeMode === 'dual_trace' ? (
            <>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${isDay ? 'bg-[#047857]' : 'bg-[#34D399]'}`} />
                <span>
                  CH1<span className="hidden sm:inline"> Waveform</span> ({readout.windowMs} ms)
                </span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    isMusicOnly
                      ? isDay
                        ? 'bg-[#64748B]'
                        : 'bg-[#94A3B8]'
                      : isDay
                        ? 'bg-[#0369A1]'
                        : 'bg-[#FBBF24]'
                  }`}
                />
                <span className="truncate">
                  {isMusicOnly ? (
                    <>
                      CH2 Raw<span className="hidden sm:inline"> Dynamics</span> ({ch2WindowLabel})
                    </>
                  ) : (
                    <>
                      CH2<span className="hidden sm:inline"> Measured RMS</span> Env ({ch2WindowLabel})
                    </>
                  )}
                </span>
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 truncate">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#34D399]" />
              <span>
                CH1 L / CH2 R Vector · Corr{' '}
                <strong className="text-[#F3F1EC]">{readout.stereoCorr}</strong>
              </span>
            </span>
          )}
        </div>

        <div
          className={`grid grid-cols-4 gap-1 rounded-lg border px-2.5 py-1.5 font-mono-tech text-[10px] tabular-nums ${
            isDay
              ? 'border-slate-200 bg-white text-[#1E293B]'
              : 'border-white/[0.06] bg-[#050706] text-[#D4D4CE]'
          }`}
        >
          <span className="truncate text-left">{readout.sampleRateKhz} kHz</span>
          <span className="truncate text-center">RMS {readout.rmsDbfs}</span>
          <span className="truncate text-center">PK {readout.peakDbfs}</span>
          <span className="truncate text-right text-[#34D399]">
            {readout.peakHz !== null ? `${readout.peakHz} Hz` : '-- Hz'}
          </span>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-[#8E8E88]">
        Tap <strong className="text-[#D4D4CE]">Isolate Pure Wave</strong> anytime to mute background
        music and verify the exact frequency with any external oscilloscope or spectrum analyzer
        (e.g. Audacity, Spectroid).
      </p>
    </div>
  );
}
