CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT vara5_uuid_v7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"trip_id" uuid,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"kind" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"stored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_customer_idx" ON "document" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "document_trip_idx" ON "document" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_storage_key_unique" ON "document" USING btree ("storage_key");--> statement-breakpoint
-- Supabase default privileges grant anon/authenticated on new public tables;
-- RLS refuses the rows, this is the second lock. Same block as 0011, 0021, 0024.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "document" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "document" FROM authenticated;
  END IF;
END $$;
