-- Notification outbox: branch-scoped; rows are never deleted.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_scope ON notifications FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notifications TO techcadd_app;
