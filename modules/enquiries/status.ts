// Shared (client + server) status rules. No server-only imports here.
export type EnquiryStatus = 'new' | 'contacted' | 'follow_up' | 'demo' | 'joined' | 'not_joined' | 'dead'

/** Legal status moves (P5). `joined` is final; a `dead` lead can be revived via follow-up. */
export const TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  new: ['contacted', 'follow_up', 'demo', 'joined', 'not_joined', 'dead'],
  contacted: ['follow_up', 'demo', 'joined', 'not_joined', 'dead'],
  follow_up: ['contacted', 'demo', 'joined', 'not_joined', 'dead'],
  demo: ['follow_up', 'joined', 'not_joined', 'dead'],
  not_joined: ['follow_up', 'demo', 'joined', 'dead'],
  joined: [],
  dead: ['follow_up'],
}

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  follow_up: 'Follow-up',
  demo: 'Demo',
  joined: 'Joined',
  not_joined: 'Not joined',
  dead: 'Dead enquiry',
}
