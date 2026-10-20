-- What an institute uses against its plan's limits (lib/plan/limits.ts): counted over the WHOLE institute, whoever
-- asks (a branch user's own view would undercount), and only for the transaction's own institute.
CREATE OR REPLACE FUNCTION org_usage()
  RETURNS TABLE (branches integer, staff integer, active_students integer, storage_mb numeric, messages_month integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
DECLARE o uuid := app_org();
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'org_usage: no organisation in this transaction'; END IF;
  RETURN QUERY SELECT
    (SELECT count(*)::int FROM branches b WHERE b.org_id = o AND b.is_active),
    (SELECT count(DISTINCT u.id)::int FROM users u JOIN user_roles r ON r.user_id = u.id AND r.org_id = o
       WHERE u.org_id = o AND u.is_active AND u.deleted_at IS NULL AND r.role <> 'student'),
    (SELECT count(*)::int FROM registrations g WHERE g.org_id = o AND g.status = 'active' AND g.deleted_at IS NULL),
    round(((SELECT coalesce(sum(octet_length(d.data)), 0) FROM registration_documents d WHERE d.org_id = o)
      + (SELECT coalesce(sum(octet_length(f.data)), 0) FROM course_syllabus_files f WHERE f.org_id = o)
      + (SELECT coalesce(sum(octet_length(c.data)), 0) FROM syllabus_changes c WHERE c.org_id = o)
      + (SELECT coalesce(sum(octet_length(n.data)), 0) FROM notes n WHERE n.org_id = o)
      + (SELECT coalesce(sum(octet_length(s.data)), 0) FROM signature_images s WHERE s.org_id = o)
      + (SELECT coalesce(sum(coalesce(octet_length(l.letterhead), 0) + coalesce(octet_length(l.stamp), 0)), 0) FROM letter_companies l WHERE l.org_id = o)
      + (SELECT coalesce(sum(octet_length(h.head_signature)), 0) FROM departments h WHERE h.org_id = o)
      ) / 1048576.0, 2),
    (SELECT count(*)::int FROM notifications m WHERE m.org_id = o AND m.channel IN ('sms', 'whatsapp') AND m.status IN ('queued', 'sent')
       AND m.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION org_usage() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION org_usage() TO techcadd_app;
