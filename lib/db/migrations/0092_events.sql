-- Seminars, workshops and other events: made in the panel with an optional quiz and a certificate design; people sign
-- up on the event's public page (its link / QR code), take the quiz when there is one, and get their certificate by
-- e-mail. Certificate designs are made on the canvas (Certificate Designs); head office's (no branch) serve every branch.
CREATE TABLE IF NOT EXISTS certificate_designs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid REFERENCES branches(id),
	name text NOT NULL,
	design jsonb NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	created_by uuid REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS certificate_designs_branch_idx ON certificate_designs (branch_id);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS events (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid REFERENCES branches(id),
	kind text NOT NULL CHECK (kind IN ('seminar', 'workshop', 'webinar', 'bootcamp', 'competition', 'other')),
	title text NOT NULL,
	description text,
	starts_at timestamp with time zone NOT NULL,
	ends_at timestamp with time zone,
	mode text DEFAULT 'offline' NOT NULL CHECK (mode IN ('offline', 'online', 'hybrid')),
	venue text,
	speaker text,
	token text NOT NULL,
	ask_mobile boolean DEFAULT true NOT NULL,
	ask_org boolean DEFAULT true NOT NULL,
	has_quiz boolean DEFAULT false NOT NULL,
	quiz jsonb DEFAULT '[]'::jsonb NOT NULL,
	pass_percent integer DEFAULT 60 NOT NULL CHECK (pass_percent BETWEEN 0 AND 100),
	quiz_minutes integer CHECK (quiz_minutes IS NULL OR quiz_minutes BETWEEN 1 AND 300),
	certificate boolean DEFAULT true NOT NULL,
	cert_for text DEFAULT 'passed' NOT NULL CHECK (cert_for IN ('all', 'passed')),
	design_id uuid REFERENCES certificate_designs(id),
	is_open boolean DEFAULT true NOT NULL,
	closes_at timestamp with time zone,
	created_by uuid REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS events_token_uq ON events (token);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_branch_idx ON events (branch_id, starts_at);--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS event_cert_seq;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE event_cert_seq TO techcadd_app;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS event_participants (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	event_id uuid NOT NULL REFERENCES events(id),
	branch_id uuid REFERENCES branches(id),
	name text NOT NULL,
	email text NOT NULL,
	mobile text,
	organisation text,
	answers jsonb,
	score integer,
	total integer,
	passed boolean,
	cert_no text,
	hash text NOT NULL,
	mailed_at timestamp with time zone,
	mail_error text,
	ip text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS event_participants_email_uq ON event_participants (event_id, lower(email));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS event_participants_hash_uq ON event_participants (hash);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS event_participants_cert_no_uq ON event_participants (cert_no);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_participants_event_idx ON event_participants (event_id, created_at);--> statement-breakpoint

-- designs: staff see head office's and their branch's; each changes its own (head office: any)
ALTER TABLE certificate_designs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE certificate_designs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY certificate_designs_read ON certificate_designs FOR SELECT USING (app_role() <> 'student' AND (branch_id IS NULL OR app_is_super() OR branch_id = app_branch()));--> statement-breakpoint
CREATE POLICY certificate_designs_insert ON certificate_designs FOR INSERT WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY certificate_designs_update ON certificate_designs FOR UPDATE USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON certificate_designs TO techcadd_app;--> statement-breakpoint
-- events and their participants: a branch its own; head office every one (and its own, with no branch)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY events_scope ON events FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON events AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON events TO techcadd_app;--> statement-breakpoint
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE event_participants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY event_participants_scope ON event_participants FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON event_participants AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON event_participants TO techcadd_app;--> statement-breakpoint

-- new permission areas: event (Seminars & workshops) and certdesign (Certificate Designs). The branch manager gets both;
-- the academic manager runs events; head office has everything already.
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['event:read', 'event:create', 'event:update', 'certdesign:read', 'certdesign:update']) AS x ORDER BY x)
WHERE key = 'branch_manager';--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['event:read', 'event:create', 'event:update', 'certdesign:read']) AS x ORDER BY x)
WHERE key = 'academic_manager';
