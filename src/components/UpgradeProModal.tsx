import { useState } from 'react';
import {
  Check,
  CreditCard,
  Crown,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { UserProfile } from '../../shared/types';
import { api, saveStoredProfileAuth } from '../lib/api';

interface UpgradeProModalProps {
  profile: UserProfile | null;
  stripeAvailable: boolean;
  onProfileCreated?: (profile: UserProfile, syncCode?: string) => void;
  onClose: () => void;
}

const PRO_BENEFITS = [
  'Unlimited custom music styles (Reggae, Rock, Jazz, Classical — anything you type)',
  'Live real-time AI music streaming tuned to your mood & pace',
  'Full access to all Science Studies & custom study builder',
  'Personal reaction-speed progress & instant QR sync across phone and laptop',
];

export function UpgradeProModal({
  profile,
  stripeAvailable,
  onProfileCreated,
  onClose,
}: UpgradeProModalProps) {
  const [plan, setPlan] = useState<'annual' | 'monthly'>('annual');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPro = profile?.planTier === 'pro';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md">
      <div className="animate-step glass-stage my-auto w-full max-w-lg rounded-3xl border border-amber-400/35 p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/12 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
              <Crown className="h-3 w-3" />
              {isPro ? 'Pro Membership Active' : 'nootropic.fm Pro'}
            </div>
            <h3 className="text-lg font-bold text-white sm:text-xl">
              {isPro ? 'Your Pro Subscription Is Active' : 'Unlock Any Music Style & Full Science Lab'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isPro ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-4 space-y-1.5 text-xs text-emerald-100">
              <div className="flex items-center gap-2 font-bold text-emerald-200">
                <Sparkles className="h-4 w-4" />
                All Pro features are unlocked on this profile
              </div>
              {profile?.proUntil && (
                <p className="text-slate-300">
                  Active through:{' '}
                  <strong className="font-mono-tech text-white">
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

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleManagePortal()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/45 bg-cyan-400/15 px-5 py-3.5 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              Manage Billing or Cancel in Stripe
            </button>
          </div>
        ) : (
          <>
            {/* Plan Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPlan('annual')}
                className={`relative rounded-2xl border p-4 text-left transition ${
                  plan === 'annual'
                    ? 'border-amber-400 bg-amber-400/12 shadow-[0_0_24px_rgba(251,191,36,0.18)]'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                }`}
              >
                <span className="absolute -top-2.5 right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950">
                  Save 50%
                </span>
                <div className="text-xs font-semibold text-amber-200">Annual Pro</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono-tech text-2xl font-bold text-white">$59</span>
                  <span className="text-xs text-slate-400">/ year</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">$4.92/mo · billed yearly</div>
              </button>

              <button
                type="button"
                onClick={() => setPlan('monthly')}
                className={`rounded-2xl border p-4 text-left transition ${
                  plan === 'monthly'
                    ? 'border-cyan-400 bg-cyan-400/12 shadow-[0_0_24px_rgba(34,211,238,0.18)]'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-semibold text-cyan-200">Monthly Pro</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono-tech text-2xl font-bold text-white">$9.99</span>
                  <span className="text-xs text-slate-400">/ month</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Cancel anytime in 1 click</div>
              </button>
            </div>

            {/* Benefits */}
            <ul className="space-y-2 rounded-2xl border border-slate-800/90 bg-slate-950/65 p-4 text-xs text-slate-200">
              {PRO_BENEFITS.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            {/* Optional receipt email */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Email for receipt &amp; invoice (optional — Stripe also collects it securely)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
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
              className="btn-aurora flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-bold text-slate-950 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              {busy
                ? 'Opening Secure Stripe Checkout...'
                : plan === 'annual'
                  ? 'Continue to Stripe · $59/year'
                  : 'Continue to Stripe · $9.99/month'}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Secured by Stripe · Cancel anytime · Promo codes supported</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
