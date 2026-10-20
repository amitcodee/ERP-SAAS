-- Staff who work in a second branch for their own work only (app_own_only, 0076) see just the events they made there
-- and those events' participants, as with enquiries and registrations: not everyone's names, e-mails and mobiles.
CREATE POLICY own_only ON events AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR created_by = app_user());--> statement-breakpoint
CREATE POLICY own_only ON event_participants AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR event_id IN (SELECT id FROM events));
