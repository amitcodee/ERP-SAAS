'use client'
// Bridges a server page (which loads only its own data) to its client screen, wiring the shared toast and
// page-to-page navigation. Props are plain data: the server page decides what each screen receives.
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import type { BranchAdmin } from '@/components/branch-admin'
import type { CallsPanel } from '@/components/calls-panel'
import type { CoursesPanel } from '@/components/courses-panel'
import type { DashboardView } from '@/components/dashboard'
import type { EnquiriesPanel } from '@/components/enquiries-panel'
import type { FeesPanel } from '@/components/fees-panel'
import type { LeadCategoriesPanel, LeadCategoryView } from '@/components/lead-categories'
import type { LeadDistribution } from '@/components/lead-distribution'
import type { RegistrationsPanel } from '@/components/registrations-panel'
import type { ReportsPanel } from '@/components/reports-panel'
import type { RoleHome } from '@/components/role-home'
import type { RolesPanel } from '@/components/roles-panel'
import type { StudentFeesPage } from '@/components/student-fees'
import type { StudentsPanel } from '@/components/students-panel'
import type { UsersPanel } from '@/components/users-panel'
import type { LogsPanel } from '@/components/logs-panel'
import type { WebLeadsPanel } from '@/components/web-leads-panel'
import { useNotify } from '@/components/panel-shell'
import { PATH, type ModuleKey } from '@/lib/panel/modules'

// Each screen is its own download: a page fetches only the code of the screen it shows (still rendered on the server).
const BranchAdminLazy = dynamic(() => import('@/components/branch-admin').then((m) => m.BranchAdmin))
const CallsPanelLazy = dynamic(() => import('@/components/calls-panel').then((m) => m.CallsPanel))
const CoursesPanelLazy = dynamic(() => import('@/components/courses-panel').then((m) => m.CoursesPanel))
const DashboardViewLazy = dynamic(() => import('@/components/dashboard').then((m) => m.DashboardView))
const EnquiriesPanelLazy = dynamic(() => import('@/components/enquiries-panel').then((m) => m.EnquiriesPanel))
const FeesPanelLazy = dynamic(() => import('@/components/fees-panel').then((m) => m.FeesPanel))
const LeadCategoriesPanelLazy = dynamic(() => import('@/components/lead-categories').then((m) => m.LeadCategoriesPanel))
const LeadCategoryViewLazy = dynamic(() => import('@/components/lead-categories').then((m) => m.LeadCategoryView))
const LeadDistributionLazy = dynamic(() => import('@/components/lead-distribution').then((m) => m.LeadDistribution))
const RegistrationsPanelLazy = dynamic(() => import('@/components/registrations-panel').then((m) => m.RegistrationsPanel))
const ReportsPanelLazy = dynamic(() => import('@/components/reports-panel').then((m) => m.ReportsPanel))
const RolesPanelLazy = dynamic(() => import('@/components/roles-panel').then((m) => m.RolesPanel))
const StudentFeesPageLazy = dynamic(() => import('@/components/student-fees').then((m) => m.StudentFeesPage))
const StudentsPanelLazy = dynamic(() => import('@/components/students-panel').then((m) => m.StudentsPanel))
const UsersPanelLazy = dynamic(() => import('@/components/users-panel').then((m) => m.UsersPanel))
const LogsPanelLazy = dynamic(() => import('@/components/logs-panel').then((m) => m.LogsPanel))
const WebLeadsPanelLazy = dynamic(() => import('@/components/web-leads-panel').then((m) => m.WebLeadsPanel))

type P<C> = C extends (props: infer X) => unknown ? Omit<X, 'notify' | 'onNavigate'> : never

export type ScreenProps =
  | { name: 'dashboard'; home: P<typeof RoleHome>; dashboard: P<typeof DashboardView> }
  | { name: 'calls'; props: P<typeof CallsPanel> }
  | { name: 'enquiries'; props: P<typeof EnquiriesPanel> }
  | { name: 'registrations'; props: P<typeof RegistrationsPanel> }
  | { name: 'fees'; props: P<typeof FeesPanel> }
  | { name: 'studentFees'; props: P<typeof StudentFeesPage> }
  | { name: 'students'; props: P<typeof StudentsPanel> }
  | { name: 'courses'; props: P<typeof CoursesPanel> }
  | { name: 'reports'; props: P<typeof ReportsPanel> }
  | { name: 'users'; props: P<typeof UsersPanel> }
  | { name: 'leads'; props: P<typeof LeadDistribution> }
  | { name: 'roles'; props: P<typeof RolesPanel> }
  | { name: 'branches'; props: P<typeof BranchAdmin> }
  | { name: 'leadCategories'; props: P<typeof LeadCategoriesPanel> }
  | { name: 'leadCategory'; props: P<typeof LeadCategoryView> }
  | { name: 'logs'; props: P<typeof LogsPanel> }
  | { name: 'webLeads'; props: P<typeof WebLeadsPanel> }

export function Screen(s: ScreenProps) {
  const notify = useNotify()
  const router = useRouter()
  const go = (m: string) => { const p = PATH[m as ModuleKey]; if (p) router.push(p) }
  switch (s.name) {
    // My day sits inside the dashboard, under the greeting and the period's numbers
    case 'dashboard': return <DashboardViewLazy {...s.dashboard} home={s.home} onNavigate={go} />
    case 'calls': return <CallsPanelLazy {...s.props} notify={notify} />
    case 'enquiries': return <EnquiriesPanelLazy {...s.props} notify={notify} />
    case 'registrations': return <RegistrationsPanelLazy {...s.props} notify={notify} />
    case 'fees': return <FeesPanelLazy {...s.props} notify={notify} />
    case 'studentFees': return <StudentFeesPageLazy {...s.props} notify={notify} />
    case 'students': return <StudentsPanelLazy {...s.props} notify={notify} />
    case 'courses': return <CoursesPanelLazy {...s.props} notify={notify} />
    case 'reports': return <ReportsPanelLazy {...s.props} />
    case 'users': return <UsersPanelLazy {...s.props} notify={notify} />
    case 'leads': return <LeadDistributionLazy {...s.props} notify={notify} />
    case 'roles': return <RolesPanelLazy {...s.props} notify={notify} />
    case 'branches': return <BranchAdminLazy {...s.props} notify={notify} />
    case 'leadCategories': return <LeadCategoriesPanelLazy {...s.props} notify={notify} />
    case 'leadCategory': return <LeadCategoryViewLazy {...s.props} />
    case 'logs': return <LogsPanelLazy {...s.props} notify={notify} />
    case 'webLeads': return <WebLeadsPanelLazy {...s.props} notify={notify} />
  }
}
