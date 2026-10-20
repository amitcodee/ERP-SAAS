-- Fixes from the security review (October 2026). The app already kept most of these rules; now the database does too.

-- 1. "Sign out" ends that sign-in for good: its id is listed here until the cookie would have expired anyway.
CREATE TABLE revoked_sessions (
	sid text PRIMARY KEY,
	expires_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX revoked_sessions_expires_idx ON revoked_sessions (expires_at);--> statement-breakpoint
ALTER TABLE revoked_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE revoked_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY revoked_sessions_system ON revoked_sessions FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON revoked_sessions TO techcadd_app;--> statement-breakpoint

-- 2. Old webhook calls are cleared (they hold student data).
GRANT DELETE ON webhook_deliveries TO techcadd_app;--> statement-breakpoint

-- The guards below hold for the app's own connection (techcadd_app, or any login that is not the tables' owner).
-- The owner - migrations, the seed, scripts/admin-reset.mjs - is not held. They run with the caller's rights so they
-- can tell who the caller is.
CREATE OR REPLACE FUNCTION app_db_owner() RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS
  $$ SELECT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'public.users'::regclass), 'USAGE') $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_db_owner() TO techcadd_app;--> statement-breakpoint

-- 3. Only head office gives a head-office (super) role.
CREATE OR REPLACE FUNCTION user_roles_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT app_is_super() AND NOT app_db_owner() AND EXISTS (SELECT 1 FROM roles WHERE key = NEW.role AND kind = 'super') THEN
    RAISE EXCEPTION 'Only head office can give the % role', NEW.role;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER user_roles_guard BEFORE INSERT OR UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION user_roles_guard();--> statement-breakpoint

-- 4. A login head office made (and any head-office login) is changed only by head office: a branch cannot reset its
--    password, change its e-mail, switch it off or move it. Everyone may still change their own.
CREATE OR REPLACE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app_is_super() OR app_db_owner() OR OLD.id = app_user() THEN RETURN NEW; END IF;
  IF (NOT OLD.branch_made OR OLD.branch_id IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.key = ur.role WHERE ur.user_id = OLD.id AND r.kind = 'super'))
     AND (NEW.password_hash, NEW.email, NEW.is_active, NEW.deleted_at, NEW.branch_id, NEW.branch_made, NEW.must_change_password, NEW.password_changed_at, NEW.two_factor_email)
         IS DISTINCT FROM (OLD.password_hash, OLD.email, OLD.is_active, OLD.deleted_at, OLD.branch_id, OLD.branch_made, OLD.must_change_password, OLD.password_changed_at, OLD.two_factor_email) THEN
    RAISE EXCEPTION 'Head office made this login, so only head office can change it';
  END IF;
  IF NEW.branch_made IS DISTINCT FROM OLD.branch_made OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'Only head office can move a login to another branch';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER users_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_guard();--> statement-breakpoint

-- 5. A person moves to another branch only through a transfer (done by the system), never by an edit - not even by a
--    telecaller of another branch who was handed the lead.
CREATE OR REPLACE FUNCTION persons_branch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND NOT app_is_super() AND NOT app_db_owner() THEN
    RAISE EXCEPTION 'A student moves to another branch only by a transfer';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER persons_branch_guard BEFORE UPDATE ON persons FOR EACH ROW EXECUTE FUNCTION persons_branch_guard();--> statement-breakpoint

-- 6. Aadhaar numbers are stored encrypted by the app (modules/people/aadhaar-store), with the last 4 digits apart.
ALTER TABLE persons ADD COLUMN aadhaar_last4 text;--> statement-breakpoint
ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_aadhaar_ck;--> statement-breakpoint
ALTER TABLE persons ADD CONSTRAINT persons_aadhaar_ck CHECK (aadhaar_no IS NULL OR aadhaar_no ~ '^[2-9][0-9]{11}$' OR aadhaar_no LIKE 'v1.%');--> statement-breakpoint
ALTER TABLE persons ADD CONSTRAINT persons_aadhaar_last4_ck CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^[0-9]{4}$');--> statement-breakpoint
UPDATE persons SET aadhaar_last4 = right(aadhaar_no, 4) WHERE aadhaar_no ~ '^[2-9][0-9]{11}$';--> statement-breakpoint

-- 7. Functions that run with their owner's rights look only at the real tables: a session's temporary table of the
--    same name can no longer stand in for one. And sessions cannot make temporary tables at all.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp', f.sig);
  END LOOP;
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END $$;
