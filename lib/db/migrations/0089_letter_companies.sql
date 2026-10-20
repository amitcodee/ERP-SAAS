-- Internship letters for several companies (techcadd, Syntax Developer, Zabi Technologies, Xair Robotics…): each company
-- has its own name, contact, letterhead and stamp, and its own letter templates. An intern is taken on by one company;
-- their letters use that company's templates, letterhead and stamp. Everything so far belongs to techcadd.
CREATE TABLE IF NOT EXISTS letter_companies (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	name text NOT NULL,
	legal_name text NOT NULL,
	contact_phone text,
	contact_email text,
	letterhead_mime text,
	letterhead bytea,
	stamp_mime text,
	stamp bytea,
	is_default boolean DEFAULT false NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	sort_order integer DEFAULT 0 NOT NULL,
	updated_by uuid REFERENCES users(id),
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS letter_companies_name_uq ON letter_companies (lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS letter_companies_default_uq ON letter_companies (is_default) WHERE is_default;--> statement-breakpoint
INSERT INTO letter_companies (name, legal_name, contact_phone, contact_email, is_default, sort_order) VALUES
	('techcadd', 'techcadd Computer Education (OPC) Private Ltd.', '98881-22291', 'hrmtechcadd@gmail.com', true, 0),
	('Syntax Developer', 'Syntax Developer', NULL, NULL, false, 1),
	('Zabi Technologies', 'Zabi Technologies', NULL, NULL, false, 2),
	('Xair Robotics', 'Xair Robotics', NULL, NULL, false, 3)
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- templates belong to a company (the ones so far: techcadd); names are unique within a company
ALTER TABLE letter_templates ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES letter_companies(id) ON DELETE CASCADE;--> statement-breakpoint
UPDATE letter_templates SET company_id = (SELECT id FROM letter_companies WHERE is_default) WHERE company_id IS NULL;--> statement-breakpoint
ALTER TABLE letter_templates ALTER COLUMN company_id SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS letter_templates_kind_name_uq;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS letter_templates_company_kind_name_uq ON letter_templates (company_id, kind, lower(name));--> statement-breakpoint

-- an intern is taken on by one company (the ones so far: techcadd)
ALTER TABLE internships ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES letter_companies(id);--> statement-breakpoint
UPDATE internships SET company_id = (SELECT id FROM letter_companies WHERE is_default) WHERE company_id IS NULL;--> statement-breakpoint
ALTER TABLE internships ALTER COLUMN company_id SET NOT NULL;--> statement-breakpoint

ALTER TABLE letter_companies ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE letter_companies FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY letter_companies_read ON letter_companies FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY letter_companies_write ON letter_companies FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
CREATE POLICY student_deny ON letter_companies AS RESTRICTIVE FOR ALL USING (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON letter_companies TO techcadd_app;
