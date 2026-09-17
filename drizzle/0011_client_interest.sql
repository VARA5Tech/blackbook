CREATE TYPE "public"."interest_kind" AS ENUM('opened', 'read', 'photos', 'video', 'cta_clicked');--> statement-breakpoint
CREATE TABLE "client_interest" (
	"id" uuid PRIMARY KEY DEFAULT vara5_uuid_v7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"title" text NOT NULL,
	"kind" "interest_kind" NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_interest_seconds_sane" CHECK (seconds >= 0 and seconds <= 86400)
);
--> statement-breakpoint
ALTER TABLE "client_interest" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_interest" ADD CONSTRAINT "client_interest_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_interest_customer_idx" ON "client_interest" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "client_interest_destination_idx" ON "client_interest" USING btree ("destination","occurred_at");--> statement-breakpoint

-- Supabase's default privileges grant anon and authenticated full rights on any
-- new table in public, so a table created now arrives reachable over
-- /rest/v1 unless they are taken away. Row-level security already refuses every
-- row, this is the second lock: if a policy is ever added here, the grant must
-- not already be waiting behind it. Same treatment as migration 0005.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "client_interest" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "client_interest" FROM authenticated;
  END IF;
END $$;
