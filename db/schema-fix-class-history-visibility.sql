-- A substitute Sensei (swap or Take Over) can read the history of every class
-- they teach at least one session of: its Class Master, students, enrollments,
-- all sessions, and the session reports (material covered, level progress)
-- that earlier Sensei filed.
--
-- Why this is needed: the app now shows "Materi sebelumnya" and correct class
-- progress to a substitute, but the original SELECT policies only exposed rows
-- tied to the Sensei's own sessions (sensei_id / original_sensei_id), so the
-- earlier sessions and reports of the same class never reached the browser.
--
-- Read-only access: these are additive SELECT policies (Postgres OR's
-- permissive policies together). Write policies are untouched, so a Sensei
-- still cannot edit anything they could not edit before.
--
-- Safe to re-run (idempotent). Paste into Supabase SQL Editor and run once.

-- "Am I assigned (currently) to at least one session of this class?"
CREATE OR REPLACE FUNCTION public.teaches_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_class_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM schedules sch
    WHERE sch.class_id = p_class_id
      AND sch.sensei_id = public.current_sensei_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.teaches_schedule_class(p_schedule_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM schedules sch
    WHERE sch.id = p_schedule_id
      AND public.teaches_class(sch.class_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.teaches_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM class_masters cm
    WHERE public.teaches_class(cm.id)
      AND cm.student_ids ? p_student_id::text
  )
$$;

DROP POLICY IF EXISTS v3_schedules_select_class_history ON schedules;
CREATE POLICY v3_schedules_select_class_history
  ON schedules FOR SELECT TO authenticated
  USING (public.teaches_class(class_id));

DROP POLICY IF EXISTS v3_session_reports_select_class_history ON session_reports;
CREATE POLICY v3_session_reports_select_class_history
  ON session_reports FOR SELECT TO authenticated
  USING (public.teaches_schedule_class(schedule_id));

DROP POLICY IF EXISTS v3_session_student_records_select_class_history ON session_student_records;
CREATE POLICY v3_session_student_records_select_class_history
  ON session_student_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM session_reports sr
      WHERE sr.id = session_student_records.session_report_id
        AND public.teaches_schedule_class(sr.schedule_id)
    )
  );

DROP POLICY IF EXISTS v3_class_masters_select_class_history ON class_masters;
CREATE POLICY v3_class_masters_select_class_history
  ON class_masters FOR SELECT TO authenticated
  USING (public.teaches_class(id));

DROP POLICY IF EXISTS v3_students_select_class_history ON students;
CREATE POLICY v3_students_select_class_history
  ON students FOR SELECT TO authenticated
  USING (public.teaches_student(id));

DROP POLICY IF EXISTS v3_enrollments_select_class_history ON enrollments;
CREATE POLICY v3_enrollments_select_class_history
  ON enrollments FOR SELECT TO authenticated
  USING (public.teaches_class(class_id));
