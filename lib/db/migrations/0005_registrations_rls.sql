-- Branch-scoped RLS for registrations; history is append-only.
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registration_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registration_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY registrations_scope ON registrations FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY registration_events_read ON registration_events FOR SELECT USING (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY registration_events_insert ON registration_events FOR INSERT WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON registrations TO techcadd_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON registration_events TO techcadd_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON registration_events FROM techcadd_app;
--> statement-breakpoint
CREATE TRIGGER registration_events_immutable BEFORE UPDATE OR DELETE ON registration_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
