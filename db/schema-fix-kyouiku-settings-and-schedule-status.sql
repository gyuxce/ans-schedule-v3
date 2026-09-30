-- Two more Kyouiku app-vs-RLS mismatches found while testing Kyouiku's own
-- capabilities directly (rather than assuming "same as Super Admin"):
--
-- 1) app_settings: the Pengaturan page's own text says "Hanya Super Admin
--    dan Kyouiku yang dapat mengubah pengaturan" (canManageSettings=true for
--    Kyouiku), but the write policy was still is_ops()-only -> 403 when a
--    Kyouiku account tried to save grace late-join / target jam.
--
-- 2) schedules: submitting a session report as Kyouiku (canOverrideAcademic)
--    flips that session's status to 'completed' locally, but the remote
--    UPDATE on `schedules` only matched Super Admin or the session's own
--    Sensei. This is the dangerous kind of gap: an UPDATE whose USING clause
--    matches zero rows returns success with 0 rows changed — NO error, no
--    403, nothing in the console. The report saved, the UI showed
--    "Selesai", but the session silently stayed 'active' in the database
--    forever. A narrow additive policy + trigger (mirroring the existing
--    Kyouiku sensei-levels-only pattern) lets Kyouiku flip status without
--    reopening date/time/sensei/swap/cancel editing, which must stay
--    Super-Admin-only (canEditOfficialSchedule=false).
--
-- Safe to re-run (idempotent). Paste into Supabase SQL Editor and run once.

CREATE POLICY v3_app_settings_write_kyouiku
  ON app_settings FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

CREATE POLICY v3_app_settings_update_kyouiku
  ON app_settings FOR UPDATE TO authenticated
  USING ((SELECT public.is_kyouiku_or_ops())) WITH CHECK ((SELECT public.is_kyouiku_or_ops()));

CREATE POLICY v3_schedules_update_kyouiku_status
  ON schedules FOR UPDATE TO authenticated
  USING ((SELECT public.current_profile_role()) = 'Kyouiku')
  WITH CHECK ((SELECT public.current_profile_role()) = 'Kyouiku');

CREATE OR REPLACE FUNCTION public.enforce_kyouiku_schedule_status_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_profile_role() = 'Kyouiku' THEN
    IF NEW.sensei_id IS DISTINCT FROM OLD.sensei_id
      OR NEW.student_id IS DISTINCT FROM OLD.student_id
      OR NEW.student_ids IS DISTINCT FROM OLD.student_ids
      OR NEW.group_id IS DISTINCT FROM OLD.group_id
      OR NEW.class_id IS DISTINCT FROM OLD.class_id
      OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.level IS DISTINCT FROM OLD.level
      OR NEW.date IS DISTINCT FROM OLD.date
      OR NEW.start_time IS DISTINCT FROM OLD.start_time
      OR NEW.end_time IS DISTINCT FROM OLD.end_time
      OR NEW.original_sensei_id IS DISTINCT FROM OLD.original_sensei_id
      OR NEW.makeup_of_session_id IS DISTINCT FROM OLD.makeup_of_session_id
      OR NEW.is_extra IS DISTINCT FROM OLD.is_extra
      OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
      OR NEW.cancellation_initiator IS DISTINCT FROM OLD.cancellation_initiator
      OR NEW.replacement_secured IS DISTINCT FROM OLD.replacement_secured
      OR NEW.swap_initiator IS DISTINCT FROM OLD.swap_initiator
      OR NEW.swap_reason IS DISTINCT FROM OLD.swap_reason
    THEN
      RAISE EXCEPTION 'Kyouiku hanya boleh mengubah status sesi (laporan/koreksi), bukan jadwal resmi';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS v3_schedules_kyouiku_status_only ON schedules;
CREATE TRIGGER v3_schedules_kyouiku_status_only
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kyouiku_schedule_status_only();
