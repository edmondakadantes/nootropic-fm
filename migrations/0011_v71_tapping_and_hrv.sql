-- Migration 0011: v7.1 Advanced Biomarkers (15s Continuation Tapping CV + BLE HRV RMSSD & 0.1 Hz LF Power)
ALTER TABLE sessions ADD COLUMN tapping_cv_pct REAL;
ALTER TABLE sessions ADD COLUMN tapping_mean_iti_ms REAL;
ALTER TABLE sessions ADD COLUMN hrv_rmssd_ms REAL;
ALTER TABLE sessions ADD COLUMN hrv_lf_ratio REAL;
