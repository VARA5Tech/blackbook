-- Moves DO and DON'T directives from their own table onto the client record.
--
-- They were only ever read for one client, only ever written all at once, and
-- their running order was already the order the editor sent them in. That is an
-- array, not a table: this drops a table, an enum, an index and a join.
--
-- Nothing client-facing changes. The bodies are copied verbatim, in order, and
-- the table is dropped only after a count proves every row arrived.

ALTER TABLE "customer"
  ADD COLUMN "dos" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "donts" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

-- created_at breaks a tie, so two directives saved with the same sort_order
-- keep the order they were written in rather than an arbitrary one.
UPDATE "customer" AS c
SET "dos" = coalesce(d.dos, '{}'),
    "donts" = coalesce(d.donts, '{}')
FROM (
  SELECT
    "customer_id",
    array_agg("body" ORDER BY "sort_order", "created_at")
      FILTER (WHERE "kind" = 'do')   AS dos,
    array_agg("body" ORDER BY "sort_order", "created_at")
      FILTER (WHERE "kind" = 'dont') AS donts
  FROM "client_directive"
  GROUP BY "customer_id"
) AS d
WHERE c."id" = d."customer_id";
--> statement-breakpoint

-- The directive rows are about to be destroyed, so the copy is checked before
-- rather than after. A mismatch aborts the migration with both numbers, and
-- the transaction takes the new columns back out with it.
DO $$
DECLARE
  rows_before integer;
  entries_after integer;
  orphans integer;
BEGIN
  SELECT count(*) INTO rows_before FROM "client_directive";

  SELECT coalesce(sum(cardinality("dos") + cardinality("donts")), 0)
    INTO entries_after FROM "customer";

  -- A directive whose client is already gone would be counted above and never
  -- copied. There is a cascading foreign key, so this should be zero.
  SELECT count(*) INTO orphans
  FROM "client_directive" d
  LEFT JOIN "customer" c ON c."id" = d."customer_id"
  WHERE c."id" IS NULL;

  IF orphans > 0 THEN
    RAISE EXCEPTION 'Aborting: % directives belong to no client', orphans;
  END IF;

  IF rows_before <> entries_after THEN
    RAISE EXCEPTION
      'Aborting: % directive rows but % array entries after the copy',
      rows_before, entries_after;
  END IF;
END $$;
--> statement-breakpoint

DROP TABLE "client_directive";
--> statement-breakpoint
DROP TYPE "public"."directive_kind";
