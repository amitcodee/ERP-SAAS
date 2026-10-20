-- Branches working together.
-- 1. SHARED STUDENTS: a student of one branch (home) takes classes in another (host) — some days in each, or online.
--    The home branch asks, the host branch accepts into one of its batches. The host then sees ONLY that student (in
--    its batch roster, attendance, tests), never the home branch's other data or the student's fees; the home branch
--    sees the attendance and marks the host records, so the certificate counts both. Either side can end it.
-- 2. OWN WORK ONLY: a staff member who also works in a second branch sees, THERE, only their own work — the leads and
--    calls they have, the students they admitted or teach, their batches and tickets — unless head office gave them
--    full access in that branch. The app sets app.own_only for such a session; these read rules then apply.

-- ---- 1. shared students
CREATE TABLE student_shares (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	registration_id uuid NOT NULL REFERENCES registrations(id),
	from_branch_id uuid NOT NULL REFERENCES branches(id),
	to_branch_id uuid NOT NULL REFERENCES branches(id),
	mode text NOT NULL DEFAULT 'classroom',
	schedule text,
	note text NOT NULL,
	status text NOT NULL DEFAULT 'pending',
	batch_id uuid REFERENCES batches(id),
	requested_by uuid REFERENCES users(id),
	requested_at timestamptz NOT NULL DEFAULT now(),
	decided_by uuid REFERENCES users(id),
	decided_at timestamptz,
	decision_note text,
	ended_by uuid REFERENCES users(id),
	ended_at timestamptz,
	CONSTRAINT student_shares_mode_ck CHECK (mode IN ('classroom', 'online')),
	CONSTRAINT student_shares_status_ck CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'ended')),
	CONSTRAINT student_shares_branches_ck CHECK (from_branch_id <> to_branch_id)
);--> statement-breakpoint
CREATE UNIQUE INDEX student_shares_open_uq ON student_shares (registration_id, to_branch_id) WHERE status IN ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX student_shares_to_idx ON student_shares (to_branch_id, status);--> statement-breakpoint
CREATE INDEX student_shares_from_idx ON student_shares (from_branch_id, status);--> statement-breakpoint
ALTER TABLE student_shares ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE student_shares FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY student_shares_scope ON student_shares FOR ALL
  USING (app_is_super() OR from_branch_id = app_branch() OR to_branch_id = app_branch())
  WITH CHECK (app_is_super() OR from_branch_id = app_branch() OR to_branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON student_shares AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON student_shares TO techcadd_app;--> statement-breakpoint
REVOKE DELETE ON student_shares FROM techcadd_app;--> statement-breakpoint

-- the students the acting branch hosts (accepted shares), read as head office so the rules below do not loop
CREATE OR REPLACE FUNCTION app_shared_students() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS
  $$ SELECT registration_id FROM student_shares WHERE to_branch_id = app_branch() AND status = 'accepted' $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_shared_students() TO techcadd_app;--> statement-breakpoint
CREATE POLICY registrations_shared ON registrations FOR SELECT USING (id IN (SELECT app_shared_students()));--> statement-breakpoint
CREATE POLICY persons_shared ON persons FOR SELECT USING (id IN (SELECT r.person_id FROM registrations r WHERE r.id IN (SELECT app_shared_students())));--> statement-breakpoint
-- the home branch (and the host) read the attendance and marks recorded for their students anywhere
CREATE POLICY attendance_of_my_students ON attendance FOR SELECT USING (registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY assessments_of_my_students ON assessments FOR SELECT USING (registration_id IN (SELECT id FROM registrations));--> statement-breakpoint

-- ---- 2. own work only in a second branch
ALTER TABLE user_branches ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'own';--> statement-breakpoint
ALTER TABLE user_branches ADD CONSTRAINT user_branches_access_ck CHECK (access IN ('own', 'full'));--> statement-breakpoint
-- people already shared keep working as they do today (head office can switch them to own work)
UPDATE user_branches SET access = 'full';--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_own_only() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.own_only', true), '') = 'true' $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_own_only() TO techcadd_app;--> statement-breakpoint
-- "my students": admitted by me, from my leads, in a batch I teach (mine, or one I took on), or shared into my batch
CREATE OR REPLACE FUNCTION app_own_students() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS
  $$ SELECT r.id FROM registrations r WHERE r.created_by = app_user()
       OR r.enquiry_id IN (SELECT e.id FROM enquiries e WHERE e.created_by = app_user() OR e.assigned_to = app_user())
     UNION SELECT m.registration_id FROM batch_members m JOIN batches b ON b.id = m.batch_id WHERE b.trainer_id = app_user()
     UNION SELECT m.registration_id FROM batch_members m WHERE m.batch_id IN (SELECT t.batch_id FROM trainer_requests t WHERE t.trainer_id = app_user() AND t.status = 'accepted') $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_own_students() TO techcadd_app;--> statement-breakpoint

CREATE POLICY own_only ON enquiries AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR created_by = app_user() OR assigned_to = app_user());--> statement-breakpoint
CREATE POLICY own_only ON enquiry_events AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR enquiry_id IN (SELECT id FROM enquiries));--> statement-breakpoint
CREATE POLICY own_only ON calls AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR received_by = app_user() OR assigned_to = app_user());--> statement-breakpoint
CREATE POLICY own_only ON registrations AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR id IN (SELECT app_own_students()));--> statement-breakpoint
CREATE POLICY own_only ON batches AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR trainer_id = app_user() OR id IN (SELECT app_trainer_batches()));--> statement-breakpoint
CREATE POLICY own_only ON batch_members AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT id FROM batches));--> statement-breakpoint
CREATE POLICY own_only ON class_sessions AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT id FROM batches));--> statement-breakpoint
CREATE POLICY own_only ON tests AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT id FROM batches));--> statement-breakpoint
CREATE POLICY own_only ON batch_topics AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT id FROM batches));--> statement-breakpoint
CREATE POLICY own_only ON fee_ledger AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON installments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON payments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON receipts AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR payment_id IN (SELECT id FROM payments));--> statement-breakpoint
CREATE POLICY own_only ON payment_reversals AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON fee_change_requests AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON fee_remarks AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON certificate_requests AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON certificates AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON registration_documents AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON registration_events AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON attendance AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON assessments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON internships AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR created_by = app_user() OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON support_tickets AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR created_by = app_user() OR assigned_to = app_user());--> statement-breakpoint
CREATE POLICY own_only ON registration_transfers AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR from_registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON student_shares AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT id FROM registrations));
