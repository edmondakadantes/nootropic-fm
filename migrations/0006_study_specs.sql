-- Migration 0006: Executable Medical Study Compiler Cache & Study-Locked Sessions
-- Non-breaking additive schema supporting Study Lab & Study-to-Sound compilation ($0 D1 cache).

CREATE TABLE IF NOT EXISTS compiled_studies (
  study_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  execution_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compiled_studies_expires ON compiled_studies(expires_at);

ALTER TABLE sessions ADD COLUMN study_spec_id TEXT;
