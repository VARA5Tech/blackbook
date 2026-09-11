-- Search support for the Client 360 command palette and the clients list.
--
-- Requirement: search by Customer Name, Customer ID, Household ID and Mobile.
-- Postgres native search is used deliberately. At Vara5's data volume a
-- dedicated search service would be infrastructure without a payoff.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

--> statement-breakpoint

-- Weighted document per client. Names rank above city and email so a search
-- for "Delhi" never outranks a person actually called that.
ALTER TABLE "customer"
  ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("first_name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("last_name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("preferred_name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("ref", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("email", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("city", '')), 'D')
  ) STORED;

--> statement-breakpoint

CREATE INDEX "customer_search_document_idx"
  ON "customer" USING gin ("search_document");

--> statement-breakpoint

-- Trigram indexes carry the fuzzy half: misspelled names and partial numbers.
-- "Rishab" finds "Rishabh"; "98765" finds +91 98765 43210.
CREATE INDEX "customer_first_name_trgm_idx"
  ON "customer" USING gin ("first_name" gin_trgm_ops);

--> statement-breakpoint

CREATE INDEX "customer_last_name_trgm_idx"
  ON "customer" USING gin ("last_name" gin_trgm_ops);

--> statement-breakpoint

CREATE INDEX "customer_preferred_name_trgm_idx"
  ON "customer" USING gin ("preferred_name" gin_trgm_ops);

--> statement-breakpoint

CREATE INDEX "customer_mobile_trgm_idx"
  ON "customer" USING gin ("mobile_normalized" gin_trgm_ops);

--> statement-breakpoint

CREATE INDEX "customer_ref_trgm_idx"
  ON "customer" USING gin ("ref" gin_trgm_ops);

--> statement-breakpoint

CREATE INDEX "household_name_trgm_idx"
  ON "household" USING gin ("name" gin_trgm_ops);

--> statement-breakpoint

CREATE INDEX "household_ref_trgm_idx"
  ON "household" USING gin ("ref" gin_trgm_ops);

--> statement-breakpoint

-- The activity log is append-only. Enforced in the database so no future
-- service, script or AI tool can quietly rewrite the audit trail.
CREATE OR REPLACE FUNCTION "activity_log_is_append_only"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

CREATE TRIGGER "activity_log_no_update"
  BEFORE UPDATE OR DELETE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION "activity_log_is_append_only"();
