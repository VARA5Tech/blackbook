ALTER TABLE "customer" ADD COLUMN "ea_name" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "ea_email" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "ea_phone" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "ea_phone_normalized" text GENERATED ALWAYS AS (nullif(regexp_replace(coalesce(ea_phone, ''), '[^0-9]', '', 'g'), '')) STORED;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "ea_notes" text;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "ea_name" text;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "ea_email" text;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "ea_phone" text;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "ea_phone_normalized" text GENERATED ALWAYS AS (nullif(regexp_replace(coalesce(ea_phone, ''), '[^0-9]', '', 'g'), '')) STORED;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "ea_notes" text;