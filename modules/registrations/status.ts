// Shared (client + server) registration status rules.
export type RegistrationStatus = 'active' | 'on_hold' | 'discontinued' | 'completed' | 'transferred'

export const REG_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  active: ['on_hold', 'discontinued'],
  on_hold: ['active', 'discontinued'],
  discontinued: ['active'], // reactivation needs a manager's approval (checked in the service)
  completed: [],
  transferred: [], // moved to another branch: its new registration lives there
}

export const REG_STATUS_LABEL: Record<RegistrationStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  discontinued: 'Discontinued',
  completed: 'Completed',
  transferred: 'Transferred',
}
