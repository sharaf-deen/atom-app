// Staff Payroll 2G — approved accounting CSV exports
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { loadStaffPayrollAccountingReport } from '@/lib/staffPayrollAccounting'

function json(status: number, body: unknown) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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

function normalizeClosedMonth(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null
  const [year, month] = value.split('-').map(Number)
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null
  if (value < '2026-08' || value > previousCairoMonth()) return null
  return value
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(',')
}

function decimal(value: number) {
  return value.toFixed(2)
}

function csvResponse(content: string, filename: string) {
  return new Response(`\uFEFF${content}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (profileError) {
      return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profileError.message })
    }
    if (profile?.role !== 'admin' && profile?.role !== 'super_admin') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const url = new URL(req.url)
    const month = normalizeClosedMonth(url.searchParams.get('month'))
    const kind = url.searchParams.get('kind') === 'payments' ? 'payments' : 'summary'
    if (!month) {
      return json(400, {
        ok: false,
        error: 'INVALID_MONTH',
        details: 'Choose a closed payroll month from August 2026 onward.',
      })
    }

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const report = await loadStaffPayrollAccountingReport(admin, `${month}-01`)
    if (!report.approved) {
      return json(409, {
        ok: false,
        error: 'PAYROLL_NOT_APPROVED',
        details: 'Only an approved payroll version can be exported.',
      })
    }

    if (kind === 'payments') {
      const lines = [
        csvLine([
          'Payroll Month',
          'Approval Version',
          'Staff Name',
          'Payment Date',
          'Amount EGP',
          'Payment Method',
          'Reference',
          'Status',
          'Recorded At',
          'Recorded By',
          'Reversed At',
          'Reversed By',
          'Reversal Reason',
          'Note',
        ]),
        ...report.payments.map((payment) =>
          csvLine([
            month,
            report.approval_version_no,
            payment.staff_name_snapshot,
            payment.payment_date,
            decimal(payment.amount),
            payment.payment_method,
            payment.reference,
            payment.status,
            payment.recorded_at,
            payment.recorded_by_name_snapshot,
            payment.reversed_at,
            payment.reversed_by_name_snapshot,
            payment.reversal_reason,
            payment.note,
          ])
        ),
      ]
      return csvResponse(lines.join('\r\n'), `atom-payroll-payments-${month}.csv`)
    }

    const lines = [
      csvLine([
        'Payroll Month',
        'Approval Version',
        'Approved At',
        'Approved By',
        'Staff Name',
        'Staff Role',
        'Actual Hours',
        'Weighted Hours',
        'Fixed Monthly Base EGP',
        'Task Compensation EGP',
        'Dynamic / Variable Task Pay EGP',
        'Performance Bonus EGP',
        'Salary Before Adjustments EGP',
        'Manual Bonus EGP',
        'Manual Deduction EGP',
        'Final Approved Salary EGP',
        'Paid EGP',
        'Remaining Due EGP',
        'Payment Status',
      ]),
      ...report.rows.map((row) =>
        csvLine([
          month,
          report.approval_version_no,
          report.approved_at,
          report.approved_by_name,
          row.staff_name,
          row.staff_role,
          decimal(row.actual_hours),
          decimal(row.weighted_hours),
          decimal(row.fixed_monthly_base),
          decimal(row.task_compensation),
          decimal(row.dynamic_task_supplement),
          decimal(row.performance_bonus),
          decimal(row.salary_before_adjustments),
          decimal(row.manual_bonus),
          decimal(row.manual_deduction),
          decimal(row.final_salary),
          decimal(row.paid_total),
          decimal(row.remaining_due),
          row.payment_status,
        ])
      ),
    ]

    return csvResponse(lines.join('\r\n'), `atom-payroll-summary-${month}.csv`)
  } catch (error) {
    return json(500, {
      ok: false,
      error: 'ACCOUNTING_EXPORT_FAILED',
      details: error instanceof Error ? error.message : String(error),
    })
  }
}
