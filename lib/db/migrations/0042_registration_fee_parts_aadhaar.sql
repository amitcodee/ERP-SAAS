-- Registration records how the fee was arrived at, and the student's Aadhaar number.
-- list_fee = the course's fee with GST before any offer; total_fee (what the student pays) = course_fee + gst_amount;
-- the discount given is list_fee - total_fee.
ALTER TABLE "registrations" ADD COLUMN "list_fee" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "course_fee" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "gst_amount" integer;--> statement-breakpoint
-- A customized course (made of modules chosen by the student) instead of one from the course list.
ALTER TABLE "registrations" ADD COLUMN "custom_course_title" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "custom_course" jsonb;--> statement-breakpoint
ALTER TABLE registrations ADD CONSTRAINT registrations_custom_course_ck CHECK (custom_course_title IS NULL OR course_id IS NULL);--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "aadhaar_no" text;--> statement-breakpoint
ALTER TABLE persons ADD CONSTRAINT persons_aadhaar_ck CHECK (aadhaar_no IS NULL OR aadhaar_no ~ '^[2-9][0-9]{11}$');--> statement-breakpoint
ALTER TABLE registrations ADD CONSTRAINT registrations_fee_parts_ck CHECK (course_fee IS NULL OR gst_amount IS NULL OR (course_fee >= 0 AND gst_amount >= 0 AND course_fee + gst_amount = total_fee));--> statement-breakpoint
ALTER TABLE registrations ADD CONSTRAINT registrations_list_fee_ck CHECK (list_fee IS NULL OR list_fee >= total_fee);
