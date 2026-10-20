// Shared (client + server) shape of a list screen's search / filter / date range / sort. No server-only imports here.
export type ListQuery = {
  q?: string
  from?: string // YYYY-MM-DD, inclusive
  to?: string // YYYY-MM-DD, inclusive
  sort?: string
  dir?: 'asc' | 'desc'
  f?: Record<string, string> // screen-specific filters (status, department, ...); '' = any
}

export const isEmptyQuery = (lq: ListQuery) =>
  !lq.q?.trim() && !lq.from && !lq.to && !lq.sort && !Object.values(lq.f ?? {}).some(Boolean)
