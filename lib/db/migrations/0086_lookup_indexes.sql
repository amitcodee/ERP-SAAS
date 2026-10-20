-- Indexes for what pages, filters and database access rules look up (they matter once the old data is imported):
-- a person's calls, registrations / enquiries by course, the audit log by person, a trainer's batches, a student's
-- notifications and help requests, and the links between records that are followed on every open.

CREATE INDEX IF NOT EXISTS calls_person_idx ON calls (person_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS enquiries_course_idx ON enquiries (course_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS registrations_course_idx ON registrations (course_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS batches_trainer_idx ON batches (trainer_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS certificates_request_idx ON certificates (request_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_registration_idx ON notifications (registration_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_person_idx ON notifications (person_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS help_requests_person_idx ON help_requests (person_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS help_requests_chosen_trainer_idx ON help_requests (chosen_trainer_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS help_requests_registration_idx ON help_requests (registration_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS help_offers_trainer_idx ON help_offers (trainer_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS batch_topics_session_idx ON batch_topics (session_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS batch_topics_topic_idx ON batch_topics (topic_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_registration_idx ON support_tickets (registration_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_leads_enquiry_idx ON web_leads (enquiry_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS registration_transfers_to_registration_idx ON registration_transfers (to_registration_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS student_shares_batch_idx ON student_shares (batch_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS login_attempts_user_idx ON login_attempts (user_id);
