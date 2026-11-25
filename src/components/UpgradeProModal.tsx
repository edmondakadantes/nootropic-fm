import { useState } from 'react';
import {
  Check,
  CreditCard,
  Crown,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { UserProfile } from '../../shared/types';
import { api, saveStoredProfileAuth } from '../lib/api';
import { isNativePlayStoreApp } from '../lib/platform';

interface UpgradeProModalProps {
  profile: UserProfile | null;
  stripeAvailable: boolean;
  onProfileCreated?: (profile: UserProfile, syncCode?: string) => void;
  onClose: () => void;
}

const PRO_BENEFITS = [
  'Unlimited full sessions (15, 30, 45, 60 min with zero cutoffs)',
  'All 10 curated instrumental styles + Endless Stream (never repeats)',
  'Real-time oscilloscope proof (Y/t & X/Y Lissajous) & 1-tap Pure Wave isolation',
  'Full Science Study Lab + reaction-speed tracking & instant QR sync across devices',
];

export function UpgradeProModal({
  profile,
  stripeAvailable,
  onProfileCreated,
  onClose,
}: UpgradeProModalProps) {
  const [plan, setPlan] = useState<'annual' | 'monthly'>('annual');
  const [email, setEmail] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [unlockingKey, setUnlockingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPro = profile?.planTier === 'pro';
  const isPlayStore = isNativePlayStoreApp();

  const handleRedeemAccessKey = async () => {
    if (!accessKey.trim()) return;
    setError(null);
    setUnlockingKey(true);
    try {
      const res = await api.restoreIdentity(accessKey.trim());
      saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
      onProfileCreated?.(res.profile, res.syncCode);
      setAccessKey('');
      if (res.profile.planTier === 'pro') {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Sync / Access Key.');
    } finally {
      setUnlockingKey(false);
    }
  };

  const handleCheckout = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.createStripeCheckout({
        plan,
        profileId: profile?.id,
        email: email.trim() || undefined,
      });
      if (res.profile && res.profileToken) {
        saveStoredProfileAuth(res.profile.id, res.profileToken, res.syncCode);
        onProfileCreated?.(res.profile, res.syncCode);
      }
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Stripe Checkout right now.');
      setBusy(false);
    }
  };

  const handleManagePortal = async () => {
    if (!profile?.id) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.openStripePortal(profile.id);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open Stripe Billing Portal.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage my-auto w-full max-w-lg rounded-2xl border border-white/15 p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/brand/pro-checkout-banner.png"
              alt="nootropic.fm Pro"
              className="h-14 w-14 shrink-0 rounded-xl border border-white/15 object-cover"
            />
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 rounded border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 font-mono-tech text-[10px] font-bold uppercase tracking-wider text-amber-200">
                <Crown className="h-3 w-3" />
                {isPro ? 'Pro Membership Active' : 'nootropic.fm Pro'}
              </div>
              <h3 className="text-base font-semibold text-[#F3F1EC] sm:text-lg leading-tight">
                {isPro ? 'Your Pro Subscription Is Active' : 'Unlock Full Sessions & Endless Stream'}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8E8E88] hover:bg-white/[0.06] hover:text-[#F3F1EC]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isPro ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 p-4 space-y-1.5 text-xs text-emerald-100">
              <div className="flex items-center gap-2 font-semibold text-[#34D399]">
                <Check className="h-4 w-4" />
                All Pro features are unlocked on this profile
              </div>
              {profile?.proUntil && (
                <p className="text-[#D4D4CE]">
                  Active through:{' '}
                  <strong className="font-mono-tech text-[#F3F1EC]">
                    {new Date(profile.proUntil).toLocaleDateString()}
                  </strong>
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            {isPlayStore ? (
              <button
                type="button"
                onClick={() => {
                  if (window.NootropicNativeBridge?.openPlayStoreSubscriptions) {
                    window.NootropicNativeBridge.openPlayStoreSubscriptions();
                  } else {
                    window.open(
                      'https://play.google.com/store/account/subscriptions?package=fm.nootropic.app',
                      '_blank',
                      'noopener,noreferrer'
                    );
                  }
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#16181C] px-5 py-3.5 text-sm font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50"
              >
                <ExternalLink className="h-4 w-4" />
                Manage Google Play Subscriptions
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleManagePortal()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#16181C] px-5 py-3.5 text-sm font-semibold text-[#F3F1EC] transition hover:border-emerald-400/50 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Manage Billing or Cancel in Stripe
              </button>
            )}
          </div>
        ) : isPlayStore ? (
          <div className="space-y-4">
            <ul className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 text-xs text-[#D4D4CE]">
              {PRO_BENEFITS.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="rounded-xl border border-emerald-400/30 bg-[#0B0C0E] p-4 space-y-2.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3F1EC]">
                <KeyRound className="h-3.5 w-3.5 text-[#34D399]" />
                Sync Your Existing Neural Pass
              </div>
              <p className="text-[11px] leading-relaxed text-[#A3A39E]">
                Already have a Neural Sync Key? Enter your <code className="font-mono-tech text-[#34D399]">NFM-XXXX-XXXX</code> pass below to restore your profile and unlocked features on this Android device.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRedeemAccessKey();
                  }}
                  placeholder="NFM-XXXX-XXXX"
                  className="font-mono-tech flex-1 rounded-xl border border-white/15 bg-[#0A0B0C] px-3 py-2.5 text-xs uppercase tracking-wider text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={unlockingKey || !accessKey.trim()}
                  onClick={() => void handleRedeemAccessKey()}
                  className="btn-aurora rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  {unlockingKey ? 'Syncing...' : 'Sync Pass'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#121316] px-3.5 py-2.5 text-[11px] text-[#A3A39E]">
              Google Play In-App Subscriptions are rolling out on Android. Meanwhile, enjoy daily calibration sessions plus +30 bonus minutes each day when sharing your Neural Fingerprint card.
            </div>
          </div>
        ) : (
          <>
            {/* Plan Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPlan('annual')}
                className={`relative rounded-xl border p-4 text-left transition ${
                  plan === 'annual'
                    ? 'border-amber-400/70 bg-amber-400/10'
                    : 'border-white/10 bg-[#121316] hover:border-white/25'
                }`}
              >
                <span className="absolute -top-2.5 right-3 rounded bg-amber-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0A0B0C]">
                  7-Day Free Trial · Save 50%
                </span>
                <div className="text-xs font-semibold text-amber-200">Annual Studio Pass</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono-tech text-2xl font-bold text-[#F3F1EC]">$59</span>
                  <span className="text-xs text-[#8E8E88]">/ year</span>
                </div>
                <div className="mt-1 text-[11px] text-[#8E8E88]">$0.00 today · $4.92/mo after trial</div>
              </button>

              <button
                type="button"
                onClick={() => setPlan('monthly')}
                className={`rounded-xl border p-4 text-left transition ${
                  plan === 'monthly'
                    ? 'border-emerald-400/70 bg-emerald-400/10'
                    : 'border-white/10 bg-[#121316] hover:border-white/25'
                }`}
              >
                <div className="text-xs font-semibold text-[#34D399]">Monthly Pass</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono-tech text-2xl font-bold text-[#F3F1EC]">$9.99</span>
                  <span className="text-xs text-[#8E8E88]">/ month</span>
                </div>
                <div className="mt-1 text-[11px] text-[#8E8E88]">Cancel anytime in 1 click</div>
              </button>
            </div>

            {plan === 'annual' && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 font-mono-tech text-[10px] text-amber-100">
                <span>Today: $0.00</span>
                <span className="text-[#8E8E88]">→</span>
                <span>Day 5: Reminder email</span>
                <span className="text-[#8E8E88]">→</span>
                <span>Day 7: $59/yr (cancel anytime)</span>
              </div>
            )}

            {/* Benefits */}
            <ul className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0B0C0E] p-4 text-xs text-[#D4D4CE]">
              {PRO_BENEFITS.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            {/* Optional receipt email */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#A3A39E]">
                Email for receipt &amp; invoice (optional, Stripe also collects it securely)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-white/15 bg-[#0B0C0E] px-3 py-2.5 text-xs text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
              />
            </div>

            {!stripeAvailable && (
              <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                Stripe Checkout is ready on the server and will activate immediately once your Stripe
                key is added.
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={busy || !stripeAvailable}
              onClick={() => void handleCheckout()}
              className="btn-aurora flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              {busy
                ? 'Opening Secure Stripe Checkout...'
                : plan === 'annual'
                  ? 'Start 7-Day Free Trial · Then $59/yr'
                  : 'Continue to Stripe · $9.99/month'}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#8E8E88]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#34D399]" />
              <span>Secured by Stripe · Tax included · Cancel anytime · Promo codes supported</span>
            </div>

            {/* Direct Sync / Access Key Unlock */}
            <div className="space-y-2 border-t border-white/[0.08] pt-3.5">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#D4D4CE]">
                <KeyRound className="h-3 w-3 text-[#34D399]" />
                Have a Pro / Lifetime Sync Key?
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRedeemAccessKey();
                  }}
                  placeholder="NFM-XXXX-XXXX"
                  className="font-mono-tech flex-1 rounded-xl border border-white/15 bg-[#0A0B0C] px-3 py-2 text-xs uppercase tracking-wider text-[#F3F1EC] placeholder-[#5F605C] focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={unlockingKey || !accessKey.trim()}
                  onClick={() => void handleRedeemAccessKey()}
                  className="rounded-xl border border-emerald-400/45 bg-emerald-500/15 px-4 py-2 text-xs font-semibold text-[#34D399] transition hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  {unlockingKey ? 'Unlocking...' : 'Unlock'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
