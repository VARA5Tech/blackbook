-- The audit trail becomes a plain table.
--
-- Until now a trigger refused updates and deletes from the application's own
-- pool (application_name 'blackbook'), while Studio, psql and the SQL endpoint
-- were free. The owner has chosen to drop that lock: the trail is still written
-- by every service and still only appended to by the application's code, but
-- the database no longer enforces it, so nothing ties the data layer to one
-- connection name. Correcting or clearing entries stays a developer's job.
--
-- Nothing in the application depended on the refusal. Erasure's referential
-- SET NULL onto customer_id and household_id is an ordinary UPDATE either way.
DROP TRIGGER IF EXISTS "activity_log_no_update" ON "activity_log";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "activity_log_is_append_only"();
