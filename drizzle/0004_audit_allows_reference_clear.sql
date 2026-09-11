-- Refine the append-only rule so erasure is possible.
--
-- Migration 0003 pointed the audit trail's client and household references at
-- SET NULL. A referential SET NULL is itself an UPDATE, which the blanket
-- append-only trigger rejected, so erasing a client still failed.
--
-- The rule is therefore narrowed: DELETE is never allowed, and an UPDATE is
-- allowed only when it does nothing but clear a client or household reference.
-- What happened, when, and who did it all remain immutable.

CREATE OR REPLACE FUNCTION "activity_log_is_append_only"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'activity_log is append-only: DELETE is not permitted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."entity_type" IS DISTINCT FROM OLD."entity_type"
     OR NEW."entity_id" IS DISTINCT FROM OLD."entity_id"
     OR NEW."action" IS DISTINCT FROM OLD."action"
     OR NEW."summary" IS DISTINCT FROM OLD."summary"
     OR NEW."changes" IS DISTINCT FROM OLD."changes"
     OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     -- A reference may only be cleared, never repointed at someone else.
     OR (NEW."customer_id" IS NOT NULL
         AND NEW."customer_id" IS DISTINCT FROM OLD."customer_id")
     OR (NEW."household_id" IS NOT NULL
         AND NEW."household_id" IS DISTINCT FROM OLD."household_id")
  THEN
    RAISE EXCEPTION
      'activity_log is append-only: only clearing a client or household reference is permitted';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
