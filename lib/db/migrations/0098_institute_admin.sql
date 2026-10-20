-- The head-office role (key super_admin) is the institute's own admin, nothing more on a multi-tenant platform: it is
-- called "Institute Admin" (lib/auth/permissions.ts DEFAULT_ROLES). Renamed where an org has not renamed it itself.
UPDATE roles SET name = 'Institute Admin', description = 'Head office of the institute. Everything, in every branch.', updated_at = now()
  WHERE key = 'super_admin' AND name = 'Super Admin';
