-- 1. A registration's total_fee is the fee AFTER discounts, everywhere (charged - discounted in the ledger). A discount
--    used to leave it at the full fee while a cut of the total lowered it, so later fee changes and transfers got the
--    total wrong and the money check raised false alarms. Existing rows are put right here (with their GST split).
-- 2. A transferred student's classes, attendance and approved capstone at the old branch count at the new one: they
--    are carried onto the new registration (the new branch cannot read the old branch's rows), and the attendance and
--    certificate-eligibility views add them in. So the new branch issues the certificate.
-- 3. A fee-change request still waiting on a transferred registration is closed (its fees are handled at the new branch).

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS prior_sessions integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS prior_present integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS prior_capstone_ok boolean NOT NULL DEFAULT false;--> statement-breakpoint

CREATE OR REPLACE VIEW v_attendance_pct WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id,
  (COALESCE(cnt.total, 0) + r.prior_sessions)::int AS sessions_total,
  (COALESCE(cnt.present, 0) + r.prior_present)::int AS sessions_present,
  CASE WHEN COALESCE(cnt.total, 0) + r.prior_sessions = 0 THEN 0
    ELSE ROUND(100.0 * (COALESCE(cnt.present, 0) + r.prior_present) / (COALESCE(cnt.total, 0) + r.prior_sessions))::int END AS pct
FROM registrations r
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE a.present) AS present
  FROM attendance a WHERE a.registration_id = r.id
) cnt ON true;--> statement-breakpoint

CREATE OR REPLACE VIEW v_certificate_eligibility WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id, r.status AS registration_status,
  b.balance AS fee_balance,
  a.pct AS attendance_pct, a.sessions_total,
  COALESCE(
    (SELECT (s.value #>> '{}')::int FROM settings s WHERE s.key = 'certificate.min_attendance_pct' AND s.branch_id = r.branch_id),
    (SELECT (s.value #>> '{}')::int FROM settings s WHERE s.key = 'certificate.min_attendance_pct' AND s.branch_id IS NULL),
    80) AS min_attendance_pct,
  r.prior_capstone_ok OR EXISTS (SELECT 1 FROM assessments x WHERE x.registration_id = r.id AND x.kind = 'capstone' AND x.approved_at IS NOT NULL) AS capstone_ok
FROM registrations r
JOIN v_fee_balance b ON b.registration_id = r.id
JOIN v_attendance_pct a ON a.registration_id = r.id;--> statement-breakpoint

-- carry-over for students already transferred (oldest transfer first, so a second move carries the first one's too)
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT from_registration_id, to_registration_id FROM registration_transfers WHERE status = 'accepted' AND to_registration_id IS NOT NULL ORDER BY decided_at LOOP
    UPDATE registrations n SET
      prior_sessions = o.prior_sessions + (SELECT count(*) FROM attendance a WHERE a.registration_id = o.id),
      prior_present = o.prior_present + (SELECT count(*) FILTER (WHERE a.present) FROM attendance a WHERE a.registration_id = o.id),
      prior_capstone_ok = o.prior_capstone_ok OR EXISTS (SELECT 1 FROM assessments x WHERE x.registration_id = o.id AND x.kind = 'capstone' AND x.approved_at IS NOT NULL)
    FROM registrations o WHERE o.id = t.from_registration_id AND n.id = t.to_registration_id;
  END LOOP;
END $$;--> statement-breakpoint

-- total fee = after discounts; the course-fee / GST split follows in the same proportion
UPDATE registrations r SET
  gst_amount = CASE WHEN r.gst_amount IS NOT NULL AND r.course_fee IS NOT NULL AND r.total_fee > 0 THEN round((b.charged - b.discounted)::numeric * r.gst_amount / r.total_fee)::int ELSE r.gst_amount END,
  course_fee = CASE WHEN r.gst_amount IS NOT NULL AND r.course_fee IS NOT NULL AND r.total_fee > 0 THEN (b.charged - b.discounted) - round((b.charged - b.discounted)::numeric * r.gst_amount / r.total_fee)::int ELSE r.course_fee END,
  list_fee = CASE WHEN r.list_fee IS NULL THEN r.total_fee ELSE greatest(r.list_fee, r.total_fee) END,
  total_fee = b.charged - b.discounted,
  updated_at = now()
FROM v_fee_balance b
WHERE b.registration_id = r.id AND b.charged > 0 AND b.charged - b.discounted >= 0 AND r.total_fee <> b.charged - b.discounted;--> statement-breakpoint

UPDATE fee_change_requests q SET status = 'rejected', decided_at = now(), decision_note = 'Closed: the student was transferred to another branch'
FROM registrations r WHERE r.id = q.registration_id AND r.status = 'transferred' AND q.status = 'pending';
