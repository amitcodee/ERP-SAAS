-- Internship letters (Documents): interns, their selection letter and their completion certificate, made from editable
-- templates. A letter's text is frozen when it is issued, so a later template change never alters an issued letter.
CREATE TABLE "letter_templates" (
	"kind" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE letter_templates ADD CONSTRAINT letter_templates_kind_ck CHECK (kind IN ('internship_offer', 'internship_completion'));--> statement-breakpoint
ALTER TABLE letter_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE letter_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY letter_templates_read ON letter_templates FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY letter_templates_write ON letter_templates FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
CREATE POLICY student_deny ON letter_templates AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON letter_templates TO techcadd_app;--> statement-breakpoint
CREATE TABLE "internships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL REFERENCES "branches"("id"),
	"ref_no" text NOT NULL,
	"registration_id" uuid REFERENCES "registrations"("id"),
	"name" text NOT NULL,
	"gender" text,
	"phone" text,
	"email" text,
	"address" text,
	"designation" text NOT NULL,
	"domain" text,
	"training_from" date,
	"training_to" date,
	"training_location" text,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"stipend" integer,
	"work_location" text,
	"working_hours" text,
	"work_mode" text,
	"responsibilities" text,
	"skills" text,
	"project" text,
	"status" text DEFAULT 'offer_requested' NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offer_issued_by" uuid REFERENCES "users"("id"),
	"offer_issued_at" timestamp with time zone,
	"offer_text" text,
	"completion_requested_by" uuid REFERENCES "users"("id"),
	"completion_requested_at" timestamp with time zone,
	"completed_by" uuid REFERENCES "users"("id"),
	"completed_at" timestamp with time zone,
	"completion_text" text,
	"cancel_reason" text
);--> statement-breakpoint
ALTER TABLE internships ADD CONSTRAINT internships_ck CHECK (status IN ('offer_requested', 'offer_issued', 'completion_requested', 'completed', 'cancelled') AND to_date >= from_date AND (gender IS NULL OR gender IN ('male', 'female', 'other')) AND (stipend IS NULL OR stipend >= 0));--> statement-breakpoint
CREATE UNIQUE INDEX "internships_ref_uq" ON "internships" ("ref_no");--> statement-breakpoint
CREATE INDEX "internships_branch_idx" ON "internships" ("branch_id", "status", "to_date");--> statement-breakpoint
ALTER TABLE internships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE internships FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY internships_scope ON internships FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON internships AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON internships TO techcadd_app;
