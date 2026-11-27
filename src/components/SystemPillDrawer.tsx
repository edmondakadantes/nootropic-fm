import { useEffect } from 'react';
import {
  CheckCircle2,
  Crown,
  Download,
  Fingerprint,
  Headphones,
  KeyRound,
  LogOut,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { formatProfileSummary, type UserProfile } from '../../shared/types';
import type { CircadianPreference } from '../lib/circadianTheme';
import { isNativePlayStoreApp } from '../lib/platform';
import type { PrivacyResolution } from '../lib/privacyGuard';
import { NeuralPassCard } from './NeuralFingerprintPass';

interface SystemPillDrawerProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  syncCode: string | null;
  privacy: PrivacyResolution;
  hugginsVerified: boolean;
  circadianPref: CircadianPreference;
  onSetCircadianPref: (pref: CircadianPreference) => void;
  restoreInput: string;
  onRestoreInputChange: (val: string) => void;
  restoring: boolean;
  onRestoreIdentity: () => void;
  identityStatus: { kind: 'ok' | 'err'; msg: string } | null;
  onEditProfile: () => void;
  onSwitchIdentity: () => void;
  onOpenHugginsCheck: () => void;
  onOpenSoundSystems: () => void;
  onOpenProModal: () => void;
  onExportLocalJson: () => void;
  onOpenPrivacyModal: () => void;
  onDeleteAllData: () => void;
  deletingData: boolean;
}

export function SystemPillDrawer({
  open,
  onClose,
  profile,
  syncCode,
  privacy,
  hugginsVerified,
  circadianPref,
  onSetCircadianPref,
  restoreInput,
  onRestoreInputChange,
  restoring,
  onRestoreIdentity,
  identityStatus,
  onEditProfile,
  onSwitchIdentity,
  onOpenHugginsCheck,
  onOpenSoundSystems,
  onOpenProModal,
  onExportLocalJson,
  onOpenPrivacyModal,
  onDeleteAllData,
  deletingData,
}: SystemPillDrawerProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isPro = profile?.planTier === 'pro';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/80 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="System, Sync & Privacy Controls"
        data-testid="system-pill-drawer"
        className="animate-step glass-stage w-full max-w-lg rounded-t-3xl p-5 sm:my-auto sm:rounded-2xl sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[#34D399]">
            <Fingerprint className="h-5 w-5" />
            <div>
              <h2 className="text-base font-semibold text-[#F3F1EC]">
                System, Sync Pass &amp; Privacy
              </h2>
              <p className="text-[11px] text-[#8E8E88]">
                {privacy.ephemeralMode
                  ? 'Local-Only Mode · Zero cloud writes or retention beacons'
                  : `Synced Neural Identity · ${formatProfileSummary(profile!)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close System drawer"
            className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/[0.06] hover:text-[#F3F1EC]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Privacy State Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 font-mono-tech text-[10px] font-semibold text-[#34D399]">
            <ShieldCheck className="h-3 w-3" />
            {privacy.statusLabel}
          </span>
          {privacy.gpcDetected && (
            <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2.5 py-1 font-mono-tech text-[10px] font-semibold text-amber-200">
              GPC Signal Honored
            </span>
          )}
          {privacy.regionOptInRequired && (
            <span className="rounded-full border border-white/12 bg-[#131518] px-2.5 py-1 font-mono-tech text-[10px] text-[#A3A39E]">
              EEA/UK Opt-In Safe
            </span>
          )}
        </div>

        {/* Section 1: Neural Pass & Sync Key */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5">
          {profile ? (
            <div className="space-y-3">
              <NeuralPassCard profile={profile} syncCode={syncCode} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEditProfile();
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-3 py-2.5 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-[#34D399]" />
                  Edit Profile Details
                </button>
                <button
                  type="button"
                  onClick={onSwitchIdentity}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-3 py-2.5 text-xs font-medium text-[#D4D4CE] transition hover:border-amber-400/45 hover:text-amber-200"
                >
                  <LogOut className="h-3.5 w-3.5 text-amber-300" />
                  Switch Person / Local-Only
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-xs font-semibold text-[#F3F1EC]">
                  Optional Personal N-of-1 Self-Study
                </div>
                <p className="text-[11px] leading-relaxed text-[#A3A39E]">
                  Studio runs 100% locally without an account. Add age &amp; role priors anytime to
                  unlock 25% blinded Sham benchmarking &amp; QR Sync Pass.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditProfile();
                }}
                className="btn-aurora shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold"
              >
                Create Sync Pass
              </button>
            </div>
          )}

          <div className="space-y-1.5 border-t border-white/[0.08] pt-3">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
              <KeyRound className="h-3.5 w-3.5 text-[#34D399]" />
              <span>Restore Neural Pass via Sync Key</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={restoreInput}
                onChange={(e) => onRestoreInputChange(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRestoreIdentity();
                }}
                placeholder="NFM-XXXX-XXXX"
                className="font-mono-tech flex-1 rounded-xl border border-white/15 bg-[#131518] px-3 py-2 text-xs uppercase tracking-wider text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={restoring || !restoreInput.trim()}
                onClick={onRestoreIdentity}
                className="btn-aurora rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {restoring ? 'Syncing...' : 'Restore'}
              </button>
            </div>
            {identityStatus && (
              <div
                className={`rounded-xl border px-3 py-2 text-xs ${
                  identityStatus.kind === 'ok'
                    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-400/35 bg-rose-500/10 text-rose-200'
                }`}
              >
                {identityStatus.msg}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Circadian Appearance */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5">
          <div>
            <div className="text-xs font-semibold text-[#F3F1EC]">Circadian Appearance</div>
            <div className="text-[11px] text-[#8E8E88]">
              Night gently rolls off &gt;3.2 kHz (-2.8 dB silk filter)
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-white/12 bg-[#131518] p-0.5 text-[11px] font-semibold">
            {(
              [
                { id: 'auto', label: 'Auto', icon: Sparkles },
                { id: 'daylight', label: 'Daylight', icon: Sun },
                { id: 'night', label: 'Night', icon: Moon },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSetCircadianPref(id)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition ${
                  circadianPref === id
                    ? 'bg-emerald-500/15 text-[#34D399]'
                    : 'text-[#8E8E88] hover:text-[#F3F1EC]'
                }`}
              >
                <Icon className="h-3 w-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Section 3: Audio & Hardware */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenHugginsCheck();
            }}
            className="flex items-center justify-between gap-2 rounded-xl border border-white/12 bg-[#131518] px-3.5 py-3 text-left text-xs font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50"
          >
            <span className="inline-flex items-center gap-2">
              <CheckCircle2
                className={`h-4 w-4 ${hugginsVerified ? 'text-[#34D399]' : 'text-[#8E8E88]'}`}
              />
              <span>600 Hz Earbud Seal</span>
            </span>
            <span className="font-mono-tech text-[10px] text-[#34D399]">
              {hugginsVerified ? 'Verified' : 'Test 35s'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSoundSystems();
            }}
            className="flex items-center justify-between gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] px-3.5 py-3 text-left text-xs font-semibold text-[#34D399] transition hover:border-emerald-400/60"
          >
            <span className="inline-flex items-center gap-2">
              <Headphones className="h-4 w-4" />
              <span>Sound Systems · Earbuds Pro</span>
            </span>
            <span className="font-mono-tech text-[10px]">$249</span>
          </button>
        </div>

        {/* Section 4: Membership & Data Sovereignty */}
        <div className="space-y-2 rounded-xl border border-white/10 bg-[#0B0C0E] p-3.5">
          {!isNativePlayStoreApp() && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenProModal();
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-amber-400/35 bg-amber-400/10 px-3.5 py-2.5 text-left text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20"
            >
              <span className="inline-flex items-center gap-2">
                <Crown className="h-4 w-4 shrink-0" />
                <span>
                  {isPro ? 'NootropicFM Pro Active (Unlimited)' : 'Unlock Pro · 7-Day Free Trial ($59/yr)'}
                </span>
              </span>
              <span>→</span>
            </button>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onExportLocalJson}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-3 py-2 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC]"
            >
              <Download className="h-3.5 w-3.5 text-[#34D399]" />
              Export Local JSON
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPrivacyModal();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#141518] px-3 py-2 text-xs font-medium text-[#D4D4CE] transition hover:border-white/25 hover:text-[#F3F1EC]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#34D399]" />
              Privacy &amp; Departments
            </button>
          </div>

          <button
            type="button"
            disabled={deletingData}
            onClick={onDeleteAllData}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/12 px-4 py-2.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deletingData ? 'Erasing data...' : 'Delete My Identity & All Data (18+)'}
          </button>
        </div>
      </div>
    </div>
  );
}
