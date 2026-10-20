-- How a registration's fee is paid (in full or in installments, and on what schedule), and requests to change a
-- student's total fees: anyone in admissions can ask, only accounts decides.
ALTER TABLE "registrations" ADD COLUMN "fee_plan" jsonb;--> statement-breakpoint
CREATE TABLE "fee_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id"),
	"registration_id" uuid NOT NULL REFERENCES "registrations"("id"),
	"current_total" integer NOT NULL,
	"new_total" integer NOT NULL,
	"requested_plan" jsonb,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid REFERENCES "users"("id"),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid REFERENCES "users"("id"),
	"decided_at" timestamp with time zone,
	"decision_note" text
);--> statement-breakpoint
ALTER TABLE fee_change_requests ADD CONSTRAINT fee_change_requests_ck CHECK (status IN ('pending', 'approved', 'rejected') AND new_total > 0);--> statement-breakpoint
CREATE INDEX "fee_change_requests_branch_idx" ON "fee_change_requests" ("branch_id", "status", "requested_at");--> statement-breakpoint
-- one open request per registration
CREATE UNIQUE INDEX "fee_change_requests_open_uq" ON "fee_change_requests" ("registration_id") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE fee_change_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fee_change_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fee_change_requests_scope ON fee_change_requests FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON fee_change_requests AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON fee_change_requests TO techcadd_app;
