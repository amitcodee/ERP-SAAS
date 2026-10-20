-- A message may carry its own HTML body (a birthday wish has its own festive layout); the text stays for the plain part.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS html text;
