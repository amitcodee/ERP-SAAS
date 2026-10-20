-- Leads made from a website form are dated by when the form was sent (not when it was placed in a branch), so the
-- Leads list shows them in the same order as Web Leads. New ones are dated this way when placed; this fixes the rest.
SELECT set_config('app.is_super', 'true', false);
--> statement-breakpoint
UPDATE enquiries e SET created_at = w.submitted_at
FROM web_leads w
WHERE w.enquiry_id = e.id AND w.submitted_at < e.created_at;
