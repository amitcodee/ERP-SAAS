-- Academics: branch RLS, certificate guard, and the single attendance / eligibility views.
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE batch_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE batch_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE class_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE certificate_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE certificate_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE certificates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY batches_scope ON batches FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY batch_members_scope ON batch_members FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY class_sessions_scope ON class_sessions FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY attendance_scope ON attendance FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY assessments_scope ON assessments FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY certificate_requests_scope ON certificate_requests FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY certificates_scope ON certificates FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON batches, batch_members, class_sessions, attendance, assessments, certificate_requests TO techcadd_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON certificates TO techcadd_app;
--> statement-breakpoint
GRANT UPDATE (is_revoked, revoked_reason) ON certificates TO techcadd_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION certificates_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'certificates cannot be deleted'; END IF;
  IF NEW.cert_no <> OLD.cert_no OR NEW.verification_hash <> OLD.verification_hash OR NEW.registration_id <> OLD.registration_id
     OR NEW.issued_at <> OLD.issued_at OR NEW.branch_id <> OLD.branch_id THEN RAISE EXCEPTION 'certificates are immutable (only revocation may change)'; END IF;
  IF OLD.is_revoked AND NOT NEW.is_revoked THEN RAISE EXCEPTION 'a revoked certificate cannot be un-revoked'; END IF;
  RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER certificates_immutable BEFORE UPDATE OR DELETE ON certificates FOR EACH ROW EXECUTE FUNCTION certificates_guard();
--> statement-breakpoint
CREATE VIEW v_attendance_pct WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id,
  COALESCE(cnt.total, 0)::int AS sessions_total,
  COALESCE(cnt.present, 0)::int AS sessions_present,
  CASE WHEN COALESCE(cnt.total, 0) = 0 THEN 0 ELSE ROUND(100.0 * cnt.present / cnt.total)::int END AS pct
FROM registrations r
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE a.present) AS present
  FROM attendance a WHERE a.registration_id = r.id
) cnt ON true;
--> statement-breakpoint
CREATE VIEW v_certificate_eligibility WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id, r.status AS registration_status,
  b.balance AS fee_balance,
  a.pct AS attendance_pct, a.sessions_total,
  COALESCE(
    (SELECT (s.value #>> '{}')::int FROM settings s WHERE s.key = 'certificate.min_attendance_pct' AND s.branch_id = r.branch_id),
    (SELECT (s.value #>> '{}')::int FROM settings s WHERE s.key = 'certificate.min_attendance_pct' AND s.branch_id IS NULL),
    80) AS min_attendance_pct,
  EXISTS (SELECT 1 FROM assessments x WHERE x.registration_id = r.id AND x.kind = 'capstone' AND x.approved_at IS NOT NULL) AS capstone_ok
FROM registrations r
JOIN v_fee_balance b ON b.registration_id = r.id
JOIN v_attendance_pct a ON a.registration_id = r.id;
--> statement-breakpoint
GRANT SELECT ON v_attendance_pct, v_certificate_eligibility TO techcadd_app;
