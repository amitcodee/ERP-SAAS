-- An institute that signed up and waits for the platform's approval (Console → Platform settings: "New institutes wait
-- for my approval"). Its owner can sign in, finish Set Up and pay; it runs (its trial starts) once approved.
ALTER TABLE organisations DROP CONSTRAINT organisations_status_ck;
--> statement-breakpoint
ALTER TABLE organisations ADD CONSTRAINT organisations_status_ck CHECK (status IN ('pending', 'trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'));
