-- Tickets grow up: staff raise INTERNAL tickets (to their branch manager, or to head office), every ticket has a
-- priority with its SLA (a reply due by), an assignee, escalation (automatic when overdue, or by hand) and, once
-- answered, a rating from whoever raised it. A student ticket keeps its person; an internal one has none.
ALTER TABLE support_tickets ALTER COLUMN person_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN kind text NOT NULL DEFAULT 'student';--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN priority text NOT NULL DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN assigned_to uuid REFERENCES users(id);--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN assigned_at timestamptz;--> statement-breakpoint
-- the SLA: while the ticket waits for the branch, a reply is due by this time
ALTER TABLE support_tickets ADD COLUMN due_at timestamptz;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN first_reply_at timestamptz;--> statement-breakpoint
-- 0 = not escalated, 1 = to the branch manager, 2 = to head office
ALTER TABLE support_tickets ADD COLUMN escalation_level integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN escalated_at timestamptz;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN escalation_note text;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN to_head_office boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN rating integer;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN rating_note text;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN rated_at timestamptz;--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_kind_ck CHECK (kind IN ('student', 'internal') AND (kind = 'internal' OR person_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_priority_ck CHECK (priority IN ('low', 'normal', 'high', 'urgent'));--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_rating_ck CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_escalation_ck CHECK (escalation_level BETWEEN 0 AND 2);--> statement-breakpoint
CREATE INDEX support_tickets_assigned_idx ON support_tickets (assigned_to, status);--> statement-breakpoint
CREATE INDEX support_tickets_due_idx ON support_tickets (status, due_at);--> statement-breakpoint
CREATE INDEX support_tickets_created_by_idx ON support_tickets (created_by);--> statement-breakpoint
-- tickets already waiting get the normal SLA from their last update
UPDATE support_tickets SET due_at = updated_at + interval '24 hours' WHERE status = 'open';
