-- Fix: "belum login" / "Akun login: Sudah ada" indicators always showing
-- wrong for Kyouiku, for every Sensei.
--
-- Root cause: profiles SELECT only allowed a user to see their own row,
-- unless they were Super Admin (is_ops). Kyouiku could therefore never see
-- any other account's row, so the app's client-side "does this Sensei's
-- email match a row in profiles?" check always came back empty/false for
-- Kyouiku — not a per-Sensei bug, it affected every Sensei at once.
--
-- This only widens READ access for Kyouiku. Writing to profiles (creating,
-- editing role/status, deleting) stays Super-Admin-only — untouched here.
--
-- Safe to re-run (idempotent). Paste into Supabase SQL Editor and run once.

DROP POLICY IF EXISTS v3_profiles_select ON profiles;
CREATE POLICY v3_profiles_select
  ON profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_kyouiku_or_ops()));
