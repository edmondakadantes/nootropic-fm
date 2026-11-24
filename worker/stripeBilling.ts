/**
 * Zero-dependency Stripe REST & Webhook verification module for Cloudflare Workers.
 * Uses native fetch + WebCrypto HMAC-SHA256 (<1 ms CPU, works on Workers Free Tier).
 */

export type BillingPlanCycle = 'monthly' | 'annual';

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function computeHmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies Stripe's `Stripe-Signature` header (`t=<ts>,v1=<hex>`), rejecting stale timestamps (>5 min).
 */
export async function verifyStripeWebhookSignature(
  rawBody: string,
  sigHeader: string | null,
  webhookSecret: string
): Promise<boolean> {
  if (!sigHeader || !webhookSecret) return false;
  const parts = sigHeader.split(',').map((p) => p.trim());
  let timestamp = '';
  const v1Sigs: string[] = [];

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1Sigs.push(v);
  }

  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec) || v1Sigs.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - tsSec) > 300) return false;

  const expected = await computeHmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  return v1Sigs.some((sig) => timingSafeHexEqual(sig.toLowerCase(), expected.toLowerCase()));
}

/**
 * Creates a Stripe Checkout Session for a recurring `nootropic.fm Pro` subscription.
 * Uses explicit Price IDs if configured, or creates inline `price_data` ($9.99/mo or $59/yr) automatically.
 */
export async function createStripeCheckoutSession(opts: {
  secretKey: string;
  plan: BillingPlanCycle;
  profileId: string;
  successUrl: string;
  cancelUrl: string;
  email?: string;
  priceMonthly?: string;
  priceAnnual?: string;
}): Promise<{ id: string; url: string }> {
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', opts.successUrl);
  form.set('cancel_url', opts.cancelUrl);
  form.set('client_reference_id', opts.profileId);
  form.set('allow_promotion_codes', 'true');
  form.set('metadata[profile_id]', opts.profileId);
  form.set('metadata[plan]', opts.plan);
  form.set('subscription_data[metadata][profile_id]', opts.profileId);
  form.set('subscription_data[metadata][plan]', opts.plan);

  // Per-session nootropic.fm Checkout Branding (does NOT affect Playrify or other brands on the same Stripe account!)
  const brandBase = 'https://www.nootropic.fm/brand';
  form.set('branding_settings[display_name]', 'nootropic.fm');
  form.set('branding_settings[background_color]', '#05070d');
  form.set('branding_settings[button_color]', '#06b6d4');
  form.set('branding_settings[border_style]', 'rounded');
  form.set('branding_settings[font_family]', 'inter');
  form.set('branding_settings[logo][type]', 'url');
  form.set('branding_settings[logo][url]', `${brandBase}/stripe-logo.png`);
  form.set('branding_settings[icon][type]', 'url');
  form.set('branding_settings[icon][url]', `${brandBase}/stripe-icon.png`);

  if (opts.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.email)) {
    form.set('customer_email', opts.email);
  }

  const configuredPrice =
    opts.plan === 'annual' ? opts.priceAnnual?.trim() : opts.priceMonthly?.trim();

  if (configuredPrice) {
    form.set('line_items[0][price]', configuredPrice);
    form.set('line_items[0][quantity]', '1');
  } else {
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][tax_behavior]', 'inclusive');
    form.set(
      'line_items[0][price_data][unit_amount]',
      opts.plan === 'annual' ? '5900' : '999'
    );
    form.set(
      'line_items[0][price_data][recurring][interval]',
      opts.plan === 'annual' ? 'year' : 'month'
    );
    form.set(
      'line_items[0][price_data][product_data][name]',
      opts.plan === 'annual' ? 'nootropic.fm Pro (Annual · Save 50%)' : 'nootropic.fm Pro (Monthly)'
    );
    form.set(
      'line_items[0][price_data][product_data][description]',
      'Unlimited full sessions, any music style you type (Reggae, Lo-Fi, Jazz, Rock & more), live AI streaming & all science studies.'
    );
    form.set(
      'line_items[0][price_data][product_data][images][0]',
      `${brandBase}/pro-checkout-banner.png`
    );
    // Required by Stripe Managed Payments (Software as a service (SaaS) - personal use)
    form.set('line_items[0][price_data][product_data][tax_code]', 'txcd_10103000');
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(12000),
  });

  const data = (await res.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.id || !data.url) {
    throw new Error(data.error?.message || `Stripe Checkout failed (${res.status})`);
  }
  return { id: data.id, url: data.url };
}

export interface VerifiedCheckoutSession {
  paid: boolean;
  profileId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  customerEmail: string | null;
  proUntilIso: string | null;
}

export async function retrieveStripeCheckoutSession(
  secretKey: string,
  checkoutSessionId: string
): Promise<VerifiedCheckoutSession> {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}?expand[]=subscription`,
    {
      headers: { authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(10000),
    }
  );
  const data = (await res.json()) as {
    status?: string;
    payment_status?: string;
    client_reference_id?: string | null;
    metadata?: { profile_id?: string; plan?: string };
    customer?: string | { id?: string } | null;
    customer_details?: { email?: string | null };
    customer_email?: string | null;
    subscription?:
      | string
      | {
          id?: string;
          status?: string;
          current_period_end?: number;
          items?: { data?: Array<{ current_period_end?: number }> };
        }
      | null;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `Unable to verify Stripe session (${res.status})`);
  }

  const subObj = typeof data.subscription === 'object' && data.subscription ? data.subscription : null;
  const subId = typeof data.subscription === 'string' ? data.subscription : (subObj?.id ?? null);
  const customerId =
    typeof data.customer === 'string'
      ? data.customer
      : (data.customer && typeof data.customer === 'object' ? (data.customer.id ?? null) : null);

  const paid =
    data.payment_status === 'paid' ||
    data.status === 'complete' ||
    subObj?.status === 'active' ||
    subObj?.status === 'trialing';

  const periodEndSec =
    subObj?.current_period_end ?? subObj?.items?.data?.[0]?.current_period_end;
  const fallbackDays = data.metadata?.plan === 'annual' ? 370 : 35;
  const proUntilIso =
    typeof periodEndSec === 'number' && periodEndSec > 0
      ? new Date(periodEndSec * 1000).toISOString()
      : new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    paid,
    profileId: data.metadata?.profile_id || data.client_reference_id || null,
    customerId,
    subscriptionId: subId,
    customerEmail: data.customer_details?.email || data.customer_email || null,
    proUntilIso,
  };
}

export async function createStripePortalSession(
  secretKey: string,
  customerId: string,
  returnUrl: string
): Promise<string> {
  const form = new URLSearchParams();
  form.set('customer', customerId);
  form.set('return_url', returnUrl);

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message || `Stripe Billing Portal failed (${res.status})`);
  }
  return data.url;
}
