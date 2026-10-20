// Super admin recovery, for when nobody can sign in (no e-mail provider means "forgot password" cannot send a link).
// Run it INSIDE the app container (Coolify -> techcadd-panel application -> Terminal). Plain JS: the runtime image has no TypeScript.
//
//   node scripts/admin-reset.mjs                      list the super admin e-mails
//   node scripts/admin-reset.mjs you@example.com      new one-time password for that super admin
//                                                     (creates the super admin if the system has none yet)
//
// The new password is printed once and never stored in plain text. It must be changed at the first sign-in,
// and every open session of that account is signed out. The reset is written to the audit log.
import { randomBytes } from 'crypto'
import { hash } from '@node-rs/argon2'
import pg from 'pg'

const url = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL // the tables' owner when the app has its own login
if (!url) { console.error('DATABASE_URL is not set (run this inside the app container)'); process.exit(1) }
const email = (process.argv[2] ?? '').trim().toLowerCase()
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('begin')
  await client.query("select set_config('app.is_super', 'true', true), set_config('app.role', 'system', true)")
  const admins = (await client.query(
    `select u.id, u.email, u.is_active from users u join user_roles r on r.user_id = u.id
     where r.role = 'super_admin' and u.deleted_at is null order by u.created_at`)).rows

  if (!email) {
    console.log(admins.length ? 'Super admins:\n' + admins.map((a) => `  ${a.email}${a.is_active ? '' : '  (deactivated)'}`).join('\n') : 'There is no super admin yet.')
    console.log('\nRun again with an e-mail to get a one-time password: node scripts/admin-reset.mjs you@example.com')
    await client.query('rollback')
  } else {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`"${email}" is not an e-mail address`)
    const temp = randomBytes(9).toString('base64url')
    const passwordHash = await hash(temp)
    let userId, action
    const existing = admins.find((a) => a.email === email)
    if (existing) {
      // reactivate too: a locked-out super admin is exactly what this is for
      await client.query(
        `update users set password_hash = $1, must_change_password = true, password_changed_at = now(), is_active = true where id = $2`,
        [passwordHash, existing.id])
      userId = existing.id; action = 'admin_recovery_reset'
    } else if (admins.length === 0) {
      const taken = (await client.query('select 1 from users where email = $1', [email])).rowCount
      if (taken) throw new Error(`${email} belongs to a staff/student account; use a different e-mail for the super admin`)
      userId = (await client.query(
        `insert into users (name, email, password_hash, must_change_password) values ('Super Admin', $1, $2, true) returning id`,
        [email, passwordHash])).rows[0].id
      await client.query(`insert into user_roles (user_id, role) values ($1, 'super_admin')`, [userId])
      action = 'admin_recovery_create'
    } else {
      throw new Error(`${email} is not a super admin. Existing super admins: ${admins.map((a) => a.email).join(', ')}`)
    }
    await client.query(`insert into audit_logs (user_id, action, entity, entity_id) values ($1, $2, 'user', $3)`, [userId, action, String(userId)])
    await client.query('commit')
    console.log(`\nSign in at the panel with:\n  e-mail:   ${email}\n  password: ${temp}\n\nYou will be asked to choose your own password straight away. This one-time password is not shown again.`)
  }
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
