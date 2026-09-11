// Staff Payroll 1F — Salary Statement PDF download
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  generateStaffPayrollStatementPdfBytes,
  type StaffPayrollStatementPayment,
  type StaffPayrollStatementSnapshot,
} from '@/lib/staffPayrollStatement'

type PayrollRole = 'admin' | 'super_admin' | string

function json(status: number, body: any) {
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

function normalizeUuid(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : ''
}

function paymentStatus(due: number, paid: number): 'unpaid' | 'partially_paid' | 'paid' {
  const remaining = Math.max(0, due - paid)
  if (due <= 0 || remaining <= 0.005) return 'paid'
  if (paid > 0.005) return 'partially_paid'
  return 'unpaid'
}

function safeFilenamePart(value: string) {
  const clean = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70)
  return clean || 'staff'
}

async function loadLogoBytes() {
  try {
    const filePath = join(process.cwd(), 'public', 'atom4app.png')
    return new Uint8Array(await readFile(filePath))
  } catch {
    return null
  }
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // A read-audit failure must not prevent an authorized statement download.
  }
}

export async function GET(
  _req: Request,
  ctx: { params: { calculationId: string } }
) {
  try {
    const calculationId = normalizeUuid(ctx?.params?.calculationId)
    if (!calculationId) {
      return json(400, { ok: false, error: 'INVALID_APPROVAL_CALCULATION_ID' })
    }

    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()

    if (authError || !auth.user) {
      return json(401, {
        ok: false,
        error: 'NOT_AUTHENTICATED',
        details: authError?.message ?? null,
      })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: PayrollRole | null }>()

    if (profileError) {
      return json(500, {
        ok: false,
        error: 'PROFILE_LOOKUP_FAILED',
        details: profileError.message,
      })
    }

    const role = profile?.role ?? 'member'
    if (role !== 'admin' && role !== 'super_admin') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })
    }

    const { data: calculation, error: calculationError } = await admin
      .from('staff_payroll_approval_calculations')
      .select(
        'id,approval_version_id,snapshot_id,month_start,staff_user_id,staff_name_snapshot,staff_role_snapshot,fixed_monthly_base,weighted_hour_rate,actual_hours,weighted_hours,task_compensation,performance_bonus,calculated_salary'
      )
      .eq('id', calculationId)
      .maybeSingle()

    if (calculationError || !calculation) {
      return json(404, {
        ok: false,
        error: 'APPROVAL_CALCULATION_NOT_FOUND',
        details: calculationError?.message ?? null,
      })
    }

    const [versionResult, paymentsResult, snapshotResult, reopenResult] = await Promise.all([
      admin
        .from('staff_payroll_approval_versions')
        .select('id,month_start,version_no,approved_at,approved_by_name_snapshot')
        .eq('id', calculation.approval_version_id)
        .maybeSingle(),
      admin
        .from('staff_payroll_salary_payments')
        .select(
          'id,amount,payment_method,payment_date,reference,note,status,recorded_at,recorded_by_name_snapshot,reversed_at,reversed_by_name_snapshot,reversal_reason'
        )
        .eq('approval_calculation_id', calculationId)
        .order('payment_date', { ascending: true })
        .order('recorded_at', { ascending: true }),
      admin
        .from('staff_payroll_monthly_snapshots')
        .select('id,status,approval_version_no')
        .eq('id', calculation.snapshot_id)
        .maybeSingle(),
      admin
        .from('staff_payroll_reopen_events')
        .select('id,reopened_at')
        .eq('approval_version_id', calculation.approval_version_id)
        .maybeSingle(),
    ])

    if (versionResult.error || !versionResult.data) {
      return json(404, {
        ok: false,
        error: 'APPROVAL_VERSION_NOT_FOUND',
        details: versionResult.error?.message ?? null,
      })
    }

    if (paymentsResult.error) {
      return json(500, {
        ok: false,
        error: 'SALARY_PAYMENTS_LOAD_FAILED',
        details: paymentsResult.error.message,
      })
    }

    const version = versionResult.data
    const salary = Number(calculation.calculated_salary ?? 0)
    const payments = ((paymentsResult.data ?? []) as any[]).map(
      (row): StaffPayrollStatementPayment => ({
        id: String(row.id),
        amount: Number(row.amount ?? 0),
        payment_method: String(row.payment_method ?? ''),
        payment_date: String(row.payment_date ?? ''),
        reference: row.reference ? String(row.reference) : null,
        note: row.note ? String(row.note) : null,
        status: String(row.status ?? 'active'),
        recorded_at: String(row.recorded_at ?? ''),
        recorded_by_name_snapshot: String(row.recorded_by_name_snapshot ?? 'Super Admin'),
        reversed_at: row.reversed_at ? String(row.reversed_at) : null,
        reversed_by_name_snapshot: row.reversed_by_name_snapshot
          ? String(row.reversed_by_name_snapshot)
          : null,
        reversal_reason: row.reversal_reason ? String(row.reversal_reason) : null,
      })
    )

    const paid = payments
      .filter((payment) => payment.status === 'active')
      .reduce((sum, payment) => sum + payment.amount, 0)
    const remaining = Math.max(0, salary - paid)

    const currentVersion =
      snapshotResult.data?.status === 'approved' &&
      Number(snapshotResult.data?.approval_version_no ?? 0) === Number(version.version_no ?? 0)

    const versionStatusLabel = currentVersion
      ? 'Current approved version'
      : reopenResult.data
        ? 'Historical version · reopened'
        : 'Historical approval version'

    const statement: StaffPayrollStatementSnapshot = {
      generated_at: new Date().toISOString(),
      month_start: String(calculation.month_start),
      approval_version: {
        id: String(version.id),
        version_no: Number(version.version_no ?? 0),
        approved_at: String(version.approved_at),
        approved_by_name_snapshot: String(version.approved_by_name_snapshot ?? 'Super Admin'),
        version_status_label: versionStatusLabel,
      },
      staff: {
        user_id: String(calculation.staff_user_id),
        name: String(calculation.staff_name_snapshot),
        role: calculation.staff_role_snapshot ? String(calculation.staff_role_snapshot) : null,
      },
      compensation: {
        fixed_monthly_base: Number(calculation.fixed_monthly_base ?? 0),
        weighted_hour_rate: Number(calculation.weighted_hour_rate ?? 0),
        actual_hours: Number(calculation.actual_hours ?? 0),
        weighted_hours: Number(calculation.weighted_hours ?? 0),
        task_compensation: Number(calculation.task_compensation ?? 0),
        performance_bonus: Number(calculation.performance_bonus ?? 0),
        approved_salary: salary,
      },
      payments,
      totals: {
        paid,
        remaining,
        payment_status: paymentStatus(salary, paid),
      },
    }

    const pdfBytes = await generateStaffPayrollStatementPdfBytes(statement, await loadLogoBytes())

    await safeAudit(admin, {
      actor_user_id: auth.user.id,
      target_user_id: calculation.staff_user_id,
      action: 'staff_payroll_salary_statement_downloaded',
      action_details: {
        approval_calculation_id: calculationId,
        approval_version_id: version.id,
        approval_version_no: Number(version.version_no ?? 0),
        month_start: calculation.month_start,
        staff_name: calculation.staff_name_snapshot,
        requester_role: role,
        access_scope: 'Read-only salary statement download.',
      },
    })

    const month = String(calculation.month_start).slice(0, 7)
    const filename = `ATOM_Salary_Statement_${month}_${safeFilenamePart(
      String(calculation.staff_name_snapshot)
    )}_V${Number(version.version_no ?? 0)}.pdf`

    const responseBody = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: error?.message ?? String(error),
    })
  }
}
