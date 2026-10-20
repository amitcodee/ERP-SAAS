-- When the lead was called (date and time), recorded with "call done".
ALTER TABLE "enquiries" ADD COLUMN "call_at" timestamp with time zone;
