-- ANS Dashboard V3 — fix: Sensei can't mark their own session completed
--
-- Bug found during QA sweep (Sensei role, Sesi Mengajar → Simpan laporan sesi):
-- submitSessionReport() sets the local schedule to status='completed' and
-- tries to persist BOTH session_reports and schedules. session_reports
-- saves fine, but the schedules UPDATE gets rejected —
--   403: new row violates row-level security policy for table "schedules"
-- — because v3_schedules_update_ops (db/schema-rls.sql) only allows
-- Super Admin to UPDATE schedules. The report itself is saved, but the
-- schedule silently stays "active" forever in the database (the UI shows
-- "completed" only until the next reload). This undercounts every
-- Session-X-of-X / Class Master progress figure for report-driven
-- completions, for every Sensei, since the RLS rewrite went live.
--
-- Fix: add a second permissive UPDATE policy scoped to the Sensei's own
-- rows (same pattern already used for session_logs / session_reports —
-- Postgres OR's multiple permissive policies together, so this does not
-- replace or loosen v3_schedules_update_ops).
--
-- Run in the Supabase SQL Editor.

DROP POLICY IF EXISTS v3_schedules_update_own ON schedules;
CREATE POLICY v3_schedules_update_own
  ON schedules FOR UPDATE TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));
