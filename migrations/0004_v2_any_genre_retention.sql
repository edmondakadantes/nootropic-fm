-- Migration 0004: nootropic.fm v2 — Any-Genre R2 Community Cache, Dual-Source Literature Cache,
-- Profile Auth Token, and Hybrid Explicit Delta + Implicit Retention Bandit Engine.

-- 1. Profile security token (SHA-256 hash) for authenticated GET/DELETE
ALTER TABLE profiles ADD COLUMN token_hash TEXT;

-- 2. Custom AI-generated studio tracks cached permanently in Cloudflare R2
CREATE TABLE IF NOT EXISTS custom_tracks (
  id TEXT PRIMARY KEY,
  genre_slug TEXT NOT NULL,
  display_label TEXT NOT NULL,
  energy_tier TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  bpm INTEGER NOT NULL DEFAULT 92,
  duration_sec REAL NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_tracks_lookup ON custom_tracks(genre_slug, energy_tier, status);

-- 3. Atomic generation lock (prevents duplicate billing on concurrent cache misses)
CREATE TABLE IF NOT EXISTS music_generation_jobs (
  job_key TEXT PRIMARY KEY,
  genre_slug TEXT NOT NULL,
  energy_tier TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  r2_key TEXT,
  track_id TEXT,
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 4. Shared 7-day literature cache (NIH PubMed + OpenAlex)
CREATE TABLE IF NOT EXISTS literature_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  papers_json TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 5. Daily spend caps (atomic reservation)
ALTER TABLE api_usage_daily ADD COLUMN music_gen_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_usage_daily ADD COLUMN music_gen_cost_cents INTEGER NOT NULL DEFAULT 0;

-- 6. Session retention, custom vibe & implicit learning columns
ALTER TABLE sessions ADD COLUMN initial_music_genre TEXT NOT NULL DEFAULT 'deep_electronic';
ALTER TABLE sessions ADD COLUMN custom_genre_slug TEXT;
ALTER TABLE sessions ADD COLUMN audio_source TEXT NOT NULL DEFAULT 'studio_library';
ALTER TABLE sessions ADD COLUMN genre_swapped_at_sec INTEGER;
ALTER TABLE sessions ADD COLUMN implicit_reward_score REAL;
ALTER TABLE sessions ADD COLUMN implicit_applied_weight REAL NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN retention_outcome TEXT;
ALTER TABLE sessions ADD COLUMN return_bonus_credited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_beacon_at TEXT;

-- 7. Separate Explicit Delta from Implicit Retention in bandit_stats (prevents avg_delta dilution)
ALTER TABLE bandit_stats ADD COLUMN explicit_trials INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bandit_stats ADD COLUMN implicit_trials INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bandit_stats ADD COLUMN explicit_delta_sum REAL NOT NULL DEFAULT 0;
ALTER TABLE bandit_stats ADD COLUMN retention_sum REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_profile_created ON sessions(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status_beacon ON sessions(status, last_beacon_at);
