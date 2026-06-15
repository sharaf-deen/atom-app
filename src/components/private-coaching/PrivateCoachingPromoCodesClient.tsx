'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import {
  isValidPrivateCoachingPromoCodeFormat,
  isValidPrivateCoachingPromoPercent,
  normalizePrivateCoachingPromoCode,
  normalizePrivateCoachingPromoPercent,
  normalizePrivateCoachingPromoTitle,
} from '@/lib/privateCoaching'

type PromoRow = {
  id: string
  code: string
  title: string | null
  discountPercent: number
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

type Props = {
  rows: PromoRow[]
}

type ActionMode = 'create' | 'edit' | 'delete'

type ConfirmState = {
  mode: ActionMode
  row: PromoRow | null
  code: string
  title: string
  discountPercent: number
  isActive: boolean
} | null

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

function summaryItems(state: ConfirmState): ConfirmActionSummaryItem[] {
  if (!state) return []

  const action = state.mode === 'create'
    ? 'Create private coaching code'
    : state.mode === 'edit'
      ? 'Update private coaching code'
      : 'Delete private coaching code'

  return [
    { label: 'Action', value: action },
    { label: 'Code', value: normalizePrivateCoachingPromoCode(state.code) || '—' },
    { label: 'Title', value: normalizePrivateCoachingPromoTitle(state.title) || '—' },
    { label: 'Discount', value: `${normalizePrivateCoachingPromoPercent(state.discountPercent)}%` },
    { label: 'Status', value: state.isActive && state.mode !== 'delete' ? 'Active' : 'Inactive' },
    { label: 'Visibility', value: 'Private: code is not shown to members. Members must enter it manually.' },
    { label: 'Token impact', value: 'Sessions/tokens stay unchanged. Only the amount to pay is reduced.' },
  ]
}

export default function PrivateCoachingPromoCodesClient({ rows }: Props) {
  const router = useRouter()
  const [code, setCode] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [discountPercent, setDiscountPercent] = React.useState(10)
  const [isActive, setIsActive] = React.useState(true)
  const [editingId, setEditingId] = React.useState('')
  const [editCode, setEditCode] = React.useState('')
  const [editTitle, setEditTitle] = React.useState('')
  const [editDiscountPercent, setEditDiscountPercent] = React.useState(10)
  const [editIsActive, setEditIsActive] = React.useState(true)
  const [confirmState, setConfirmState] = React.useState<ConfirmState>(null)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const normalizedCreateCode = normalizePrivateCoachingPromoCode(code)
  const createInvalid = code.trim().length > 0 && !isValidPrivateCoachingPromoCodeFormat(code)
  const createPercentInvalid = !isValidPrivateCoachingPromoPercent(discountPercent)

  function resetCreateForm() {
    setCode('')
    setTitle('')
    setDiscountPercent(10)
    setIsActive(true)
  }

  function startEdit(row: PromoRow) {
    setStatus({ kind: '', message: '' })
    setEditingId(row.id)
    setEditCode(row.code)
    setEditTitle(row.title ?? '')
    setEditDiscountPercent(row.discountPercent)
    setEditIsActive(row.isActive)
  }

  function cancelEdit() {
    if (busy) return
    setEditingId('')
    setEditCode('')
    setEditTitle('')
    setEditDiscountPercent(10)
    setEditIsActive(true)
  }

  function confirmCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: '', message: '' })

    if (!isValidPrivateCoachingPromoCodeFormat(code)) {
      setStatus({ kind: 'error', message: 'Promo code must be 2-32 characters using letters, numbers, underscore or dash.' })
      return
    }
    if (!isValidPrivateCoachingPromoPercent(discountPercent)) {
      setStatus({ kind: 'error', message: 'Discount percent must be between 1 and 100.' })
      return
    }

    setConfirmState({
      mode: 'create',
      row: null,
      code: normalizedCreateCode,
      title: normalizePrivateCoachingPromoTitle(title),
      discountPercent: normalizePrivateCoachingPromoPercent(discountPercent),
      isActive,
    })
  }

  function confirmEdit(row: PromoRow) {
    setStatus({ kind: '', message: '' })

    if (!isValidPrivateCoachingPromoCodeFormat(editCode)) {
      setStatus({ kind: 'error', message: 'Promo code must be 2-32 characters using letters, numbers, underscore or dash.' })
      return
    }
    if (!isValidPrivateCoachingPromoPercent(editDiscountPercent)) {
      setStatus({ kind: 'error', message: 'Discount percent must be between 1 and 100.' })
      return
    }

    setConfirmState({
      mode: 'edit',
      row,
      code: normalizePrivateCoachingPromoCode(editCode),
      title: normalizePrivateCoachingPromoTitle(editTitle),
      discountPercent: normalizePrivateCoachingPromoPercent(editDiscountPercent),
      isActive: editIsActive,
    })
  }

  function confirmDelete(row: PromoRow) {
    setStatus({ kind: '', message: '' })
    setConfirmState({
      mode: 'delete',
      row,
      code: row.code,
      title: row.title ?? '',
      discountPercent: row.discountPercent,
      isActive: false,
    })
  }

  async function runConfirmedAction() {
    if (!confirmState) return

    setBusy(true)
    setStatus({ kind: '', message: '' })

    try {
      const body = JSON.stringify({
        code: normalizePrivateCoachingPromoCode(confirmState.code),
        title: normalizePrivateCoachingPromoTitle(confirmState.title),
        discount_percent: normalizePrivateCoachingPromoPercent(confirmState.discountPercent),
        is_active: confirmState.isActive,
      })

      const url = confirmState.mode === 'create'
        ? '/api/private-coaching/promo-codes'
        : `/api/private-coaching/promo-codes/${encodeURIComponent(confirmState.row?.id ?? '')}`

      const method = confirmState.mode === 'create' ? 'POST' : confirmState.mode === 'edit' ? 'PATCH' : 'DELETE'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : body,
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not save private coaching promo code.' })
        return
      }

      if (confirmState.mode === 'create') resetCreateForm()
      if (confirmState.mode === 'edit') cancelEdit()
      setConfirmState(null)
      setStatus({
        kind: 'success',
        message: confirmState.mode === 'delete' ? 'Private coaching promo code deleted.' : 'Private coaching promo code saved.',
      })
      router.refresh()
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not save private coaching promo code.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">Private codes are not displayed to members.</div>
        <p className="mt-1">Share a code manually with selected members. They will only see a private-code field and must enter the exact code to receive the discount.</p>
      </div>

      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <form onSubmit={confirmCreate} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="text-base font-semibold tracking-tight">Add private coaching promo code</div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr_140px_auto] lg:items-end">
          <label className="grid gap-1">
            <span className="text-sm font-semibold">Code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Example: VIP10"
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Example: VIP member discount"
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">Discount %</span>
            <input
              type="number"
              min="1"
              max="100"
              value={discountPercent}
              onChange={(event) => setDiscountPercent(Number(event.target.value))}
              className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold shadow-soft">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Active
          </label>
        </div>
        {createInvalid ? <p className="mt-2 text-sm font-semibold text-rose-700">Code format: 2-32 characters, letters/numbers/underscore/dash only.</p> : null}
        {createPercentInvalid ? <p className="mt-2 text-sm font-semibold text-rose-700">Discount percent must be between 1 and 100.</p> : null}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={busy || !normalizedCreateCode || createInvalid || createPercentInvalid}>
            Add promo code
          </Button>
        </div>
      </form>

      <div className="grid gap-3">
        {rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))] shadow-soft">
            No private coaching promo code yet.
          </div>
        ) : null}

        {rows.map((row) => {
          const isEditing = editingId === row.id

          return (
            <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 py-1 text-[11px] font-semibold">
                      {row.code}
                    </span>
                    <span className={row.isActive ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700' : 'rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700'}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="mt-3 text-base font-semibold tracking-tight">{row.title || 'Untitled private coaching discount'}</div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {row.discountPercent}% off · Created {formatDateTime(row.createdAt)}
                  </div>
                </div>

                <div className="flex w-full flex-col gap-2 lg:w-auto">
                  <Button type="button" variant="outline" onClick={() => startEdit(row)} disabled={busy} className="w-full lg:w-auto">
                    Edit
                  </Button>
                  <Button type="button" variant="outline" onClick={() => confirmDelete(row)} disabled={busy} className="w-full lg:w-auto">
                    Delete
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-4 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                  <div className="text-sm font-semibold">Edit promo code</div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr_140px_auto] lg:items-end">
                    <label className="grid gap-1">
                      <span className="text-sm font-semibold">Code</span>
                      <input
                        value={editCode}
                        onChange={(event) => setEditCode(event.target.value)}
                        className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-sm font-semibold">Title</span>
                      <input
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-sm font-semibold">Discount %</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={editDiscountPercent}
                        onChange={(event) => setEditDiscountPercent(Number(event.target.value))}
                        className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold shadow-soft">
                      <input type="checkbox" checked={editIsActive} onChange={(event) => setEditIsActive(event.target.checked)} />
                      Active
                    </label>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={cancelEdit} disabled={busy}>
                      Cancel edit
                    </Button>
                    <Button type="button" onClick={() => confirmEdit(row)} disabled={busy}>
                      Save promo code
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <ConfirmActionModal
        open={Boolean(confirmState)}
        title={confirmState?.mode === 'delete' ? 'Delete private coaching promo code?' : 'Confirm private coaching promo code'}
        description="Please review this private code before applying the change."
        confirmLabel={confirmState?.mode === 'delete' ? 'Confirm delete' : 'Confirm & save'}
        pendingLabel="Saving…"
        pending={busy}
        tone={confirmState?.mode === 'delete' ? 'destructive' : 'default'}
        summaryItems={summaryItems(confirmState)}
        warning="Existing private coaching requests keep their saved discount snapshot. New requests will use the current active code settings."
        onCancel={() => {
          if (!busy) setConfirmState(null)
        }}
        onConfirm={runConfirmedAction}
      />
    </div>
  )
}
