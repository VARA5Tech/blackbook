-- One number, one client, enforced by the database.
--
-- The partial unique index only ever covered mobile against mobile. Two active
-- clients could still collide on WhatsApp, or one client's mobile against
-- another's WhatsApp, and the private access gate refuses an ambiguous number
-- rather than guessing, so that collision locks both of them out of the
-- website. The service checks both columns already; this closes the same hole
-- for an import, a script or a hand-written statement.
--
-- It is a trigger rather than an index because the rule spans two columns and
-- two rows, which no unique index can express. AFTER, not BEFORE, because
-- mobile_normalized is a generated column and generated values are not yet
-- computed while a BEFORE trigger runs.

CREATE OR REPLACE FUNCTION "vara5_assert_phone_is_unique"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  clash     record;
BEGIN
  -- An archived client releases their numbers, exactly as the old index did.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  FOREACH candidate IN ARRAY ARRAY[NEW.mobile_normalized, NEW.whatsapp_normalized] LOOP
    CONTINUE WHEN candidate IS NULL;

    /*
     * Two transactions inserting the same number at the same moment would both
     * see nothing and both commit. The lock is keyed on the number itself, so
     * they queue behind each other and the second one sees the first.
     */
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate, 0));

    SELECT c.ref INTO clash
    FROM customer c
    WHERE c.archived_at IS NULL
      AND c.id <> NEW.id
      AND (c.mobile_normalized = candidate OR c.whatsapp_normalized = candidate)
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'That number already belongs to %', clash.ref
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Same treatment as every other function here: the Supabase anon key shares this
-- database, and anything callable in public is reachable over /rest/v1/rpc.
REVOKE ALL ON FUNCTION "vara5_assert_phone_is_unique"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "vara5_assert_phone_is_unique"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "vara5_assert_phone_is_unique"() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT EXECUTE ON FUNCTION "vara5_assert_phone_is_unique"() TO postgres;
  END IF;
END $$;
--> statement-breakpoint

-- Generated columns cannot be named in UPDATE OF, so the trigger watches the
-- columns they are derived from, plus the archive flag that releases a number.
DROP TRIGGER IF EXISTS "customer_phone_is_unique" ON "customer";
--> statement-breakpoint
CREATE TRIGGER "customer_phone_is_unique"
AFTER INSERT OR UPDATE OF "mobile", "whatsapp", "archived_at" ON "customer"
FOR EACH ROW
EXECUTE FUNCTION "vara5_assert_phone_is_unique"();
--> statement-breakpoint

-- Nothing in the existing data may already break the rule, or the first edit to
-- an untouched client would fail for a reason nobody could see.
DO $$
DECLARE
  offenders int;
BEGIN
  SELECT count(*) INTO offenders
  FROM customer a
  JOIN customer b
    ON b.id <> a.id
   AND b.archived_at IS NULL
   AND (
     b.mobile_normalized = a.mobile_normalized
     OR b.whatsapp_normalized = a.whatsapp_normalized
     OR b.mobile_normalized = a.whatsapp_normalized
   )
  WHERE a.archived_at IS NULL
    AND (a.mobile_normalized IS NOT NULL OR a.whatsapp_normalized IS NOT NULL);

  IF offenders > 0 THEN
    RAISE EXCEPTION 'Two active clients already share a number (% pairs). Fix them before applying this migration.', offenders;
  END IF;
END $$;
