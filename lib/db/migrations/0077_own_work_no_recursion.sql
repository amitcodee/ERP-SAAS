-- 0076's "own work only" rules read batches from batch_members while batches (student rule) reads batch_members: Postgres
-- refuses such a loop ("infinite recursion detected in policy for relation batches") even when own_only is off.
-- The rules now ask helper functions (read as head office, own work off) instead of the tables themselves.

-- the batches that are mine: I teach them, or took them on through a trainer request
CREATE OR REPLACE FUNCTION app_own_batches() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' SET app.own_only = 'false' AS
  $$ SELECT b.id FROM batches b WHERE b.trainer_id = app_user()
     UNION SELECT t.batch_id FROM trainer_requests t WHERE t.trainer_id = app_user() AND t.status = 'accepted' $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_own_batches() TO techcadd_app;--> statement-breakpoint
-- the helpers read everything as head office: own work must be off inside them too, or they would ask themselves
ALTER FUNCTION app_own_students() SET app.own_only = 'false';--> statement-breakpoint
ALTER FUNCTION app_shared_students() SET app.own_only = 'false';--> statement-breakpoint
ALTER FUNCTION app_trainer_students() SET app.own_only = 'false';--> statement-breakpoint

DROP POLICY own_only ON batches;--> statement-breakpoint
CREATE POLICY own_only ON batches AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR id IN (SELECT app_own_batches()));--> statement-breakpoint
DROP POLICY own_only ON batch_members;--> statement-breakpoint
CREATE POLICY own_only ON batch_members AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT app_own_batches()));--> statement-breakpoint
DROP POLICY own_only ON class_sessions;--> statement-breakpoint
CREATE POLICY own_only ON class_sessions AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT app_own_batches()));--> statement-breakpoint
DROP POLICY own_only ON tests;--> statement-breakpoint
CREATE POLICY own_only ON tests AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT app_own_batches()));--> statement-breakpoint
DROP POLICY own_only ON batch_topics;--> statement-breakpoint
CREATE POLICY own_only ON batch_topics AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR batch_id IN (SELECT app_own_batches()));--> statement-breakpoint

-- a student's records: mine when the student is (no detour through registrations' own rules)
DROP POLICY own_only ON fee_ledger;--> statement-breakpoint
CREATE POLICY own_only ON fee_ledger AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON installments;--> statement-breakpoint
CREATE POLICY own_only ON installments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON payments;--> statement-breakpoint
CREATE POLICY own_only ON payments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON payment_reversals;--> statement-breakpoint
CREATE POLICY own_only ON payment_reversals AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON fee_change_requests;--> statement-breakpoint
CREATE POLICY own_only ON fee_change_requests AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON fee_remarks;--> statement-breakpoint
CREATE POLICY own_only ON fee_remarks AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON certificate_requests;--> statement-breakpoint
CREATE POLICY own_only ON certificate_requests AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON certificates;--> statement-breakpoint
CREATE POLICY own_only ON certificates AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON registration_documents;--> statement-breakpoint
CREATE POLICY own_only ON registration_documents AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON registration_events;--> statement-breakpoint
CREATE POLICY own_only ON registration_events AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON attendance;--> statement-breakpoint
CREATE POLICY own_only ON attendance AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON assessments;--> statement-breakpoint
CREATE POLICY own_only ON assessments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON internships;--> statement-breakpoint
CREATE POLICY own_only ON internships AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR created_by = app_user() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON registration_transfers;--> statement-breakpoint
CREATE POLICY own_only ON registration_transfers AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR from_registration_id IN (SELECT app_own_students()));--> statement-breakpoint
DROP POLICY own_only ON student_shares;--> statement-breakpoint
CREATE POLICY own_only ON student_shares AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));
