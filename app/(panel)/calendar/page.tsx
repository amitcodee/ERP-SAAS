export const dynamic = 'force-dynamic'
import { CalendarPanel } from '@/components/calendar-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { todayIST } from '@/modules/fees/plan'
import { calendar, type CalendarView } from '@/modules/reports/calendar'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 92
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const monday = (k: string) => addDays(k, -((new Date(`${k}T00:00:00Z`).getUTCDay() + 6) % 7))
const monthEnd = (m: string) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) }

// The work calendar, as a month, a week or a range of days. What is on screen and which days are listed in full
// live in the address:
//   month: ?view=month&month=2026-10&day=2026-10-10   (the month; the day listed, today by default)
//   week:  ?view=week&day=2026-10-10[&pick=...]        (the week of that day; the whole week listed, or one picked day)
//   range: ?view=range&from=...&to=...[&pick=...]      (up to 3 months; the whole range listed, or one picked day)
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; month?: string; day?: string; from?: string; to?: string; pick?: string }> }) {
  const { actor, isSuper, user } = await requirePage('Calendar')
  const sp = await searchParams
  const today = todayIST()
  const view: CalendarView = sp.view === 'week' || sp.view === 'range' ? sp.view : 'month'
  const day = sp.day && ISO.test(sp.day) ? sp.day : today
  let q: { month: string; from: string; to: string; gridFrom: string; gridTo: string }

  if (view === 'week') {
    const start = monday(day), end = addDays(start, 6)
    const pick = sp.pick && ISO.test(sp.pick) && sp.pick >= start && sp.pick <= end ? sp.pick : null
    q = { month: start.slice(0, 7), gridFrom: start, gridTo: end, from: pick ?? start, to: pick ?? end }
  } else if (view === 'range') {
    let from = sp.from && ISO.test(sp.from) ? sp.from : addDays(today, -6)
    let to = sp.to && ISO.test(sp.to) ? sp.to : today
    if (to < from) [from, to] = [to, from]
    if (Date.parse(to) - Date.parse(from) > (MAX_RANGE_DAYS - 1) * 86400000) to = addDays(from, MAX_RANGE_DAYS - 1)
    const pick = sp.pick && ISO.test(sp.pick) && sp.pick >= from && sp.pick <= to ? sp.pick : null
    q = { month: from.slice(0, 7), gridFrom: from, gridTo: to, from: pick ?? from, to: pick ?? to }
  } else {
    const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : day.slice(0, 7)
    const d = day.startsWith(month) ? day : `${month}-01`
    q = { month, gridFrom: `${month}-01`, gridTo: monthEnd(month), from: d, to: d }
  }
  const data = await withTenant(actor, (tx) => calendar(tx, actor, { view, ...q, today, branchId: actor.branchId }))
  return <CalendarPanel data={data} scope={isSuper ? user.branchName : ''} />
}
