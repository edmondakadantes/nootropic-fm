import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Pause,
  Play,
  ShieldAlert,
  Sliders,
  Volume2,
  Waves,
} from 'lucide-react';
import type { LiveAdjustment, ProtocolRecommendation } from '../../shared/types';
import { DEVICE_LABELS_RO, STATE_LABELS_RO, TARGET_LABELS_RO } from '../../shared/types';
import { PsychoacousticEngine, type EngineTelemetry } from '../audio/PsychoacousticEngine';
import { api } from '../lib/api';
import { NeuralVisualizer } from './NeuralVisualizer';

interface PlayerViewProps {
  recommendation: ProtocolRecommendation;
  onFinishToDebrief: (stats: {
    actualDurationSec: number;
    liveAdjustments: LiveAdjustment[];
  }) => void;
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PlayerView({ recommendation, onFinishToDebrief }: PlayerViewProps) {
  const engineRef = useRef<PsychoacousticEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PsychoacousticEngine();
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [volume, setVolume] = useState(0.74);
  const [intensityMult, setIntensityMult] = useState(1.0);
  const [modMult, setModMult] = useState(1.0);
  const [adjustments, setAdjustments] = useState<LiveAdjustment[]>([]);
  const [telemetry, setTelemetry] = useState<EngineTelemetry>({
    phase: 'entry',
    phaseLabelRo: 'Aliniere & intrare (Principiul Iso)',
    progressRatio: 0,
    currentModHz: recommendation.params.modulationHz,
    currentModDepth: recommendation.params.modulationDepth,
    currentBpm: recommendation.params.bpm,
    antiMonotonyActive: false,
  });

  const plannedSec = recommendation.plannedDurationMin * 60;
  const elapsedRef = useRef(0);
  const adjustmentsRef = useRef<LiveAdjustment[]>([]);
  elapsedRef.current = elapsedSec;
  adjustmentsRef.current = adjustments;

  // Auto-start procedural Web Audio engine on mount (user just clicked Start!)
  useEffect(() => {
    let mounted = true;
    const startAudio = async () => {
      try {
        await engineRef.current?.start(
          recommendation.params,
          recommendation.plannedDurationMin,
          `${recommendation.arm.name} · ${TARGET_LABELS_RO[recommendation.targetState]}`
        );
        if (mounted) {
          setIsPlaying(true);
          setAudioStarted(true);
        }
      } catch {
        // Browser may require explicit click if autoplay restricted
        if (mounted) {
          setIsPlaying(false);
          setAudioStarted(false);
        }
      }
    };
    void startAudio();

    return () => {
      mounted = false;
      engineRef.current?.stop();
    };
  }, [recommendation]);

  // 1-second session timer + periodic telemetry sync to Worker D1
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        const tel = engineRef.current?.updateElapsed(next);
        if (tel) setTelemetry(tel);

        // Sync behavioral telemetry to D1 every 15s (survives browser close!)
        if (next > 0 && next % 15 === 0) {
          void api
            .saveProgress({
              sessionId: recommendation.sessionId,
              actualDurationSec: next,
              liveAdjustments: adjustmentsRef.current,
            })
            .catch(() => {});
        }

        if (next >= plannedSec) {
          window.clearInterval(id);
          engineRef.current?.stop();
          setIsPlaying(false);
          onFinishToDebrief({
            actualDurationSec: next,
            liveAdjustments: adjustmentsRef.current,
          });
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [isPlaying, plannedSec, recommendation.sessionId, onFinishToDebrief]);

  const togglePlay = async () => {
    if (!audioStarted) {
      await engineRef.current?.start(
        recommendation.params,
        recommendation.plannedDurationMin,
        recommendation.arm.name
      );
      setAudioStarted(true);
      setIsPlaying(true);
      return;
    }
    if (isPlaying) {
      await engineRef.current?.pause();
      setIsPlaying(false);
    } else {
      await engineRef.current?.resume();
      setIsPlaying(true);
    }
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    engineRef.current?.setVolume(v);
  };

  const tweakIntensity = (delta: number) => {
    const next = Number(Math.max(0.5, Math.min(1.5, intensityMult + delta)).toFixed(2));
    setIntensityMult(next);
    engineRef.current?.adjustIntensity(next);
    setAdjustments((prev) => [...prev, { atSec: elapsedRef.current, control: 'intensity', delta }]);
  };

  const tweakModulation = (delta: number) => {
    const next = Number(Math.max(0.3, Math.min(1.5, modMult + delta)).toFixed(2));
    setModMult(next);
    engineRef.current?.adjustModDepth(next);
    setAdjustments((prev) => [...prev, { atSec: elapsedRef.current, control: 'modulation', delta }]);
  };

  const handleEndSession = () => {
    engineRef.current?.stop();
    setIsPlaying(false);
    void api
      .saveProgress({
        sessionId: recommendation.sessionId,
        actualDurationSec: elapsedRef.current,
        liveAdjustments: adjustmentsRef.current,
      })
      .catch(() => {});
    onFinishToDebrief({
      actualDurationSec: elapsedRef.current,
      liveAdjustments: adjustmentsRef.current,
    });
  };

  const progressPct = Math.min(100, (elapsedSec / plannedSec) * 100);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Safety banner for Driving */}
      {recommendation.safetyMode && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/12 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-xs text-amber-100">
              <div className="font-semibold uppercase tracking-wide text-amber-300">
                Driving Safety Mode · Frecvențe de trafic protejate
              </div>
              {recommendation.safetyWarningsRo.map((w, idx) => (
                <p key={idx} className="leading-relaxed text-amber-100/90">
                  {w}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Live Studio Card */}
      <div className="glass-card rounded-2xl p-5 sm:p-7 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
                <Waves className="h-3 w-3" />
                {recommendation.arm.name}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                  recommendation.isExploration
                    ? 'border-purple-400/35 bg-purple-500/15 text-purple-200'
                    : 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                }`}
              >
                <FlaskConical className="h-3 w-3" />
                {recommendation.isExploration
                  ? 'Explorare controlată (Bandit)'
                  : `Exploatare optimă · ${recommendation.confidencePct}% scor`}
              </span>
            </div>
            <h1 className="mt-2.5 text-2xl font-bold text-white">
              {TARGET_LABELS_RO[recommendation.targetState]}
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Cohortă: <span className="text-slate-200">{recommendation.cohortLabelRo}</span> · Ieșire:{' '}
              <span className="text-slate-200">{DEVICE_LABELS_RO[recommendation.device]}</span> · Start:{' '}
              <span className="text-slate-200">
                {STATE_LABELS_RO[recommendation.currentState]} ({recommendation.baselineScore}/5)
              </span>
            </p>
          </div>

          <div className="text-right">
            <div className="font-mono-tech text-3xl font-bold tracking-tight text-white">
              {formatTimer(elapsedSec)}
            </div>
            <div className="font-mono-tech text-xs text-slate-400">
              din {recommendation.plannedDurationMin}:00 min
            </div>
          </div>
        </div>

        {/* Live 60fps Neural Waveform Visualizer */}
        <NeuralVisualizer
          engine={engineRef.current}
          isPlaying={isPlaying}
          safetyMode={recommendation.safetyMode}
          modulationHz={telemetry.currentModHz}
        />

        {/* Iso-Principle Session Progression Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-cyan-300">
              <Activity className="h-3.5 w-3.5" />
              Faza activă: {telemetry.phaseLabelRo}
              {telemetry.antiMonotonyActive && (
                <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                  Impuls anti-monotonie
                </span>
              )}
            </span>
            <span className="font-mono-tech text-slate-400">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-amber-300 transition-all duration-500"
              style={{ width: `${Math.max(2, progressPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>0% · Intrare (Iso)</span>
            <span>15% – 88% · Platou cognitiv</span>
            <span>100% · Revenire</span>
          </div>
        </div>

        {/* Play/Pause & Live Psychoacoustic Controls */}
        <div className="flex flex-col gap-4 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void togglePlay()}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:scale-105 hover:bg-cyan-300"
              aria-label={isPlaying ? 'Pauză' : 'Redă'}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6 fill-slate-950" />
              ) : (
                <Play className="h-6 w-6 translate-x-0.5 fill-slate-950" />
              )}
            </button>

            <div className="w-36 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Volume2 className="h-3.5 w-3.5" /> Volum
                </span>
                <span className="font-mono-tech">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => handleVolume(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
              <Sliders className="h-3.5 w-3.5" /> Ajustare live:
            </span>
            <button
              type="button"
              onClick={() => tweakIntensity(-0.15)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-400/50"
            >
              Mai calm
            </button>
            <button
              type="button"
              onClick={() => tweakIntensity(0.15)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-400/50"
            >
              Mai energic
            </button>
            <button
              type="button"
              onClick={() => tweakModulation(-0.2)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-indigo-400/50"
            >
              AM −
            </button>
            <button
              type="button"
              onClick={() => tweakModulation(0.2)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-indigo-400/50"
            >
              AM +
            </button>
          </div>
        </div>

        {/* Acoustic DNA Telemetry Grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Modulație AM</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-cyan-300">
              {telemetry.currentModHz} Hz
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Adâncime AM</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-indigo-300">
              {Math.round(telemetry.currentModDepth * 100)}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Puls ritmic</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-white">
              {telemetry.currentBpm > 0 ? `${telemetry.currentBpm} BPM` : 'Ambient'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Zgomot calibrat</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-slate-200">
              {recommendation.params.noiseColor} ({Math.round(recommendation.params.noiseLevel * 100)}%)
            </div>
          </div>
          <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:col-span-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Ajustări live</div>
            <div className="font-mono-tech mt-1 text-base font-semibold text-amber-300">
              {adjustments.length}
            </div>
          </div>
        </div>

        {/* Finish Session CTA -> Post-Session Debrief */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-800/80 pt-4 sm:flex-row">
          <p className="text-xs text-slate-400">
            Când termini (sau vrei să evaluezi acum), apasă butonul pentru debrief-ul de 10 secunde ca platforma să învețe.
          </p>
          <button
            type="button"
            onClick={handleEndSession}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300"
          >
            <CheckCircle2 className="h-4 w-4" />
            Încheie și oferă feedback (10s)
          </button>
        </div>
      </div>

      {/* Scientific Rationale & Verified Peer-Reviewed Literature */}
      <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 text-cyan-300">
          <BookOpen className="h-5 w-5" />
          <h2 className="text-base font-semibold text-white">
            De ce acest protocol? (Bază științifică verificată)
          </h2>
        </div>

        <p className="text-sm leading-relaxed text-slate-300">{recommendation.rationaleRo}</p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {recommendation.studies.map((study) => (
            <div
              key={study.id}
              className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold text-cyan-300">
                  {study.authors.split(',')[0]} et al. ({study.year}) · {study.journal}
                </div>
                <a
                  href={study.doiOrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-slate-400 hover:text-cyan-300"
                  title="Deschide studiul (DOI)"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <div className="text-xs font-medium text-white">{study.title}</div>
              <p className="text-xs leading-relaxed text-slate-400">{study.summaryRo}</p>
              <p className="text-[11px] text-amber-300/80">Limitare / Precauție: {study.caveatRo}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
