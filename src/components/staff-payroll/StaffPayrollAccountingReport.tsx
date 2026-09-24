'use client'

import {
  BadgeCheck,
  Banknote,
  Download,
  FileSpreadsheet,
  Printer,
  ReceiptText,
} from 'lucide-react'
import type { StaffPayrollAccountingReport as AccountingReport } from '@/lib/staffPayrollAccounting'

function money(value: number) {
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EGP`
}

function hours(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function dateTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function roleLabel(value: string | null) {
  if (!value) return 'Staff'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function paymentStatus(value: 'unpaid' | 'partially_paid' | 'paid') {
  if (value === 'paid') return 'Paid'
  if (value === 'partially_paid') return 'Partially paid'
  return 'Unpaid'
}

function statusClass(value: 'unpaid' | 'partially_paid' | 'paid') {
  if (value === 'paid') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (value === 'partially_paid') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function StaffPayrollAccountingReport({
  selectedMonth,
  maxMonth,
  report,
}: {
  selectedMonth: string
  maxMonth: string
  report: AccountingReport
}) {
  const summaryExport = `/api/staff-payroll/accounting-export?month=${selectedMonth}&kind=summary`
  const paymentExport = `/api/staff-payroll/accounting-export?month=${selectedMonth}&kind=payments`

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
            <FileSpreadsheet className="h-4 w-4" /> Payroll 2G
          </div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Monthly Accounting Summary</h1>
          <p className="mt-2 max-w-3xl text-sm text-black/60">
            Read-only accounting view based exclusively on the current approved and immutable payroll version.
          </p>
        </div>

        <form method="get" className="print:hidden">
          <label className="text-xs font-semibold text-black/60" htmlFor="accounting-month">
            Closed payroll month
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="accounting-month"
              name="month"
              type="month"
              min="2026-08"
              max={maxMonth}
              defaultValue={selectedMonth}
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            />
            <button className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">
              View
            </button>
          </div>
        </form>
      </header>

      {!report.approved ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="font-semibold">No approved payroll available for {monthLabel(selectedMonth)}</div>
          <p className="mt-1 text-sm">
            Approve the monthly payroll first. Draft or reopened data is never included in accounting exports.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
                <div>
                  <div className="font-semibold text-emerald-950">
                    Approved payroll · Version {report.approval_version_no}
                  </div>
                  <div className="mt-1 text-xs text-emerald-900/75">
                    {monthLabel(selectedMonth)} · Approved by {report.approved_by_name ?? 'Super Admin'} · {dateTime(report.approved_at)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 print:hidden">
                <a
                  href={summaryExport}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
                >
                  <Download className="h-4 w-4" /> Payroll CSV
                </a>
                <a
                  href={paymentExport}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-100"
                >
                  <ReceiptText className="h-4 w-4" /> Payments CSV
                </a>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-100"
                >
                  <Printer className="h-4 w-4" /> Print / PDF
                </button>
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-black/50">Final approved payroll</div>
              <div className="mt-2 text-xl font-bold">{money(report.totals.final_salary)}</div>
              <div className="mt-1 text-xs text-black/50">{report.totals.staff_count} staff member{report.totals.staff_count === 1 ? '' : 's'}</div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-900/60">Paid</div>
              <div className="mt-2 text-xl font-bold text-blue-950">{money(report.totals.paid)}</div>
              <div className="mt-1 text-xs text-blue-900/60">Active salary payments only</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-900/60">Remaining due</div>
              <div className="mt-2 text-xl font-bold text-amber-950">{money(report.totals.remaining)}</div>
              <div className="mt-1 text-xs text-amber-900/60">Approved payroll less active payments</div>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-violet-900/60">Manual adjustments</div>
              <div className="mt-2 text-sm font-bold text-violet-950">+ {money(report.totals.manual_bonus)}</div>
              <div className="mt-1 text-sm font-bold text-violet-950">− {money(report.totals.manual_deduction)}</div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/50"><Banknote className="h-4 w-4" /> Cash paid</div>
              <div className="mt-2 text-lg font-bold">{money(report.totals.cash_paid)}</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/50"><Banknote className="h-4 w-4" /> Instapay paid</div>
              <div className="mt-2 text-lg font-bold">{money(report.totals.instapay_paid)}</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/50"><Banknote className="h-4 w-4" /> Bank transfer paid</div>
              <div className="mt-2 text-lg font-bold">{money(report.totals.bank_transfer_paid)}</div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-black/10 bg-white">
            <div className="border-b border-black/10 px-4 py-3">
              <h2 className="font-semibold">Approved payroll by staff member</h2>
              <p className="mt-1 text-xs text-black/50">Amounts are taken from approval version {report.approval_version_no}; payment totals use active ledger entries.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full text-left text-xs">
                <thead className="bg-black/[0.03] text-black/60">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Staff</th>
                    <th className="px-3 py-3 text-right font-semibold">Hours</th>
                    <th className="px-3 py-3 text-right font-semibold">Fixed base</th>
                    <th className="px-3 py-3 text-right font-semibold">Tasks</th>
                    <th className="px-3 py-3 text-right font-semibold">{report.rate_model === 'variable_payroll_pool' ? 'Variable task pay' : report.rate_model === 'dynamic_task_rates' ? 'Dynamic supplement' : 'Performance bonus'}</th>
                    <th className="px-3 py-3 text-right font-semibold">Manual bonus</th>
                    <th className="px-3 py-3 text-right font-semibold">Deduction</th>
                    <th className="px-3 py-3 text-right font-semibold">Final salary</th>
                    <th className="px-3 py-3 text-right font-semibold">Paid</th>
                    <th className="px-3 py-3 text-right font-semibold">Remaining</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {report.rows.map((row) => (
                    <tr key={row.calculation_id}>
                      <td className="px-3 py-3">
                        <div className="font-semibold">{row.staff_name}</div>
                        <div className="mt-0.5 text-[11px] text-black/45">{roleLabel(row.staff_role)}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{hours(row.actual_hours)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(row.fixed_monthly_base)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(row.task_compensation)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(report.rate_model === 'variable_payroll_pool' ? row.task_compensation : report.rate_model === 'dynamic_task_rates' ? row.dynamic_task_supplement : row.performance_bonus)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-emerald-700">+{money(row.manual_bonus)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-rose-700">−{money(row.manual_deduction)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.final_salary)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(row.paid_total)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.remaining_due)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass(row.payment_status)}`}>
                          {paymentStatus(row.payment_status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-black/10 bg-black/[0.025] font-semibold">
                  <tr>
                    <td className="px-3 py-3" colSpan={4}>Monthly totals</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(report.rate_model === 'variable_payroll_pool' ? report.totals.task_compensation : report.rate_model === 'dynamic_task_rates' ? report.totals.dynamic_task_supplement : report.totals.performance_bonus)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-700">+{money(report.totals.manual_bonus)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-rose-700">−{money(report.totals.manual_deduction)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(report.totals.final_salary)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(report.totals.paid)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(report.totals.remaining)}</td>
                    <td className="px-3 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <p className="text-xs text-black/45">
            Exports are read-only. They do not create expenses, payment-reconciliation entries, or bank transactions.
          </p>
        </>
      )}
    </div>
  )
}
