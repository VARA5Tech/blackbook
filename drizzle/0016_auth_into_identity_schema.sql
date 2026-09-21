-- Better Auth's four tables move out of `public` into their own schema.
--
-- `public` then holds only the business tables, the same separation Supabase
-- keeps for its own `auth` schema (whose name is why this one is `identity`).
--
-- Nothing is copied and no row is rewritten. `SET SCHEMA` changes which
-- namespace a table belongs to and nothing else: its rows, indexes, primary
-- and unique keys, row-level security and triggers go with it, and the fifteen
-- foreign keys pointing at app_user from the business tables keep working,
-- because Postgres tracks them by the table's identity, not its name. It takes
-- a brief lock on each table and is over in milliseconds.

CREATE SCHEMA IF NOT EXISTS "identity";
--> statement-breakpoint

-- Supabase's API roles get nothing here. The tables already refuse every row
-- to them through row-level security; this closes the schema itself, so they
-- cannot even see that the tables exist.
REVOKE ALL ON SCHEMA "identity" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA "identity" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA "identity" FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "public"."app_user" SET SCHEMA "identity";
--> statement-breakpoint
ALTER TABLE "public"."app_session" SET SCHEMA "identity";
--> statement-breakpoint
ALTER TABLE "public"."app_account" SET SCHEMA "identity";
--> statement-breakpoint
ALTER TABLE "public"."app_verification" SET SCHEMA "identity";
