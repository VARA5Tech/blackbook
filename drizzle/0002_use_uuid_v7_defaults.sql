ALTER TABLE "client_directive" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "customer" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "customer" ALTER COLUMN "ref" SET DEFAULT vara5_ref('CUST-', nextval('customer_ref_seq'));--> statement-breakpoint
ALTER TABLE "household" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "household" ALTER COLUMN "ref" SET DEFAULT vara5_ref('HH-', nextval('household_ref_seq'));--> statement-breakpoint
ALTER TABLE "customer_preference" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "preference_option" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "activity_log" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "interaction" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "milestone" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "id" SET DEFAULT vara5_uuid_v7();