-- Migration 0005: Passwordless Neural Identity & Demographic Profile Fields
-- Non-breaking additions to profiles (existing rows keep clean defaults).

ALTER TABLE profiles ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'prefer_not_to_say';
ALTER TABLE profiles ADD COLUMN occupation_label TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN sync_code_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_sync_code_hash ON profiles(sync_code_hash);
