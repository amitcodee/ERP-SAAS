import { sql } from 'drizzle-orm'

/**
 * Admissions counted once: a registration that came in through an accepted transfer is the same student's admission,
 * already counted at the branch they joined (registration alias must be `r`).
 */
export const NOT_TRANSFERRED_IN = sql`not exists (select 1 from registration_transfers t where t.to_registration_id = r.id)`
