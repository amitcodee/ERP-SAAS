-- Two-step sign-in by e-mail: when on, the password alone is not enough; a 6-digit code is mailed to the person
-- and asked for before the session starts. Each person switches it on or off for themselves (My account > Security).
ALTER TABLE "users" ADD COLUMN "two_factor_email" boolean DEFAULT false NOT NULL;
