export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Banknote,
  BadgeDollarSign,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  LockKeyhole,
  UsersRound,
} from 'lucide-react'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import { getSessionUser } from '@/lib/session'

const STAFF_ROLES = [
  'assistant_coach',
  'coach',
  'head_coach',
  'reception',
  'admin',
  'super_admin',
]

type SearchParams = {
  month?: string | string[]
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
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

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeClosedMonth(value: string) {
  const fallback = shiftMonth(currentCairoMonth(), -1)
  if (!/^\d{4}-\d{2}$/.test(value)) return fallback

  const [year, month] = value.split('-').map(Number)
  if (year < 2026 || year > 2200 || month < 1 || month > 12) return fallback

  const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  if (normalized < '2026-08') return '2026-08'
  if (normalized >= currentCairoMonth()) return fallback
  return normalized
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function money(value: number) {
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EGP`
}

function number(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function statusStyle(tone: 'ready' | 'warning' | 'neutral') {
  if (tone === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default async function StaffPayrollOverviewPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/staff-payroll')

  const canView = me.role === 'admin' || me.role === 'super_admin'
  const canWrite = me.role === 'super_admin'

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Staff Payroll</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access Staff Payroll."
            nextPath="/admin/staff-payroll"
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
        <h1 className="text-2xl font-bold">Staff Payroll</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const selectedMonth = normalizeClosedMonth(firstParam(searchParams?.month).trim())
  const monthStart = `${selectedMonth}-01`
  const nextMonthStart = `${shiftMonth(selectedMonth, 1)}-01`

  const [
    staffResult,
    areaResult,
    taskResult,
    mappingResult,
    logsResult,
    compensationResult,
    adjustmentsResult,
    snapshotResult,
    importsResult,
    sessionsResult,
    paymentsResult,
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id,role')
      .in('role', STAFF_ROLES),
    admin
      .from('staff_task_areas')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    admin
      .from('staff_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    admin
      .from('staff_payroll_coaching_template_mappings')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    admin
      .from('staff_monthly_task_logs')
      .select('id,staff_user_id,actual_hours,weighted_hours,source')
      .eq('month_start', monthStart)
      .is('voided_at', null),
    admin
      .from('staff_compensation_rate_periods')
      .select('staff_user_id')
      .lte('effective_from', monthStart)
      .or(`effective_until.is.null,effective_until.gt.${monthStart}`),
    admin
      .from('staff_payroll_monthly_adjustments')
      .select('adjustment_type,amount,status')
      .eq('month_start', monthStart)
      .eq('status', 'active'),
    admin
      .from('staff_payroll_monthly_snapshots')
      .select(
        'id,status,approval_version_no,calculated_payroll_total,staff_count,missing_hours_task_count,unconfigured_staff_count,approved_at,calculated_at'
      )
      .eq('month_start', monthStart)
      .maybeSingle(),
    admin
      .from('staff_payroll_coaching_import_items')
      .select('id,staff_user_id,duration_hours,status')
      .eq('month_start', monthStart)
      .eq('status', 'active'),
    admin
      .from('schedule_training_sessions')
      .select('id')
      .gte('session_date', monthStart)
      .lt('session_date', nextMonthStart)
      .neq('status', 'cancelled')
      .limit(5000),
    admin
      .from('staff_payroll_salary_payments')
      .select('amount,status,approval_version_no')
      .eq('month_start', monthStart)
      .limit(10000),
  ])

  const sessionIds = ((sessionsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id)
  const assignmentsResult = sessionIds.length
    ? await admin
        .from('schedule_session_coach_assignments')
        .select('id,staff_user_id')
        .in('training_session_id', sessionIds)
        .eq('is_active', true)
        .limit(10000)
    : { data: [], error: null }

  const loadError =
    staffResult.error?.message ||
    areaResult.error?.message ||
    taskResult.error?.message ||
    mappingResult.error?.message ||
    logsResult.error?.message ||
    compensationResult.error?.message ||
    adjustmentsResult.error?.message ||
    snapshotResult.error?.message ||
    importsResult.error?.message ||
    sessionsResult.error?.message ||
    paymentsResult.error?.message ||
    assignmentsResult.error?.message ||
    ''

  const logs = (logsResult.data ?? []) as Array<{
    id: string
    staff_user_id: string
    actual_hours: number | null
    weighted_hours: number | null
    source: string
  }>
  const snapshot = snapshotResult.data as null | {
    id: string
    status: 'draft' | 'approved'
    approval_version_no: number
    calculated_payroll_total: number
    staff_count: number
    missing_hours_task_count: number
    unconfigured_staff_count: number
    approved_at: string | null
    calculated_at: string
  }

  const staffWithLogs = new Set(logs.map((row) => row.staff_user_id))
  const configuredStaff = new Set(
    ((compensationResult.data ?? []) as Array<{ staff_user_id: string }>).map(
      (row) => row.staff_user_id
    )
  )
  const missingLiveCompensation = [...staffWithLogs].filter(
    (staffUserId) => !configuredStaff.has(staffUserId)
  ).length
  const missingHours = logs.filter((row) => row.actual_hours == null).length
  const actualHours = logs.reduce((sum, row) => sum + Number(row.actual_hours ?? 0), 0)
  const weightedHours = logs.reduce((sum, row) => sum + Number(row.weighted_hours ?? 0), 0)
  const importedAssignments = (importsResult.data ?? []).length
  const scheduledAssignments = (assignmentsResult.data ?? []).length
  const remainingCoachingReviews = Math.max(0, scheduledAssignments - importedAssignments)
  const currentVersionNo = Number(snapshot?.approval_version_no ?? 0)
  const approvedTotal = Number(snapshot?.calculated_payroll_total ?? 0)
  const activeCurrentPayments = ((paymentsResult.data ?? []) as Array<{
    amount: number
    status: string
    approval_version_no: number
  }>).filter(
    (row) => row.status === 'active' && Number(row.approval_version_no) === currentVersionNo
  )
  const paidTotal = activeCurrentPayments.reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0
  )
  const remainingDue = Math.max(0, approvedTotal - paidTotal)
  const activeAdjustments = (adjustmentsResult.data ?? []) as Array<{
    adjustment_type: 'bonus' | 'deduction'
    amount: number
    status: string
  }>
  const adjustmentBonusTotal = activeAdjustments
    .filter((row) => row.adjustment_type === 'bonus')
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  const adjustmentDeductionTotal = activeAdjustments
    .filter((row) => row.adjustment_type === 'deduction')
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)

  const taskTone = (taskResult.count ?? 0) > 0 ? 'ready' : 'warning'
  const coachingTone =
    scheduledAssignments === 0
      ? 'neutral'
      : remainingCoachingReviews === 0
        ? 'ready'
        : 'warning'
  const monthlyTone =
    logs.length > 0 && missingHours === 0 && missingLiveCompensation === 0
      ? 'ready'
      : 'warning'
  const calculationTone = snapshot?.status === 'approved' ? 'ready' : 'warning'
  const paymentTone =
    snapshot?.status !== 'approved'
      ? 'neutral'
      : remainingDue <= 0
        ? 'ready'
        : 'warning'

  const steps = [
    {
      number: 1,
      title: 'Task Catalog',
      description: `${taskResult.count ?? 0} active tasks across ${areaResult.count ?? 0} areas. ${mappingResult.count ?? 0} active class mappings.`,
      status:
        (taskResult.count ?? 0) > 0
          ? 'Catalog ready'
          : 'No active payroll tasks',
      tone: taskTone,
      href: '/admin/staff-payroll/tasks',
      action: canWrite ? 'Manage catalog' : 'View catalog',
      icon: BookOpenCheck,
    },
    {
      number: 2,
      title: 'Coaching Import',
      description: `${scheduledAssignments} scheduled coaching assignments · ${importedAssignments} imported into Monthly Tasks.`,
      status:
        scheduledAssignments === 0
          ? 'No scheduled assignments'
          : remainingCoachingReviews === 0
            ? 'Import review complete'
            : `${remainingCoachingReviews} assignment${remainingCoachingReviews === 1 ? '' : 's'} to review`,
      tone: coachingTone,
      href: `/admin/staff-payroll/coaching-import?month=${selectedMonth}`,
      action: canWrite ? 'Review & sync coaching' : 'Review coaching',
      icon: GraduationCap,
    },
    {
      number: 3,
      title: 'Monthly Tasks',
      description: `${logs.length} active task entries for ${staffWithLogs.size} staff members · ${number(actualHours)} actual hours.`,
      status:
        logs.length === 0
          ? 'No work logged yet'
          : missingHours > 0
            ? `${missingHours} task${missingHours === 1 ? '' : 's'} missing actual hours`
            : missingLiveCompensation > 0
              ? `${missingLiveCompensation} staff compensation profile${missingLiveCompensation === 1 ? '' : 's'} missing`
              : 'Monthly work ready',
      tone: monthlyTone,
      href: `/admin/staff-payroll/monthly-tasks?month=${selectedMonth}`,
      action: canWrite ? 'Complete monthly work' : 'Review monthly work',
      icon: ClipboardCheck,
    },
    {
      number: 4,
      title: 'Compensation Rates',
      description: `${configuredStaff.size} staff members have a rate period applicable to ${monthLabel(selectedMonth)}.`,
      status:
        missingLiveCompensation > 0
          ? `${missingLiveCompensation} staff rate${missingLiveCompensation === 1 ? '' : 's'} missing`
          : 'Applicable rates ready',
      tone: missingLiveCompensation > 0 ? 'warning' : 'ready',
      href: '/admin/staff-payroll/rates',
      action: canWrite ? 'Manage rate periods' : 'Review rate periods',
      icon: Banknote,
    },
    {
      number: 5,
      title: 'Bonuses & Deductions',
      description: `${activeAdjustments.length} active adjustments · + ${money(adjustmentBonusTotal)} bonuses · − ${money(adjustmentDeductionTotal)} deductions.`,
      status:
        snapshot?.status === 'approved'
          ? 'Adjustments approved & locked'
          : activeAdjustments.length
            ? 'Adjustments ready for recalculation'
            : 'No manual adjustments',
      tone: snapshot?.status === 'approved' ? 'ready' : 'neutral',
      href: `/admin/staff-payroll/adjustments?month=${selectedMonth}`,
      action: canWrite ? 'Manage adjustments' : 'Review adjustments',
      icon: BadgeDollarSign,
    },
    {
      number: 6,
      title: 'Salary Calculation',
      description: snapshot
        ? `${snapshot.staff_count} staff · ${money(approvedTotal)} total payroll.`
        : 'Create the financial snapshot and calculate each staff salary.',
      status:
        snapshot?.status === 'approved'
          ? `Approved & locked · Version ${currentVersionNo}`
          : snapshot?.status === 'draft'
            ? 'Draft calculated · approval pending'
            : 'Calculation not started',
      tone: calculationTone,
      href: `/admin/staff-payroll/calculation?month=${selectedMonth}`,
      action: snapshot ? 'Review calculation' : 'Start calculation',
      icon: Calculator,
    },
    {
      number: 7,
      title: 'Payments',
      description:
        snapshot?.status === 'approved'
          ? `${money(paidTotal)} paid · ${money(remainingDue)} remaining.`
          : 'Payments become available after payroll approval.',
      status:
        snapshot?.status !== 'approved'
          ? 'Waiting for approved payroll'
          : remainingDue <= 0
            ? 'Payroll fully paid'
            : paidTotal > 0
              ? 'Payroll partially paid'
              : 'Payroll unpaid',
      tone: paymentTone,
      href: `/admin/staff-payroll/payments?month=${selectedMonth}`,
      action: canWrite ? 'Manage payments' : 'Review payments',
      icon: Banknote,
    },
  ] as const

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Staff Payroll 2F
              </span>
              <span
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold ' +
                  (canWrite
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800')
                }
              >
                {canWrite ? 'Super Admin · payroll control' : 'Admin · read-only'}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Monthly Payroll Overview</h1>
            <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">
              Follow the complete monthly payroll workflow, identify blockers and continue directly to the next action.
            </p>
          </div>

          <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="text-sm font-medium">
              Payroll month
              <input
                type="month"
                name="month"
                min="2026-08"
                max={shiftMonth(currentCairoMonth(), -1)}
                defaultValue={selectedMonth}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-[210px]"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Load overview
            </button>
          </form>
        </div>
      </section>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Staff Payroll overview could not load completely: {loadError}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <UsersRound size={16} /> Eligible staff
          </div>
          <div className="mt-2 text-2xl font-bold">{(staffResult.data ?? []).length}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{staffWithLogs.size} with work logged</div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <Clock3 size={16} /> Weighted hours
          </div>
          <div className="mt-2 text-2xl font-bold">{number(weightedHours)} h</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{number(actualHours)} actual hours</div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <Calculator size={16} /> Payroll total
          </div>
          <div className="mt-2 text-2xl font-bold">{snapshot ? money(approvedTotal) : '—'}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            {snapshot?.status === 'approved' ? `Approved version ${currentVersionNo}` : snapshot ? 'Draft calculation' : 'Not calculated'}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <Banknote size={16} /> Remaining due
          </div>
          <div className="mt-2 text-2xl font-bold">
            {snapshot?.status === 'approved' ? money(remainingDue) : '—'}
          </div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{money(paidTotal)} recorded as paid</div>
        </div>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
              Payroll workflow
            </div>
            <h2 className="mt-1 text-xl font-bold">{monthLabel(selectedMonth)}</h2>
          </div>
          {snapshot?.status === 'approved' ? (
            <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900">
              <LockKeyhole size={15} /> Approved & locked
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950">
              <CircleAlert size={15} /> Payroll not approved
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3">
          {steps.map((step) => {
            const Icon = step.icon
            return (
              <div
                key={step.number}
                className="grid gap-4 rounded-2xl border border-black/10 p-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(220px,0.7fr)_auto] lg:items-center"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
                  {step.number}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon size={18} />
                    <h3 className="font-bold">{step.title}</h3>
                  </div>
                  <p className="mt-1 text-sm text-[hsl(var(--muted))]">{step.description}</p>
                </div>

                <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${statusStyle(step.tone)}`}>
                  <div className="flex items-center gap-2">
                    {step.tone === 'ready' ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
                    {step.status}
                  </div>
                </div>

                <Link
                  href={step.href}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
                >
                  {step.action}
                  <ChevronRight size={16} />
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {(missingHours > 0 || missingLiveCompensation > 0 || remainingCoachingReviews > 0) && snapshot?.status !== 'approved' ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Items to resolve before payroll approval</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {remainingCoachingReviews > 0 ? <li>Review {remainingCoachingReviews} scheduled coaching assignment{remainingCoachingReviews === 1 ? '' : 's'}.</li> : null}
            {missingHours > 0 ? <li>Complete actual hours for {missingHours} monthly task entr{missingHours === 1 ? 'y' : 'ies'}.</li> : null}
            {missingLiveCompensation > 0 ? <li>Configure compensation for {missingLiveCompensation} staff member{missingLiveCompensation === 1 ? '' : 's'} with logged work.</li> : null}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
