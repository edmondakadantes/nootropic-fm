-- Migration 0007: Objective 15s PVT Cognitive Benchmark & Open Study Empirical Leaderboard
-- Non-breaking additive schema for objective ms reaction-time deltas & per-study community results.

ALTER TABLE sessions ADD COLUMN pvt_pre_ms REAL;
ALTER TABLE sessions ADD COLUMN pvt_post_ms REAL;
ALTER TABLE sessions ADD COLUMN pvt_delta_ms REAL;
ALTER TABLE sessions ADD COLUMN pvt_lapses_pre INTEGER;
ALTER TABLE sessions ADD COLUMN pvt_lapses_post INTEGER;

CREATE TABLE IF NOT EXISTS study_outcomes (
  id TEXT PRIMARY KEY,
  study_spec_id TEXT NOT NULL,
  study_title TEXT NOT NULL,
  entrainment_type TEXT NOT NULL DEFAULT 'amplitude_modulation',
  frequency_hz REAL NOT NULL DEFAULT 0,
  worked_rating TEXT,
  delta_score REAL,
  pvt_pre_ms REAL,
  pvt_post_ms REAL,
  pvt_delta_ms REAL,
  is_control_trial INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_outcomes_spec ON study_outcomes(study_spec_id, created_at DESC);
