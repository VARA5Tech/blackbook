-- Moves the single-valued preferences onto the client record.
--
-- `customer_preference_profile` held one row per client, created eagerly at
-- client creation so that every later edit could be an update rather than an
-- upsert. A row that always exists, never repeats and carries no fields of its
-- own is a set of columns. Keeping it apart cost a join on Client 360 and a
-- second write on every save.
--
-- `customer_preference` is untouched: those rows point at a catalogue option
-- and carry a polarity, a note, a rank and the membership fields, and they are
-- what answers "who avoids large resorts".
--
-- No client identity field is read or written here. Nothing touches `mobile`,
-- `whatsapp`, either normalised column or `archived_at`, so the uniqueness
-- trigger, which watches exactly those, never fires.

ALTER TABLE "customer"
  ADD COLUMN "travel_typical_trip_nights" integer,
  ADD COLUMN "travel_party" "public"."travelling_party",
  ADD COLUMN "travel_frequency" "public"."travel_frequency",
  ADD COLUMN "travel_budget_range" "public"."budget_range",
  ADD COLUMN "travel_booking_lead_time" "public"."booking_lead_time",
  ADD COLUMN "travel_notes" text,
  ADD COLUMN "hotel_notes" text,
  ADD COLUMN "flight_cabin" "public"."cabin_class",
  ADD COLUMN "flight_direct_preference" "public"."direct_flight_preference",
  ADD COLUMN "flight_notes" text,
  ADD COLUMN "dining_dietary" "public"."dietary_preference",
  ADD COLUMN "dining_fine_dining" "public"."fine_dining_preference",
  ADD COLUMN "dining_notes" text,
  ADD COLUMN "lifestyle_experience_style" "public"."experience_style",
  ADD COLUMN "lifestyle_notes" text,
  ADD COLUMN "preferences_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "preferences_updated_by" text;
--> statement-breakpoint

ALTER TABLE "customer"
  ADD CONSTRAINT "customer_preferences_updated_by_app_user_id_fk"
  FOREIGN KEY ("preferences_updated_by") REFERENCES "public"."app_user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- `preferences_updated_at` is kept distinct from the client's own
-- `profile_updated_at`, which also moves when the Client DNA narrative is
-- saved. On the day this migration was written they already disagreed for 29
-- of 39 clients, so they are two facts and both are carried across.
UPDATE "customer" AS c
SET "travel_typical_trip_nights" = p."travel_typical_trip_nights",
    "travel_party"               = p."travel_party",
    "travel_frequency"           = p."travel_frequency",
    "travel_budget_range"        = p."travel_budget_range",
    "travel_booking_lead_time"   = p."travel_booking_lead_time",
    "travel_notes"               = p."travel_notes",
    "hotel_notes"                = p."hotel_notes",
    "flight_cabin"               = p."flight_cabin",
    "flight_direct_preference"   = p."flight_direct_preference",
    "flight_notes"               = p."flight_notes",
    "dining_dietary"             = p."dining_dietary",
    "dining_fine_dining"         = p."dining_fine_dining",
    "dining_notes"               = p."dining_notes",
    "lifestyle_experience_style" = p."lifestyle_experience_style",
    "lifestyle_notes"            = p."lifestyle_notes",
    "preferences_updated_at"     = p."updated_at",
    "preferences_updated_by"     = p."updated_by"
FROM "customer_preference_profile" AS p
WHERE c."id" = p."customer_id";
--> statement-breakpoint

-- The profile rows are about to be destroyed, so the copy is proved first,
-- field by field rather than by counting rows. A mismatch aborts the migration
-- and the transaction takes the new columns back out with it.
DO $$
DECLARE
  unmatched integer;
  orphans integer;
BEGIN
  SELECT count(*) INTO orphans
  FROM "customer_preference_profile" p
  LEFT JOIN "customer" c ON c."id" = p."customer_id"
  WHERE c."id" IS NULL;

  IF orphans > 0 THEN
    RAISE EXCEPTION 'Aborting: % preference profiles belong to no client', orphans;
  END IF;

  SELECT count(*) INTO unmatched
  FROM "customer_preference_profile" p
  JOIN "customer" c ON c."id" = p."customer_id"
  WHERE (c."travel_typical_trip_nights", c."travel_party", c."travel_frequency",
         c."travel_budget_range", c."travel_booking_lead_time", c."travel_notes",
         c."hotel_notes", c."flight_cabin", c."flight_direct_preference",
         c."flight_notes", c."dining_dietary", c."dining_fine_dining",
         c."dining_notes", c."lifestyle_experience_style", c."lifestyle_notes",
         c."preferences_updated_at", c."preferences_updated_by")
    IS DISTINCT FROM
        (p."travel_typical_trip_nights", p."travel_party", p."travel_frequency",
         p."travel_budget_range", p."travel_booking_lead_time", p."travel_notes",
         p."hotel_notes", p."flight_cabin", p."flight_direct_preference",
         p."flight_notes", p."dining_dietary", p."dining_fine_dining",
         p."dining_notes", p."lifestyle_experience_style", p."lifestyle_notes",
         p."updated_at", p."updated_by");

  IF unmatched > 0 THEN
    RAISE EXCEPTION
      'Aborting: % preference profiles did not copy across field for field', unmatched;
  END IF;
END $$;
--> statement-breakpoint

DROP TABLE "customer_preference_profile";
