CREATE TYPE "public"."lead_status" AS ENUM('new', 'acknowledged', 'planning', 'booking', 'won', 'dropped');--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT vara5_uuid_v7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"interest_id" uuid,
	"destination" text NOT NULL,
	"title" text NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"assignee_id" text,
	"assigned_at" timestamp with time zone,
	"assigned_by" text,
	"task_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp with time zone,
	"outcome_note" text,
	"dropped_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_interest_id_client_interest_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."client_interest"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "identity"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_by_app_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "identity"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_acknowledged_by_app_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "identity"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_status_idx" ON "lead" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "lead_assignee_idx" ON "lead" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "lead_customer_idx" ON "lead" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_open_per_destination_unique" ON "lead" USING btree ("customer_id","destination") WHERE status not in ('won', 'dropped');