CREATE TYPE "public"."installment_status" AS ENUM('scheduled', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('charge', 'discount', 'payment', 'refund', 'adjustment');--> statement-breakpoint
CREATE TABLE "fee_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"ref_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"amount" integer NOT NULL,
	"status" "installment_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"mode_id" uuid NOT NULL,
	"txn_ref" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"pdf_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "receipts_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mode_id_lookups_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_ledger_reg_idx" ON "fee_ledger" USING btree ("registration_id","created_at");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("branch_id","status","due_date");--> statement-breakpoint
CREATE INDEX "payments_reg_idx" ON "payments" USING btree ("registration_id","paid_at");