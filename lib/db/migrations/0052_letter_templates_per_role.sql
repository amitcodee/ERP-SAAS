-- Several letter templates per letter (e.g. "Web Development Intern", "App Development Intern"), chosen per student;
-- "Standard" stays the built-in default (a row named Standard is head office's edited Standard).
-- Registrations say which internship letters the student needs and from which templates; courses list their skills /
-- tools for {{skills}}.
ALTER TABLE "letter_templates" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "letter_templates" ADD COLUMN "name" text DEFAULT 'Standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "letter_templates" DROP CONSTRAINT "letter_templates_pkey";--> statement-breakpoint
ALTER TABLE "letter_templates" ADD PRIMARY KEY ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "letter_templates_kind_name_uq" ON "letter_templates" ("kind", lower("name"));--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "wants_offer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "offer_template_id" uuid REFERENCES "letter_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "internships" ADD COLUMN "completion_template_id" uuid REFERENCES "letter_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "internships_registration_uq" ON "internships" ("registration_id") WHERE registration_id IS NOT NULL AND status <> 'cancelled';--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "internship_offer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "internship_completion" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "offer_template_id" uuid REFERENCES "letter_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "completion_template_id" uuid REFERENCES "letter_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "skills" text;
