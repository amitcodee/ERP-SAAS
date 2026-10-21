// Grades from marks, for the report card (modules/academics/report-card.ts). Each institute sets its own bands and
// pass mark (Settings → Report cards); these are the defaults. Pure, so the page, the PDF and the tests agree.

/** A band: from `min` percent up (to the next band's min), the grade written and its word. */
export type GradeBand = { min: number; grade: string; label: string }
export type GradesConfig = { bands: GradeBand[]; passPct: number }

export const DEFAULT_GRADES: GradesConfig = {
  bands: [
    { min: 90, grade: 'A+', label: 'Outstanding' },
    { min: 80, grade: 'A', label: 'Excellent' },
    { min: 70, grade: 'B+', label: 'Very good' },
    { min: 60, grade: 'B', label: 'Good' },
    { min: 50, grade: 'C', label: 'Satisfactory' },
    { min: 40, grade: 'D', label: 'Pass' },
    { min: 0, grade: 'E', label: 'Needs improvement' },
  ],
  passPct: 40,
}

/** What is wrong with a set of bands, or null: 1 to 12 bands, distinct minimums from 0 to 100, one starting at 0. */
export function gradesProblem(c: GradesConfig): string | null {
  if (!c.bands.length || c.bands.length > 12) return 'Give between 1 and 12 grades'
  if (c.bands.some((b) => !b.grade.trim() || b.grade.length > 4)) return 'Each grade needs a short name (up to 4 letters), e.g. A+'
  if (c.bands.some((b) => !Number.isInteger(b.min) || b.min < 0 || b.min > 100)) return 'Each grade starts at a whole percent from 0 to 100'
  if (new Set(c.bands.map((b) => b.min)).size !== c.bands.length) return 'Two grades start at the same percent'
  if (!c.bands.some((b) => b.min === 0)) return 'One grade must start at 0%, so every mark has a grade'
  if (!Number.isInteger(c.passPct) || c.passPct < 0 || c.passPct > 100) return 'The pass mark is a whole percent from 0 to 100'
  return null
}

/** The band of a percentage (the highest band whose minimum it reaches). */
export function gradeOf(pct: number, bands: GradeBand[] = DEFAULT_GRADES.bands): GradeBand {
  const sorted = [...bands].sort((a, b) => b.min - a.min)
  return sorted.find((b) => pct >= b.min) ?? sorted[sorted.length - 1]
}

/** A percentage to one decimal place (0 when nothing is out of anything). */
export const pctOf = (score: number, max: number) => (max > 0 ? Math.round((score * 1000) / max) / 10 : 0)

/** The overall result of marked work: the total of the marks over the total of the maximums. */
export function overall(marks: { score: number | null; maxScore: number | null }[]): { score: number; max: number; pct: number } | null {
  const done = marks.filter((m) => m.score != null && m.maxScore != null && m.maxScore > 0)
  if (!done.length) return null
  const score = done.reduce((n, m) => n + m.score!, 0), max = done.reduce((n, m) => n + m.maxScore!, 0)
  return { score, max, pct: pctOf(score, max) }
}

/** Ranks by percentage, highest first; equal percentages share a rank (1, 2, 2, 4). */
export function ranks<T extends { pct: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.pct - a.pct)
  return sorted.map((r) => ({ ...r, rank: sorted.findIndex((x) => x.pct === r.pct) + 1 }))
}
