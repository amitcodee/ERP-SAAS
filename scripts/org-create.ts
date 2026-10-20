// Creates an institute (modules/orgs/provision.ts) from the command line, for development and first installs:
//   pnpm org:create --name "Bright Future Academy" --slug bright --owner "Meera Kapoor" --email meera@example.com
// Prints the owner's temporary password (changed at first sign-in) and the workspace address.
import { pool } from '../lib/db/client'
import { provisionOrg } from '../modules/orgs/provision'

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined }

async function main() {
  const [name, slug, ownerName, ownerEmail] = [arg('name'), arg('slug'), arg('owner'), arg('email')]
  if (!name || !slug || !ownerName || !ownerEmail) throw new Error('Usage: pnpm org:create --name <institute> --slug <web address> --owner <name> --email <owner e-mail> [--active]')
  const r = await provisionOrg({ name, slug, ownerName, ownerEmail, status: process.argv.includes('--active') ? 'active' : 'trial' })
  const root = process.env.ROOT_DOMAIN
  console.log(`Created ${name} (${r.orgId})`)
  console.log(`  workspace: ${root ? `https://${r.slug}.${root}` : `http://${r.slug}.localhost:3000`}`)
  console.log(`  owner:     ${ownerEmail}  temporary password: ${r.tempPassword}`)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 }).finally(() => pool.end())
