-- Feature: 4th Sensei status tier, "Need Attention" — an ACTIVE Sensei whose
-- compliance (QA, reporting, attendance habits, etc.) is below bar, manually
-- flagged by Kyouiku. Distinct from primary_status (ACTIVE/INACTIVE, which
-- stays Super-Admin-only) and from the auto-computed NEW/UNASSIGNED labels.
--
-- Mirrors the existing narrow-permission pattern already used for
-- sensei.level_mengajar and schedules.status: Kyouiku gets write access via
-- an additive policy, and a trigger restricts that access to ONLY the one
-- new column — primary_status, leave dates, join_date stay Super-Admin-only.
--
-- Safe to re-run (idempotent). Paste into Supabase SQL Editor and run once.

ALTER TABLE sensei_status ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS v3_sensei_status_write_kyouiku_attention ON sensei_status;
CREATE POLICY v3_sensei_status_write_kyouiku_attention
  ON sensei_status FOR UPDATE TO authenticated
  USING ((SELECT public.current_profile_role()) = 'Kyouiku')
  WITH CHECK ((SELECT public.current_profile_role()) = 'Kyouiku');

CREATE OR REPLACE FUNCTION public.enforce_kyouiku_sensei_attention_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_profile_role() = 'Kyouiku' THEN
    IF NEW.sensei_id IS DISTINCT FROM OLD.sensei_id
      OR NEW.primary_status IS DISTINCT FROM OLD.primary_status
      OR NEW.join_date IS DISTINCT FROM OLD.join_date
      OR NEW.leave_start IS DISTINCT FROM OLD.leave_start
      OR NEW.leave_end IS DISTINCT FROM OLD.leave_end
    THEN
      RAISE EXCEPTION 'Kyouiku hanya boleh mengubah status "Need Attention" Sensei, bukan status aktif/CUTI';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS v3_sensei_status_kyouiku_attention_only ON sensei_status;
CREATE TRIGGER v3_sensei_status_kyouiku_attention_only
  BEFORE UPDATE ON sensei_status
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kyouiku_sensei_attention_only();
