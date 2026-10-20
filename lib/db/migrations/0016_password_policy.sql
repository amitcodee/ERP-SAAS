ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Every account that exists today was given a password by someone else (seed script / admin). Make them choose their own.
UPDATE "users" SET "must_change_password" = true;
