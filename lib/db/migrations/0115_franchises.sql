-- Franchises (modules/franchise/service.ts): a branch is the institute's own or a franchise run by a partner, who pays a
-- royalty (a percent of the fees the centre receives, in basis points, or a fixed amount a month, in paise). Receipts of
-- a franchise carry the partner's legal name. Royalty payments are recorded by head office; a franchise's own staff
-- with franchise:read see their centre's statement. A wrong payment is deleted softly and stays on record.
ALTER TABLE branches ADD COLUMN kind text NOT NULL DEFAULT 'own';
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN partner_name text;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN partner_owner text;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN partner_phone text;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN partner_email text;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN agreement_from date;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN agreement_to date;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN royalty_kind text;
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN royalty_value integer;
--> statement-breakpoint
ALTER TABLE branches ADD CONSTRAINT branches_kind_ck CHECK (kind IN ('own', 'franchise'));
--> statement-breakpoint
ALTER TABLE branches ADD CONSTRAINT branches_royalty_ck CHECK (
	(royalty_kind IS NULL AND royalty_value IS NULL)
	OR (royalty_kind = 'percent' AND royalty_value BETWEEN 0 AND 10000)
	OR (royalty_kind = 'fixed' AND royalty_value >= 0));
--> statement-breakpoint
ALTER TABLE branches ADD CONSTRAINT branches_agreement_ck CHECK (agreement_to IS NULL OR agreement_from IS NULL OR agreement_to >= agreement_from);
--> statement-breakpoint
CREATE TABLE royalty_payments (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid NOT NULL REFERENCES branches(id),
	paid_on date NOT NULL,
	amount integer NOT NULL,
	mode text,
	ref text,
	note text,
	created_by uuid NOT NULL REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	deleted_at timestamp with time zone,
	deleted_by uuid REFERENCES users(id),
	CONSTRAINT royalty_payments_amount_ck CHECK (amount > 0),
	CONSTRAINT royalty_payments_branch_id_orgfk FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
	CONSTRAINT royalty_payments_created_by_orgfk FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
	CONSTRAINT royalty_payments_deleted_by_orgfk FOREIGN KEY (org_id, deleted_by) REFERENCES users (org_id, id)
);
--> statement-breakpoint
CREATE INDEX royalty_payments_branch_day_idx ON royalty_payments (branch_id, paid_on);
--> statement-breakpoint
ALTER TABLE royalty_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE royalty_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY royalty_payments_scope ON royalty_payments FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY student_deny ON royalty_payments AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY org_guard ON royalty_payments AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON royalty_payments AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON royalty_payments AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON royalty_payments AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON royalty_payments TO techcadd_app;
--> statement-breakpoint
-- the new permission area: head office everything; branch managers see their own centre's statement
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['franchise:read', 'franchise:update', 'franchise:create', 'franchise:delete']) AS x ORDER BY x)
WHERE key = 'super_admin';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['franchise:read']) AS x ORDER BY x)
WHERE key = 'branch_manager';
