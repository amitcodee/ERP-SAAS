-- Orgs from before organisations had owners (the Sample Institute) get one: their first active head-office login.
-- A support session works as the owner, so an org without one could not be supported. (A fresh database has no
-- logins yet at this point: scripts/seed.ts sets the owner when it makes the first admin.)
UPDATE organisations o SET owner_user_id = (
  SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.org_id = u.org_id AND r.role = 'super_admin'
  WHERE u.org_id = o.id AND u.is_active AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1)
WHERE o.owner_user_id IS NULL;
