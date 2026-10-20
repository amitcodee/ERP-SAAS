-- Proof of a payment (a screenshot of the transfer, the card slip, a photo of the cheque or of the signed cash slip)
-- is kept with the registration's documents, tied to the payment it proves.
ALTER TABLE "registration_documents" ADD COLUMN "payment_id" uuid REFERENCES "payments"("id");--> statement-breakpoint
CREATE INDEX "registration_documents_payment_idx" ON "registration_documents" ("payment_id") WHERE payment_id IS NOT NULL;
