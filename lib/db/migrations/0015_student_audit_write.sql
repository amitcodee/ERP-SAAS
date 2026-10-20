-- Students own actions (e.g. requesting a certificate) must be audited, so they may INSERT audit rows,
-- but they can never READ the audit log.
DROP POLICY student_deny ON audit_logs;
--> statement-breakpoint
CREATE POLICY student_no_read ON audit_logs AS RESTRICTIVE FOR SELECT USING (app_role() <> 'student');
