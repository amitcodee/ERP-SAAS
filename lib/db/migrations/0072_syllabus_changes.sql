-- A course's syllabus is shared by every branch. An academic manager (or branch manager) of any branch may change it,
-- but the change waits here until head office approves it; only then does it reach every branch's trainers and
-- students. One change waits per course at a time (its author may keep editing it). Head office's own edits apply at once.
CREATE TABLE syllabus_changes (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
	branch_id uuid REFERENCES branches(id),
	topics jsonb,
	file_action text,
	file_name text,
	mime text,
	size_bytes integer,
	data bytea,
	status text NOT NULL DEFAULT 'pending',
	proposed_by uuid REFERENCES users(id),
	proposed_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	decided_by uuid REFERENCES users(id),
	decided_at timestamptz,
	decision_note text,
	CONSTRAINT syllabus_changes_status_ck CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT syllabus_changes_file_ck CHECK (file_action IS NULL OR file_action IN ('replace', 'remove'))
);--> statement-breakpoint
CREATE UNIQUE INDEX syllabus_changes_pending_uq ON syllabus_changes (course_id) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX syllabus_changes_status_idx ON syllabus_changes (status, proposed_at);--> statement-breakpoint
ALTER TABLE syllabus_changes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE syllabus_changes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- shared like the syllabus: every branch's staff see what waits (who may change what is checked by the panel)
CREATE POLICY syllabus_changes_staff ON syllabus_changes FOR ALL USING (app_role() <> 'student') WITH CHECK (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON syllabus_changes TO techcadd_app;
