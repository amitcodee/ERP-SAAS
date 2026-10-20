export const dynamic = 'force-dynamic'
import { LetterTemplateEditor } from '@/components/letter-template-editor'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import type { LetterKind } from '@/lib/letters/standard'
import { companyArt, getTemplate, listCompanies, listTemplates } from '@/modules/letters/service'

// Documents / Letter Templates (head office): the internship letters' wording per company (techcadd, Syntax Developer…),
// several named templates per letter (?company=<company>&kind=internship_offer|internship_completion&id=<template>;
// no id = that company's Standard), and the companies themselves (name, contact, letterhead, stamp).
export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string; kind?: string; id?: string }> }) {
  const { actor } = await requirePage('Letter Templates')
  const sp = await searchParams
  const kind: LetterKind = sp.kind === 'internship_completion' ? 'internship_completion' : 'internship_offer'
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
  const d = await withTenant(actor, async (tx) => {
    const companies = await listCompanies(tx)
    const company = companies.find((c) => c.id === uuid(sp.company)) ?? companies[0]
    return { companies, company, art: await companyArt(tx, company.id), t: await getTemplate(tx, kind, uuid(sp.id), company.id), list: await listTemplates(tx, kind, company.id) }
  })
  return <LetterTemplateEditor key={`${d.company.id}${kind}${d.t.id}${d.t.updatedAt}`} kind={kind} template={d.t} templates={d.list} companies={d.companies} company={d.company} art={d.art} />
}
