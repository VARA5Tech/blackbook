-- Shuts PostgREST out of the lead table.
--
-- Migration 0018 enabled row-level security on `lead` but left the grants
-- alone, and Supabase's default privileges hand anon and authenticated full
-- rights on anything created in public. Row security already refuses every
-- row, so nothing is reachable today; this is the second lock, the one that
-- matters if a policy is ever added here. Same block as migrations 0005 and
-- 0011, and idempotent: revoking a right nobody was granted is not an error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "lead" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "lead" FROM authenticated;
  END IF;
END $$;
