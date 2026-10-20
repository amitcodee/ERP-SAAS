// Seeds catalogs straight from fildes.md (P3) + global rules (P7) + first super admin.
// Idempotent: safe to re-run. Branches are NOT seeded — we need the real list (insti.md §12).
import { hash } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { withOrgSystem } from '../lib/db/withTenant'
import { departments, lookups, settings, userRoles, users } from '../lib/db/schema'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

const DEPARTMENTS = ['Basic & Accounting', 'CSE-IT', 'Graphic Designing', 'Digital Marketing', 'CAD/CAM', 'Video Editing', 'Robotics']

const LOOKUPS: Record<(typeof lookups.$inferInsert)['kind'], string[]> = {
  enquiry_source: ['Random call', 'Direct visit', 'Banners/Posters', 'Reference', 'Social Media', 'Just Dial', 'Seminar', 'Paid Lead', 'Other'],
  payment_mode: ['Cash', 'Online', 'Card Payment', 'Cheque'],
  class_mode: ['Online', 'Offline'],
  occupation_type: ['Student', 'Working', 'Unemployed', 'Abroad'],
  not_joined_reason: ['Will Register soon', 'Will Take time to Register', 'Will Confirm within days'],
  qualification: [],
  disposition: [],
}

const SETTINGS: Record<string, unknown> = {
  'certificate.min_attendance_pct': 80,
  'followup.sla_hours': 2,
}

async function main() {
const email = process.env.SEED_ADMIN_EMAIL
const password = process.env.SEED_ADMIN_PASSWORD

await withOrgSystem(ORG, async (tx) => {
  await tx.insert(departments).values(DEPARTMENTS.map((name, i) => ({ name, sortOrder: i }))).onConflictDoNothing()

  for (const [kind, values] of Object.entries(LOOKUPS)) {
    if (!values.length) continue
    await tx
      .insert(lookups)
      .values(values.map((value, i) => ({ kind: kind as keyof typeof LOOKUPS, value, sortOrder: i })))
      .onConflictDoNothing()
  }

  for (const [key, value] of Object.entries(SETTINGS)) {
    await tx.insert(settings).values({ key, value: value as never }).onConflictDoNothing()
  }

  if (email && password) {
    const [existing] = await tx.select().from(users).where(eq(users.email, email))
    if (!existing) {
      const [u] = await tx
        .insert(users)
        .values({ name: 'Super Admin', email, passwordHash: await hash(password), mustChangePassword: true })
        .returning()
      await tx.insert(userRoles).values({ userId: u.id, orgId: ORG, role: 'super_admin' })
      // the first admin owns the org (a support session works as the owner)
      await tx.execute(sql`update organisations set owner_user_id = ${u.id} where id = ${ORG} and owner_user_id is null`)
      console.log('super admin created:', email)
    }
  } else {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipped super admin')
  }
})

console.log('seed done')
await pool.end()

}

main().catch((e) => { console.error(e); process.exit(1) })
