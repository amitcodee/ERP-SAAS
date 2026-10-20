-- Enquiries are people who came to the office (visited). Leads are the ones who have not visited yet: they come
-- from the website, e-mail or another source and are kept on their own "Leads" page until the visit.
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
-- Everything entered as an enquiry before this change was an office enquiry.
UPDATE enquiries SET visited = true, visited_at = coalesce(visited_at, created_at) WHERE NOT visited;
--> statement-breakpoint
INSERT INTO lookups (kind, value, sort_order)
SELECT 'enquiry_source', v.value, v.sort_order FROM (VALUES ('Website', 8), ('Email', 9)) AS v(value, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM lookups l WHERE l.kind = 'enquiry_source' AND lower(l.value) = lower(v.value));
--> statement-breakpoint
UPDATE lookups SET sort_order = 20 WHERE kind = 'enquiry_source' AND value = 'Other';
