-- A batch taught by a trainer of another branch. The batch's academic manager asks; the trainer accepts or declines.
-- Labels are kept on the request so neither side needs to read the other branch's users or branch rows.
CREATE TABLE trainer_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	batch_id uuid NOT NULL REFERENCES batches(id),
	branch_id uuid NOT NULL REFERENCES branches(id), -- the batch's branch
	trainer_id uuid NOT NULL REFERENCES users(id),
	trainer_label text NOT NULL, -- e.g. "Aman Gill · techcadd Jalandhar"
	branch_label text NOT NULL, -- the batch's branch, e.g. "techcadd Mohali"
	batch_label text NOT NULL, -- e.g. "Batch 3 — Web Development · Mon, Wed, Fri 10:00–12:00 · 8 students"
	note text,
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'ended')),
	requested_by uuid REFERENCES users(id),
	requested_at timestamptz NOT NULL DEFAULT now(),
	decided_by uuid REFERENCES users(id),
	decided_at timestamptz,
	decision_note text
);
--> statement-breakpoint
CREATE UNIQUE INDEX trainer_requests_one_pending ON trainer_requests (batch_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX trainer_requests_trainer ON trainer_requests (trainer_id, status);
--> statement-breakpoint
ALTER TABLE trainer_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE trainer_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trainer_requests_branch ON trainer_requests FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY trainer_requests_mine ON trainer_requests FOR SELECT USING (trainer_id = app_user());
--> statement-breakpoint
CREATE POLICY student_deny ON trainer_requests AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON trainer_requests TO techcadd_app;
--> statement-breakpoint
-- The trainer of a batch from another branch: that batch, its students, their classes, attendance and grades.
-- Batch-level rules read the trainer's accepted requests (that table's rules point nowhere else, so no loop); the
-- student-level ones go through app_trainer_students(), which reads batch_members as head office (like branch_options).
CREATE OR REPLACE FUNCTION app_trainer_batches() RETURNS SETOF uuid LANGUAGE sql STABLE AS
  $$ SELECT batch_id FROM trainer_requests WHERE trainer_id = app_user() AND status = 'accepted' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_trainer_students() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS
  $$ SELECT m.registration_id FROM batch_members m WHERE m.batch_id IN (SELECT r.batch_id FROM trainer_requests r WHERE r.trainer_id = app_user() AND r.status = 'accepted') $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_trainer_batches() TO techcadd_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_trainer_students() TO techcadd_app;
--> statement-breakpoint
CREATE POLICY batches_trainer ON batches FOR SELECT USING (id IN (SELECT app_trainer_batches()));
--> statement-breakpoint
CREATE POLICY batch_members_trainer ON batch_members FOR SELECT USING (batch_id IN (SELECT app_trainer_batches()));
--> statement-breakpoint
CREATE POLICY class_sessions_trainer ON class_sessions FOR ALL USING (batch_id IN (SELECT app_trainer_batches())) WITH CHECK (batch_id IN (SELECT app_trainer_batches()));
--> statement-breakpoint
CREATE POLICY attendance_trainer ON attendance FOR ALL USING (registration_id IN (SELECT app_trainer_students())) WITH CHECK (registration_id IN (SELECT app_trainer_students()));
--> statement-breakpoint
CREATE POLICY assessments_trainer ON assessments FOR ALL USING (registration_id IN (SELECT app_trainer_students())) WITH CHECK (registration_id IN (SELECT app_trainer_students()));
--> statement-breakpoint
CREATE POLICY registrations_trainer ON registrations FOR SELECT USING (id IN (SELECT app_trainer_students()));
--> statement-breakpoint
CREATE POLICY persons_trainer ON persons FOR SELECT USING (id IN (SELECT r.person_id FROM registrations r WHERE r.id IN (SELECT app_trainer_students())));
--> statement-breakpoint
-- The batch's branch sees the name of its trainer from another branch.
CREATE POLICY users_batch_trainer ON users FOR SELECT USING (id IN (SELECT trainer_id FROM trainer_requests WHERE status = 'accepted'));
--> statement-breakpoint
-- A batch given to another trainer ends the earlier trainer's access.
CREATE OR REPLACE FUNCTION trainer_requests_end() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  UPDATE trainer_requests SET status = 'ended', decided_at = coalesce(decided_at, now())
  WHERE batch_id = NEW.id AND status = 'accepted' AND trainer_id IS DISTINCT FROM NEW.trainer_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER batches_trainer_change AFTER UPDATE OF trainer_id ON batches FOR EACH ROW WHEN (OLD.trainer_id IS DISTINCT FROM NEW.trainer_id) EXECUTE FUNCTION trainer_requests_end();
