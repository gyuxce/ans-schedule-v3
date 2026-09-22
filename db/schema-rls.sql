-- ANS Dashboard V3 — RLS hardening + performance (aman diulang / idempotent)
-- Jalankan di SQL Editor project V3 yang sudah punya schema.sql.
-- File ini:
--   1) drop policy longgar staging + nama lama v3_*
--   2) pasang RBAC: Super Admin / Kyouiku / Sensei
--   3) PERF: helper functions STABLE, panggilan dibungkus (select ...) supaya
--      dievaluasi SEKALI per query (bukan per baris), + index pendukung.
--   4) naikkan statement_timeout role authenticated/anon sebagai jaring pengaman.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================
-- HELPERS  (STABLE = hasil boleh di-cache dalam satu statement)
-- =========================================================

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles
  WHERE id = (SELECT auth.uid()) AND status = 'Approved'
$$;

-- "Ops" = Super Admin only. 'Staff' sengaja TIDAK di sini (frontend melipat
-- 'Staff' ke UI level Kyouiku). Staff tetap di is_kyouiku_or_ops().
CREATE OR REPLACE FUNCTION public.is_ops()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.current_profile_role() IN ('Super Admin') $$;

CREATE OR REPLACE FUNCTION public.is_kyouiku_or_ops()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.current_profile_role() IN ('Super Admin', 'Staff', 'Kyouiku') $$;

CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.current_profile_role() IS NOT NULL $$;

CREATE OR REPLACE FUNCTION public.current_sensei_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT p.sensei_id FROM profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.status = 'Approved'
        AND p.sensei_id IS NOT NULL
      LIMIT 1
    ),
    (
      SELECT s.id FROM sensei s
      WHERE lower(coalesce(s.email, '')) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
      LIMIT 1
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.owns_schedule(p_schedule_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM schedules sch
    WHERE sch.id = p_schedule_id
      AND (
        sch.sensei_id = public.current_sensei_id()
        OR sch.original_sensei_id = public.current_sensei_id()::text
      )
  )
$$;

-- =========================================================
-- INDEX PENDUKUNG RLS  (aman diulang)
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_schedules_sensei_id      ON schedules (sensei_id);
CREATE INDEX IF NOT EXISTS idx_schedules_orig_sensei_id ON schedules (original_sensei_id);
CREATE INDEX IF NOT EXISTS idx_schedules_student_id     ON schedules (student_id);
CREATE INDEX IF NOT EXISTS idx_schedules_group_id       ON schedules (group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date           ON schedules (date);
CREATE INDEX IF NOT EXISTS idx_schedules_student_ids    ON schedules USING gin (student_ids);

CREATE INDEX IF NOT EXISTS idx_availability_sensei_id   ON sensei_availability (sensei_id);
CREATE INDEX IF NOT EXISTS idx_session_logs_sensei_id   ON session_logs (sensei_id);
CREATE INDEX IF NOT EXISTS idx_session_logs_schedule_id ON session_logs (schedule_id);
CREATE INDEX IF NOT EXISTS idx_session_reports_schedule ON session_reports (schedule_id);
CREATE INDEX IF NOT EXISTS idx_ssr_report_id            ON session_student_records (session_report_id);
CREATE INDEX IF NOT EXISTS idx_qa_sensei_id             ON teaching_qa_scores (sensei_id);
CREATE INDEX IF NOT EXISTS idx_lt_sensei_id             ON lesson_trackers (sensei_id);
CREATE INDEX IF NOT EXISTS idx_lt_student_id            ON lesson_trackers (student_id);
CREATE INDEX IF NOT EXISTS idx_lt_schedule_id           ON lesson_trackers (schedule_id);
CREATE INDEX IF NOT EXISTS idx_class_masters_sensei_id  ON class_masters (sensei_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_sensei_id    ON enrollments (sensei_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id   ON enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_offdays_sensei_id        ON offdays (sensei_id);
CREATE INDEX IF NOT EXISTS idx_time_blocks_sensei_id    ON sensei_time_blocks (sensei_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at         ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_sensei_id       ON profiles (sensei_id);

-- =========================================================
-- DROP LOOSE STAGING POLICIES + OLD NAMES
-- =========================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname = 'staging_all_authenticated' OR policyname LIKE 'v3_%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- =========================================================
-- ENABLE RLS
-- =========================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensei ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE offdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensei_time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_trackers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensei_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensei_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_student_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_qa_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- PROFILES
-- =========================================================

CREATE POLICY v3_profiles_select
  ON profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_ops()));

CREATE POLICY v3_profiles_insert_own
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = (SELECT auth.uid())
    AND lower(email) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
    AND role IN ('Sensei', 'Staff', 'Kyouiku')
    AND status = 'Pending'
  );

CREATE POLICY v3_profiles_insert_ops
  ON profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_ops()));

CREATE POLICY v3_profiles_update_ops
  ON profiles FOR UPDATE TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

CREATE POLICY v3_profiles_delete_ops
  ON profiles FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()));

-- =========================================================
-- SENSEI MASTER
-- =========================================================

CREATE POLICY v3_sensei_select
  ON sensei FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_sensei_write_ops
  ON sensei FOR ALL TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

-- =========================================================
-- SENSEI STATUS
-- =========================================================

CREATE POLICY v3_sensei_status_select
  ON sensei_status FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_sensei_status_write_ops
  ON sensei_status FOR ALL TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

-- =========================================================
-- STUDENTS
-- =========================================================

CREATE POLICY v3_students_select
  ON students FOR SELECT TO authenticated
  USING (
    (SELECT public.is_kyouiku_or_ops())
    OR EXISTS (
      SELECT 1 FROM schedules sch
      WHERE sch.sensei_id = (SELECT public.current_sensei_id())
        AND (sch.student_id = students.id OR sch.student_ids ? students.id::text)
    )
    OR lower(coalesce(students.sensei_name, '')) = (
      SELECT lower(coalesce(s.name, '')) FROM sensei s
      WHERE s.id = (SELECT public.current_sensei_id())
    )
  );

CREATE POLICY v3_students_write_ops
  ON students FOR ALL TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

CREATE POLICY v3_students_update_academic
  ON students FOR UPDATE TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops())) WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

-- =========================================================
-- GROUPS
-- =========================================================

CREATE POLICY v3_groups_select
  ON groups FOR SELECT TO authenticated
  USING (
    (SELECT public.is_kyouiku_or_ops())
    OR EXISTS (
      SELECT 1 FROM schedules sch
      WHERE sch.group_id = groups.id AND sch.sensei_id = (SELECT public.current_sensei_id())
    )
  );

CREATE POLICY v3_groups_write_ops
  ON groups FOR ALL TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

-- =========================================================
-- OFFICIAL SCHEDULES
-- =========================================================

CREATE POLICY v3_schedules_select
  ON schedules FOR SELECT TO authenticated
  USING (
    (SELECT public.is_kyouiku_or_ops())
    OR sensei_id = (SELECT public.current_sensei_id())
    OR original_sensei_id = (SELECT public.current_sensei_id())::text
  );

CREATE POLICY v3_schedules_write_ops
  ON schedules FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_ops()));

CREATE POLICY v3_schedules_update_ops
  ON schedules FOR UPDATE TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

-- A Sensei must be able to update their own session (submitSessionReport
-- flips status -> 'completed'). Additive: Postgres OR's permissive UPDATE
-- policies together, so v3_schedules_update_ops above still applies.
CREATE POLICY v3_schedules_update_own
  ON schedules FOR UPDATE TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_schedules_delete_ops
  ON schedules FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()));

-- =========================================================
-- AVAILABILITY
-- =========================================================

CREATE POLICY v3_availability_select
  ON sensei_availability FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_availability_insert
  ON sensei_availability FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_availability_update
  ON sensei_availability FOR UPDATE TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_availability_delete
  ON sensei_availability FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

-- =========================================================
-- TIME BLOCKS / OFFDAYS / LESSON TRACKERS
-- =========================================================

CREATE POLICY v3_time_blocks_select
  ON sensei_time_blocks FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_time_blocks_write
  ON sensei_time_blocks FOR ALL TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_offdays_select
  ON offdays FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_offdays_write
  ON offdays FOR ALL TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_trackers_select
  ON lesson_trackers FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_trackers_write
  ON lesson_trackers FOR ALL TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

-- =========================================================
-- SESSION LOGS
-- =========================================================

CREATE POLICY v3_session_logs_select
  ON session_logs FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_session_logs_insert
  ON session_logs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_session_logs_update
  ON session_logs FOR UPDATE TO authenticated
  USING ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()))
  WITH CHECK ((SELECT public.is_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_session_logs_delete_ops
  ON session_logs FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()));

-- =========================================================
-- SESSION REPORTS + PER-STUDENT RECORDS
-- =========================================================

CREATE POLICY v3_session_reports_select
  ON session_reports FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR public.owns_schedule(schedule_id));

CREATE POLICY v3_session_reports_insert
  ON session_reports FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_ops()) OR public.owns_schedule(schedule_id));

CREATE POLICY v3_session_reports_update
  ON session_reports FOR UPDATE TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR public.owns_schedule(schedule_id))
  WITH CHECK ((SELECT public.is_kyouiku_or_ops()) OR public.owns_schedule(schedule_id));

CREATE POLICY v3_session_reports_delete_ops
  ON session_reports FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()));

CREATE POLICY v3_session_student_records_select
  ON session_student_records FOR SELECT TO authenticated
  USING (
    (SELECT public.is_kyouiku_or_ops())
    OR EXISTS (
      SELECT 1 FROM session_reports sr
      WHERE sr.id = session_student_records.session_report_id
        AND public.owns_schedule(sr.schedule_id)
    )
  );

CREATE POLICY v3_session_student_records_write
  ON session_student_records FOR ALL TO authenticated
  USING (
    (SELECT public.is_ops())
    OR EXISTS (
      SELECT 1 FROM session_reports sr
      WHERE sr.id = session_student_records.session_report_id
        AND ((SELECT public.is_kyouiku_or_ops()) OR public.owns_schedule(sr.schedule_id))
    )
  )
  WITH CHECK (
    (SELECT public.is_ops())
    OR EXISTS (
      SELECT 1 FROM session_reports sr
      WHERE sr.id = session_student_records.session_report_id
        AND ((SELECT public.is_kyouiku_or_ops()) OR public.owns_schedule(sr.schedule_id))
    )
  );

-- =========================================================
-- TEACHING QA SCORES
-- =========================================================

CREATE POLICY v3_qa_select
  ON teaching_qa_scores FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_qa_write_kyouiku
  ON teaching_qa_scores FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

CREATE POLICY v3_qa_update_kyouiku
  ON teaching_qa_scores FOR UPDATE TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops())) WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

CREATE POLICY v3_qa_delete_ops
  ON teaching_qa_scores FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()));

-- =========================================================
-- AUDIT LOGS
-- =========================================================

CREATE POLICY v3_audit_select
  ON audit_logs FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()));

CREATE POLICY v3_audit_insert
  ON audit_logs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_approved_user()));

CREATE POLICY v3_audit_delete_ops
  ON audit_logs FOR DELETE TO authenticated
  USING ((SELECT public.is_ops()));

-- =========================================================
-- APP SETTINGS
-- =========================================================

CREATE POLICY v3_app_settings_select
  ON app_settings FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

CREATE POLICY v3_app_settings_write_ops
  ON app_settings FOR ALL TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

-- =========================================================
-- LEVEL COMPLETIONS
-- =========================================================

CREATE POLICY v3_level_completions_select
  ON level_completions FOR SELECT TO authenticated
  USING (
    (SELECT public.is_kyouiku_or_ops())
    OR EXISTS (
      SELECT 1 FROM schedules sch
      WHERE sch.sensei_id = (SELECT public.current_sensei_id())
        AND (sch.student_id = level_completions.student_id
             OR sch.student_ids ? level_completions.student_id::text)
    )
  );

CREATE POLICY v3_level_completions_write
  ON level_completions FOR ALL TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops())) WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

-- =========================================================
-- CLASS MASTERS
-- =========================================================

CREATE POLICY v3_class_masters_select
  ON class_masters FOR SELECT TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops()) OR sensei_id = (SELECT public.current_sensei_id()));

CREATE POLICY v3_class_masters_write_ops
  ON class_masters FOR ALL TO authenticated
  USING ((SELECT public.is_ops())) WITH CHECK ((SELECT public.is_ops()));

-- =========================================================
-- ENROLLMENTS
-- =========================================================

CREATE POLICY v3_enrollments_select
  ON enrollments FOR SELECT TO authenticated
  USING (
    (SELECT public.is_kyouiku_or_ops())
    OR sensei_id = (SELECT public.current_sensei_id())
    OR EXISTS (
      SELECT 1 FROM schedules sch
      WHERE sch.sensei_id = (SELECT public.current_sensei_id())
        AND (sch.student_id = enrollments.student_id
             OR sch.student_ids ? enrollments.student_id::text)
    )
  );

CREATE POLICY v3_enrollments_write
  ON enrollments FOR ALL TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops())) WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

-- =========================================================
-- STATEMENT TIMEOUT (jaring pengaman; berlaku untuk koneksi baru)
-- =========================================================

ALTER ROLE authenticated SET statement_timeout = '20s';
ALTER ROLE anon SET statement_timeout = '20s';

-- Refresh statistik planner setelah migrasi data
ANALYZE schedules;
ANALYZE students;
ANALYZE lesson_trackers;
ANALYZE session_logs;
ANALYZE audit_logs;
ANALYZE sensei;
ANALYZE enrollments;

-- =========================================================
-- QUICK VERIFY (opsional)
-- SELECT policyname, tablename FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'v3_%' ORDER BY tablename, policyname;
-- =========================================================
