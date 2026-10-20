-- Student portal isolation, enforced by the database (not just the app).
-- RESTRICTIVE policies are ANDed with the existing branch policies: a student sees only rows
-- that belong to their own person, and nothing at all from staff-only tables.
CREATE OR REPLACE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.role', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_person() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;
--> statement-breakpoint

-- staff-only tables: students see nothing
CREATE POLICY student_deny ON enquiries AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON enquiry_events AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON calls AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON person_occupations AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON notifications AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON batches AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON batch_members AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON class_sessions AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON audit_logs AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_deny ON number_sequences AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint

-- own-row tables
CREATE POLICY student_own ON persons AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR id = app_person());
--> statement-breakpoint
CREATE POLICY student_own ON registrations AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR person_id = app_person());
--> statement-breakpoint
CREATE POLICY student_own ON users AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR id = app_user());
--> statement-breakpoint
CREATE POLICY student_own ON user_roles AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR user_id = app_user());
--> statement-breakpoint

-- tables hanging off a registration: visible only if the registration itself is visible (i.e. is theirs)
CREATE POLICY student_own ON fee_ledger AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON installments AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON payments AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON attendance AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON assessments AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON certificate_requests AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON certificates AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON registration_events AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON receipts AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR payment_id IN (SELECT id FROM payments));
