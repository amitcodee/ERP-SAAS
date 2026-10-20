-- Website leads. Every form sent on a branch website (techcadd-<city> sites) arrives here first, with the page it came from.
-- A site whose address is set on a branch (branches.website_url) sends its leads straight into that branch as Leads;
-- the others wait in this inbox, shown by website, until head office sends them to a branch.
ALTER TABLE "branches" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "website_host" text;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_website_host_uq" ON "branches" ("website_host") WHERE "website_host" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "source_url" text;--> statement-breakpoint
CREATE TABLE "web_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_host" text NOT NULL,
	"source_url" text,
	"external_id" text,
	"name" text NOT NULL,
	"phone" text,
	"phone_norm" text,
	"email" text,
	"course" text,
	"location" text,
	"message" text,
	"payload" jsonb,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"branch_id" uuid REFERENCES "branches"("id"),
	"matched_by" text,
	"enquiry_id" uuid REFERENCES "enquiries"("id"),
	"problem" text,
	"placed_by" uuid REFERENCES "users"("id"),
	"placed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "web_leads_site_ext_uq" ON "web_leads" ("site_host", "external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "web_leads_branch_idx" ON "web_leads" ("branch_id", "submitted_at");--> statement-breakpoint
CREATE INDEX "web_leads_site_idx" ON "web_leads" ("site_host", "submitted_at");--> statement-breakpoint
ALTER TABLE web_leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE web_leads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A branch sees the website leads given to it; leads not yet given to a branch are head office's.
CREATE POLICY web_leads_read ON web_leads FOR SELECT USING (app_is_super() OR (branch_id IS NOT NULL AND branch_id = app_branch()));
--> statement-breakpoint
CREATE POLICY web_leads_write ON web_leads FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON web_leads TO techcadd_app;
--> statement-breakpoint
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
INSERT INTO lookups (kind, value, sort_order) SELECT 'enquiry_source', 'Website', 8
WHERE NOT EXISTS (SELECT 1 FROM lookups WHERE kind = 'enquiry_source' AND value = 'Website');
--> statement-breakpoint
-- Branch heads see their own branch's website leads (matches DEFAULT_ROLES in lib/auth/permissions.ts).
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['weblead:read']) AS x ORDER BY x)
WHERE key = 'branch_manager';
