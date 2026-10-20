-- Row-level security: the SSOT for "who may see which branch" (insti.md §5).
-- Hand-written. The app connects as the login role, then `SET LOCAL ROLE techcadd_app`
-- (see lib/db/withTenant.ts) so these policies apply even to the table owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'techcadd_app') THEN
    CREATE ROLE techcadd_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN EXECUTE format('GRANT techcadd_app TO %I', current_user); END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO techcadd_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO techcadd_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO techcadd_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_super() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.is_super', true), 'false') = 'true' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_branch() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.branch_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME; END $$;
--> statement-breakpoint

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE courses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lookups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lookups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE number_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- branches: a user sees only their own branch; only super_admin writes
CREATE POLICY branches_read ON branches FOR SELECT USING (app_is_super() OR id = app_branch());
--> statement-breakpoint
CREATE POLICY branches_write ON branches FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint

-- users / roles: same branch only
CREATE POLICY users_scope ON users FOR ALL
  USING (app_is_super() OR branch_id = app_branch())
  WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY user_roles_scope ON user_roles FOR ALL
  USING (app_is_super() OR EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.branch_id = app_branch()))
  WITH CHECK (app_is_super() OR EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.branch_id = app_branch()));
--> statement-breakpoint

-- global catalogs: everyone reads, only super_admin writes
CREATE POLICY departments_read ON departments FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY departments_write ON departments FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY courses_read ON courses FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY courses_write ON courses FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY lookups_read ON lookups FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY lookups_write ON lookups FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint

-- settings: global rows (branch_id NULL) readable by all, writable by super_admin only;
-- branch rows readable/writable by that branch
CREATE POLICY settings_read ON settings FOR SELECT
  USING (branch_id IS NULL OR app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY settings_write ON settings FOR ALL
  USING (app_is_super() OR branch_id = app_branch())
  WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint

-- numbering: per branch
CREATE POLICY number_sequences_scope ON number_sequences FOR ALL
  USING (app_is_super() OR branch_id = app_branch())
  WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint

-- audit: read + insert only, never changed (policy, grant and trigger all enforce it)
CREATE POLICY audit_read ON audit_logs FOR SELECT USING (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs FROM techcadd_app;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
