import Link from 'next/link'
import { ChevronDown, LayoutDashboard } from 'lucide-react'

/** Super Admin home navigation: every directly navigable /admin page.
 * Keep category order predictable; the member-specific dynamic visitor conversion
 * URL is intentionally excluded because it requires a real visitorId.
 * Permissions remain enforced by each destination; this component adds none.
 */
export const SUPER_ADMIN_PAGE_GROUPS = [
  { title: 'Overview', pages: [
    { href: '/admin', label: 'Admin Dashboard' },
    { href: '/admin/health-monitor', label: 'Health Monitor' },
    { href: '/admin/program-health', label: 'Program Health' },
    { href: '/admin/permissions-audit', label: 'Permissions Audit' },
    { href: '/admin/account-activation', label: 'Account Activation' },
    { href: '/admin/legal-consent-remediation', label: 'Legal Consent Remediation' },
  ] },
  { title: 'Members & Attendance', pages: [
    { href: '/admin/members', label: 'Members' },
    { href: '/admin/members/families', label: 'Family Accounts' },
    { href: '/admin/members/families/recover', label: 'Family Recovery' },
    { href: '/admin/members/family-intake', label: 'Family Intake' },
    { href: '/admin/members/family-operations', label: 'Family Operations' },
    { href: '/admin/members/inactive', label: 'Inactive' },
    { href: '/admin/members/member-id-recovery', label: 'Member ID Recovery' },
    { href: '/admin/visitors', label: 'Visitors' },
    { href: '/admin/attendance', label: 'Attendance' },
    { href: '/admin/scan-audit', label: 'Scan Audit' },
    { href: '/admin/membership-activity', label: 'Membership Activity' },
    { href: '/admin/freeze-requests', label: 'Freeze Requests' },
    { href: '/admin/membership-refunds', label: 'Membership Refunds' },
    { href: '/admin/expiring-soon', label: 'Expiring Soon' },
    { href: '/admin/outstanding-dues', label: 'Outstanding Dues' },
  ] },
  { title: 'CRM & Prospects', pages: [
    { href: '/admin/crm', label: 'CRM Queue' },
    { href: '/admin/prospects', label: 'Prospects' },
    { href: '/admin/prospects/whatsapp', label: 'Whatsapp' },
  ] },
  { title: 'Finance & Banking', pages: [
    { href: '/admin/payments', label: 'Payments' },
    { href: '/admin/payments/reconciliation', label: 'Reconciliation' },
    { href: '/admin/payments/reconciliation/bank-matching', label: 'Bank Matching' },
    { href: '/admin/payments/reconciliation/evidence', label: 'Evidence' },
    { href: '/admin/cash-report', label: 'Cash Report' },
    { href: '/admin/banking', label: 'Banking' },
    { href: '/admin/banking/cash-position', label: 'Cash Position' },
    { href: '/admin/banking/cib-preview', label: 'CIB Merchant Preview' },
    { href: '/admin/banking/classification-rules', label: 'Classification Rules' },
    { href: '/admin/banking/outflows', label: 'Outflows' },
    { href: '/admin/banking/reconciliation', label: 'Reconciliation' },
    { href: '/admin/external-income', label: 'External Income' },
    { href: '/admin/personal-funds', label: 'Personal Funds' },
    { href: '/admin/categories', label: 'Categories' },
  ] },
  { title: 'Staff Payroll', pages: [
    { href: '/admin/staff-payroll', label: 'Staff Payroll' },
    { href: '/admin/staff-payroll/dashboard', label: 'Dashboard' },
    { href: '/admin/staff-payroll/staff', label: 'Staff' },
    { href: '/admin/staff-payroll/rates', label: 'Rates' },
    { href: '/admin/staff-payroll/dynamic-rates', label: 'Dynamic Rates' },
    { href: '/admin/staff-payroll/tasks', label: 'Tasks' },
    { href: '/admin/staff-payroll/monthly-tasks', label: 'Monthly Tasks' },
    { href: '/admin/staff-payroll/coaching-declarations', label: 'Coaching Declarations' },
    { href: '/admin/staff-payroll/coaching-import', label: 'Coaching Import' },
    { href: '/admin/staff-payroll/calculation', label: 'Calculation' },
    { href: '/admin/staff-payroll/adjustments', label: 'Adjustments' },
    { href: '/admin/staff-payroll/accounting', label: 'Accounting' },
    { href: '/admin/staff-payroll/payments', label: 'Payments' },
    { href: '/admin/staff-payroll/forecast', label: 'Forecast' },
    { href: '/admin/staff-payroll/simulator', label: 'Simulator' },
  ] },
  { title: 'Store', pages: [
    { href: '/admin/store', label: 'Store' },
    { href: '/admin/store/dashboard', label: 'Dashboard' },
    { href: '/admin/store/sales', label: 'Sales' },
    { href: '/admin/store/expenses', label: 'Expenses' },
    { href: '/admin/store/funding', label: 'Funding' },
    { href: '/admin/store/models', label: 'Models' },
    { href: '/admin/store/preorders', label: 'Preorders' },
    { href: '/admin/store/reconciliation', label: 'Reconciliation' },
  ] },
  { title: 'Private Coaching', pages: [
    { href: '/admin/private-coaching', label: 'Private Coaching' },
  ] },
] as const

export default function SuperAdminPages() {
  const total = SUPER_ADMIN_PAGE_GROUPS.reduce((sum, group) => sum + group.pages.length, 0)
  return (
    <section aria-labelledby="admin-workspace-title" className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[hsl(var(--surface-2))]"><LayoutDashboard size={23} aria-hidden="true" /></span>
          <div>
            <h2 id="admin-workspace-title" className="text-xl font-semibold tracking-tight">Admin Workspace</h2>
            <p className="text-sm text-[hsl(var(--muted))]">All admin pages, organized in one place.</p>
          </div>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">{total} pages</span>
      </div>
      <div className="space-y-2">
        {SUPER_ADMIN_PAGE_GROUPS.map((group, index) => (
          <details key={group.title} className="group rounded-2xl border border-[hsl(var(--border))]" open={index === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
              <span>{group.title}<span className="ml-2 text-xs font-normal text-[hsl(var(--muted))]">({group.pages.length})</span></span>
              <ChevronDown size={19} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <nav aria-label={group.title} className="grid gap-2 border-t border-[hsl(var(--border))] p-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.pages.map(page => (
                <Link
                  key={page.href}
                  href={page.href}
                  className="rounded-xl border border-[hsl(var(--border))] px-3 py-3 text-sm font-medium transition hover:bg-[hsl(var(--surface-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {page.label}
                </Link>
              ))}
            </nav>
          </details>
        ))}
      </div>
    </section>
  )
}
