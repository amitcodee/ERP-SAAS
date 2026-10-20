-- Lookups "by student" were scanning whole tables/indexes (found with 3,000 students + 75,000 attendance rows:
-- the main page took ~5s). Each composite primary key led with the OTHER column, so it could not serve these.
CREATE INDEX IF NOT EXISTS attendance_registration_idx ON attendance (registration_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS batch_members_registration_idx ON batch_members (registration_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS installments_registration_idx ON installments (registration_id, status, due_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS certificate_requests_registration_idx ON certificate_requests (registration_id, requested_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payments_registration_idx2 ON payments (registration_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS registrations_created_idx ON registrations (branch_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS enquiries_created_idx ON enquiries (branch_id, created_at DESC);
--> statement-breakpoint
ANALYZE attendance;
--> statement-breakpoint
ANALYZE registrations;
