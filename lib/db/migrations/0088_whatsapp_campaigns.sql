-- Bulk WhatsApp: AiSensy campaigns listed by head office (Settings → WhatsApp campaigns) and sent to students or leads
-- from the Bulk WhatsApp page. A send is a broadcast; its messages go through the outbox like every other message.
CREATE TABLE IF NOT EXISTS wa_campaigns (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	label text NOT NULL,
	campaign text NOT NULL,
	params jsonb DEFAULT '[]'::jsonb NOT NULL,
	body text,
	media_url text,
	media_name text,
	audience text DEFAULT 'any' NOT NULL CHECK (audience IN ('any', 'students', 'leads')),
	is_active boolean DEFAULT true NOT NULL,
	created_by uuid REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS wa_campaigns_campaign_uq ON wa_campaigns (lower(campaign));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS wa_broadcasts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	campaign_id uuid NOT NULL REFERENCES wa_campaigns(id),
	branch_id uuid REFERENCES branches(id),
	audience jsonb NOT NULL,
	summary text NOT NULL,
	texts jsonb DEFAULT '[]'::jsonb NOT NULL,
	total integer NOT NULL,
	created_by uuid REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS wa_broadcasts_branch_idx ON wa_broadcasts (branch_id, created_at);--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS campaign text;--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS media jsonb;--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS broadcast_id uuid REFERENCES wa_broadcasts(id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_broadcast_idx ON notifications (broadcast_id);--> statement-breakpoint

-- campaigns: every staff member may see the list; only head office changes it
ALTER TABLE wa_campaigns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE wa_campaigns FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY wa_campaigns_read ON wa_campaigns FOR SELECT USING (app_role() <> 'student');--> statement-breakpoint
CREATE POLICY wa_campaigns_head_office ON wa_campaigns FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON wa_campaigns TO techcadd_app;--> statement-breakpoint
-- broadcasts: a branch sees its own; head office every one
ALTER TABLE wa_broadcasts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE wa_broadcasts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY wa_broadcasts_scope ON wa_broadcasts FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON wa_broadcasts AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT ON wa_broadcasts TO techcadd_app;--> statement-breakpoint

-- new permission area: broadcast (Bulk WhatsApp). The branch manager gets it; head office has everything already.
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['broadcast:read', 'broadcast:create']) AS x ORDER BY x)
WHERE key = 'branch_manager';
