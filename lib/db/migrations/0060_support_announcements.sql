-- Student portal: help tickets (a student asks, the branch answers, in a thread) and announcements (a notice board:
-- head office posts to every branch or to one, a branch manager to their own branch).
CREATE SEQUENCE support_ticket_seq;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE support_ticket_seq TO techcadd_app;--> statement-breakpoint
CREATE TABLE support_tickets (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ticket_no text NOT NULL DEFAULT ('TKT-' || lpad(nextval('support_ticket_seq')::text, 5, '0')),
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid REFERENCES registrations(id),
	person_id uuid NOT NULL REFERENCES persons(id),
	created_by uuid REFERENCES users(id),
	category text NOT NULL,
	subject text NOT NULL,
	status text NOT NULL DEFAULT 'open',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	closed_at timestamptz,
	CONSTRAINT support_tickets_status_ck CHECK (status IN ('open', 'answered', 'closed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX support_tickets_no_uq ON support_tickets (ticket_no);--> statement-breakpoint
CREATE INDEX support_tickets_branch_idx ON support_tickets (branch_id, status, updated_at);--> statement-breakpoint
CREATE INDEX support_tickets_person_idx ON support_tickets (person_id);--> statement-breakpoint
CREATE TABLE support_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
	branch_id uuid NOT NULL REFERENCES branches(id),
	author_id uuid REFERENCES users(id),
	from_staff boolean NOT NULL DEFAULT false,
	body text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, created_at);--> statement-breakpoint
CREATE TABLE announcements (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	branch_id uuid REFERENCES branches(id), -- null = every branch (head office)
	title text NOT NULL,
	body text NOT NULL,
	pinned boolean NOT NULL DEFAULT false,
	ends_on date, -- shown until this day; null = until removed
	created_by uuid REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz
);--> statement-breakpoint
CREATE INDEX announcements_branch_idx ON announcements (branch_id, created_at);--> statement-breakpoint
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE support_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- tickets and their messages: the branch (all for head office); a student only their own
CREATE POLICY support_tickets_scope ON support_tickets FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_own ON support_tickets AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR person_id = app_person()) WITH CHECK (app_role() <> 'student' OR person_id = app_person());--> statement-breakpoint
CREATE POLICY support_messages_scope ON support_messages FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_own ON support_messages AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR ticket_id IN (SELECT id FROM support_tickets)) WITH CHECK (app_role() <> 'student' OR (NOT from_staff AND ticket_id IN (SELECT id FROM support_tickets)));--> statement-breakpoint
-- announcements: everyone reads those for all branches and their own branch's; head office and the branch write
CREATE POLICY announcements_read ON announcements FOR SELECT USING (app_is_super() OR branch_id IS NULL OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY announcements_write ON announcements FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_no_insert ON announcements AS RESTRICTIVE FOR INSERT WITH CHECK (app_role() <> 'student');--> statement-breakpoint
CREATE POLICY student_no_update ON announcements AS RESTRICTIVE FOR UPDATE USING (app_role() <> 'student');--> statement-breakpoint
CREATE POLICY student_no_delete ON announcements AS RESTRICTIVE FOR DELETE USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets, support_messages, announcements TO techcadd_app;
