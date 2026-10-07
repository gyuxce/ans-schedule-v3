-- Feature: quick-view Sensei capabilities (feedback item #14) — whether a
-- Sensei can teach in English and/or teach Kids classes, settable by
-- Kyouiku/Ops when a Sensei account is first created in V3, surfaced in
-- Ketersediaan without navigating to the Sensei page.
--
-- No RLS/trigger changes needed: the existing v3_sensei_write_kyouiku_levels
-- policy + enforce_kyouiku_sensei_levels_only() trigger (see the
-- level_mengajar narrow-write block above) is a deny-list of specific
-- columns Kyouiku may NOT touch — any new column not named there, including
-- these two, is already writable by Kyouiku through that same policy.
-- Super Admin already has unrestricted write via v3_sensei_write_ops.
--
-- Safe to re-run (idempotent). Paste into Supabase SQL Editor and run once.

ALTER TABLE sensei ADD COLUMN IF NOT EXISTS can_teach_english BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sensei ADD COLUMN IF NOT EXISTS can_teach_kids BOOLEAN NOT NULL DEFAULT false;
