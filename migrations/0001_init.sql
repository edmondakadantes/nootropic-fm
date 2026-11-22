-- nootropic.fm Open Research Database Schema (Cloudflare D1 / SQLite)
-- Designed for privacy-by-design: no PII required, anonymous research profiles only.

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  age INTEGER NOT NULL,
  age_band TEXT NOT NULL,
  role TEXT NOT NULL,
  texture_pref TEXT NOT NULL,
  noise_sensitivity TEXT NOT NULL,
  default_device TEXT NOT NULL,
  primary_challenge TEXT NOT NULL,
  research_consent INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cohort_key TEXT NOT NULL,
  raw_input_text TEXT NOT NULL DEFAULT '',
  current_state TEXT NOT NULL,
  baseline_score INTEGER NOT NULL,
  target_state TEXT NOT NULL,
  environment TEXT NOT NULL,
  device TEXT NOT NULL,
  safety_mode INTEGER NOT NULL DEFAULT 0,
  planned_duration_min INTEGER NOT NULL,
  actual_duration_sec INTEGER NOT NULL DEFAULT 0,
  completion_ratio REAL NOT NULL DEFAULT 0,
  arm_id TEXT NOT NULL,
  arm_name TEXT NOT NULL,
  is_exploration INTEGER NOT NULL DEFAULT 0,
  acoustic_params_json TEXT NOT NULL,
  cited_study_ids_json TEXT NOT NULL,
  live_adjustments_json TEXT NOT NULL DEFAULT '[]',
  time_of_day_bucket TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  post_score INTEGER,
  delta_score INTEGER,
  worked_rating TEXT,
  feedback_tags_json TEXT NOT NULL DEFAULT '[]',
  reward_score REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cohort ON sessions(cohort_key, status);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS bandit_stats (
  scope_type TEXT NOT NULL,      -- 'cohort' | 'profile'
  scope_id TEXT NOT NULL,        -- cohort_key or profile_id
  arm_id TEXT NOT NULL,
  alpha REAL NOT NULL,           -- Beta distribution success pseudo-count
  beta REAL NOT NULL,            -- Beta distribution failure pseudo-count
  trials INTEGER NOT NULL DEFAULT 0,
  avg_delta REAL NOT NULL DEFAULT 0,
  avg_completion REAL NOT NULL DEFAULT 0,
  avg_reward REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id, arm_id)
);

CREATE TABLE IF NOT EXISTS api_usage_daily (
  day TEXT PRIMARY KEY,
  gemini_calls INTEGER NOT NULL DEFAULT 0
);
