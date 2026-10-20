-- Sign-in protection. Every sign-in attempt is logged (who, from which IP and device, what happened). Wrong
-- passwords lock the IP and the account for longer and longer (30 s, 1 min, 10 min, 30 min, 1 h); after that the IP
-- is blocked until head office unblocks it. Head office can also block an IP by hand, or trust one (a branch
-- office) so it is never blocked. Locations of IPs are looked up once and kept. Head office only.
CREATE TABLE login_attempts (
	id bigserial PRIMARY KEY,
	at timestamptz NOT NULL DEFAULT now(),
	email text,
	user_id uuid REFERENCES users(id) ON DELETE SET NULL,
	ip text,
	user_agent text,
	-- success | two_factor_sent | wrong_password | unknown_email | inactive | branch_not_ready | locked | blocked_ip | two_factor_wrong
	result text NOT NULL
);--> statement-breakpoint
CREATE INDEX login_attempts_at_idx ON login_attempts (at DESC);--> statement-breakpoint
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, at DESC);--> statement-breakpoint
CREATE INDEX login_attempts_email_idx ON login_attempts (email, at DESC);--> statement-breakpoint
-- one row per IP ('ip:…') and per account ('email:…'): wrong tries since the last success and how far up the ladder
CREATE TABLE login_locks (
	key text PRIMARY KEY,
	failures integer NOT NULL DEFAULT 0,
	level integer NOT NULL DEFAULT 0,
	locked_until timestamptz,
	last_failed_at timestamptz
);--> statement-breakpoint
CREATE TABLE ip_rules (
	ip text PRIMARY KEY,
	kind text NOT NULL,
	reason text,
	auto boolean NOT NULL DEFAULT false,
	created_by uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT ip_rules_kind_ck CHECK (kind IN ('block', 'allow'))
);--> statement-breakpoint
CREATE TABLE ip_geo (
	ip text PRIMARY KEY,
	country text,
	region text,
	city text,
	isp text,
	looked_up_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE login_locks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE login_locks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ip_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ip_rules FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ip_geo ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ip_geo FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- sign-in runs on the server's own (head-office) connection; reading and managing them is head office only
CREATE POLICY login_attempts_super ON login_attempts FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
CREATE POLICY login_locks_super ON login_locks FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
CREATE POLICY ip_rules_super ON ip_rules FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
CREATE POLICY ip_geo_super ON ip_geo FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON login_attempts, login_locks, ip_rules, ip_geo TO techcadd_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO techcadd_app;
