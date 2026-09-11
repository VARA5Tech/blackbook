CREATE TYPE "public"."activity_action" AS ENUM('created', 'updated', 'archived', 'restored', 'linked', 'unlinked', 'interaction_logged', 'preference_updated');--> statement-breakpoint
CREATE TYPE "public"."activity_entity" AS ENUM('customer', 'household', 'milestone', 'interaction', 'task', 'preference');--> statement-breakpoint
CREATE TYPE "public"."booking_lead_time" AS ENUM('last_minute', 'under_1_month', 'one_to_three_months', 'three_to_six_months', 'six_months_plus');--> statement-breakpoint
CREATE TYPE "public"."budget_range" AS ENUM('upto_5l', '5l_10l', '10l_25l', '25l_50l', '50l_plus', 'no_ceiling');--> statement-breakpoint
CREATE TYPE "public"."cabin_class" AS ENUM('economy', 'premium_economy', 'business', 'first', 'private');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."dietary_preference" AS ENUM('no_restriction', 'vegetarian', 'vegan', 'jain', 'halal', 'kosher', 'pescatarian', 'gluten_free', 'other');--> statement-breakpoint
CREATE TYPE "public"."direct_flight_preference" AS ENUM('always_direct', 'prefer_direct', 'no_preference');--> statement-breakpoint
CREATE TYPE "public"."directive_kind" AS ENUM('do', 'dont');--> statement-breakpoint
CREATE TYPE "public"."experience_style" AS ENUM('private_bespoke', 'small_group', 'exclusive_access', 'off_the_beaten_path', 'classic_highlights', 'relaxed_unstructured');--> statement-breakpoint
CREATE TYPE "public"."fine_dining_preference" AS ENUM('essential', 'enjoys', 'occasional', 'prefers_casual');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('primary', 'spouse', 'partner', 'child', 'parent', 'sibling', 'other');--> statement-breakpoint
CREATE TYPE "public"."household_travel_pattern" AS ENUM('couple', 'family', 'multi_generational');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('call', 'whatsapp', 'email', 'meeting', 'trip', 'note', 'other');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."milestone_type" AS ENUM('birthday', 'wedding_anniversary', 'work_anniversary', 'religious', 'memorial', 'other');--> statement-breakpoint
CREATE TYPE "public"."preference_kind" AS ENUM('destination', 'travel_style', 'travel_season', 'hotel_brand', 'hotel_property', 'room_type', 'bed_preference', 'view_preference', 'airline', 'loyalty_programme', 'seat_preference', 'flight_timing', 'cuisine', 'restaurant', 'allergy', 'beverage_preference', 'interest', 'activity', 'luxury_brand');--> statement-breakpoint
CREATE TYPE "public"."preference_polarity" AS ENUM('prefer', 'wishlist', 'avoid');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."travel_frequency" AS ENUM('less_than_once_a_year', 'one_to_two_per_year', 'three_to_four_per_year', 'five_plus_per_year');--> statement-breakpoint
CREATE TYPE "public"."travelling_party" AS ENUM('solo', 'couple', 'family_young_children', 'family_teens', 'multi_generational', 'friends', 'business');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager', 'rm', 'viewer');--> statement-breakpoint
CREATE SEQUENCE "public"."customer_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."household_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100 CACHE 1;--> statement-breakpoint
CREATE TABLE "app_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_directive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "directive_kind" NOT NULL,
	"body" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text DEFAULT 'CUST-' || lpad(nextval('customer_ref_seq')::text, 5, '0') NOT NULL,
	"household_id" uuid,
	"household_role" "household_role",
	"first_name" text NOT NULL,
	"last_name" text,
	"preferred_name" text,
	"mobile" text,
	"mobile_normalized" text GENERATED ALWAYS AS (nullif(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), '')) STORED,
	"whatsapp" text,
	"whatsapp_normalized" text GENERATED ALWAYS AS (nullif(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), '')) STORED,
	"email" text,
	"date_of_birth" date,
	"gender" "gender",
	"nationality" text,
	"city" text,
	"address" text,
	"location_url" text,
	"location_lat" text,
	"location_lng" text,
	"primary_rm_id" text,
	"customer_since" date DEFAULT now() NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"client_dna" text,
	"last_interaction_at" timestamp with time zone,
	"profile_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "customer_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text DEFAULT 'HH-' || lpad(nextval('household_ref_seq')::text, 5, '0') NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"primary_customer_id" uuid,
	"travel_pattern" "household_travel_pattern",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "household_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "customer_preference_profile" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"travel_typical_trip_nights" integer,
	"travel_party" "travelling_party",
	"travel_frequency" "travel_frequency",
	"travel_budget_range" "budget_range",
	"travel_booking_lead_time" "booking_lead_time",
	"travel_notes" text,
	"hotel_notes" text,
	"flight_cabin" "cabin_class",
	"flight_direct_preference" "direct_flight_preference",
	"flight_notes" text,
	"dining_dietary" "dietary_preference",
	"dining_fine_dining" "fine_dining_preference",
	"dining_notes" text,
	"lifestyle_experience_style" "experience_style",
	"lifestyle_notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "customer_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"polarity" "preference_polarity" DEFAULT 'prefer' NOT NULL,
	"note" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "preference_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "preference_kind" NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"grouping" text,
	"is_custom" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "activity_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "activity_action" NOT NULL,
	"customer_id" uuid,
	"household_id" uuid,
	"summary" text NOT NULL,
	"changes" jsonb,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"household_id" uuid,
	"type" "interaction_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"logged_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_owner_check" CHECK (customer_id is not null or household_id is not null)
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"household_id" uuid,
	"type" "milestone_type" NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"recurs_annually" boolean DEFAULT true NOT NULL,
	"month_of_year" smallint GENERATED ALWAYS AS (extract(month from date)::smallint) STORED,
	"day_of_month" smallint GENERATED ALWAYS AS (extract(day from date)::smallint) STORED,
	"celebration_style" text,
	"notes" text,
	"reminder_days_before" integer[] DEFAULT '{30,7,1}' NOT NULL,
	"status" "milestone_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "milestone_owner_check" CHECK ((customer_id is not null) <> (household_id is not null))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"customer_id" uuid,
	"household_id" uuid,
	"assignee_id" text,
	"due_date" date,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_account" ADD CONSTRAINT "app_account_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session" ADD CONSTRAINT "app_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_directive" ADD CONSTRAINT "client_directive_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_primary_rm_id_app_user_id_fk" FOREIGN KEY ("primary_rm_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_primary_customer_id_customer_id_fk" FOREIGN KEY ("primary_customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preference_profile" ADD CONSTRAINT "customer_preference_profile_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preference_profile" ADD CONSTRAINT "customer_preference_profile_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preference" ADD CONSTRAINT "customer_preference_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preference" ADD CONSTRAINT "customer_preference_option_id_preference_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."preference_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preference" ADD CONSTRAINT "customer_preference_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_option" ADD CONSTRAINT "preference_option_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_logged_by_app_user_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_account_user_idx" ON "app_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_session_user_idx" ON "app_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_user_role_idx" ON "app_user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "app_verification_identifier_idx" ON "app_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "client_directive_customer_idx" ON "client_directive" USING btree ("customer_id","kind");--> statement-breakpoint
CREATE INDEX "customer_household_idx" ON "customer" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "customer_rm_idx" ON "customer" USING btree ("primary_rm_id");--> statement-breakpoint
CREATE INDEX "customer_status_idx" ON "customer" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customer_archived_idx" ON "customer" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "customer_last_interaction_idx" ON "customer" USING btree ("last_interaction_at");--> statement-breakpoint
CREATE INDEX "customer_mobile_normalized_idx" ON "customer" USING btree ("mobile_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_mobile_unique_active" ON "customer" USING btree ("mobile_normalized") WHERE archived_at is null and mobile_normalized is not null;--> statement-breakpoint
CREATE INDEX "household_name_idx" ON "household" USING btree ("name");--> statement-breakpoint
CREATE INDEX "household_city_idx" ON "household" USING btree ("city");--> statement-breakpoint
CREATE INDEX "household_archived_idx" ON "household" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_preference_unique" ON "customer_preference" USING btree ("customer_id","option_id","polarity");--> statement-breakpoint
CREATE INDEX "customer_preference_customer_idx" ON "customer_preference" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_preference_option_idx" ON "customer_preference" USING btree ("option_id","polarity");--> statement-breakpoint
CREATE UNIQUE INDEX "preference_option_kind_slug_unique" ON "preference_option" USING btree ("kind","slug");--> statement-breakpoint
CREATE INDEX "preference_option_kind_idx" ON "preference_option" USING btree ("kind","sort_order");--> statement-breakpoint
CREATE INDEX "preference_option_label_idx" ON "preference_option" USING btree ("label");--> statement-breakpoint
CREATE INDEX "activity_log_customer_idx" ON "activity_log" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_household_idx" ON "activity_log" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_log_created_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "interaction_customer_idx" ON "interaction" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "interaction_household_idx" ON "interaction" USING btree ("household_id","occurred_at");--> statement-breakpoint
CREATE INDEX "milestone_customer_idx" ON "milestone" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "milestone_household_idx" ON "milestone" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "milestone_upcoming_idx" ON "milestone" USING btree ("month_of_year","day_of_month","status");--> statement-breakpoint
CREATE INDEX "milestone_type_idx" ON "milestone" USING btree ("type");--> statement-breakpoint
CREATE INDEX "task_assignee_idx" ON "task" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "task_customer_idx" ON "task" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "task_due_idx" ON "task" USING btree ("due_date","status");