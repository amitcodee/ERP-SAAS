-- Multi-tenancy, part 1: the platform's own tables. An organisation is one institute (the tenant); its branches,
-- staff, students and everything else belong to it (0095 puts org_id on every tenant table). Platform admins are
-- separate people (platform_users) who see organisations, never their students; support access to an org goes
-- through support_sessions, which the org sees.
--
-- Database context (lib/db/withTenant.ts):
--   app.org_id     the organisation the transaction works in (tenant tables show only its rows; unset: none)
--   app.read_only  'true' while the org is read-only (billing) or a support session is read-only: no writes
--   app.platform   'true' for the platform console (platform tables only; tenant tables still need app.org_id)
CREATE OR REPLACE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_read_only() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.read_only', true), 'false') = 'true' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.platform', true), 'false') = 'true' $$;
--> statement-breakpoint

-- Plans: limits and the modules they include. Edited by the platform admin; read by anyone (the pricing page).
CREATE TABLE plans (
	key text PRIMARY KEY NOT NULL,
	name text NOT NULL,
	description text,
	price_monthly integer DEFAULT 0 NOT NULL, -- paise, before GST
	price_yearly integer DEFAULT 0 NOT NULL,
	limits jsonb DEFAULT '{}'::jsonb NOT NULL, -- {branches, staff, activeStudents, storageMb, messagesPerMonth}: null = no limit
	modules text[] DEFAULT '{}' NOT NULL, -- e.g. events, api, custom_domain, white_label
	is_public boolean DEFAULT true NOT NULL,
	sort integer DEFAULT 0 NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT plans_key_ck CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
INSERT INTO plans (key, name, description, price_monthly, price_yearly, limits, modules, sort) VALUES
  ('free', 'Free', 'One branch to try things out.', 0, 0, '{"branches":1,"staff":3,"activeStudents":50,"storageMb":200,"messagesPerMonth":100}', '{}', 0),
  ('starter', 'Starter', 'A single-centre institute.', 99900, 999000, '{"branches":1,"staff":10,"activeStudents":300,"storageMb":2000,"messagesPerMonth":2000}', '{events}', 1),
  ('growth', 'Growth', 'Several branches, events and the API.', 249900, 2499000, '{"branches":5,"staff":50,"activeStudents":2000,"storageMb":20000,"messagesPerMonth":10000}', '{events,api}', 2),
  ('enterprise', 'Enterprise', 'No fixed limits, your own domain and branding.', 0, 0, '{"branches":null,"staff":null,"activeStudents":null,"storageMb":null,"messagesPerMonth":null}', '{events,api,custom_domain,white_label,sso}', 3);
--> statement-breakpoint

CREATE TABLE organisations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	name text NOT NULL,
	legal_name text,
	slug text NOT NULL,
	status text DEFAULT 'trial' NOT NULL,
	plan_key text DEFAULT 'starter' NOT NULL REFERENCES plans(key) ON UPDATE CASCADE,
	trial_ends_at timestamp with time zone,
	branding jsonb DEFAULT '{}'::jsonb NOT NULL, -- logo, colours, tagline, signature ... (Phase 3)
	numbering jsonb DEFAULT '{}'::jsonb NOT NULL, -- number formats per kind (lib/numbering.ts)
	locale text DEFAULT 'en-IN' NOT NULL,
	timezone text DEFAULT 'Asia/Kolkata' NOT NULL,
	currency text DEFAULT 'INR' NOT NULL,
	country text DEFAULT 'IN' NOT NULL,
	gstin text,
	pan text,
	address text,
	phone text,
	email text,
	owner_user_id uuid, -- the institute's owner (a users row of this org); set once the owner's login exists
	features jsonb DEFAULT '{}'::jsonb NOT NULL, -- feature flags set by the platform admin
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT organisations_status_ck CHECK (status IN ('trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled')),
	-- a DNS label: also the subdomain <slug>.<root domain>
	CONSTRAINT organisations_slug_ck CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX organisations_slug_uq ON organisations (slug);
--> statement-breakpoint

-- The org every row that existed before multi-tenancy belongs to (development data and the demo).
INSERT INTO organisations (id, name, slug, status, plan_key) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Sample Institute', 'sample', 'active', 'enterprise');
--> statement-breakpoint

-- Custom domains: verified by a DNS TXT record holding `token` before the host resolves to the org.
CREATE TABLE org_domains (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	org_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
	host text NOT NULL,
	token text NOT NULL,
	verified_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT org_domains_host_ck CHECK (host = lower(host))
);
--> statement-breakpoint
CREATE UNIQUE INDEX org_domains_host_uq ON org_domains (host);
--> statement-breakpoint
CREATE INDEX org_domains_org_idx ON org_domains (org_id);
--> statement-breakpoint

-- The platform's own people (your company). They sign in on the platform host only.
CREATE TABLE platform_users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	name text NOT NULL,
	email text NOT NULL,
	password_hash text NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	last_login_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX platform_users_email_uq ON platform_users (lower(email));
--> statement-breakpoint

-- Platform-wide settings (the fallback mailer, billing details on platform invoices, ...); secrets sealed.
CREATE TABLE platform_config (
	key text PRIMARY KEY NOT NULL,
	config jsonb DEFAULT '{}'::jsonb NOT NULL,
	secrets text,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Support access: a platform admin works inside an org for a short, stated reason. The org's admins see every one.
CREATE TABLE support_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	org_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
	platform_user_id uuid NOT NULL REFERENCES platform_users(id),
	reason text NOT NULL,
	mode text DEFAULT 'read' NOT NULL,
	started_at timestamp with time zone DEFAULT now() NOT NULL,
	expires_at timestamp with time zone NOT NULL,
	ended_at timestamp with time zone,
	ended_by text, -- 'platform' | 'org' | 'expired'
	CONSTRAINT support_sessions_mode_ck CHECK (mode IN ('read', 'write')),
	CONSTRAINT support_sessions_length_ck CHECK (expires_at > started_at AND expires_at <= started_at + interval '60 minutes')
);
--> statement-breakpoint
CREATE INDEX support_sessions_org_idx ON support_sessions (org_id, started_at DESC);
--> statement-breakpoint

-- Row-level security on the platform tables.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plans_read ON plans FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY plans_write ON plans FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
--> statement-breakpoint
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organisations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- an org sees its own row; its head office may edit it (status, plan and trial are guarded below)
CREATE POLICY organisations_read ON organisations FOR SELECT USING (app_is_platform() OR id = app_org());
--> statement-breakpoint
CREATE POLICY organisations_update ON organisations FOR UPDATE
  USING (app_is_platform() OR (id = app_org() AND app_is_super()))
  WITH CHECK (app_is_platform() OR (id = app_org() AND app_is_super()));
--> statement-breakpoint
CREATE POLICY organisations_insert ON organisations FOR INSERT WITH CHECK (app_is_platform());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION organisations_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN
  IF NOT app_is_platform() AND NOT app_db_owner() AND (NEW.status, NEW.plan_key, NEW.trial_ends_at, NEW.slug, NEW.features)
       IS DISTINCT FROM (OLD.status, OLD.plan_key, OLD.trial_ends_at, OLD.slug, OLD.features) THEN
    RAISE EXCEPTION 'Only the platform changes an organisation''s status, plan, trial, web address or features';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organisations_guard BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION organisations_guard();
--> statement-breakpoint
ALTER TABLE org_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_domains FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_domains_read ON org_domains FOR SELECT USING (app_is_platform() OR org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_domains_write ON org_domains FOR ALL
  USING (app_is_platform() OR (org_id = app_org() AND app_is_super()))
  WITH CHECK (app_is_platform() OR (org_id = app_org() AND app_is_super()));
--> statement-breakpoint
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_users_scope ON platform_users FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
--> statement-breakpoint
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_config FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_config_scope ON platform_config FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
--> statement-breakpoint
ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE support_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- the platform opens and ends them; the org sees its own and its head office may end one
CREATE POLICY support_sessions_read ON support_sessions FOR SELECT USING (app_is_platform() OR org_id = app_org());
--> statement-breakpoint
CREATE POLICY support_sessions_insert ON support_sessions FOR INSERT WITH CHECK (app_is_platform());
--> statement-breakpoint
CREATE POLICY support_sessions_update ON support_sessions FOR UPDATE
  USING (app_is_platform() OR (org_id = app_org() AND app_is_super()))
  WITH CHECK (app_is_platform() OR (org_id = app_org() AND app_is_super()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON plans, organisations, org_domains, platform_users, platform_config, support_sessions TO techcadd_app;
--> statement-breakpoint
GRANT DELETE ON org_domains TO techcadd_app;
--> statement-breakpoint

-- Which org a host belongs to, before anyone has signed in (the proxy and public pages). Returns only what routing
-- needs, so an unauthenticated request cannot list organisations.
CREATE OR REPLACE FUNCTION org_for_host(p_slug text, p_host text)
  RETURNS TABLE (id uuid, slug text, name text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'pg_temp' SET "app.platform" TO 'true' AS
  $$ SELECT o.id, o.slug, o.name, o.status FROM organisations o
     WHERE (p_slug IS NOT NULL AND o.slug = lower(p_slug))
        OR (p_host IS NOT NULL AND o.id = (SELECT d.org_id FROM org_domains d WHERE d.host = lower(p_host) AND d.verified_at IS NOT NULL))
     LIMIT 1 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION org_for_host(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION org_for_host(text, text) TO techcadd_app;
