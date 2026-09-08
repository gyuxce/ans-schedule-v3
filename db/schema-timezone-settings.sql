-- ANS Dashboard V3 — additive: Sensei timezone + grace late-join settings
-- Jalankan di staging yang sudah punya schema.sql (project yang sudah jalan).
-- Aman dijalankan berulang (IF NOT EXISTS / ON CONFLICT).

ALTER TABLE sensei ADD COLUMN IF NOT EXISTS timezone TEXT;
UPDATE sensei SET timezone = 'Asia/Jakarta' WHERE timezone IS NULL OR timezone = '';
ALTER TABLE sensei ALTER COLUMN timezone SET DEFAULT 'Asia/Jakarta';
ALTER TABLE sensei DROP CONSTRAINT IF EXISTS sensei_timezone_check;
ALTER TABLE sensei ADD CONSTRAINT sensei_timezone_check
  CHECK (timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Tokyo'));

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO app_settings (key, value)
VALUES ('late_grace_minutes', '0'::jsonb), ('weekly_hour_target', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
