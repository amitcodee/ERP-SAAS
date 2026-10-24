-- Certificates at a franchise (modules/certificates/service.ts): the partner's centre requests them, head office issues
-- them (in the brand's name), unless head office lets that franchise issue its own. Enforced here too: at a franchise
-- that waits for head office, only head office may insert a certificate.
ALTER TABLE branches ADD COLUMN hq_certificates boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE POLICY franchise_hq_issue ON certificates AS RESTRICTIVE FOR INSERT WITH CHECK (
	app_is_super() OR NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = certificates.branch_id AND b.kind = 'franchise' AND b.hq_certificates));
