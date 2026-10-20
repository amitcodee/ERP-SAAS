-- Random calls get lead details (what the caller said, how interested, when they plan to visit, why a lead died)
-- and a follow-up history: every follow-up call is one row, and the call itself always shows the latest state.
ALTER TABLE "calls" ADD COLUMN "call_remark" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "interested" boolean;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "interest_pct" integer;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "expected_visit_date" date;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "dead_reason" text;--> statement-breakpoint
ALTER TABLE calls ADD CONSTRAINT calls_interest_ck CHECK (interest_pct IS NULL OR (interested IS TRUE AND interest_pct BETWEEN 0 AND 100));
--> statement-breakpoint
CREATE TABLE "call_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user" uuid,
	"status" text,
	"call_remark" text,
	"remarks" text,
	"interested" boolean,
	"interest_pct" integer,
	"next_follow_up" date,
	"expected_visit_date" date,
	"dead_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_followups" ADD CONSTRAINT "call_followups_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_followups" ADD CONSTRAINT "call_followups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_followups" ADD CONSTRAINT "call_followups_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_followups_call_idx" ON "call_followups" USING btree ("call_id","called_at");
--> statement-breakpoint
ALTER TABLE call_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE call_followups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY call_followups_scope ON call_followups FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY student_deny ON call_followups AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON call_followups TO techcadd_app;
