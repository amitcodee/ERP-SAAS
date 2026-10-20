-- Self sign-up (the public site): an institute that has asked for an account and is confirming its e-mail with a
-- code. The org is made only once the code is right. A platform table: only the platform context reads it.
CREATE TABLE signups (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	name text NOT NULL,
	slug text NOT NULL,
	owner_name text NOT NULL,
	email text NOT NULL,
	mobile text NOT NULL,
	plan_key text NOT NULL REFERENCES plans(key) ON UPDATE CASCADE,
	password_hash text NOT NULL,
	code_hash text NOT NULL,
	attempts integer DEFAULT 0 NOT NULL,
	sends integer DEFAULT 1 NOT NULL,
	expires_at timestamp with time zone NOT NULL,
	ip text,
	org_id uuid REFERENCES organisations(id),
	completed_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT signups_email_ck CHECK (email = lower(email))
);
--> statement-breakpoint
CREATE INDEX signups_email_idx ON signups (email, created_at);
--> statement-breakpoint
CREATE INDEX signups_slug_idx ON signups (slug) WHERE completed_at IS NULL;
--> statement-breakpoint
ALTER TABLE signups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE signups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signups_platform ON signups FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON signups TO techcadd_app;
