'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import {
  PRIVATE_COACHING_PACKAGES,
  formatPrivateCoachingMoney,
  privateCoachingPaymentMethodLabel,
  privateCoachingPromoSummary,
  privateCoachingStatusLabel,
  type PrivateCoachingPackageSessions,
  type PrivateCoachingPaymentMethod,
} from '@/lib/privateCoaching'

type RequestRow = {
  id: string
  memberName: string
  memberMeta: string
  coachName: string
  packageSessions: number
  amountCents: number
  originalAmountCents: number | null
  discountCode: string | null
  discountLabel: string | null
  discountPercent: number | null
  discountAmountCents: number | null
  paymentMethod: string
  status: string
  createdAt: string
  confirmedAt: string | null
}

type Props = {
  rows: RequestRow[]
}

const REQUESTS_PAGE_SIZE = 5

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'payment_pending') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function userKey(row: RequestRow) {
  return `${row.memberName}||${row.memberMeta}`
}

function uniqueMemberOptions(rows: RequestRow[]) {
  const seen = new Map<string, { key: string; label: string; meta: string }>()
  for (const row of rows) {
    const key = userKey(row)
    if (!seen.has(key)) {
      seen.set(key, { key, label: row.memberName || 'Unknown member', meta: row.memberMeta || '' })
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function packageAmountCents(sessions: number) {
  return PRIVATE_COACHING_PACKAGES.find((item) => item.sessions === sessions)?.amountCents ?? 0
}

function discountedAmountCents(originalAmountCents: number, discountPercent?: number | null) {
  const original = Math.max(0, Number(originalAmountCents ?? 0))
  const percent = Math.max(0, Number(discountPercent ?? 0))
  if (percent <= 0) return original
  return Math.max(0, original - Math.round((original * percent) / 100))
}

function paymentSummaryItems(row: RequestRow | null): ConfirmActionSummaryItem[] {
  if (!row) return []

  return [
    { label: 'Member', value: row.memberName },
    { label: 'Member info', value: row.memberMeta || '—' },
    { label: 'Coach', value: row.coachName },
    { label: 'Package', value: `${row.packageSessions} session(s)` },
    { label: 'Amount', value: formatPrivateCoachingMoney(row.amountCents) },
    row.discountAmountCents && row.discountAmountCents > 0
      ? { label: 'Promo code', value: privateCoachingPromoSummary(row.discountCode, row.discountPercent, row.discountAmountCents, row.discountLabel) }
      : { label: 'Promo code', value: 'No promo code' },
    { label: 'Payment method', value: privateCoachingPaymentMethodLabel(row.paymentMethod) },
    { label: 'Current status', value: privateCoachingStatusLabel(row.status) },
    { label: 'Requested', value: formatDateTime(row.createdAt) },
    { label: 'Token impact', value: `${row.packageSessions} active token(s) will be created` },
    { label: 'Payment impact', value: 'Request becomes active after confirmation' },
  ]
}

function editSummaryItems(row: RequestRow | null, sessions: number, paymentMethod: string): ConfirmActionSummaryItem[] {
  if (!row) return []

  return [
    { label: 'Member', value: row.memberName },
    { label: 'Member info', value: row.memberMeta || '—' },
    { label: 'Coach', value: row.coachName },
    { label: 'Current package', value: `${row.packageSessions} session(s)` },
    { label: 'New package', value: `${sessions} session(s)` },
    { label: 'Original amount', value: formatPrivateCoachingMoney(packageAmountCents(sessions)) },
    row.discountCode && row.discountPercent
      ? { label: 'Promo kept', value: privateCoachingPromoSummary(row.discountCode, row.discountPercent, Math.max(0, packageAmountCents(sessions) - discountedAmountCents(packageAmountCents(sessions), row.discountPercent)), row.discountLabel) }
      : { label: 'Promo kept', value: 'No promo code' },
    { label: 'New final amount', value: formatPrivateCoachingMoney(discountedAmountCents(packageAmountCents(sessions), row.discountPercent)) },
    { label: 'Payment method', value: privateCoachingPaymentMethodLabel(paymentMethod) },
    { label: 'Current status', value: privateCoachingStatusLabel(row.status) },
    { label: 'Request impact', value: 'Only pending request details will be updated' },
  ]
}

function deleteSummaryItems(row: RequestRow | null): ConfirmActionSummaryItem[] {
  if (!row) return []

  return [
    { label: 'Member', value: row.memberName },
    { label: 'Member info', value: row.memberMeta || '—' },
    { label: 'Coach', value: row.coachName },
    { label: 'Package', value: `${row.packageSessions} session(s)` },
    { label: 'Amount', value: formatPrivateCoachingMoney(row.amountCents) },
    row.discountAmountCents && row.discountAmountCents > 0
      ? { label: 'Promo code', value: privateCoachingPromoSummary(row.discountCode, row.discountPercent, row.discountAmountCents, row.discountLabel) }
      : { label: 'Promo code', value: 'No promo code' },
    { label: 'Payment method', value: privateCoachingPaymentMethodLabel(row.paymentMethod) },
    { label: 'Current status', value: privateCoachingStatusLabel(row.status) },
    { label: 'Request impact', value: 'Payment pending request will be cancelled' },
    { label: 'Token impact', value: 'No token will be created' },
  ]
}

export default function PrivateCoachingAdminClient({ rows }: Props) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState('')
  const [busyAction, setBusyAction] = React.useState<'confirm-payment' | 'update-request' | 'delete-request' | ''>('')
  const [confirmPaymentRow, setConfirmPaymentRow] = React.useState<RequestRow | null>(null)
  const [confirmDeleteRow, setConfirmDeleteRow] = React.useState<RequestRow | null>(null)
  const [editingRow, setEditingRow] = React.useState<RequestRow | null>(null)
  const [editSessions, setEditSessions] = React.useState<PrivateCoachingPackageSessions>(1)
  const [editPaymentMethod, setEditPaymentMethod] = React.useState<PrivateCoachingPaymentMethod>('cash')
  const [confirmEditOpen, setConfirmEditOpen] = React.useState(false)
  const [memberFilter, setMemberFilter] = React.useState('all')
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const memberOptions = React.useMemo(() => uniqueMemberOptions(rows), [rows])

  const filteredRows = React.useMemo(() => {
    if (memberFilter === 'all') return rows
    return rows.filter((row) => userKey(row) === memberFilter)
  }, [memberFilter, rows])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / REQUESTS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageStart = (safePage - 1) * REQUESTS_PAGE_SIZE
  const paginatedRows = filteredRows.slice(pageStart, pageStart + REQUESTS_PAGE_SIZE)

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  function setFilterAndReset(value: string) {
    setMemberFilter(value)
    setPage(1)
  }

  function startEdit(row: RequestRow) {
    setStatus({ kind: '', message: '' })
    setEditingRow(row)
    setEditSessions((row.packageSessions === 5 || row.packageSessions === 10 ? row.packageSessions : 1) as PrivateCoachingPackageSessions)
    setEditPaymentMethod((row.paymentMethod === 'instapay' ? 'instapay' : 'cash') as PrivateCoachingPaymentMethod)
    setConfirmEditOpen(false)
  }

  function closeEdit() {
    if (busyId) return
    setEditingRow(null)
    setConfirmEditOpen(false)
  }

  async function confirmPayment(row: RequestRow) {
    setBusyId(row.id)
    setBusyAction('confirm-payment')
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/requests/${encodeURIComponent(row.id)}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not confirm payment.' })
        return
      }
      setConfirmPaymentRow(null)
      setStatus({ kind: 'success', message: 'Payment confirmed. Sessions are now active for the member.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not confirm payment.' })
    } finally {
      setBusyId('')
      setBusyAction('')
    }
  }

  async function updateRequest(row: RequestRow) {
    setBusyId(row.id)
    setBusyAction('update-request')
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/requests/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_sessions: editSessions,
          payment_method: editPaymentMethod,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not update request.' })
        return
      }
      setConfirmEditOpen(false)
      setEditingRow(null)
      setStatus({ kind: 'success', message: 'Private coaching request updated.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not update request.' })
    } finally {
      setBusyId('')
      setBusyAction('')
    }
  }

  async function deleteRequest(row: RequestRow) {
    setBusyId(row.id)
    setBusyAction('delete-request')
    setStatus({ kind: '', message: '' })

    try {
      const res = await fetch(`/api/private-coaching/requests/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not delete request.' })
        return
      }
      setConfirmDeleteRow(null)
      setEditingRow(null)
      setStatus({ kind: 'success', message: 'Private coaching request cancelled.' })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not delete request.' })
    } finally {
      setBusyId('')
      setBusyAction('')
    }
  }

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      {rows.length ? (
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <label className="grid gap-1 lg:min-w-[280px]">
              <span className="text-sm font-semibold">Filter requests by member</span>
              <select
                value={memberFilter}
                onChange={(event) => setFilterAndReset(event.target.value)}
                className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
              >
                <option value="all">All members</option>
                {memberOptions.map((member) => (
                  <option key={member.key} value={member.key}>
                    {member.label}{member.meta ? ` — ${member.meta}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm font-semibold text-[hsl(var(--muted))]">
              Showing {filteredRows.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + REQUESTS_PAGE_SIZE, filteredRows.length)} of {filteredRows.length} request(s) · 5 per page
            </div>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No private coaching request yet.
        </div>
      ) : null}

      {rows.length > 0 && filteredRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
          No request matches this member filter.
        </div>
      ) : null}

      <div className="grid gap-3">
        {paginatedRows.map((row) => {
          const canManagePending = row.status === 'payment_pending'
          const isEditing = editingRow?.id === row.id

          return (
            <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(row.status)}`}>
                      {privateCoachingStatusLabel(row.status)}
                    </span>
                    <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--muted))]">
                      {row.packageSessions} session(s)
                    </span>
                  </div>

                  <div className="mt-3 text-base font-semibold tracking-tight">{row.memberName}</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.memberMeta}</div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Amount</div>
                      <div className="font-semibold">{formatPrivateCoachingMoney(row.amountCents)}</div>
                      {row.discountAmountCents && row.discountAmountCents > 0 ? (
                        <div className="mt-1 text-[11px] font-semibold text-emerald-700">{row.discountCode} · -{formatPrivateCoachingMoney(row.discountAmountCents)}</div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Payment</div>
                      <div className="font-semibold">{privateCoachingPaymentMethodLabel(row.paymentMethod)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Requested</div>
                      <div className="font-semibold">{formatDateTime(row.createdAt)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Coach</div>
                      <div className="font-semibold">{row.coachName}</div>
                    </div>
                  </div>
                </div>

                {canManagePending ? (
                  <div className="flex w-full flex-col gap-2 lg:w-auto">
                    <Button
                      type="button"
                      onClick={() => setConfirmPaymentRow(row)}
                      disabled={Boolean(busyId)}
                      loading={busyId === row.id && busyAction === 'confirm-payment'}
                      loadingText="Confirming…"
                      className="w-full lg:w-auto"
                    >
                      Confirm payment received
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => startEdit(row)}
                      disabled={Boolean(busyId)}
                      className="w-full lg:w-auto"
                    >
                      Edit request
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmDeleteRow(row)}
                      disabled={Boolean(busyId)}
                      loading={busyId === row.id && busyAction === 'delete-request'}
                      loadingText="Deleting…"
                      className="w-full lg:w-auto"
                    >
                      Delete request
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                    {row.confirmedAt ? `Confirmed ${formatDateTime(row.confirmedAt)}` : privateCoachingStatusLabel(row.status)}
                  </div>
                )}
              </div>

              {isEditing ? (
                <div className="mt-4 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                  <div className="text-sm font-semibold">Edit pending request</div>
                  <p className="mt-1 text-xs text-[hsl(var(--muted))]">Only payment pending requests can be edited safely before tokens are created.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-sm font-semibold">Package</span>
                      <select
                        value={editSessions}
                        onChange={(event) => setEditSessions(Number(event.target.value) as PrivateCoachingPackageSessions)}
                        className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                      >
                        {PRIVATE_COACHING_PACKAGES.map((item) => (
                          <option key={item.sessions} value={item.sessions}>
                            {item.label} — {formatPrivateCoachingMoney(item.amountCents)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-sm font-semibold">Payment method</span>
                      <select
                        value={editPaymentMethod}
                        onChange={(event) => setEditPaymentMethod(event.target.value as PrivateCoachingPaymentMethod)}
                        className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                      >
                        <option value="cash">Cash at reception</option>
                        <option value="instapay">Instapay</option>
                      </select>
                    </label>
                  </div>
                  {editingRow?.discountAmountCents && editingRow.discountAmountCents > 0 ? (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      Existing promo kept: {privateCoachingPromoSummary(editingRow.discountCode, editingRow.discountPercent, editingRow.discountAmountCents, editingRow.discountLabel)}. The discount will be recalculated if you change the package.
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={closeEdit} disabled={Boolean(busyId)}>
                      Cancel edit
                    </Button>
                    <Button type="button" onClick={() => setConfirmEditOpen(true)} disabled={Boolean(busyId)} loading={busyId === row.id && busyAction === 'update-request'} loadingText="Saving…">
                      Save request changes
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {filteredRows.length > REQUESTS_PAGE_SIZE ? (
        <div className="flex flex-col gap-2 rounded-3xl border border-[hsl(var(--border))] bg-white p-3 text-sm shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="font-semibold text-[hsl(var(--muted))]">Page {safePage} of {pageCount}</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1}>
              Previous
            </Button>
            <Button type="button" variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={Boolean(confirmPaymentRow)}
        title="Confirm private coaching payment"
        description="Please confirm that the payment was received before activating private coaching tokens."
        confirmLabel="Confirm payment"
        pendingLabel="Confirming…"
        pending={Boolean(confirmPaymentRow && busyId === confirmPaymentRow.id)}
        summaryItems={paymentSummaryItems(confirmPaymentRow)}
        warning="This action creates active private coaching tokens for the member."
        onCancel={() => {
          if (!busyId) setConfirmPaymentRow(null)
        }}
        onConfirm={() => {
          if (confirmPaymentRow) return confirmPayment(confirmPaymentRow)
        }}
      />

      <ConfirmActionModal
        open={Boolean(editingRow && confirmEditOpen)}
        title="Confirm private coaching request changes"
        description="Please review the pending request update before saving."
        confirmLabel="Confirm & save"
        pendingLabel="Saving…"
        pending={Boolean(editingRow && busyId === editingRow.id && busyAction === 'update-request')}
        summaryItems={editSummaryItems(editingRow, editSessions, editPaymentMethod)}
        warning="Only the pending request details are updated. No token is created by this action."
        onCancel={() => {
          if (!busyId) setConfirmEditOpen(false)
        }}
        onConfirm={() => {
          if (editingRow) return updateRequest(editingRow)
        }}
      />

      <ConfirmActionModal
        open={Boolean(confirmDeleteRow)}
        title="Delete private coaching request?"
        description="Please confirm before cancelling this pending private coaching request."
        confirmLabel="Confirm delete"
        pendingLabel="Deleting…"
        pending={Boolean(confirmDeleteRow && busyId === confirmDeleteRow.id && busyAction === 'delete-request')}
        tone="destructive"
        summaryItems={deleteSummaryItems(confirmDeleteRow)}
        warning="This is a safe cancellation for payment pending requests only. Active requests with tokens cannot be deleted here."
        onCancel={() => {
          if (!busyId) setConfirmDeleteRow(null)
        }}
        onConfirm={() => {
          if (confirmDeleteRow) return deleteRequest(confirmDeleteRow)
        }}
      />
    </div>
  )
}
