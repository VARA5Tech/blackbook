-- Close the Supabase API layer off from Blackbook's tables.
--
-- Blackbook talks to Postgres directly and does all of its authorization in the
-- service layer, which is what the handover asks for. But it shares a database
-- with a Supabase stack, and that stack runs PostgREST behind Kong: anything
-- readable in `public` is reachable over HTTP with the anon key. Client names,
-- phone numbers, home addresses and family details are exactly what must not be.
--
-- Two locks, because they cover different things.
--
-- Row-level security with no policies denies every row to every role except the
-- table owner, who bypasses RLS unless FORCE ROW LEVEL SECURITY is set. The
-- application connects as the owner, so this is invisible to it and total for
-- everyone else. Verified: a role granted ALL on a table reads 1 row before and
-- 0 after, while the owner still reads and writes.
--
-- Revoking the grants covers what RLS does not, TRUNCATE among them, and means
-- the tables are not merely empty to PostgREST but absent from it.
--
-- This depends on the application connecting as the role that owns the tables.
-- If that ever changes, it will need policies or it will see nothing at all.

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END $$;

--> statement-breakpoint

-- The Supabase roles only exist in a Supabase stack. Local development and the
-- test database have neither, so this is conditional rather than assumed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
  END IF;
END $$;
