-- Whether the registration includes a project certificate (given with the course certificate). Chosen on the
-- registration form; existing registrations default to no.
ALTER TABLE "registrations" ADD COLUMN "project_certificate" boolean DEFAULT false NOT NULL;
