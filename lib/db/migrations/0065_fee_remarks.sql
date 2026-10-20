-- Fees are collected by admissions (counselors); accounts only checks them. When accounts finds something wrong in a
-- student's fees (or one receipt) it raises a REMARK; whoever collects fees fixes it and marks it fixed, saying what
-- was done. Remarks are never deleted. Roles follow (matches DEFAULT_ROLES): counselors take payments; accountants
-- see fees and raise remarks (fee:clear) but no longer take payments or change fees.
CREATE TABLE fee_remarks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid NOT NULL REFERENCES registrations(id),
	receipt_no text,
	note text NOT NULL,
	status text NOT NULL DEFAULT 'open',
	raised_by uuid REFERENCES users(id),
	raised_at timestamptz NOT NULL DEFAULT now(),
	fixed_by uuid REFERENCES users(id),
	fixed_at timestamptz,
	fix_note text,
	CONSTRAINT fee_remarks_status_ck CHECK (status IN ('open', 'fixed'))
);--> statement-breakpoint
CREATE INDEX fee_remarks_branch_idx ON fee_remarks (branch_id, status, raised_at);--> statement-breakpoint
CREATE INDEX fee_remarks_reg_idx ON fee_remarks (registration_id);--> statement-breakpoint
ALTER TABLE fee_remarks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fee_remarks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fee_remarks_scope ON fee_remarks FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON fee_remarks AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON fee_remarks TO techcadd_app;--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['fee:clear']) AS x ORDER BY x)
WHERE kind = 'super' OR key = 'branch_manager';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['fee:read', 'fee:create', 'fee:update', 'receipt:read']) AS x ORDER BY x),
  description = 'Enquiries and admissions; collects fees (payments, total fees, payment plans); requests certificates and internship letters.'
WHERE key = 'counselor';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(array_remove(array_remove(permissions, 'fee:create'), 'fee:update') || ARRAY['fee:read', 'fee:clear']) AS x ORDER BY x),
  description = 'Checks fees and receipts and raises remarks for admissions to fix; clears fees and issues course and project certificates.'
WHERE key = 'accountant';
