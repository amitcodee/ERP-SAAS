-- Inter-branch transfers. A student admitted in one branch moves to another part-way through: the old branch asks,
-- the new branch accepts. On acceptance the new branch gets its own copy of the person (people are kept per branch),
-- a new registration with the same course and what is still to pay, and the student's login; the old registration is
-- marked TRANSFERRED, its balance moved out by an adjustment, and stays with all its payments and receipts. Until the
-- new branch accepts, nothing moves and the old branch keeps the student.
ALTER TYPE registration_status ADD VALUE IF NOT EXISTS 'transferred';--> statement-breakpoint
CREATE TABLE registration_transfers (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	from_registration_id uuid NOT NULL REFERENCES registrations(id),
	from_branch_id uuid NOT NULL REFERENCES branches(id),
	to_branch_id uuid NOT NULL REFERENCES branches(id),
	to_registration_id uuid REFERENCES registrations(id),
	status text NOT NULL DEFAULT 'pending',
	reason text NOT NULL,
	balance_at_request integer NOT NULL DEFAULT 0,
	requested_by uuid REFERENCES users(id),
	requested_at timestamptz NOT NULL DEFAULT now(),
	decided_by uuid REFERENCES users(id),
	decided_at timestamptz,
	decision_note text,
	CONSTRAINT registration_transfers_status_ck CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
	CONSTRAINT registration_transfers_branches_ck CHECK (from_branch_id <> to_branch_id)
);--> statement-breakpoint
-- one open transfer per registration
CREATE UNIQUE INDEX registration_transfers_open_uq ON registration_transfers (from_registration_id) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX registration_transfers_from_idx ON registration_transfers (from_branch_id, status, requested_at);--> statement-breakpoint
CREATE INDEX registration_transfers_to_idx ON registration_transfers (to_branch_id, status, requested_at);--> statement-breakpoint
ALTER TABLE registration_transfers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE registration_transfers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- both branches see a transfer: the one it leaves and the one it goes to
CREATE POLICY registration_transfers_scope ON registration_transfers FOR ALL
  USING (app_is_super() OR from_branch_id = app_branch() OR to_branch_id = app_branch())
  WITH CHECK (app_is_super() OR from_branch_id = app_branch() OR to_branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON registration_transfers AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON registration_transfers TO techcadd_app;--> statement-breakpoint
-- finding the same person in other branches (by mobile, e-mail or date of birth)
CREATE INDEX IF NOT EXISTS persons_phone_norm_idx ON persons (phone_norm);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS persons_email_lower_idx ON persons (lower(email)) WHERE email IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS persons_dob_idx ON persons (dob) WHERE dob IS NOT NULL;
