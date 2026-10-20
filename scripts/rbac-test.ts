// Roles as data, multi-role users, no privilege escalation, and cross-branch lead distribution. One rolled-back transaction.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { can, mayGrant } from '../lib/auth/permissions'
import { branches, departments, enquiries, roles, userRoles, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { loadUserStateIn } from '../modules/auth/account'
import { createEnquiry, followUpCall, listCallsPage, listEnquiries, logCall, transitionEnquiry } from '../modules/enquiries/service'
import { addLeadCategory } from '../modules/catalog/service'
import { distributeLeads, leadPool, leadProgress, listTelecallers, personLeads, poolList } from '../modules/leads/service'
import { deleteRole, listRoles, saveRole } from '../modules/roles/service'
import { createUser, setUserRoles } from '../modules/users/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 110).replace(/\s+/g, ' ') : '')
  }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }
/** The actor exactly as getActor() builds it: live roles + permissions from the database. */
async function live(tx: Tx, userId: string, branchId: string | null): Promise<Actor> {
  await tx.execute(sql`reset role`)
  const s = (await loadUserStateIn(tx, userId))!
  const role = s.roles.includes('super_admin') ? 'super_admin' : s.roles.includes('student') ? 'student' : s.roles[0]
  return { userId, orgId: ORG, role, roles: s.roles, perms: s.perms, branchId }
}

async function main() {
  check('default telecaller can work leads but not assign them', can('telecaller', 'read', 'lead') && !can('telecaller', 'assign', 'lead'))
  check('accountant clears fees and issues certificates; counselor collects fees but clears nothing', can('accountant', 'clear', 'certificate') && can('accountant', 'approve', 'certificate') && !can('accountant', 'create', 'fee') && can('counselor', 'create', 'fee') && !can('counselor', 'update', 'fee') && !can('counselor', 'clear', 'certificate'))
  check('multi-role union: counselor + telecaller', can(['counselor', 'telecaller'], 'read', 'lead') && can(['counselor', 'telecaller'], 'create', 'registration'))
  const head = { isSuper: false, perms: [...(await import('../lib/auth/permissions')).DEFAULT_ROLE.branch_manager.perms] }
  const def = (await import('../lib/auth/permissions')).DEFAULT_ROLE
  check('a branch head may give day-to-day roles (trainer, telecaller, counselor, accountant)', ['trainer', 'telecaller', 'counselor', 'accountant'].every((k) => mayGrant(head, { kind: 'staff', permissions: def[k].perms })))
  check('a branch head may not create another branch head or a super admin', !mayGrant(head, { kind: 'staff', permissions: def.branch_manager.perms }) && !mayGrant(head, { kind: 'super', permissions: [] }))
  check('a branch head may not give a role that can edit roles', !mayGrant(head, { kind: 'staff', permissions: ['role:update', 'enquiry:read'] }))

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [A] = await tx.insert(branches).values({ code: 'RA1', name: 'Roles A' }).returning()
      const [B] = await tx.insert(branches).values({ code: 'RB1', name: 'Roles B' }).returning()
      const mk = async (name: string, branchId: string | null, rs: string[]) => {
        const [u] = await tx.insert(users).values({ branchId, name, email: `${name}@rbac.test.invalid`, passwordHash: 'x' }).returning()
        await tx.insert(userRoles).values(rs.map((role) => ({ userId: u.id, role })))
        return u
      }
      const uSup = await mk('sup', null, ['super_admin'])
      const uHeadA = await mk('headA', A.id, ['branch_manager'])
      const uMulti = await mk('multiA', A.id, ['counselor', 'telecaller']) // one person, two roles
      const uTelB = await mk('telB', B.id, ['telecaller'])
      const uCouA = await mk('couA', A.id, ['counselor'])
      const [dept] = await tx.select().from(departments).limit(1)
      const sup = await live(tx, uSup.id, null)

      // ---- roles are data, edited live ------------------------------------------------------------
      await as(tx, sup)
      const key = await saveRole(tx, sup, { name: 'Night Caller', description: 'evening shift', permissions: ['lead:read', 'enquiry:read'] })
      check('a new role gets a key from its name', key === 'night_caller')
      await throws(tx, 'two roles cannot share a name', () => saveRole(tx, sup, { name: 'night caller', permissions: [] }), /already exists/)
      await throws(tx, 'unknown permissions are refused', () => saveRole(tx, sup, { name: 'Bad', permissions: ['fee:teleport'] }), /Unknown permission/)
      await throws(tx, 'Super Admin cannot be edited', () => saveRole(tx, sup, { key: 'super_admin', name: 'Super Admin', permissions: [] }), /cannot be changed/)
      await throws(tx, 'Student cannot be edited', () => saveRole(tx, sup, { key: 'student', name: 'Student', permissions: ['fee:read', 'enquiry:read'] }), /cannot be changed/)

      await setUserRoles(tx, sup, uCouA.id, ['counselor', key])
      let couA = await live(tx, uCouA.id, A.id)
      check('roles add up: counselor + Night Caller', can(couA, 'read', 'lead') && can(couA, 'create', 'registration'))
      await as(tx, sup)
      await saveRole(tx, sup, { key, name: 'Night Caller', permissions: ['enquiry:read'] })
      couA = await live(tx, uCouA.id, A.id)
      check('editing a role changes what its holders can do at once (lead:read removed)', !can(couA, 'read', 'lead') && can(couA, 'read', 'enquiry'))
      await as(tx, sup)
      await throws(tx, 'a role still held cannot be deleted', () => deleteRole(tx, sup, key), /still have this role/)
      await throws(tx, 'built-in roles cannot be deleted', () => deleteRole(tx, sup, 'counselor'), /cannot be deleted/)
      await setUserRoles(tx, sup, uCouA.id, ['counselor'])
      await deleteRole(tx, sup, key)
      check('an unused custom role can be deleted', !(await tx.select().from(roles).where(eq(roles.key, key))).length)
      check('the roles list shows how many people hold each role', (await listRoles(tx)).find((r) => r.key === 'counselor')!.users >= 1)

      // ---- a branch head ---------------------------------------------------------------------------------
      const headA = await live(tx, uHeadA.id, A.id)
      await as(tx, headA)
      await throws(tx, 'a branch head cannot edit roles', () => saveRole(tx, headA, { name: 'Sneaky', permissions: ['role:update'] }), /Forbidden/)
      const made = await createUser(tx, headA, { name: 'New Trainer', email: 'nt@rbac.test.invalid', roles: ['trainer', 'telecaller'] })
      check('a branch head adds a person with two roles, in their own branch', made.user.branchId === A.id && (await tx.select().from(userRoles).where(eq(userRoles.userId, made.user.id))).length === 2)
      await throws(tx, 'a branch head cannot make a branch head', () => createUser(tx, headA, { name: 'X Y', email: 'xy@rbac.test.invalid', roles: ['branch_manager'] }), /cannot create this role/)
      // a login the branch made (one head office made is refused earlier, for that reason)
      await throws(tx, 'a branch head cannot promote staff to branch head', () => setUserRoles(tx, headA, made.user.id, ['trainer', 'branch_manager']), /cannot create this role/)
      await throws(tx, 'nor change a login head office made', () => setUserRoles(tx, headA, uCouA.id, ['counselor', 'telecaller']), /Head office made this login/)
      await throws(tx, 'nobody changes their own roles', () => setUserRoles(tx, headA, uHeadA.id, ['branch_manager', 'accountant']), /your own roles/)
      await as(tx, sup)
      await throws(tx, 'a branch user cannot be turned into super admin', () => setUserRoles(tx, sup, uCouA.id, ['super_admin']), /cannot be made super admin/)

      // ---- lead distribution ----------------------------------------------------------------------------
      const cou: Actor = { userId: uCouA.id, orgId: ORG, role: 'counselor', branchId: A.id }
      await as(tx, cou)
      const leads = []
      for (let i = 0; i < 5; i++) leads.push((await createEnquiry(tx, cou, { person: { firstName: `Lead${i}`, phone: `98111000${10 + i}` }, departmentId: dept.id, assignedTo: null })).enquiry)
      await tx.execute(sql`update enquiries set assigned_to = null where id in (${sql.join(leads.map((l) => sql`${l.id}`), sql`, `)})`)

      await as(tx, sup)
      const people = await listTelecallers(tx, sup)
      check('telecallers list: everyone whose roles can work leads, any branch (not plain counselors)', [uMulti.id, uTelB.id, uHeadA.id].every((id) => people.some((p) => p.id === id)) && !people.some((p) => p.id === uCouA.id))
      const poolA = await leadPool(tx, sup, { branchId: A.id, statuses: ['new'], unassignedOnly: true })
      check('pool counts the unassigned new leads', poolA.available >= 5, String(poolA.available))
      const catId = await addLeadCategory(tx, sup, 'Rbac Hot')
      await tx.execute(sql`update enquiries set category_id = ${catId} where id = ${leads[0].id}`)
      const inCat = await leadPool(tx, sup, { branchId: A.id, categoryId: catId, statuses: ['new'], unassignedOnly: true })
      const noCat = await leadPool(tx, sup, { branchId: A.id, categoryId: 'none', statuses: ['new'], unassignedOnly: true })
      check('pool by lead category: one lead in the category, the rest without one', inCat.available === 1 && noCat.available === poolA.available - 1 && inCat.byCategory.map((c) => `${c.name}:${c.n}`).join() === 'Rbac Hot:1', JSON.stringify([inCat, noCat.available]))
      const split = (await leadPool(tx, sup, { branchId: A.id, statuses: ['new'], unassignedOnly: true })).byCategory
      check('pool lists the split by category', split.some((c) => c.name === 'Rbac Hot' && c.n === 1) && split.some((c) => c.name === 'No category'), JSON.stringify(split))
      const res = await distributeLeads(tx, sup, { branchId: A.id, statuses: ['new'], unassignedOnly: true, telecallerIds: [uMulti.id, uTelB.id], perPerson: 2 })
      check('round-robin: 4 leads, 2 each', res.total === 4 && res.result.every((r) => r.assigned === 2), JSON.stringify(res.result))

      const telB = await live(tx, uTelB.id, B.id)
      await as(tx, telB)
      const mine = await listEnquiries(tx, telB, { mine: true })
      check('a branch-B telecaller sees exactly their 2 branch-A leads', mine.total === 2 && mine.rows.every((r) => r.enquiryNo.includes('RA1')), String(mine.total))
      const all = await listEnquiries(tx, telB, {})
      check('...and no other branch-A enquiry', all.rows.filter((r) => r.enquiryNo.includes('RA1')).length === 2)
      const theirs = await tx.select().from(enquiries).where(eq(enquiries.assignedTo, uTelB.id))
      await transitionEnquiry(tx, telB, { enquiryId: theirs[0].id, to: 'follow_up', followUpDate: '2026-12-01', note: 'called, call back' })
      const [after] = await tx.select().from(enquiries).where(eq(enquiries.id, theirs[0].id))
      check('they can work it (status + history saved across branches)', after.status === 'follow_up')
      const notMine = leads.find((l) => !theirs.some((t) => t.id === l.id))!
      const hidden = await tx.select().from(enquiries).where(eq(enquiries.id, notMine.id))
      check('a lead given to someone else stays invisible to them', hidden.length === 0)
      // Random calls can be handed out too, and worked across branches by the person they were given to.
      await as(tx, cou)
      const rc = await logCall(tx, cou, { person: { firstName: 'Ringer', phone: '9811100099' }, departmentId: dept.id })
      await as(tx, sup)
      const callPool = await leadPool(tx, sup, { kind: 'call', branchId: A.id, statuses: ['new'], unassignedOnly: true })
      check('pool by type: random calls are counted separately from leads', callPool.available === 1 && (await leadPool(tx, sup, { kind: 'visited', branchId: A.id, statuses: ['new'], unassignedOnly: false })).available >= 4 && (await leadPool(tx, sup, { kind: 'lead', branchId: A.id, statuses: ['new'], unassignedOnly: false })).available === 0)
      const cres = await distributeLeads(tx, sup, { kind: 'call', branchId: A.id, statuses: ['new'], unassignedOnly: true, telecallerIds: [uTelB.id], perPerson: 5 })
      check('random calls are handed out', cres.total === 1 && cres.result[0].assigned === 1)
      await as(tx, telB)
      const given = await listCallsPage(tx, telB, { query: { f: { mine: 'assigned' } } })
      check('a branch-B telecaller sees the branch-A call given to them', given.total === 1 && given.rows[0].name === 'Ringer')
      await followUpCall(tx, telB, { callId: rc.call.id, status: 'In process', nextFollowUp: '2026-12-05', callRemark: 'will think' })
      check('...and can record a follow-up call on it', (await listCallsPage(tx, telB, { query: { f: { mine: 'assigned' } } })).rows[0].followUps === 1)
      await as(tx, sup)
      const progC = (await leadProgress(tx, sup)).find((p) => p.id === uTelB.id)
      check('progress counts the random call too', progC?.total === 3 && progC.worked === 2, JSON.stringify(progC))
      const detC = await personLeads(tx, sup, uTelB.id)
      check('progress details list the call and its follow-up', detC.leads.some((l) => l.kind === 'call' && l.name === 'Ringer' && l.callDone) && detC.activity.some((a) => a.enquiryNo === 'Random call' && a.note === 'will think'), JSON.stringify(detC.activity))
      await as(tx, telB)
      await throws(tx, 'a telecaller cannot see the distribution progress', () => leadProgress(tx, telB), /Forbidden/)
      await as(tx, sup)
      const prog = (await leadProgress(tx, sup)).find((p) => p.id === uTelB.id)
      check('progress: the telecaller has 2 leads and a call; 2 worked', prog?.total === 3 && prog.worked === 2 && prog.joined === 0, JSON.stringify(prog))
      const detail = await personLeads(tx, sup, uTelB.id)
      check('progress details: their leads and what they recorded', detail.leads.length === 3 && detail.leads.some((l) => l.status === 'follow_up' && l.nextFollowUp === '2026-12-01') && detail.activity.length === 2 && detail.activity.some((a) => a.note === 'called, call back' && a.toStatus === 'follow_up'), JSON.stringify(detail.activity))
      await as(tx, telB)
      await throws(tx, 'a telecaller cannot distribute leads', () => distributeLeads(tx, telB, { statuses: ['new'], telecallerIds: [uTelB.id], perPerson: 1 }), /Forbidden/)

      await as(tx, headA)
      // Ticked leads: the list shows who holds each one; sending ticked leads moves them even when already assigned.
      await as(tx, cou)
      const extra = (await createEnquiry(tx, cou, { person: { firstName: 'Extra', phone: '9811100077' }, departmentId: dept.id, assignedTo: null })).enquiry
      await tx.execute(sql`update enquiries set assigned_to = null where id = ${extra.id}`)
      await as(tx, sup)
      const listAll = await poolList(tx, sup, { branchId: A.id, statuses: ['new', 'follow_up'], unassignedOnly: false })
      const held = listAll.filter((l) => l.assignedToId === uTelB.id), loose = listAll.filter((l) => !l.assignedToId), others = listAll.filter((l) => l.assignedToId === uMulti.id)
      check('lead list: shows every matching lead with its current owner', listAll.length >= 4 && held.length >= 1 && held.every((l) => l.assignedTo === 'telB') && loose.length >= 1, JSON.stringify(listAll.map((l) => [l.name, l.assignedTo])))
      check('lead list: "unassigned only" leaves out the ones somebody holds', (await poolList(tx, sup, { branchId: A.id, statuses: ['new', 'follow_up'], unassignedOnly: true })).every((l) => !l.assignedToId))
      const moved = await distributeLeads(tx, sup, { branchId: A.id, statuses: ['new', 'follow_up'], unassignedOnly: true, telecallerIds: [uMulti.id], perPerson: 50, leadIds: [held[0].id, extra.id] })
      const afterMove = await poolList(tx, sup, { branchId: A.id, statuses: ['new', 'follow_up'], unassignedOnly: false })
      check('ticked leads: exactly those are sent, an already-assigned one is transferred', moved.total === 2 && [held[0].id, extra.id].every((id) => afterMove.find((l) => l.id === id)?.assignedToId === uMulti.id) && afterMove.filter((l) => l.assignedToId === uMulti.id).length === others.length + 2)
      await as(tx, headA)
      await throws(tx, 'a branch head cannot hand leads to another branch’s telecaller', () => distributeLeads(tx, headA, { statuses: ['new'], unassignedOnly: true, telecallerIds: [uTelB.id], perPerson: 1 }), /Pick telecallers from the list/)
      const r2 = await distributeLeads(tx, headA, { statuses: ['new'], unassignedOnly: true, telecallerIds: [uMulti.id], perPerson: 10 })
      check('a branch head distributes their own branch leads to their own telecaller', r2.total >= 1 && r2.result[0].assigned === r2.total)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
