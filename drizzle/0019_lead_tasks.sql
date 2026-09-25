ALTER TABLE "lead" DROP CONSTRAINT "lead_task_id_task_id_fk";
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_lead_idx" ON "task" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "task_id";