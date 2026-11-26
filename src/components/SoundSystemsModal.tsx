import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Cpu,
  Headphones,
  Radio,
  ShieldCheck,
  Sparkles,
  Waves,
  X,
} from 'lucide-react';
import { api } from '../lib/api';

export type SoundSystemProductCode =
  | 'earbuds_01_usb_c'
  | 'earbuds_pro_hrv'
  | 'sound_system_01';

interface SoundSystemsModalProps {
  profileId?: string;
  onClose: () => void;
}

const HARDWARE_LINEUP: Array<{
  code: SoundSystemProductCode;
  series: string;
  name: string;
  badge: string;
  specLine: string;
  description: string;
}> = [
  {
    code: 'earbuds_01_usb_c',
    series: 'DROP 01 · REFERENCE IEM',
    name: 'NootropicFM Earbuds 01 (Lossless USB-C)',
    badge: 'First Batch · Includes 1 Yr Pro',
    specLine: '24-bit / 48 kHz Integrated DAC · 0.0° Phase Smear · Memory-Seal Tips',
    description:
      'Zero Bluetooth compression and zero consumer V-curve bass bloat. Engineered specifically so -20 dB 40 Hz Gamma bursts and 6 Hz Theta envelopes reach the eardrum intact.',
  },
  {
    code: 'earbuds_pro_hrv',
    series: 'DROP 02 · CLOSED-LOOP BIOMETRIC',
    name: 'NootropicFM Earbuds Pro (In-Ear HRV)',
    badge: 'R&D Prototype',
    specLine: 'Concha Optical PPG Sensor · Live RMSSD Biofeedback · Neural-Safe Passive Seal',
    description:
      'Streams real-time heart-rate variability directly from your ear canal into the NootropicFM engine, automatically adapting modulation Hz to your nervous system.',
  },
  {
    code: 'sound_system_01',
    series: 'DROP 03 · ARCHITECTURAL AUDIO',
    name: 'NootropicFM Sound System 01',
    badge: 'Future Concept',
    specLine: 'Nearfield Crosstalk-Canceled Array · Warm Circadian Amber/Daylight Optics',
    description:
      'Precision desk and bedside acoustic instrument pairing phase-aligned nearfield drivers with automatic Daylight & Nocturnal circadian calibration.',
  },
];

export function SoundSystemsModal({ profileId, onClose }: SoundSystemsModalProps) {
  const [selectedProduct, setSelectedProduct] =
    useState<SoundSystemProductCode>('earbuds_01_usb_c');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservedQueue, setReservedQueue] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError('Please enter a valid email address to reserve your Founding Batch spot.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.joinHardwareWaitlist({
        email: cleanEmail,
        productCode: selectedProduct,
        profileId,
      });
      setReservedQueue(res.queueNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join waitlist right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage my-auto w-full max-w-2xl rounded-2xl p-5 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-0.5 font-mono-tech text-[10px] font-bold uppercase tracking-[0.16em] text-[#34D399]">
              <Radio className="h-3 w-3" />
              NootropicFM Sound Systems · Acoustic Hardware Lab
            </div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-[#F3F1EC] sm:text-2xl">
              Why NootropicFM Is Engineered Exclusively for In-Ear Buds
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8E8E88] transition hover:bg-white/10 hover:text-[#F3F1EC]"
            aria-label="Close Sound Systems modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 3 Laws of In-Ear Entrainment */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 space-y-1.5">
            <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
              <Headphones className="h-3.5 w-3.5" />
              1. Zero Crosstalk
            </div>
            <p className="text-[11px] leading-relaxed text-[#A3A39E]">
              Laptop &amp; room speakers leak Left into Right (~0.3 ms delay), canceling brainstem
              dichotic phase-locking and stereo spatial orbits.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 space-y-1.5">
            <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
              <Waves className="h-3.5 w-3.5" />
              2. Sealed Ear Canal
            </div>
            <p className="text-[11px] leading-relaxed text-[#A3A39E]">
              Silicone or foam eartips create a sealed pressure chamber, Coupling 6×40 Hz sub-harmonics
              directly to the tympanic membrane.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5 space-y-1.5">
            <div className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
              <Cpu className="h-3.5 w-3.5" />
              3. Pure Unmasked Signal
            </div>
            <p className="text-[11px] leading-relaxed text-[#A3A39E]">
              Mass-market Bluetooth buds apply V-curve bass EQ &amp; lossy psychoacoustic masking that
              smears subtle -20 dB neural envelopes.
            </p>
          </div>
        </div>

        {/* Hardware Lineup */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#F3F1EC]">
              Upcoming Hardware Ecosystem · Select to Reserve Priority Access:
            </span>
            <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#34D399]">
              Founding Waitlist
            </span>
          </div>

          <div className="space-y-2">
            {HARDWARE_LINEUP.map((item) => {
              const active = selectedProduct === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setSelectedProduct(item.code);
                    setReservedQueue(null);
                  }}
                  className={`w-full rounded-xl border p-3.5 text-left transition-all ${
                    active
                      ? 'border-emerald-400/65 bg-emerald-500/[0.09] text-[#F3F1EC]'
                      : 'border-white/10 bg-[#121417] text-[#D4D4CE] hover:border-white/25'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tech text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
                        {item.series}
                      </span>
                      <span className="rounded border border-white/12 bg-[#0B0C0E] px-2 py-0.5 font-mono-tech text-[9.5px] text-[#D4D4CE]">
                        {item.badge}
                      </span>
                    </div>
                    {active && (
                      <span className="inline-flex items-center gap-1 font-mono-tech text-[10px] font-bold text-[#34D399]">
                        <Check className="h-3 w-3" /> Selected
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[#F3F1EC]">{item.name}</div>
                  <div className="mt-0.5 font-mono-tech text-[10.5px] text-[#34D399]">
                    {item.specLine}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#A3A39E]">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Waitlist Form */}
        {reservedQueue !== null ? (
          <div className="animate-rise flex items-center justify-between gap-3 rounded-xl border border-emerald-400/45 bg-emerald-500/12 px-4 py-3.5 text-xs text-[#F3F1EC]">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[#34D399]" />
              <div>
                <div className="font-semibold text-[#F3F1EC]">
                  Founding Batch Spot #{String(reservedQueue).padStart(4, '0')} Reserved
                </div>
                <div className="text-[11px] text-[#A3A39E]">
                  We&apos;ll notify <strong>{email.trim()}</strong> first when{' '}
                  {HARDWARE_LINEUP.find((h) => h.code === selectedProduct)?.name} opens for private
                  studio orders.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2.5 border-t border-white/10 pt-3.5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email for Founding Batch early access..."
                className="flex-1 rounded-xl border border-white/15 bg-[#0B0C0E] px-3.5 py-3 text-xs text-[#F3F1EC] placeholder-[#6E6E68] focus:border-emerald-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="btn-aurora inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-5 py-3 text-xs font-semibold disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {submitting ? 'Reserving...' : 'Join Hardware Waitlist'}
              </button>
            </div>
            {error && <p className="text-xs font-medium text-rose-300">{error}</p>}
            <p className="flex items-center gap-1.5 text-[10.5px] text-[#7E7E78]">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
              Zero spam — one private invite when Batch 01 acoustic units are ready. Until then, use
              your best sealed in-ear buds.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
