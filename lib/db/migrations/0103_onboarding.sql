-- The setup steps of a new institute (Set Up, PLAN.md 2.3): which ones it has marked done or skipped, and whether it
-- has put the checklist away. Institutes from before sign-up existed are set up already.
ALTER TABLE organisations ADD COLUMN onboarding jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE organisations SET onboarding = '{"dismissed": true}'::jsonb;
