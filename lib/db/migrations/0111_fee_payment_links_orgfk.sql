-- fee_payment_links (0110) points at tenant tables: each key gets its org companion, as every such key has (0095), so
-- a row can never point at another institute's branch, registration or user.
ALTER TABLE fee_payment_links ADD CONSTRAINT fee_payment_links_branch_id_orgfk FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id);
--> statement-breakpoint
ALTER TABLE fee_payment_links ADD CONSTRAINT fee_payment_links_registration_id_orgfk FOREIGN KEY (org_id, registration_id) REFERENCES registrations (org_id, id);
--> statement-breakpoint
ALTER TABLE fee_payment_links ADD CONSTRAINT fee_payment_links_created_by_orgfk FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id);
