// Adds a platform admin (the platform's own team: they sign in at admin.<root>), or gives one a new password:
//   pnpm platform:user --name "Amit" --email amit@example.com
// Prints the password to hand over. Platform admins never see an institute's records except through a support session.
import { pool } from '../lib/db/client'
import { upsertPlatformUser } from '../modules/platform/service'

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined }

async function main() {
  const [name, email] = [arg('name'), arg('email')]
  if (!name || !email) throw new Error('Usage: pnpm platform:user --name <name> --email <e-mail>')
  const r = await upsertPlatformUser({ name, email })
  const root = process.env.ROOT_DOMAIN
  console.log(`Platform admin ${email} (${r.id})`)
  console.log(`  sign in at: ${root ? `https://admin.${root}` : 'http://admin.localhost:3000'}`)
  console.log(`  password:   ${r.password}`)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 }).finally(() => pool.end())
