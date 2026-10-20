-- What a certificate prints, chosen at the request: the course name and the tools / modules covered, when they should
-- differ from the course's own (e.g. a student who learnt other tools). Frozen on the certificate when it is issued,
-- so a later change of the course never changes an issued certificate. NULL = the course's own words (as before).
ALTER TABLE certificate_requests ADD COLUMN IF NOT EXISTS cert_course_title text;--> statement-breakpoint
ALTER TABLE certificate_requests ADD COLUMN IF NOT EXISTS cert_tools text[];--> statement-breakpoint
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS course_title text;--> statement-breakpoint
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS tools text[];--> statement-breakpoint
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS tools_label text;--> statement-breakpoint
-- the printed words are as immutable as the number and the hash
CREATE OR REPLACE FUNCTION certificates_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'certificates cannot be deleted'; END IF;
  IF NEW.cert_no <> OLD.cert_no OR NEW.verification_hash <> OLD.verification_hash OR NEW.registration_id <> OLD.registration_id
     OR NEW.issued_at <> OLD.issued_at OR NEW.branch_id <> OLD.branch_id
     OR NEW.course_title IS DISTINCT FROM OLD.course_title OR NEW.tools IS DISTINCT FROM OLD.tools OR NEW.tools_label IS DISTINCT FROM OLD.tools_label
     THEN RAISE EXCEPTION 'certificates are immutable (only revocation may change)'; END IF;
  IF OLD.is_revoked AND NOT NEW.is_revoked THEN RAISE EXCEPTION 'a revoked certificate cannot be un-revoked'; END IF;
  RETURN NEW; END $$;
