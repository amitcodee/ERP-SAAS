-- What a branch spends (modules/expenses/service.ts), against the fees received for the profit. Staff see their
-- branch's (head office every branch's); students never. A wrong entry is deleted softly and stays on record.
CREATE TABLE expenses (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid NOT NULL REFERENCES branches(id),
	spent_on date NOT NULL,
	category text NOT NULL,
	amount integer NOT NULL,
	paid_to text,
	mode text,
	note text,
	created_by uuid NOT NULL REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	deleted_at timestamp with time zone,
	deleted_by uuid REFERENCES users(id),
	CONSTRAINT expenses_amount_ck CHECK (amount > 0),
	CONSTRAINT expenses_branch_id_orgfk FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
	CONSTRAINT expenses_created_by_orgfk FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
	CONSTRAINT expenses_deleted_by_orgfk FOREIGN KEY (org_id, deleted_by) REFERENCES users (org_id, id)
);
--> statement-breakpoint
CREATE INDEX expenses_branch_day_idx ON expenses (branch_id, spent_on);
--> statement-breakpoint
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY expenses_scope ON expenses FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY student_deny ON expenses AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY org_guard ON expenses AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON expenses AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON expenses AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON expenses AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON expenses TO techcadd_app;
--> statement-breakpoint
-- the new permission area: head office and branch managers everything; accountants see and record
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['expense:read', 'expense:create', 'expense:delete']) AS x ORDER BY x)
WHERE key IN ('super_admin', 'branch_manager');
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['expense:read', 'expense:create']) AS x ORDER BY x)
WHERE key = 'accountant';
