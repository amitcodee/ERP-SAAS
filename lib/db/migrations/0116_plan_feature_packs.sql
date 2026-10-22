-- The feature packs (lib/panel/features.ts) become part of what a plan includes (Console → Plans), so a plan decides
-- which extras an institute may switch on. Every plan that exists keeps what it had: it gets every pack ('events' was
-- already a plan module and stays as each plan has it). During a trial everything is open, as before.
UPDATE plans SET modules = ARRAY(SELECT DISTINCT x FROM unnest(modules || ARRAY['calling', 'webleads', 'helpdesk', 'teaching', 'expenses', 'internships', 'letters', 'whatsapp', 'import', 'franchise']) AS x ORDER BY x);
