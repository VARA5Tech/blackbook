-- Client references become VARA-482193: six random digits, not a counter.
--
-- A counted reference told everyone how many clients Vara5 has, and let anyone
-- walk the list by adding one. The number is also meant to be read out, put on
-- a card and one day typed as a member number on vara5.travel, so it stays
-- short, all digits, and is drawn at random from 900,000 possibilities.
--
-- Uniqueness is the unique index on customer.ref, not the odds: the function
-- redraws until the number is free. Households keep HH-00100; that reference is
-- internal and nobody outside the team ever sees it.

CREATE OR REPLACE FUNCTION "vara5_member_ref"()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  bits      bigint;
  digits    text;
  candidate text;
  attempts  int := 0;
BEGIN
  LOOP
    attempts := attempts + 1;
    IF attempts > 100 THEN
      RAISE EXCEPTION 'vara5_member_ref could not find a free reference in 100 attempts';
    END IF;

    -- 32 unpredictable bits. gen_random_uuid() is the database's cryptographic
    -- generator; random() is a predictable sequence and must not be used here.
    bits := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint;
    IF bits < 0 THEN
      bits := bits + 4294967296;
    END IF;

    -- Rejection sampling, so every number is equally likely. 4294800000 is the
    -- largest multiple of 900000 inside 2^32; taking a modulo of anything above
    -- it would make the low numbers slightly more common.
    CONTINUE WHEN bits >= 4294800000;

    digits := ((bits % 900000) + 100000)::text;

    -- Numbers a stranger would try first, and numbers that read as a mistake.
    CONTINUE WHEN digits ~ '^(.)\1{5}$';          -- 111111
    CONTINUE WHEN digits ~ '^(..)\1{2}$';         -- 121212
    CONTINUE WHEN digits ~ '^(...)\1$';           -- 123123
    CONTINUE WHEN digits IN (
      '123456', '234567', '345678', '456789', '567890',
      '987654', '876543', '765432', '654321', '543210'
    );

    candidate := 'VARA-' || digits;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM customer WHERE ref = candidate);
  END LOOP;

  RETURN candidate;
END;
$$;
--> statement-breakpoint

-- Same treatment as the other vara5_ functions: the Supabase anon key shares
-- this database, and anything callable in public is reachable over /rest/v1/rpc.
REVOKE ALL ON FUNCTION "vara5_member_ref"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "vara5_member_ref"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "vara5_member_ref"() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT EXECUTE ON FUNCTION "vara5_member_ref"() TO postgres;
  END IF;
END $$;
--> statement-breakpoint

-- Existing clients keep their record and get a new reference. The audit trail
-- quotes references in its sentences, so those are rewritten in step with them;
-- otherwise the history would point at references that no longer exist.
--
-- This runs from the migrator, whose connection is not named "blackbook", so the
-- append-only trigger allows it. The application itself still cannot.
DO $$
DECLARE
  client  record;
  new_ref text;
BEGIN
  FOR client IN SELECT id, ref FROM customer WHERE ref LIKE 'CUST-%' ORDER BY ref LOOP
    new_ref := vara5_member_ref();

    UPDATE activity_log
       SET summary = replace(summary, client.ref, new_ref)
     WHERE summary LIKE '%' || client.ref || '%';

    UPDATE customer SET ref = new_ref WHERE id = client.id;
  END LOOP;
END $$;
