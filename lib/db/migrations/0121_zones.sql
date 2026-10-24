-- Zones (regions) above branches (modules/branches/zones.ts): head office groups its branches into zones and names a
-- zonal manager for each; the manager then works in every branch of the zone (user_branches, full access). A share made
-- for a zone carries via_zone, so taking the manager off (or the branch out of the zone) removes only what the zone gave.
CREATE TABLE zones (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	name text NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT zones_name_ck CHECK (length(trim(name)) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX zones_name_uq ON zones (org_id, lower(name));
--> statement-breakpoint
ALTER TABLE zones ADD CONSTRAINT zones_org_id_uq UNIQUE (org_id, id);
--> statement-breakpoint
CREATE TABLE zone_managers (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	zone_id uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
	user_id uuid NOT NULL REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY (zone_id, user_id),
	CONSTRAINT zone_managers_zone_id_orgfk FOREIGN KEY (org_id, zone_id) REFERENCES zones (org_id, id) ON DELETE CASCADE,
	CONSTRAINT zone_managers_user_id_orgfk FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id)
);
--> statement-breakpoint
CREATE INDEX zone_managers_user_idx ON zone_managers (user_id);
--> statement-breakpoint
ALTER TABLE branches ADD COLUMN zone_id uuid REFERENCES zones(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE branches ADD CONSTRAINT branches_zone_id_orgfk FOREIGN KEY (org_id, zone_id) REFERENCES zones (org_id, id) ON DELETE SET NULL (zone_id);
--> statement-breakpoint
ALTER TABLE user_branches ADD COLUMN via_zone uuid REFERENCES zones(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE user_branches ADD CONSTRAINT user_branches_via_zone_orgfk FOREIGN KEY (org_id, via_zone) REFERENCES zones (org_id, id) ON DELETE SET NULL (via_zone);
--> statement-breakpoint
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE zones FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY zones_read ON zones FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY zones_write ON zones FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY student_deny ON zones AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY org_guard ON zones AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON zones AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON zones AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON zones AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
ALTER TABLE zone_managers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE zone_managers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY zone_managers_read ON zone_managers FOR SELECT USING (app_is_super() OR user_id = app_user());
--> statement-breakpoint
CREATE POLICY zone_managers_write ON zone_managers FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY student_deny ON zone_managers AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY org_guard ON zone_managers AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON zone_managers AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON zone_managers AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON zone_managers AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON zones TO techcadd_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON zone_managers TO techcadd_app;
