-- Lead distribution for random calls: a call can be given to someone to follow up, like an enquiry (0027).
-- The person sees and works the calls given to them even when the call belongs to another branch.
ALTER TABLE "calls" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_assigned_idx" ON "calls" USING btree ("assigned_to");--> statement-breakpoint
CREATE POLICY calls_assigned_read ON calls FOR SELECT USING (assigned_to = app_user());
--> statement-breakpoint
CREATE POLICY calls_assigned_update ON calls FOR UPDATE USING (assigned_to = app_user()) WITH CHECK (assigned_to = app_user());
--> statement-breakpoint
CREATE POLICY call_followups_assigned_read ON call_followups FOR SELECT USING (call_id IN (SELECT id FROM calls WHERE assigned_to = app_user()));
--> statement-breakpoint
CREATE POLICY call_followups_assigned_insert ON call_followups FOR INSERT WITH CHECK (call_id IN (SELECT id FROM calls WHERE assigned_to = app_user()));
--> statement-breakpoint
CREATE POLICY persons_assigned_call_read ON persons FOR SELECT USING (id IN (SELECT person_id FROM calls WHERE assigned_to = app_user()));
