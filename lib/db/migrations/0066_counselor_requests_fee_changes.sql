-- Counselors collect fee payments but only ASK for a fee change (total, plan, discount); accounts or the branch head
-- approves it. Accountants still do not take payments; they check, raise remarks and decide fee changes.
UPDATE roles SET updated_at = now(), permissions = array_remove(permissions, 'fee:update'),
  description = 'Enquiries and admissions; collects fee payments and asks accounts for fee changes; requests certificates and internship letters.'
WHERE key = 'counselor';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['fee:update']) AS x ORDER BY x),
  description = 'Checks the fees admissions collects (remarks to fix), approves fee changes and discounts; clears fees and issues course and project certificates.'
WHERE key = 'accountant';
