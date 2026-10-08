import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { canAccessStaffPayroll } from '@/lib/rbac'

export default async function StaffPayrollLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll')
  if (!canAccessStaffPayroll(me.role)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Super Admin can access salary and payroll data."
            nextPath="/admin/staff-payroll"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <nav className="flex flex-wrap gap-2 rounded-2xl border border-black/10 bg-white p-2">
          <Link
            href="/admin/staff-payroll"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Overview
          </Link>
          <Link
            href="/admin/staff-payroll/dashboard"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/staff-payroll/forecast"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Forecast
          </Link>
          <Link
            href="/admin/staff-payroll/staff"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Staff Profiles
          </Link>
          <Link
            href="/admin/staff-payroll/monthly-tasks"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Monthly Tasks
          </Link>
          <Link
            href="/admin/staff-payroll/coaching-import"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Coaching Import
          </Link>
          <Link
            href="/admin/staff-payroll/calculation"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Salary Calculation
          </Link>
          <Link
            href="/admin/staff-payroll/simulator"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Simulator
          </Link>
          <Link
            href="/admin/staff-payroll/adjustments"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Bonuses & Deductions
          </Link>
          <Link
            href="/admin/staff-payroll/rates"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Bases & Eligibility
          </Link>
          <Link
            href="/admin/staff-payroll/dynamic-rates"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Legacy Task Rates
          </Link>
          <Link
            href="/admin/staff-payroll/payments"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Payments
          </Link>
          <Link
            href="/admin/staff-payroll/accounting"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Accounting
          </Link>
          <Link
            href="/admin/staff-payroll/tasks"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Task Catalog
          </Link>
        </nav>
      </div>

      {children}
    </>
  )
}
