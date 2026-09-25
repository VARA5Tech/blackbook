CREATE TYPE "public"."trip_status" AS ENUM('inbound', 'planning', 'booked', 'traveling', 'traveled', 'cancelled', 'archived');--> statement-breakpoint
CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT vara5_uuid_v7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"household_id" uuid,
	"title" text NOT NULL,
	"status" "trip_status" DEFAULT 'planning' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"dates_text" text,
	"party_size" integer,
	"currency" text,
	"curator_name" text,
	"travelers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"itinerary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"tern_id" text,
	"tern_raw" jsonb,
	"tern_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "trip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "prefix" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "middle_name" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "suffix" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "travel_documents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "tern_id" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "tern_raw" jsonb;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "tern_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "flight_seat" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "flight_bulkhead" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "hotel_room_floor" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "hotel_room_elevator" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "cruise_deck" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "cruise_cabin_position" text;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_customer_idx" ON "trip" USING btree ("customer_id","starts_on");--> statement-breakpoint
CREATE INDEX "trip_status_idx" ON "trip" USING btree ("status","starts_on");--> statement-breakpoint
CREATE INDEX "trip_travelers_idx" ON "trip" USING gin ("travelers" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "trip_tern_id_unique" ON "trip" USING btree ("tern_id") WHERE tern_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tern_id_unique" ON "customer" USING btree ("tern_id") WHERE tern_id is not null;--> statement-breakpoint
-- Supabase's default privileges grant anon and authenticated full rights on any
-- new table in public. Row security already refuses every row; this is the
-- second lock, the one that matters if a policy is ever added. Same block as
-- migrations 0011 and 0021.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "trip" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "trip" FROM authenticated;
  END IF;
END $$;
