-- Migration 0003: Science Upgrade (Blind A/B Control, Gen x Energy, Personal AM Sensitivity)
ALTER TABLE profiles ADD COLUMN preferred_mod_mult REAL NOT NULL DEFAULT 1.0;
ALTER TABLE sessions ADD COLUMN is_control_trial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN energy_tier TEXT NOT NULL DEFAULT 'focus';
ALTER TABLE sessions ADD COLUMN music_genre TEXT NOT NULL DEFAULT 'deep_electronic';
CREATE INDEX IF NOT EXISTS idx_sessions_control ON sessions(is_control_trial, status);
