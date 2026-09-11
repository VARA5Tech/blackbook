-- Let a client be erased without destroying the audit trail.
--
-- The activity log is append-only (migration 0001), so a cascading delete from
-- `customer` raised an exception and made hard deletion impossible. That is the
-- wrong trade-off: the ops team must be able to honour an erasure request,
-- while the record that something happened has to survive.
--
-- Pointing these two columns at SET NULL keeps both: the client row can go, and
-- the audit rows remain with their client reference cleared.

ALTER TABLE "activity_log"
  DROP CONSTRAINT IF EXISTS "activity_log_customer_id_customer_id_fk";

--> statement-breakpoint

ALTER TABLE "activity_log"
  ADD CONSTRAINT "activity_log_customer_id_customer_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL;

--> statement-breakpoint

ALTER TABLE "activity_log"
  DROP CONSTRAINT IF EXISTS "activity_log_household_id_household_id_fk";

--> statement-breakpoint

ALTER TABLE "activity_log"
  ADD CONSTRAINT "activity_log_household_id_household_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE SET NULL;
