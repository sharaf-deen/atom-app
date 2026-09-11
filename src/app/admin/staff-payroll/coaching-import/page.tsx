// Staff Payroll 1G — Automatic Coaching Import
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import StaffPayrollCoachingImportManager from '@/components/staff-payroll/StaffPayrollCoachingImportManager'
import { getSessionUser } from '@/lib/session'

function getOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function currentCairoMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (year && month) return `${year}-${month}`
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousCairoMonth() {
  const current = currentCairoMonth()
  const [year, month] = current.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeMonth(value: string | undefined) {
  const fallback = previousCairoMonth()
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback
  const [yearRaw, monthRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback
  const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  return normalized > currentCairoMonth() ? fallback : normalized
}

export default async function StaffPayrollCoachingImportPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll/coaching-import')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll · Coaching Import</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll coaching import."
            nextPath="/admin/staff-payroll/coaching-import"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const selectedMonth = normalizeMonth(getOne(searchParams?.month))

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 1G
              </span>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (canWrite
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800')
                }
              >
                {canWrite ? 'Super Admin · Generate / Review / Import' : 'Admin · read-only'}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Automatic Coaching Import</h1>
            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              Convert confirmed Structured Schedule coaching work into Monthly Tasks without paying from the schedule alone.
            </p>
            <p className="mt-2 text-xs text-[hsl(var(--muted))]">
              Evidence is required: matched staff QR, completed linked Training Log, or an audited Super Admin manual confirmation.
            </p>
          </div>
        </div>
      </section>

      <StaffPayrollCoachingImportManager
        initialMonth={selectedMonth}
        canWrite={canWrite}
      />
    </main>
  )
}
