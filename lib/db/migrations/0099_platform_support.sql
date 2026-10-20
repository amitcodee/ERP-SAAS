-- Platform support inside an org (support_sessions): what a platform admin does there is in the org's own audit log,
-- with who really did it (impersonator_id) and under which session.
ALTER TABLE audit_logs ADD COLUMN impersonator_id uuid REFERENCES platform_users(id);
--> statement-breakpoint
ALTER TABLE audit_logs ADD COLUMN support_session_id uuid REFERENCES support_sessions(id);
--> statement-breakpoint
-- who is in, as the org sees it (the org cannot read platform_users): the name when the session was opened
ALTER TABLE support_sessions ADD COLUMN by_name text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX support_sessions_open_idx ON support_sessions (org_id) WHERE ended_at IS NULL;
--> statement-breakpoint

-- The platform console's view of each org: sizes only (how many branches, logins, active students, receipts this
-- month), never a record. The platform cannot read tenant tables itself (app_org() is NULL there).
CREATE OR REPLACE FUNCTION platform_org_stats()
  RETURNS TABLE (org_id uuid, branches integer, users integer, active_students integer, receipts_30d integer, last_sign_in timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN
  IF NOT app_is_platform() THEN RAISE EXCEPTION 'platform_org_stats: platform only'; END IF;
  RETURN QUERY SELECT o.id,
    (SELECT count(*)::int FROM branches b WHERE b.org_id = o.id AND b.is_active),
    (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND u.is_active AND u.deleted_at IS NULL),
    (SELECT count(*)::int FROM registrations r WHERE r.org_id = o.id AND r.status = 'active'),
    (SELECT count(*)::int FROM receipts x WHERE x.org_id = o.id AND x.created_at > now() - interval '30 days'),
    (SELECT max(a.at) FROM login_attempts a WHERE a.org_id = o.id AND a.result = 'success')
  FROM organisations o;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_org_stats() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_org_stats() TO techcadd_app;
