-- Revoking and issuing again.
-- 1. Only head office revokes (also checked here, not only in the app), and the record says who and when.
-- 2. A revoked certificate stays on record (its verify link keeps saying REVOKED), and the student can be issued a
--    new one with a new number: one LIVE certificate per registration instead of one ever.
-- 3. The student no longer sees a revoked certificate.

ALTER TABLE certificates ADD COLUMN IF NOT EXISTS revoked_at timestamptz;--> statement-breakpoint
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id);--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by) ON certificates TO techcadd_app;--> statement-breakpoint

ALTER TABLE certificates DROP CONSTRAINT IF EXISTS certificates_registration_id_unique;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS certificates_live_uq ON certificates (registration_id) WHERE NOT is_revoked;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS certificates_registration_idx ON certificates (registration_id, issued_at DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION certificates_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'certificates cannot be deleted'; END IF;
  IF NEW.cert_no <> OLD.cert_no OR NEW.verification_hash <> OLD.verification_hash OR NEW.registration_id <> OLD.registration_id
     OR NEW.issued_at <> OLD.issued_at OR NEW.branch_id <> OLD.branch_id
     OR NEW.course_title IS DISTINCT FROM OLD.course_title OR NEW.tools IS DISTINCT FROM OLD.tools OR NEW.tools_label IS DISTINCT FROM OLD.tools_label
     THEN RAISE EXCEPTION 'certificates are immutable (only revocation may change)'; END IF;
  IF OLD.is_revoked AND NOT NEW.is_revoked THEN RAISE EXCEPTION 'a revoked certificate cannot be un-revoked: issue a new one'; END IF;
  IF OLD.is_revoked AND (NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by)
     THEN RAISE EXCEPTION 'the certificate is already revoked'; END IF;
  IF NEW.is_revoked AND NOT OLD.is_revoked AND NOT app_is_super() THEN RAISE EXCEPTION 'only head office can revoke a certificate'; END IF;
  RETURN NEW; END $$;--> statement-breakpoint

-- a student sees only their live certificate
CREATE POLICY student_live_only ON certificates AS RESTRICTIVE FOR SELECT USING (app_role() <> 'student' OR NOT is_revoked);
