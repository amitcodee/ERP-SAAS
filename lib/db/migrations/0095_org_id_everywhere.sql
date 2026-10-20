-- Multi-tenancy, part 2: every tenant table gets org_id, and the database (not the code) keeps organisations apart.
--
--  * org_id uuid NOT NULL, DEFAULT app_org(): rows are stamped with the org of the transaction that writes them, so
--    insert code needs no change; writing outside any org fails on NOT NULL. Rows that existed before belong to the
--    Sample Institute (the constant default fills them without an UPDATE, so the append-only triggers never fire).
--  * A RESTRICTIVE policy `org_guard` per table: PostgreSQL ANDs it with the existing (permissive) branch policies,
--    so every rule becomes `org_id = app_org() AND (the branch rule)`. app_is_super() now means "every branch of
--    this org". No org set: no rows.
--  * Read-only guards (`org_ro_*`): no INSERT / UPDATE / DELETE while app.read_only is on (billing, read-only support
--    sessions). Sign-in, sign-out, the audit log and job runs stay writable.
--  * A foreign-key check ignores RLS, so a row could point at another org's row by its id. Every foreign key between
--    tenant tables gets a companion (org_id, col) -> parent(org_id, id) key (named *_orgfk), the parents a
--    UNIQUE (org_id, id) (named *_org_id_uq).
--  * Business keys are unique per org (e-mail, branch code, registration / receipt / certificate numbers ...).
--  * The SECURITY DEFINER helpers skip RLS, so each filters by org explicitly.
--
-- The lists below are the audited classification of every table; pnpm test:tenancy checks it stays complete.
DO $$
DECLARE
  sample constant uuid := '00000000-0000-4000-8000-000000000001';
  tenant constant text[] := ARRAY[
    'announcements', 'api_keys', 'app_config', 'assessments', 'attendance', 'audit_logs', 'batch_members', 'batch_topics',
    'batches', 'branches', 'call_followups', 'calls', 'certificate_designs', 'certificate_requests', 'certificates',
    'class_sessions', 'course_syllabus_files', 'course_topics', 'courses', 'departments', 'enquiries', 'enquiry_events',
    'event_participants', 'events', 'fee_change_requests', 'fee_ledger', 'fee_remarks', 'help_offers', 'help_requests',
    'installments', 'internships', 'ip_rules', 'job_runs', 'lead_categories', 'legacy_payments', 'letter_companies',
    'letter_templates', 'login_attempts', 'login_locks', 'lookups', 'message_templates', 'notes', 'notifications',
    'number_sequences', 'payment_reversals', 'payments', 'person_occupations', 'persons', 'receipts',
    'registration_documents', 'registration_events', 'registration_transfers', 'registrations', 'revoked_sessions',
    'roles', 'settings', 'signature_images', 'student_shares', 'support_messages', 'support_tickets', 'syllabus_changes',
    'tests', 'trainer_requests', 'user_branches', 'user_roles', 'users', 'wa_broadcasts', 'wa_campaigns', 'web_leads',
    'webhook_deliveries', 'webhooks'];
  -- stay writable while an org is read-only: signing in and out, the audit trail, job bookkeeping
  writable constant text[] := ARRAY['audit_logs', 'job_runs', 'login_attempts', 'login_locks', 'revoked_sessions'];
  platform constant text[] := ARRAY['ip_geo', 'organisations', 'org_domains', 'plans', 'platform_config', 'platform_users', 'support_sessions'];
  t text;
  k record;
  act text;
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relname = ANY (tenant || platform);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'tables not classified as tenant or platform: %', missing; END IF;

  FOREACH t IN ARRAY tenant LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN org_id uuid NOT NULL DEFAULT %L REFERENCES organisations(id)', t, sample);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT app_org()', t);
    EXECUTE format('CREATE INDEX %I ON %I (org_id)', t || '_org_idx', t);
    EXECUTE format('CREATE POLICY org_guard ON %I AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org())', t);
    IF NOT t = ANY (writable) THEN
      EXECUTE format('CREATE POLICY org_ro_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only())', t);
      EXECUTE format('CREATE POLICY org_ro_update ON %I AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only())', t);
      EXECUTE format('CREATE POLICY org_ro_delete ON %I AS RESTRICTIVE FOR DELETE USING (NOT app_read_only())', t);
    END IF;
  END LOOP;

  -- roles are per org: the key is unique inside an org, and a user's role must be one of their own org's roles
  ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_roles_key_fk;
  ALTER TABLE roles DROP CONSTRAINT roles_pkey;
  ALTER TABLE roles ADD CONSTRAINT roles_pkey PRIMARY KEY (org_id, key);
  ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_orgfk FOREIGN KEY (org_id, role) REFERENCES roles (org_id, key) ON UPDATE CASCADE;

  -- every other foreign key between tenant tables points at an id: give it its org companion
  FOR k IN
    SELECT con.conname, ch.relname AS child, pa.relname AS parent, ca.attname AS col, pa_att.attname AS ref,
           con.confdeltype, con.confupdtype
    FROM pg_constraint con
    JOIN pg_class ch ON ch.oid = con.conrelid JOIN pg_class pa ON pa.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = ch.relnamespace
    JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
    JOIN pg_attribute pa_att ON pa_att.attrelid = con.confrelid AND pa_att.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND n.nspname = 'public' AND ch.relname = ANY (tenant) AND pa.relname = ANY (tenant)
      AND ca.attname <> 'org_id'
    ORDER BY pa.relname, ch.relname, con.conname
  LOOP
    IF array_length((SELECT conkey FROM pg_constraint WHERE conname = k.conname AND conrelid = k.child::regclass), 1) <> 1 OR k.ref <> 'id' THEN
      RAISE EXCEPTION 'foreign key % (%.% -> %.%) is not a single column onto id: handle it by hand', k.conname, k.child, k.col, k.parent, k.ref;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = left(k.parent, 50) || '_org_id_uq') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (org_id, id)', k.parent, left(k.parent, 50) || '_org_id_uq');
    END IF;
    act := CASE k.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' WHEN 'n' THEN format('SET NULL (%I)', k.col)
                              WHEN 'd' THEN format('SET DEFAULT (%I)', k.col) ELSE 'NO ACTION' END;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id, %I) REFERENCES %I (org_id, id) ON DELETE %s ON UPDATE %s',
      k.child, left(k.conname, 57) || '_orgfk', k.col, k.parent, act,
      CASE k.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END);
  END LOOP;
END $$;
--> statement-breakpoint

-- Keys that were one-per-table become one-per-org.
ALTER TABLE app_config DROP CONSTRAINT app_config_pkey;
--> statement-breakpoint
ALTER TABLE app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (org_id, key);
--> statement-breakpoint
ALTER TABLE signature_images DROP CONSTRAINT signature_images_pkey;
--> statement-breakpoint
ALTER TABLE signature_images ADD CONSTRAINT signature_images_pkey PRIMARY KEY (org_id, key);
--> statement-breakpoint
ALTER TABLE login_locks DROP CONSTRAINT login_locks_pkey;
--> statement-breakpoint
ALTER TABLE login_locks ADD CONSTRAINT login_locks_pkey PRIMARY KEY (org_id, key);
--> statement-breakpoint
ALTER TABLE ip_rules DROP CONSTRAINT ip_rules_pkey;
--> statement-breakpoint
ALTER TABLE ip_rules ADD CONSTRAINT ip_rules_pkey PRIMARY KEY (org_id, ip);
--> statement-breakpoint

DO $$
DECLARE
  -- name -> the new definition (org_id first); the rest of each definition is the old one, unchanged
  u constant text[][] := ARRAY[
    ['branches_code_uq', 'branches (org_id, code)'],
    ['branches_cert_code_uq', 'branches (org_id, cert_code)'],
    ['branches_website_host_uq', 'branches (org_id, website_host) WHERE website_host IS NOT NULL'],
    ['certificates_cert_no_unique', 'certificates (org_id, cert_no)'],
    ['departments_name_uq', 'departments (org_id, name)'],
    ['enquiries_no_uq', 'enquiries (org_id, enquiry_no)'],
    ['event_participants_cert_no_uq', 'event_participants (org_id, cert_no)'],
    ['internships_ref_uq', 'internships (org_id, ref_no)'],
    ['lead_categories_name_uq', 'lead_categories (org_id, lower(name))'],
    ['letter_companies_default_uq', 'letter_companies (org_id, is_default) WHERE is_default'],
    ['letter_companies_name_uq', 'letter_companies (org_id, lower(name))'],
    ['lookups_kind_value_uq', 'lookups (org_id, kind, value)'],
    ['message_templates_one_uq', $q$message_templates (org_id, key, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE key <> 'announcement'$q$],
    ['receipts_receipt_no_unique', 'receipts (org_id, receipt_no)'],
    ['registrations_reg_no_uq', 'registrations (org_id, reg_no)'],
    ['settings_scope_key_uq', 'settings (org_id, branch_id, key) NULLS NOT DISTINCT'],
    ['support_tickets_no_uq', 'support_tickets (org_id, ticket_no)'],
    ['users_email_uq', 'users (org_id, email)'],
    ['wa_campaigns_campaign_uq', 'wa_campaigns (org_id, lower(campaign))'],
    ['web_leads_site_ext_uq', 'web_leads (org_id, site_host, external_id) WHERE external_id IS NOT NULL']];
  i int;
  tbl text;
BEGIN
  FOR i IN 1 .. array_length(u, 1) LOOP
    SELECT c.conrelid::regclass::text INTO tbl FROM pg_constraint c WHERE c.conname = u[i][1] AND c.contype = 'u';
    IF tbl IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, u[i][1]);
    ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = u[i][1] AND relkind = 'i') THEN
      EXECUTE format('DROP INDEX %I', u[i][1]);
    ELSE
      RAISE EXCEPTION 'unique key % not found', u[i][1];
    END IF;
    EXECUTE format('CREATE UNIQUE INDEX %I ON %s', u[i][1], u[i][2]);
  END LOOP;
END $$;
--> statement-breakpoint

-- The SECURITY DEFINER helpers (they skip RLS): each now stays inside the transaction's org.
CREATE OR REPLACE FUNCTION app_has_perm(perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS
  $$ SELECT EXISTS (SELECT 1 FROM roles r
       WHERE r.org_id = app_org()
         AND (r.key = app_role() OR r.key IN (SELECT ur.role FROM user_roles ur WHERE ur.user_id = app_user() AND ur.org_id = app_org()))
         AND (r.kind = 'super' OR perm = ANY (r.permissions))) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_my_help_offers() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' SET "app.own_only" TO 'false' AS
  $$ SELECT request_id FROM help_offers WHERE trainer_id = app_user() AND org_id = app_org() $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_own_batches() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' SET "app.own_only" TO 'false' AS
  $$ SELECT b.id FROM batches b WHERE b.trainer_id = app_user() AND b.org_id = app_org()
     UNION SELECT t.batch_id FROM trainer_requests t WHERE t.trainer_id = app_user() AND t.status = 'accepted' AND t.org_id = app_org() $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_own_students() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' SET "app.own_only" TO 'false' AS
  $$ SELECT r.id FROM registrations r WHERE r.org_id = app_org() AND (r.created_by = app_user()
       OR r.enquiry_id IN (SELECT e.id FROM enquiries e WHERE e.org_id = app_org() AND (e.created_by = app_user() OR e.assigned_to = app_user())))
     UNION SELECT m.registration_id FROM batch_members m JOIN batches b ON b.id = m.batch_id
       WHERE b.trainer_id = app_user() AND m.org_id = app_org() AND b.org_id = app_org()
     UNION SELECT m.registration_id FROM batch_members m WHERE m.org_id = app_org() AND m.batch_id IN
       (SELECT t.batch_id FROM trainer_requests t WHERE t.trainer_id = app_user() AND t.status = 'accepted' AND t.org_id = app_org()) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_shared_students() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' SET "app.own_only" TO 'false' AS
  $$ SELECT registration_id FROM student_shares WHERE to_branch_id = app_branch() AND status = 'accepted' AND org_id = app_org() $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_trainer_students() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' SET "app.own_only" TO 'false' AS
  $$ SELECT m.registration_id FROM batch_members m WHERE m.org_id = app_org() AND m.batch_id IN
       (SELECT r.batch_id FROM trainer_requests r WHERE r.trainer_id = app_user() AND r.status = 'accepted' AND r.org_id = app_org()) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_visible_help_requests() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' SET "app.own_only" TO 'false' AS
  $$ SELECT h.id FROM help_requests h WHERE h.org_id = app_org() AND (h.branch_id = app_branch() OR h.chosen_trainer_id = app_user()
       OR (app_can_teach() AND (h.status = 'open' OR h.id IN (SELECT request_id FROM help_offers WHERE trainer_id = app_user() AND org_id = app_org())))) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION branch_options() RETURNS TABLE(id uuid, code text, name text, city text) LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' AS
  $$ SELECT b.id, b.code, b.name, b.city FROM branches b WHERE b.is_active AND b.org_id = app_org() ORDER BY b.name $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_event(p_event text, p_payload jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.is_super" TO 'true' AS
  $$ INSERT INTO webhook_deliveries (org_id, webhook_id, event, payload)
     SELECT w.org_id, w.id, p_event, p_payload FROM webhooks w
     WHERE w.org_id = app_org() AND w.is_active AND (p_event = ANY (w.events) OR '*' = ANY (w.events)) $$;
--> statement-breakpoint

-- The guards that look roles up by key: the key is only unique inside an org.
CREATE OR REPLACE FUNCTION user_roles_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN
  IF NOT app_is_super() AND NOT app_db_owner() AND EXISTS (SELECT 1 FROM roles WHERE key = NEW.role AND org_id = NEW.org_id AND kind = 'super') THEN
    RAISE EXCEPTION 'Only head office can give the % role', NEW.role;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN
  IF app_is_super() OR app_db_owner() OR OLD.id = app_user() THEN RETURN NEW; END IF;
  IF (NOT OLD.branch_made OR OLD.branch_id IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.key = ur.role AND r.org_id = ur.org_id WHERE ur.user_id = OLD.id AND r.kind = 'super'))
     AND (NEW.password_hash, NEW.email, NEW.is_active, NEW.deleted_at, NEW.branch_id, NEW.branch_made, NEW.must_change_password, NEW.password_changed_at, NEW.two_factor_email)
         IS DISTINCT FROM (OLD.password_hash, OLD.email, OLD.is_active, OLD.deleted_at, OLD.branch_id, OLD.branch_made, OLD.must_change_password, OLD.password_changed_at, OLD.two_factor_email) THEN
    RAISE EXCEPTION 'Head office made this login, so only head office can change it';
  END IF;
  IF NEW.branch_made IS DISTINCT FROM OLD.branch_made OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'Only head office can move a login to another branch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- The org's owner is one of its own users.
ALTER TABLE organisations ADD CONSTRAINT organisations_owner_fk FOREIGN KEY (id, owner_user_id) REFERENCES users (org_id, id) DEFERRABLE INITIALLY DEFERRED;
