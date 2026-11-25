-- Migration 0010: v7.0 Phase 2 — 20-Trial Visual 1/RT PVT, Display Refresh Telemetry & Blinding Integrity
ALTER TABLE sessions ADD COLUMN pvt_pre_inv_rt REAL;
ALTER TABLE sessions ADD COLUMN pvt_post_inv_rt REAL;
ALTER TABLE sessions ADD COLUMN pvt_delta_inv_rt REAL;
ALTER TABLE sessions ADD COLUMN pvt_trial_count INTEGER;
ALTER TABLE sessions ADD COLUMN pvt_refresh_hz REAL;
ALTER TABLE sessions ADD COLUMN pvt_decile_spread_ms REAL;
ALTER TABLE sessions ADD COLUMN blinding_guess TEXT;
