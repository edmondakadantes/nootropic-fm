-- Anti-bot privacy-preserving rate limiting table (stores salted SHA-256 IP hash only, never raw IPs)
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
