CREATE TYPE "public"."notification_channel" AS ENUM('whatsapp', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"person_id" uuid,
	"registration_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"template" text NOT NULL,
	"to_address" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_branch_idx" ON "notifications" USING btree ("branch_id","created_at");