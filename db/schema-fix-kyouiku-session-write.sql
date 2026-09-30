-- Fix: Kyouiku gets a 403 "row-level security policy" error when they try to
-- override a session's clock-in/out, or submit a session report themselves.
--
-- Root cause: the app already lets Kyouiku do both (canOverrideClock and
-- canOverrideAcademic are true for Kyouiku, same as Super Admin), but the
-- database policies for INSERT/UPDATE on session_logs, and INSERT on
-- session_reports, were still gated to is_ops() (Super Admin only) --
-- never updated to match when Kyouiku's app-side permissions were added.
--
-- Found live while testing Kyouiku's own actions with Playwright.
--
-- Safe to re-run (idempotent via CREATE OR REPLACE POLICY semantics below).
-- Paste into Supabase SQL Editor and run once.

DROP POLICY IF EXISTS v3_session_logs_insert ON session_logs;
CREATE POLICY v3_session_logs_insert
  ON session_logs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

DROP POLICY IF EXISTS v3_session_logs_update ON session_logs;
CREATE POLICY v3_session_logs_update
  ON session_logs FOR UPDATE TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

DROP POLICY IF EXISTS v3_session_reports_insert ON session_reports;
CREATE POLICY v3_session_reports_insert
  ON session_reports FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_kyouiku_or_ops()) OR public.owns_schedule(schedule_id));
