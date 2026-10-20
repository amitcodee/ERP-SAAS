ALTER TABLE "enquiries" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "legacy_reg_no" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_legacy_uq" UNIQUE("branch_id","legacy_ref");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_legacy_uq" UNIQUE("branch_id","legacy_reg_no");