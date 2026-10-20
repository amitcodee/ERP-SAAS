import { can, CATALOG, DEFAULT_ROLES, PERM_GROUPS, PERM_HELP, RESOURCES } from '../lib/auth/permissions'
import { MODULES } from '../lib/panel/modules'
import { actingBranch } from '../lib/auth/acting'
import { COUNTRIES, DIAL_CODES, isDialCode } from '../lib/countries'
let failed = 0
const t = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++ }
t('super admin can delete branch', can('super_admin', 'delete', 'branch'))
t('branch manager cannot create branch', !can('branch_manager', 'create', 'branch'))
t('branch manager approves certificates', can('branch_manager', 'approve', 'certificate'))
t('accountant checks fees but does not take payments', can('accountant', 'clear', 'fee') && !can('accountant', 'create', 'fee'))
t('accountant cannot edit enquiries', !can('accountant', 'update', 'enquiry'))
t('trainer marks attendance', can('trainer', 'create', 'attendance'))
t('trainer cannot touch fees', !can('trainer', 'read', 'fee'))
t('student cannot read enquiries', !can('student', 'read', 'enquiry'))
t('student can request a certificate', can('student', 'create', 'certificate'))
t('nobody but super_admin deletes anything', !(['branch_manager','counselor','front_desk','accountant','trainer','student'] as const).some((r) => can(r, 'delete', 'fee')))
t('every permission area sits in exactly one Roles & Permissions group', RESOURCES.every((r) => PERM_GROUPS.filter((g) => g.areas.includes(r)).length === 1))
t('country list: every country once, codes are 1 to 3 digits', new Set(COUNTRIES.map((c) => c.name)).size === COUNTRIES.length && COUNTRIES.length > 200 && COUNTRIES.every((c) => /^\d{1,3}$/.test(c.code)))
t('country drop-down: India (+91) first, one entry per code', DIAL_CODES[0].code === '91' && new Set(DIAL_CODES.map((c) => c.code)).size === DIAL_CODES.length && isDialCode('971') && !isDialCode('9999'))
t('counselor takes payments but only requests fee changes', can('counselor', 'create', 'fee') && !can('counselor', 'update', 'fee'))
t('accountant approves fee changes', can('accountant', 'update', 'fee'))
t('counselor cannot raise fee remarks', !can('counselor', 'clear', 'fee'))
t('multi-role union works', can(['front_desk', 'accountant'], 'create', 'enquiry') && can(['front_desk', 'accountant'], 'clear', 'fee'))

// features follow permissions, not role names: a custom role gets exactly what is ticked
const custom = (perms: string[]) => ({ role: 'my_custom_role', roles: ['my_custom_role'], perms })
const menu = (who: Parameters<typeof can>[0]) => MODULES.filter((m) => m.allowed((a, r) => can(who, a, r))).map((m) => m.key)
t('a custom role with teaching:read gets My Classes and Project Help', ['My Classes', 'Project Help'].every((k) => menu(custom(['teaching:read'])).includes(k as never)))
t('a custom role with helpdesk:read gets the Help Desk', menu(custom(['helpdesk:read'])).includes('Help Desk'))
t('a custom role with template:read gets Message Templates', menu(custom(['template:read'])).includes('Message Templates'))
t('a custom role with recycle:read gets the Recycle Bin', menu(custom(['recycle:read'])).includes('Recycle Bin'))
t('a custom role with nothing ticked gets only the pages everyone has', menu(custom([])).every((k) => ['Dashboard', 'My Tickets', 'Settings'].includes(k)))
t('the branch manager runs help desk, templates, escalations and branch e-mail', (['helpdesk:update', 'template:update', 'overdue:read', 'branchmail:update'] as const).every((x) => can('branch_manager', x.split(':')[1] as never, x.split(':')[0] as never)))
t('the branch manager is not a trainer and does not approve the syllabus', !can('branch_manager', 'read', 'teaching') && !can('branch_manager', 'approve', 'teaching'))
t('trainers and academic managers teach', can('trainer', 'read', 'teaching') && can('trainer', 'create', 'teaching') && can('academic_manager', 'read', 'teaching'))
t('only head office revokes certificates by default', !DEFAULT_ROLES.some((r) => r.kind !== 'super' && r.perms.includes('certificate:delete')))
t('every permission area is explained', RESOURCES.every((r) => PERM_HELP[r] && Object.keys(CATALOG[r].actions).every((a) => PERM_HELP[r].actions[a as never])))

// the acting branch comes from the LIVE state, never the sign-in session
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333'
const br = (id: string, access: 'own' | 'full') => ({ id, code: id.slice(0, 3), name: id, access })
const movedToB = { homeBranchId: B, branches: [br(B, 'full')] }
t('moved by head office: works in the new branch at once', actingBranch(movedToB, 'counselor', undefined).branchId === B)
t('moved: the old branch picked in the switcher is ignored', actingBranch(movedToB, 'counselor', A).branchId === B)
t('moved, old branch kept: may still pick it', actingBranch({ homeBranchId: B, branches: [br(B, 'full'), br(A, 'full')] }, 'counselor', A).branchId === A)
t('a second branch shared for own work only', JSON.stringify(actingBranch({ homeBranchId: A, branches: [br(A, 'full'), br(C, 'own')] }, 'trainer', C)) === JSON.stringify({ branchId: C, ownOnly: true }))
t('home branch is never own-only', !actingBranch({ homeBranchId: A, branches: [br(A, 'full'), br(C, 'own')] }, 'trainer', A).ownOnly)
t('no home branch left: no branch (signed out)', actingBranch({ homeBranchId: null, branches: [] }, 'counselor', A).branchId === null)
t('super admin acts in the picked branch, or all', actingBranch({ homeBranchId: null, branches: [] }, 'super_admin', C).branchId === C && actingBranch({ homeBranchId: null, branches: [] }, 'super_admin', 'x').branchId === null)
process.exitCode = failed ? 1 : 0
