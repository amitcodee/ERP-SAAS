-- Message templates: the words of the birthday e-mail and card, the help-desk reply e-mail, the trainer help e-mails,
-- and ready-made announcements. Head office writes the default (branch_id NULL); a branch manager may write their
-- branch's own version, which wins for that branch. "announcement" rows are a list (many per branch); every other
-- key has at most one row per branch (and one default).
CREATE TABLE message_templates (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	key text NOT NULL,
	branch_id uuid REFERENCES branches(id),
	title text,
	subject text,
	body text NOT NULL,
	updated_by uuid REFERENCES users(id),
	updated_at timestamptz NOT NULL DEFAULT now(),
	created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX message_templates_one_uq ON message_templates (key, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE key <> 'announcement';--> statement-breakpoint
CREATE INDEX message_templates_branch_idx ON message_templates (branch_id, key);--> statement-breakpoint
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- staff read the defaults and their branch's own; they write only their branch's (head office: any)
CREATE POLICY message_templates_read ON message_templates FOR SELECT USING (app_is_super() OR branch_id IS NULL OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY message_templates_write ON message_templates FOR INSERT WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY message_templates_update ON message_templates FOR UPDATE USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY message_templates_delete ON message_templates FOR DELETE USING (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_deny ON message_templates AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO techcadd_app;
