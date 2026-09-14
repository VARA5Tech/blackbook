-- Client search also finds a client by their executive assistant's name and
-- email. search_document is a generated column, so its expression can only
-- change by dropping and re-adding it; its GIN index goes with it and is
-- rebuilt below.
ALTER TABLE "customer" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "customer"
  ADD COLUMN "search_document" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("first_name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("last_name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("preferred_name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("ref", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("email", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("ea_name", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("ea_email", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("city", '')), 'D')
  ) STORED;
--> statement-breakpoint
CREATE INDEX "customer_search_document_idx"
  ON "customer" USING gin ("search_document");
--> statement-breakpoint
-- Partial assistant numbers, the same way "98765" finds a client's mobile.
CREATE INDEX "customer_ea_phone_trgm_idx"
  ON "customer" USING gin ("ea_phone_normalized" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "household_ea_phone_trgm_idx"
  ON "household" USING gin ("ea_phone_normalized" gin_trgm_ops);
