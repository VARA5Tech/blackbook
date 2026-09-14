-- The audit trail is append-only for the application, and only for the
-- application.
--
-- Before launch the owner needs to correct and clear audit entries freely, and
-- after launch a developer repairing data should not have to switch a lock off
-- and on around every statement. What the lock actually has to stop is the
-- running application, or a bug in it, rewriting history that staff rely on.
--
-- So the trigger now asks who is connected. The application's pool identifies
-- itself as application_name 'blackbook' (src/db/index.ts), and for that
-- connection the rules are unchanged: no deletes, and no updates except clearing
-- a client or household reference during erasure. Every other connection,
-- Supabase Studio, the SQL endpoint behind `pnpm db:query:prod`, psql, the
-- migrator, is not held to it.
--
-- application_name is set by the client and could be imitated, so this is a
-- guard against accidents, not against someone holding the database password.
-- Anyone with that password could always disable the trigger outright.
CREATE OR REPLACE FUNCTION "activity_log_is_append_only"()
RETURNS trigger AS $$
BEGIN
  IF current_setting('application_name', true) IS DISTINCT FROM 'blackbook' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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
