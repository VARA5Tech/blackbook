-- Time-ordered keys, and references that widen past 99,999.
--
-- This migration only creates the two functions. The column defaults that call
-- them change in the next migration, which drizzle-kit generates from the
-- schema, so the schema snapshot and the database stay in agreement.

-- UUIDv7, per RFC 9562: 48 bits of milliseconds since the epoch, then random
-- bits. Sorting by key sorts by creation time, so new rows append to the end of
-- the primary key index instead of landing at random positions in it.
--
-- Postgres 18 has uuidv7() built in. Production runs 17, which does not, and no
-- extension for it is available on that image. This is the pure SQL technique:
-- take a v4 from the built-in generator, overwrite its first six bytes with the
-- millisecond timestamp, and set the version nibble from 4 to 7. A v4 already
-- carries the variant bits v7 needs, so those are left alone. Replace the body
-- with uuidv7() once production reaches 18.
CREATE OR REPLACE FUNCTION "vara5_uuid_v7"()
RETURNS uuid
LANGUAGE sql
VOLATILE
PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;
--> statement-breakpoint

-- A human reference: CUST-00100, and CUST-100000 once past 99,999.
--
-- The previous default padded with lpad(n, 5). lpad truncates a longer string
-- rather than widening it, so client 100,000 would have been minted CUST-10000,
-- a duplicate of client 10,000, and the unique constraint would then have
-- refused every new client from that point on.
--
-- A function rather than an inline expression because the number is read twice,
-- to pad it and to measure it, while nextval() must run exactly once per row.
CREATE OR REPLACE FUNCTION "vara5_ref"(prefix text, n bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT prefix || lpad(n::text, greatest(5, length(n::text)), '0')
$$;
--> statement-breakpoint

-- Keep both functions away from the Supabase API.
--
-- A function in public is executable by PUBLIC, which on a Supabase stack means
-- callable over HTTP at /rest/v1/rpc with the anon key. Revoking from anon alone
-- would not help, because anon would still inherit the grant through PUBLIC. So
-- PUBLIC loses it, the owner keeps it implicitly, and the role the application
-- connects as in production gets it back. Neither function reads data; the rule
-- for this schema is simply that PostgREST gets nothing.
REVOKE ALL ON FUNCTION "vara5_uuid_v7"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "vara5_ref"(text, bigint) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  -- Supabase also grants new functions to these roles directly.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "vara5_uuid_v7"() FROM anon;
    REVOKE ALL ON FUNCTION "vara5_ref"(text, bigint) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "vara5_uuid_v7"() FROM authenticated;
    REVOKE ALL ON FUNCTION "vara5_ref"(text, bigint) FROM authenticated;
  END IF;

  -- The application's role in production. Every insert evaluates these as
  -- column defaults, so without this grant no client could be created there.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT EXECUTE ON FUNCTION "vara5_uuid_v7"() TO postgres;
    GRANT EXECUTE ON FUNCTION "vara5_ref"(text, bigint) TO postgres;
  END IF;
END $$;
