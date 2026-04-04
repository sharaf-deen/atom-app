'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Modal from '@/components/ui/Modal'
import SaveButton from '@/components/forms/SaveButton'
import { useSafeSubmit } from '@/lib/forms/useSafeSubmit'

export type ExpenseRow = {
  id: string
  date: string
  category_key: string | null
  description: string | null
  amount: number
  payment_method?: string | null
  receipt_path?: string | null
  receipt_mime?: string | null
  receipt_filename?: string | null
}

type Props = {
  expenses: ExpenseRow[]
  labelByKey: Record<string, string>
  returnQueryString?: string
}

type EditableExpense = {
  id: string
  date: string
  category_key: string
  description: string
  amount: string
  payment_method: string
}

function formatEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(safe)
}

function isImageReceipt(mime?: string | null, path?: string | null) {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return true
  const p = (path || '').toLowerCase()
  return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.gif')
}

function paymentLabel(v?: string | null) {
  const s = (v || '').trim()
  if (!s) return '—'
  if (s === 'cash') return 'Cash'
  if (s === 'visa') return 'Visa card'
  if (s === 'instapay') return 'Instapay'
  if (s === 'bank_transfer') return 'Bank transfer'
  return s.replaceAll('_', ' ')
}

function paymentBadgeClass(v?: string | null) {
  const s = (v || '').trim()
  if (s === 'cash') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (s === 'visa') return 'bg-violet-50 text-violet-700 border-violet-200'
  if (s === 'instapay') return 'bg-sky-50 text-sky-700 border-sky-200'
  if (s === 'bank_transfer') return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-[hsl(var(--bg))] text-[hsl(var(--muted))] border-[hsl(var(--border))]'
}

function receiptUrl(id: string) {
  return `/api/expenses/${id}/receipt`
}

function redirectHref(returnQueryString?: string, patch?: Record<string, string>) {
  const sp = new URLSearchParams(returnQueryString || '')
  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!value) sp.delete(key)
      else sp.set(key, value)
    }
  }
  const s = sp.toString()
  return s ? `/expenses?${s}` : '/expenses'
}

function parseErrorMessage(data: any, fallback: string) {
  return data?.details || data?.error || fallback
}

export default function ExpensesTableClient({ expenses, labelByKey, returnQueryString = '' }: Props) {
  const router = useRouter()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [active, setActive] = useState<
    | null
    | {
        id: string
        url: string
        filename?: string | null
        mime?: string | null
        path?: string | null
      }
  >(null)
  const [editing, setEditing] = useState<EditableExpense | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<ExpenseRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { submit: submitEdit, isPending: saving } = useSafeSubmit({
    action: async () => {
      if (!editing) return { ok: false as const, message: 'No expense selected.' }

      const amount = Number(editing.amount)
      if (!editing.category_key) {
        return { ok: false as const, message: 'Please choose a category.' }
      }
      if (!Number.isFinite(amount)) {
        return { ok: false as const, message: 'Invalid amount.' }
      }

      const res = await fetch(`/api/expenses/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editing.date,
          category_key: editing.category_key,
          description: editing.description.trim() || null,
          amount,
          payment_method: editing.payment_method,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          ok: false as const,
          message: parseErrorMessage(data, 'Update failed.'),
        }
      }

      return {
        ok: true as const,
        message: 'Expense updated',
        refresh: false,
      }
    },
    defaultSuccessMessage: 'Expense updated',
    defaultErrorMessage: 'Update failed.',
    onSuccess: async () => {
      const href = redirectHref(returnQueryString, { updated: '1', deleted: '', saved: '' })
      setEditOpen(false)
      router.replace(href)
      router.refresh()
    },
  })

  const activeIsImage = useMemo(() => {
    if (!active) return false
    return isImageReceipt(active.mime, active.path)
  }, [active])

  function openPreview(e: ExpenseRow) {
    setActive({
      id: e.id,
      url: receiptUrl(e.id),
      filename: e.receipt_filename,
      mime: e.receipt_mime,
      path: e.receipt_path,
    })
    setPreviewOpen(true)
  }

  function openEdit(e: ExpenseRow) {
    setEditing({
      id: e.id,
      date: e.date,
      category_key: e.category_key || '',
      description: e.description || '',
      amount: String(e.amount ?? ''),
      payment_method: e.payment_method || 'cash',
    })
    setEditOpen(true)
  }

  function openDelete(e: ExpenseRow) {
    setDeletingExpense(e)
    setDeleteOpen(true)
  }

  async function onSaveEdit() {
    await submitEdit()
  }

  async function onDeleteExpense() {
    if (!deletingExpense) return

    try {
      setDeleting(true)
      const res = await fetch(`/api/expenses/${deletingExpense.id}`, {
        method: 'DELETE',
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(parseErrorMessage(data, 'Delete failed.'))

      toast.success('Expense deleted')
      const href = redirectHref(returnQueryString, { deleted: '1', updated: '', saved: '' })
      router.push(href)
      router.refresh()
      setDeleteOpen(false)
    } catch (error: any) {
      toast.error(error?.message || 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {expenses.length > 0 ? (
        <>
          <div className="space-y-3 md:hidden">
            {expenses.map((e) => {
              const categoryLabel = e.category_key ? labelByKey[e.category_key] ?? e.category_key : '—'
              const hasReceipt = Boolean(e.receipt_path)
              return (
                <div key={e.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">{e.date}</div>
                      <div className="mt-1 font-semibold">{categoryLabel}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">{formatEGP(e.amount)}</div>
                      <span className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentBadgeClass(e.payment_method)}`}>
                        {paymentLabel(e.payment_method)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-[hsl(var(--muted))]">
                    {e.description?.trim() ? e.description : 'No description'}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {hasReceipt ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openPreview(e)}
                          className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                        >
                          View receipt
                        </button>
                        <a
                          href={receiptUrl(e.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                        >
                          Open receipt
                        </a>
                      </>
                    ) : (
                      <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-[11px] font-medium text-[hsl(var(--muted))]">
                        No receipt
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(e)}
                        className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openDelete(e)}
                        className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-left">
                  <th className="py-3 pr-3 font-semibold">Date</th>
                  <th className="py-3 pr-3 font-semibold">Category</th>
                  <th className="py-3 pr-3 font-semibold">Description</th>
                  <th className="py-3 pr-3 font-semibold">Payment</th>
                  <th className="py-3 pr-3 font-semibold">Receipt</th>
                  <th className="py-3 pr-3 font-semibold">Actions</th>
                  <th className="py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const categoryLabel = e.category_key ? labelByKey[e.category_key] ?? e.category_key : '—'
                  const hasReceipt = Boolean(e.receipt_path)
                  return (
                    <tr key={e.id} className="border-b border-[hsl(var(--border))]/60 align-top">
                      <td className="py-3 pr-3 whitespace-nowrap">{e.date}</td>
                      <td className="py-3 pr-3 font-medium">{categoryLabel}</td>
                      <td className="py-3 pr-3 text-[hsl(var(--muted))] max-w-[24rem]">
                        <div className="line-clamp-2">{e.description?.trim() ? e.description : 'No description'}</div>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentBadgeClass(e.payment_method)}`}>
                          {paymentLabel(e.payment_method)}
                        </span>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        {hasReceipt ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openPreview(e)}
                              className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                            >
                              View
                            </button>
                            <a
                              href={receiptUrl(e.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                            >
                              Open
                            </a>
                          </div>
                        ) : (
                          <span className="text-[hsl(var(--muted))]">No receipt</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(e)}
                            className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openDelete(e)}
                            className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                      <td className="py-3 text-right text-base font-semibold whitespace-nowrap">{formatEGP(e.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={active?.filename ? `Receipt · ${active.filename}` : 'Receipt'}
        className="w-[min(95vw,56rem)]"
      >
        {!active ? null : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[hsl(var(--muted))] truncate">{active.filename || active.url}</div>
              <div className="flex items-center gap-2">
                <a
                  href={active.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline"
                  title="Open in new tab"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-xl border border-[hsl(var(--border))] px-3 py-1 text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            {activeIsImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.url}
                alt={active.filename ? `Receipt ${active.filename}` : 'Receipt'}
                className="w-full max-h-[70vh] object-contain rounded-xl border border-[hsl(var(--border))]"
              />
            ) : (
              <iframe
                src={active.url}
                title="Receipt PDF"
                className="w-full h-[70vh] rounded-xl border border-[hsl(var(--border))]"
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title="Edit expense"
        className="w-[min(95vw,40rem)]"
      >
        {!editing ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Date</span>
                <input
                  type="date"
                  value={editing.date}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, date: e.target.value } : cur))}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment method</span>
                <select
                  value={editing.payment_method}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, payment_method: e.target.value } : cur))}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="cash">Cash</option>
                  <option value="visa">Visa card</option>
                  <option value="instapay">Instapay</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">Category</span>
                <select
                  value={editing.category_key}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, category_key: e.target.value } : cur))}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Choose…</option>
                  {Object.entries(labelByKey).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount (EGP)</span>
                <input
                  type="number"
                  step="0.01"
                  value={editing.amount}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, amount: e.target.value } : cur))}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">Description</span>
                <input
                  value={editing.description}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, description: e.target.value } : cur))}
                  placeholder="Optional note…"
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                disabled={saving}
                className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80 disabled:opacity-60"
              >
                Cancel
              </button>
              <SaveButton
                type="button"
                onClick={onSaveEdit}
                loading={saving}
                idleLabel="Save changes"
                pendingLabel="Saving..."
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="Delete expense"
      >
        {!deletingExpense ? null : (
          <div className="space-y-4">
            <p className="text-sm text-[hsl(var(--muted))]">
              This will permanently delete the expense on <span className="font-medium text-[hsl(var(--fg))]">{deletingExpense.date}</span>{' '}
              for <span className="font-medium text-[hsl(var(--fg))]">{formatEGP(deletingExpense.amount)}</span>.
            </p>
            <p className="text-sm text-[hsl(var(--muted))]">The linked receipt will also be removed when possible.</p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDeleteExpense}
                disabled={deleting}
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete expense'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
