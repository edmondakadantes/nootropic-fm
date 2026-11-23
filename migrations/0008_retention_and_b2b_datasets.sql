-- v4.0 Granular Listening Retention Curve (25% / 50% / 75% / 90%+) + B2B Dataset Licensing Leads
ALTER TABLE sessions ADD COLUMN max_milestone_pct INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_milestone
  ON sessions(max_milestone_pct, completion_ratio);

CREATE TABLE IF NOT EXISTS dataset_inquiries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  organization TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  cohort_interest TEXT NOT NULL DEFAULT '',
  use_case TEXT NOT NULL DEFAULT 'research',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dataset_inquiries_created
  ON dataset_inquiries(created_at DESC);
