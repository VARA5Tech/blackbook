ALTER TABLE "customer" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "customer_preference" ADD COLUMN "membership_number" text;--> statement-breakpoint
ALTER TABLE "customer_preference" ADD COLUMN "membership_tier" text;--> statement-breakpoint
CREATE INDEX "customer_preference_membership_idx" ON "customer_preference" USING btree ("membership_number");