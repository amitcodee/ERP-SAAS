-- Registration records when classes start and how they run: the joining date, the daily class time, the course's
-- total hours and the date it is expected to finish. Also adds the "Hybrid" mode of classes.
ALTER TABLE "registrations" ADD COLUMN "joining_date" date;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "class_minutes_per_day" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "class_days_per_week" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "class_start_time" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "course_hours" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "expected_end_date" date;--> statement-breakpoint
ALTER TABLE registrations ADD CONSTRAINT registrations_schedule_ck CHECK (
  (class_minutes_per_day IS NULL OR class_minutes_per_day BETWEEN 15 AND 720)
  AND (class_days_per_week IS NULL OR class_days_per_week BETWEEN 1 AND 7)
  AND (class_start_time IS NULL OR class_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  AND (course_hours IS NULL OR course_hours > 0));--> statement-breakpoint
INSERT INTO lookups (kind, value, sort_order) VALUES ('class_mode', 'Hybrid', 2) ON CONFLICT (kind, value) DO UPDATE SET is_active = true;
