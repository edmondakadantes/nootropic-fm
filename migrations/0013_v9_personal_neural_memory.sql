-- Migration 0013: v9.0 100/100 Continuous Personal Neural Memory Vector on Profiles
ALTER TABLE profiles ADD COLUMN neural_memory_json TEXT;
