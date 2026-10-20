ALTER TABLE "enquiries" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "enquiries_assigned_idx" ON "enquiries" USING btree ("assigned_to","status");--> statement-breakpoint
-- Lead distribution: a lead (enquiry) assigned to someone is visible to and workable by that person even when it
-- belongs to another branch (head office spreads cold leads of all branches over telecallers). Policies are
-- permissive, so they ADD to the branch scope; nothing else of the other branch becomes visible.
CREATE OR REPLACE FUNCTION app_my_leads() RETURNS SETOF uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM enquiries WHERE assigned_to = app_user() $$;
--> statement-breakpoint
CREATE POLICY enquiries_assigned_read ON enquiries FOR SELECT USING (assigned_to = app_user());
--> statement-breakpoint
CREATE POLICY enquiries_assigned_update ON enquiries FOR UPDATE USING (assigned_to = app_user()) WITH CHECK (assigned_to = app_user());
--> statement-breakpoint
CREATE POLICY enquiry_events_assigned_read ON enquiry_events FOR SELECT USING (enquiry_id IN (SELECT app_my_leads()));
--> statement-breakpoint
CREATE POLICY enquiry_events_assigned_insert ON enquiry_events FOR INSERT WITH CHECK (enquiry_id IN (SELECT app_my_leads()));
--> statement-breakpoint
CREATE POLICY persons_assigned_read ON persons FOR SELECT USING (id IN (SELECT person_id FROM enquiries WHERE assigned_to = app_user()));
--> statement-breakpoint
CREATE POLICY persons_assigned_update ON persons FOR UPDATE USING (id IN (SELECT person_id FROM enquiries WHERE assigned_to = app_user())) WITH CHECK (id IN (SELECT person_id FROM enquiries WHERE assigned_to = app_user()));
--> statement-breakpoint
CREATE POLICY person_occupations_assigned_read ON person_occupations FOR SELECT USING (person_id IN (SELECT person_id FROM enquiries WHERE assigned_to = app_user()));
