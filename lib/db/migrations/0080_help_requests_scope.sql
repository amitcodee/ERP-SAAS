-- Project / study help (Ask a trainer) was open to every staff role at the database level (USING (true)): any login
-- could read, change or delete every student's requests and offers. Now:
--   a request: head office; the student's branch; teaching staff of any branch (who offer help) — the open requests and
--              those they offered on or were chosen for; the student their own (the existing student rule);
--   an offer:  head office; the request's branch; the trainer who made it; teaching staff who can see the request.
-- "Teaching staff" is the same test as the app's canTeach: a role with the attendance:create permission.

CREATE OR REPLACE FUNCTION app_can_teach() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.key = ur.role
       WHERE ur.user_id = app_user() AND (r.kind = 'super' OR 'attendance:create' = ANY (r.permissions))) $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_teach() TO techcadd_app;--> statement-breakpoint
-- the requests this person offered on (read as head office, so the two tables' rules do not ask each other)
CREATE OR REPLACE FUNCTION app_my_help_offers() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' SET app.own_only = 'false' AS
  $$ SELECT request_id FROM help_offers WHERE trainer_id = app_user() $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_my_help_offers() TO techcadd_app;--> statement-breakpoint
-- the requests this person may see (for the offers' rule)
CREATE OR REPLACE FUNCTION app_visible_help_requests() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' SET app.own_only = 'false' AS
  $$ SELECT h.id FROM help_requests h WHERE h.branch_id = app_branch() OR h.chosen_trainer_id = app_user()
       OR (app_can_teach() AND (h.status = 'open' OR h.id IN (SELECT request_id FROM help_offers WHERE trainer_id = app_user()))) $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_visible_help_requests() TO techcadd_app;--> statement-breakpoint

DROP POLICY IF EXISTS help_requests_all ON help_requests;--> statement-breakpoint
CREATE POLICY help_requests_read ON help_requests FOR SELECT USING (
  app_is_super() OR app_role() = 'student' OR branch_id = app_branch() OR chosen_trainer_id = app_user()
  OR (app_can_teach() AND (status = 'open' OR id IN (SELECT app_my_help_offers()))));--> statement-breakpoint
-- a student asks (their own, by the student rule); staff of the branch
CREATE POLICY help_requests_add ON help_requests FOR INSERT WITH CHECK (app_is_super() OR app_role() = 'student' OR branch_id = app_branch());--> statement-breakpoint
-- the student (chooses a trainer, cancels), the branch, the chosen trainer (marks it done)
CREATE POLICY help_requests_change ON help_requests FOR UPDATE
  USING (app_is_super() OR app_role() = 'student' OR branch_id = app_branch() OR chosen_trainer_id = app_user())
  WITH CHECK (app_is_super() OR app_role() = 'student' OR branch_id = app_branch() OR chosen_trainer_id = app_user());--> statement-breakpoint

DROP POLICY IF EXISTS help_offers_all ON help_offers;--> statement-breakpoint
CREATE POLICY help_offers_read ON help_offers FOR SELECT USING (
  app_is_super() OR app_role() = 'student' OR trainer_id = app_user() OR request_id IN (SELECT app_visible_help_requests()));--> statement-breakpoint
-- a trainer offers (and changes / withdraws) only their own offer, on a request they can see
CREATE POLICY help_offers_own ON help_offers FOR INSERT WITH CHECK (trainer_id = app_user() AND app_can_teach() AND request_id IN (SELECT app_visible_help_requests()));--> statement-breakpoint
CREATE POLICY help_offers_change ON help_offers FOR UPDATE USING (trainer_id = app_user()) WITH CHECK (trainer_id = app_user());--> statement-breakpoint
CREATE POLICY help_offers_remove ON help_offers FOR DELETE USING (trainer_id = app_user() OR app_is_super());
