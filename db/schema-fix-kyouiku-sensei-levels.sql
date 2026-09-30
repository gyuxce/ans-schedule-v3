-- Kyouiku can edit a Sensei's "Level mengajar" (levels taught) from the dashboard.
--
-- Why this is needed: the app already checks role permissions in the UI, but a
-- Kyouiku account's own Supabase credentials could otherwise call the database
-- REST API directly and edit any Sensei field, bypassing the app entirely. RLS
-- (which policy applies) can't be scoped to a single column, so a trigger does
-- the actual column-level enforcement below; the policy just grants Kyouiku
-- UPDATE access on this table at all.
--
-- Safe to re-run (idempotent). Paste into Supabase SQL Editor and run once.

DROP POLICY IF EXISTS v3_sensei_write_kyouiku_levels ON sensei;
CREATE POLICY v3_sensei_write_kyouiku_levels
  ON sensei FOR UPDATE TO authenticated
  USING ((SELECT public.current_profile_role()) = 'Kyouiku')
  WITH CHECK ((SELECT public.current_profile_role()) = 'Kyouiku');

CREATE OR REPLACE FUNCTION public.enforce_kyouiku_sensei_levels_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_profile_role() = 'Kyouiku' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.note IS DISTINCT FROM OLD.note
      OR NEW.no_wa IS DISTINCT FROM OLD.no_wa
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.kelas_tersedia IS DISTINCT FROM OLD.kelas_tersedia
      OR NEW.sensei_leave_quota IS DISTINCT FROM OLD.sensei_leave_quota
      OR NEW.timezone IS DISTINCT FROM OLD.timezone
      OR NEW.display_name IS DISTINCT FROM OLD.display_name
    THEN
      RAISE EXCEPTION 'Kyouiku hanya boleh mengubah level_mengajar Sensei';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS v3_sensei_kyouiku_levels_only ON sensei;
CREATE TRIGGER v3_sensei_kyouiku_levels_only
  BEFORE UPDATE ON sensei
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kyouiku_sensei_levels_only();
