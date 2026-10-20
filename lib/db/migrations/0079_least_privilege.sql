-- Least privilege for the app's database role. 0001 made every new table writable in full (ALTER DEFAULT PRIVILEGES
-- ... SELECT, INSERT, UPDATE, DELETE), so tables added since could be changed or emptied by the app even where nothing
-- should ever be (support messages, fee remarks, transfers, syllabus changes, certificates, receipts ...).
-- Now: new tables get SELECT and INSERT only, and UPDATE / DELETE are granted per table, exactly where the code
-- changes or removes rows. (Recycle-bin purges and the factory reset run as the owner and are not affected.)

-- new tables: read and add only; anything more is granted on purpose in the migration that makes the table
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM techcadd_app;--> statement-breakpoint

-- start from nothing: no table can be changed or emptied by the app ...
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE '%drizzle%' LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM techcadd_app', t);
  END LOOP;
END $$;--> statement-breakpoint

-- ... then rows the app edits (status changes, settings, soft delete via deleted_at, counters, upserts)
GRANT UPDATE ON
  announcements, api_keys, app_config, assessments, attendance, batch_topics, batches, branches, calls,
  certificate_requests, class_sessions, course_syllabus_files, course_topics, courses, departments, enquiries,
  fee_change_requests, fee_remarks, help_offers, help_requests, installments, internships, ip_geo, ip_rules, job_runs,
  lead_categories, letter_templates, login_locks, message_templates, notes, notifications, number_sequences, persons,
  registration_transfers, registrations, roles, settings, signature_images, student_shares, support_tickets,
  syllabus_changes, trainer_requests, user_branches, users, web_leads, webhook_deliveries, webhooks
TO techcadd_app;--> statement-breakpoint
-- only these columns: revoking a certificate, and a receipt's stored PDF (the rest of both is immutable)
GRANT UPDATE (is_revoked, revoked_reason, revoked_at, revoked_by) ON certificates TO techcadd_app;--> statement-breakpoint
GRANT UPDATE (pdf_object_key) ON receipts TO techcadd_app;--> statement-breakpoint

-- ... and rows the app removes for good (replaced lists, links, wrong uploads, lockout counters)
GRANT DELETE ON
  assessments, batch_members, batch_topics, course_syllabus_files, course_topics, help_offers, ip_rules,
  letter_templates, login_attempts, login_locks, message_templates, registration_documents, roles, tests,
  user_branches, user_roles, web_leads, webhooks
TO techcadd_app;
-- Never changed or removed by the app (append-only or immutable), among them: audit_logs, fee_ledger, payments,
-- payment_reversals, receipts, registration_events, enquiry_events, call_followups, support_messages, person_occupations,
-- lookups; and certificates / receipts beyond the columns above.
