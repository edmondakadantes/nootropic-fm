-- v4.1 Stripe Subscriptions (Pro Plan Tier + Idempotent Webhook Event Log)
ALTER TABLE profiles ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN pro_until TEXT;
ALTER TABLE profiles ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN billing_email TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_sub ON profiles(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  profile_id TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_events_created ON billing_events(created_at DESC);
