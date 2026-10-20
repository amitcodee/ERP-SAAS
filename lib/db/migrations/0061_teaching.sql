-- Teaching: the course syllabus (topics, and an optional PDF), which topics each batch has covered (ticked by the
-- trainer with the day's attendance), tests with marks and answer-sheet photos, notes the trainer shares with a
-- batch's students or with other trainers, and project / study help that students ask of every trainer.

-- syllabus: one list per course, shared by every branch
CREATE TABLE course_topics (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
	module text, -- optional heading the topic sits under, e.g. "Module 1: Basics"
	title text NOT NULL,
	details text,
	sort_order integer NOT NULL DEFAULT 0,
	created_by uuid REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX course_topics_course_idx ON course_topics (course_id, sort_order);--> statement-breakpoint
CREATE TABLE course_syllabus_files (
	course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
	file_name text NOT NULL,
	mime text NOT NULL,
	size_bytes integer NOT NULL,
	data bytea NOT NULL,
	uploaded_by uuid REFERENCES users(id),
	uploaded_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- topics a batch has covered, and on which day
CREATE TABLE batch_topics (
	batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
	topic_id uuid NOT NULL REFERENCES course_topics(id) ON DELETE CASCADE,
	branch_id uuid NOT NULL REFERENCES branches(id),
	session_id uuid REFERENCES class_sessions(id) ON DELETE SET NULL,
	covered_on date NOT NULL,
	marked_by uuid REFERENCES users(id),
	PRIMARY KEY (batch_id, topic_id)
);--> statement-breakpoint

-- a test of a batch; each student's marks are an assessment row pointing at it
CREATE TABLE tests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	branch_id uuid NOT NULL REFERENCES branches(id),
	batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
	title text NOT NULL,
	test_date date NOT NULL,
	max_score integer NOT NULL CHECK (max_score > 0),
	created_by uuid REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX tests_batch_idx ON tests (batch_id, test_date);--> statement-breakpoint
ALTER TABLE assessments ADD COLUMN test_id uuid REFERENCES tests(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE assessments ADD COLUMN sheet_doc_id uuid REFERENCES registration_documents(id);--> statement-breakpoint
CREATE UNIQUE INDEX assessments_test_reg_uq ON assessments (test_id, registration_id) WHERE test_id IS NOT NULL;--> statement-breakpoint

-- notes: a link and / or a file, shared with a batch's students and / or with every trainer
CREATE TABLE notes (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	branch_id uuid NOT NULL REFERENCES branches(id),
	batch_id uuid REFERENCES batches(id) ON DELETE CASCADE,
	course_id uuid REFERENCES courses(id),
	title text NOT NULL,
	body text,
	url text,
	file_name text,
	mime text,
	size_bytes integer,
	data bytea,
	share_students boolean NOT NULL DEFAULT true,
	share_trainers boolean NOT NULL DEFAULT false,
	created_by uuid NOT NULL REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz
);--> statement-breakpoint
CREATE INDEX notes_batch_idx ON notes (batch_id, created_at);--> statement-breakpoint

-- help from trainers: a student asks, any trainer of any branch offers, the student picks one
CREATE SEQUENCE help_request_seq;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE help_request_seq TO techcadd_app;--> statement-breakpoint
CREATE TABLE help_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	request_no text NOT NULL DEFAULT ('HLP-' || lpad(nextval('help_request_seq')::text, 5, '0')),
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid REFERENCES registrations(id),
	person_id uuid NOT NULL REFERENCES persons(id),
	created_by uuid REFERENCES users(id),
	kind text NOT NULL, -- project | doubt | career | other
	title text NOT NULL,
	details text NOT NULL,
	status text NOT NULL DEFAULT 'open', -- open -> assigned -> done (or cancelled)
	chosen_trainer_id uuid REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT help_requests_status_ck CHECK (status IN ('open', 'assigned', 'done', 'cancelled'))
);--> statement-breakpoint
CREATE INDEX help_requests_status_idx ON help_requests (status, created_at);--> statement-breakpoint
CREATE TABLE help_offers (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	request_id uuid NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
	trainer_id uuid NOT NULL REFERENCES users(id),
	message text,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT help_offers_uq UNIQUE (request_id, trainer_id)
);--> statement-breakpoint

ALTER TABLE course_topics ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE course_topics FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE course_syllabus_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE course_syllabus_files FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE batch_topics ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE batch_topics FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE help_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE help_offers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE help_offers FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- syllabus: everyone reads (it is the course outline); staff write (the app checks who)
CREATE POLICY course_topics_read ON course_topics FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY course_topics_write ON course_topics FOR ALL USING (app_role() <> 'student') WITH CHECK (app_role() <> 'student');--> statement-breakpoint
CREATE POLICY course_syllabus_files_read ON course_syllabus_files FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY course_syllabus_files_write ON course_syllabus_files FOR ALL USING (app_role() <> 'student') WITH CHECK (app_role() <> 'student');--> statement-breakpoint

-- batch topics and tests: the branch, and a trainer of another branch on the batch; a student reads their batches'
CREATE POLICY batch_topics_scope ON batch_topics FOR ALL USING (app_is_super() OR branch_id = app_branch() OR batch_id IN (SELECT app_trainer_batches())) WITH CHECK (app_is_super() OR branch_id = app_branch() OR batch_id IN (SELECT app_trainer_batches()));--> statement-breakpoint
CREATE POLICY student_own ON batch_topics AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR batch_id IN (SELECT batch_id FROM batch_members)) WITH CHECK (app_role() <> 'student');--> statement-breakpoint
CREATE POLICY tests_scope ON tests FOR ALL USING (app_is_super() OR branch_id = app_branch() OR batch_id IN (SELECT app_trainer_batches())) WITH CHECK (app_is_super() OR branch_id = app_branch() OR batch_id IN (SELECT app_trainer_batches()));--> statement-breakpoint
CREATE POLICY student_own ON tests AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR batch_id IN (SELECT batch_id FROM batch_members)) WITH CHECK (app_role() <> 'student');--> statement-breakpoint

-- notes: the branch, their author, a trainer of the batch, and every staff member when shared with trainers;
-- a student reads only notes shared with students of their batches
CREATE POLICY notes_scope ON notes FOR ALL
	USING (app_is_super() OR branch_id = app_branch() OR created_by = app_user() OR batch_id IN (SELECT app_trainer_batches()) OR (share_trainers AND app_role() <> 'student'))
	WITH CHECK (app_is_super() OR created_by = app_user());--> statement-breakpoint
CREATE POLICY student_own ON notes AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR (share_students AND deleted_at IS NULL AND batch_id IN (SELECT batch_id FROM batch_members))) WITH CHECK (app_role() <> 'student');--> statement-breakpoint

-- help requests: every staff member reads them (trainers of all branches offer); a student only their own
CREATE POLICY help_requests_all ON help_requests FOR ALL USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY student_own ON help_requests AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR person_id = app_person()) WITH CHECK (app_role() <> 'student' OR person_id = app_person());--> statement-breakpoint
CREATE POLICY help_offers_all ON help_offers FOR ALL USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY student_own ON help_offers AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR request_id IN (SELECT id FROM help_requests)) WITH CHECK (app_role() <> 'student');--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON course_topics, course_syllabus_files, batch_topics, tests, notes, help_requests, help_offers TO techcadd_app;
