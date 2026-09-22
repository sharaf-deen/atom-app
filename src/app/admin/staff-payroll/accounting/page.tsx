// Staff Payroll 2G — Monthly Accounting Summary & CSV Exports
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollAccountingReport from '@/components/staff-payroll/StaffPayrollAccountingReport'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import { getSessionUser } from '@/lib/session'
import { loadStaffPayrollAccountingReport } from '@/lib/staffPayrollAccounting'

function getOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function previousCairoMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const date = year && month ? new Date(Date.UTC(year, month - 2, 1)) : new Date()
  if (!year || !month) date.setUTCMonth(date.getUTCMonth() - 1, 1)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeClosedMonth(value: string | undefined) {
  const fallback = previousCairoMonth()
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback
  const [year, month] = value.split('-').map(Number)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback
  if (value < '2026-08') return '2026-08'
  if (value > fallback) return fallback
  return value
}

export default async function StaffPayrollAccountingPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/accounting')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Accounting</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access payroll accounting exports."
            nextPath="/admin/staff-payroll/accounting"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Accounting</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const selectedMonth = normalizeClosedMonth(getOne(searchParams?.month))
  const monthStart = `${selectedMonth}-01`

  try {
    const report = await loadStaffPayrollAccountingReport(admin, monthStart)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <StaffPayrollAccountingReport
          selectedMonth={selectedMonth}
          maxMonth={previousCairoMonth()}
          report={report}
        />
      </main>
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Accounting</h1>
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Accounting report could not be loaded: {message}
        </div>
      </main>
    )
  }
}
