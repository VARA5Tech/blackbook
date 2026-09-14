-- Takes the milestone date functions away from the Supabase API.
--
-- They were created without a revoke, so PUBLIC could execute them, and on a
-- Supabase stack that makes them callable over HTTP at /rest/v1/rpc with the
-- anon key. They only do date arithmetic and read no client data, but the rule
-- for this schema is that PostgREST gets nothing.
--
-- The baseline's lockout did revoke functions from anon, and it was not enough:
-- anon still inherited EXECUTE through PUBLIC. Revoking from PUBLIC is what
-- actually closes it; the owner keeps the right implicitly.
REVOKE ALL ON FUNCTION "vara5_next_occurrence"(int, int, date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vara5_days_until"(int, int, date) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  -- Supabase also grants functions to these roles directly.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "vara5_next_occurrence"(int, int, date) FROM anon;
    REVOKE ALL ON FUNCTION "vara5_days_until"(int, int, date) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "vara5_next_occurrence"(int, int, date) FROM authenticated;
    REVOKE ALL ON FUNCTION "vara5_days_until"(int, int, date) FROM authenticated;
  END IF;

  -- The application's role in production. The milestone lists and the
  -- dashboard call both, and vara5_days_until calls vara5_next_occurrence.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT EXECUTE ON FUNCTION "vara5_next_occurrence"(int, int, date) TO postgres;
    GRANT EXECUTE ON FUNCTION "vara5_days_until"(int, int, date) TO postgres;
  END IF;
END $$;
