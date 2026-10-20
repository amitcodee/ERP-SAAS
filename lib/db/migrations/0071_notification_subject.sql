-- A queued message may carry its own subject (a birthday wish's subject comes from its template).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject text;
