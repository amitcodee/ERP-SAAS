-- The capstone project: the student names it (title) and lists what it was built with (tools) in the portal; the trainer
-- checks both, may correct them, and approves. The project certificate prints them.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS tools text;
