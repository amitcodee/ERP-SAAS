-- A parent's or guardian's private link to one registration (modules/portal/parent.ts): attendance, fees and marks,
-- read-only, with Pay online. Only a hash of the token is kept. Staff see their branch's (head office every
-- branch's); a student only their own registrations'.
CREATE TABLE parent_links (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid NOT NULL REFERENCES registrations(id),
	token_hash text NOT NULL,
	created_by uuid NOT NULL REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	revoked_at timestamp with time zone,
	last_seen_at timestamp with time zone,
	CONSTRAINT parent_links_branch_id_orgfk FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
	CONSTRAINT parent_links_registration_id_orgfk FOREIGN KEY (org_id, registration_id) REFERENCES registrations (org_id, id),
	CONSTRAINT parent_links_created_by_orgfk FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX parent_links_token_uq ON parent_links (org_id, token_hash);
--> statement-breakpoint
CREATE INDEX parent_links_reg_idx ON parent_links (registration_id);
--> statement-breakpoint
ALTER TABLE parent_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE parent_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY parent_links_scope ON parent_links FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY student_own ON parent_links AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY org_guard ON parent_links AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON parent_links AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON parent_links AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON parent_links AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON parent_links TO techcadd_app;
--> statement-breakpoint
-- who opened a fee payment page: the student (back to their portal) or a parent through their link (back to a page
-- of their own; the link's token is never kept, so the way back cannot name it)
ALTER TABLE fee_payment_links ADD COLUMN via text DEFAULT 'student' NOT NULL;
--> statement-breakpoint
ALTER TABLE fee_payment_links ADD CONSTRAINT fee_payment_links_via_ck CHECK (via IN ('student', 'parent'));
