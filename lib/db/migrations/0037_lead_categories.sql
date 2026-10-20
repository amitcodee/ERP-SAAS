-- Lead categories: a list head office keeps (Settings), set on random calls, leads and visited enquiries.
CREATE TABLE "lead_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_categories_name_uq" ON "lead_categories" (lower("name"));--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_category_id_lead_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lead_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_category_id_lead_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lead_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE lead_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lead_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Same rule as the other shared lists: everyone reads, only head office changes.
CREATE POLICY lead_categories_read ON lead_categories FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY lead_categories_write ON lead_categories FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_categories TO techcadd_app;
