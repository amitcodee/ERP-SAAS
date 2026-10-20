export const dynamic = 'force-dynamic'
import { sql } from 'drizzle-orm'
import { CertificateSignatures } from '@/components/certificate-signatures'
import { SettingsTabs, type SettingsData } from '@/components/settings-tabs'
import { appOrigin } from '@/lib/app-url'
import { webLeadsSecretFor } from '@/lib/tenant/web-leads-secret'
import { canManageBranchEmail, getBranchEmail, getConfig } from '@/lib/config/store'
import { JOBS } from '@/lib/job-registry'
import { requirePage } from '@/lib/panel/base'
import { withTenant as withHeadOffice, withTenant } from '@/lib/db/withTenant'
import { authorisedSignatureInfo, getSignatureChoice, signatureImage } from '@/modules/catalog/categories'
import { DATASETS, listApiKeys } from '@/modules/integrations/api'
import { EVENTS, listWebhooks } from '@/modules/integrations/webhooks'
import { integrations } from '@/modules/reports/integrations'
import { listRules } from '@/modules/settings/service'
import { listNumbering } from '@/modules/settings/numbering'
import { listCampaigns } from '@/modules/notifications/broadcasts'

// Settings, in tabs: business rules and certificate signatures for everyone who may see them; e-mail, WhatsApp &
// SMS, reminders, scheduled jobs, integrations and API access for head office; the branch's own mail server for its
// branch manager (and head office while working in a branch). Passwords and tokens never reach
// the page: only whether one is saved.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const b = await requirePage('Settings')
  const { tab } = await searchParams
  const canEdit = b.ok('update', 'setting')
  const headOffice = b.isSuper
  const base = await withTenant(b.actor, async (tx) => ({
    rules: await listRules(tx), choice: await getSignatureChoice(tx), signer: await authorisedSignatureInfo(tx), image: await signatureImage(tx, { authorised: true }),
    integrations: headOffice ? await integrations(tx, b.actor) : null,
  }))

  let branchEmail: SettingsData['branchEmail'] = null
  if (canManageBranchEmail(b.actor)) {
    const e = await getBranchEmail(b.actor.orgId, b.actor.branchId!)
    // a first setup starts switched on: filling it in is the point
    branchEmail = { branchName: b.user.branchName, config: e.saved ? e.config : { ...e.config, enabled: true }, hasPassword: !!e.secrets.password, saved: e.saved, updatedAt: e.updatedAt }
  }

  let admin: SettingsData['admin'] = null
  if (headOffice) {
    const [email, whatsapp, sms, reminders, jobs] = await Promise.all([getConfig(b.actor.orgId, 'email'), getConfig(b.actor.orgId, 'whatsapp'), getConfig(b.actor.orgId, 'sms'), getConfig(b.actor.orgId, 'reminders'), getConfig(b.actor.orgId, 'jobs')])
    const data = await withHeadOffice(b.actor, async (tx) => ({
      webhooks: await listWebhooks(tx),
      keys: await listApiKeys(tx),
      campaigns: await listCampaigns(tx),
      numbering: await listNumbering(tx),
      branches: (await tx.execute<{ id: string; name: string; code: string }>(sql`select id, name, code from branches where is_active order by name`)).rows,
      runs: (await tx.execute<{ id: string; job: string; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; summary: Record<string, unknown> | null }>(sql`
        select id, job, started_at::text, finished_at::text, ok, error, summary from job_runs order by started_at desc limit 30`)).rows,
    }))
    admin = {
      email: { config: email.config, hasPassword: !!email.secrets.password, saved: email.saved, updatedAt: email.updatedAt },
      whatsapp: { config: whatsapp.config, hasToken: !!whatsapp.secrets.token, hasApiKey: !!whatsapp.secrets.apiKey, saved: whatsapp.saved, updatedAt: whatsapp.updatedAt },
      sms: { config: sms.config, hasAuthKey: !!sms.secrets.authKey, saved: sms.saved, updatedAt: sms.updatedAt },
      campaigns: data.campaigns,
      numbering: data.numbering,
      reminders: reminders.config,
      jobs: jobs.config,
      jobInfo: Object.fromEntries(Object.entries(JOBS).map(([k, j]) => [k, { label: j.label, what: j.what }])),
      runs: data.runs.map((r) => ({ id: r.id, job: r.job, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok, error: r.error, summary: r.summary })),
      cronSecretSet: !!process.env.CRON_SECRET,
      webhooks: data.webhooks,
      events: EVENTS.map((e) => ({ ...e })),
      keys: data.keys,
      datasets: Object.entries(DATASETS).map(([key, d]) => ({ key, label: d.label, what: d.what, dateField: d.dateField, fields: d.fields })),
      branches: data.branches,
      origin: await appOrigin(b.actor.orgId),
      webLeadsOn: !!webLeadsSecretFor(b.actor.orgId),
    }
  }

  return (
    <SettingsTabs
      tab={tab ?? 'rules'}
      data={{ rules: base.rules, canEdit, integrations: base.integrations, branchEmail, admin }}
      signatures={(canEdit || headOffice) ? <CertificateSignatures key="signatures" choice={base.choice} signer={base.signer} image={base.image} canEdit={canEdit} /> : null}
    />
  )
}
