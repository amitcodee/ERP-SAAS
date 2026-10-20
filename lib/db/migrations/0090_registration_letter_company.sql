-- A registration says which company its internship letters come from (Letter Templates → Companies); null: techcadd.
-- Setting up the intern (Internship Requests → From registrations) takes it over.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS letter_company_id uuid REFERENCES letter_companies(id);
