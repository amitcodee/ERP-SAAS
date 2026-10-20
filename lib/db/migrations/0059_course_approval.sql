-- Courses get the same approval step as course categories: head office adds approved courses; a branch admin adds
-- one, which waits until head office approves it (only approved courses appear in the pick-lists).
ALTER TABLE "courses" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "requested_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "requested_branch_id" uuid REFERENCES "branches"("id");--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "decided_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE courses ADD CONSTRAINT courses_status_ck CHECK (status IN ('approved', 'pending', 'rejected'));--> statement-breakpoint
-- a branch may add a course (pending, for its own branch) and change it while it waits; head office does the rest
CREATE POLICY courses_branch_request ON courses FOR INSERT WITH CHECK (NOT app_is_super() AND status = 'pending' AND requested_branch_id = app_branch());--> statement-breakpoint
CREATE POLICY courses_branch_edit ON courses FOR UPDATE USING (NOT app_is_super() AND status = 'pending' AND requested_branch_id = app_branch()) WITH CHECK (status = 'pending' AND requested_branch_id = app_branch());
