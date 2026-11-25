-- v8.0 Principal Audit Upgrades: Single-Use WS Ticket Nonces, Active WS Concurrency Leases & Atomic Stripe Webhook Idempotency
CREATE TABLE IF NOT EXISTS used_ws_nonces (
  nonce TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_used_ws_nonces_exp ON used_ws_nonces(expires_at);

CREATE TABLE IF NOT EXISTS active_ws_leases (
  lease_id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_ws_leases_actor ON active_ws_leases(actor_key, expires_at);

CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_received ON processed_webhooks(received_at DESC);
