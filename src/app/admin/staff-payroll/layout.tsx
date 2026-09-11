import Link from 'next/link'

export default function StaffPayrollLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <nav className="flex flex-wrap gap-2 rounded-2xl border border-black/10 bg-white p-2">
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
            href="/admin/staff-payroll/payments"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Payments
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
