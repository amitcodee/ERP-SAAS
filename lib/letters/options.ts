// The internship-letter choices on a registration (new and Edit): the company, then that company's templates
// ('' = its Standard). The companies come from the template list (listTemplates: active ones, the main company first).
type Ref = { id: string | null; kind: string; name: string; companyId: string; companyName: string }

export function letterCompaniesOf(templates: Ref[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  for (const t of templates) if (!out.some((c) => c.id === t.companyId)) out.push({ id: t.companyId, name: t.companyName })
  return out
}

/** A company's templates of one letter, for a drop-down (Standard first, value ''). No company: the main one. */
export function companyTemplateOptions(templates: Ref[], kind: string, companyId: string | null | undefined): { value: string; label: string }[] {
  const company = companyId || templates[0]?.companyId
  return templates.filter((t) => t.kind === kind && t.companyId === company).map((t) => ({ value: t.id ?? '', label: t.name }))
}
