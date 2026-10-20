-- Branch-scoped RLS for the admissions funnel; enquiry history is append-only.
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE persons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE person_occupations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE person_occupations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enquiries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enquiry_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enquiry_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY persons_scope ON persons FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY person_occupations_scope ON person_occupations FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY calls_scope ON calls FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY enquiries_scope ON enquiries FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY enquiry_events_read ON enquiry_events FOR SELECT USING (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY enquiry_events_insert ON enquiry_events FOR INSERT WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON enquiry_events FROM techcadd_app;
--> statement-breakpoint
CREATE TRIGGER enquiry_events_immutable BEFORE UPDATE OR DELETE ON enquiry_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON persons, person_occupations, calls, enquiries TO techcadd_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON enquiry_events TO techcadd_app;
