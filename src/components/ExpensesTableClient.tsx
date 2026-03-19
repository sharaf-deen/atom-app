'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

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

export default function ExpensesTableClient({ expenses, labelByKey }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
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
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<EditableExpense | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const activeIsImage = useMemo(() => {
    if (!active) return false
    return isImageReceipt(active.mime, active.path)
  }, [active])

  const categoryOptions = useMemo(() => {
    return Object.entries(labelByKey)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }))
  }, [labelByKey])

  function openPreview(e: ExpenseRow) {
    const url = `/api/expenses/${e.id}/receipt`
    setActive({ id: e.id, url, filename: e.receipt_filename, mime: e.receipt_mime, path: e.receipt_path })
    setOpen(true)
  }

  function close() {
    setOpen(false)
    // keep active to avoid iframe reload flicker if reopened quickly
  }

  function openEdit(e: ExpenseRow) {
    setEditing({
      id: e.id,
      date: e.date,
      category_key: e.category_key ?? '',
      description: e.description ?? '',
      amount: String(Number.isFinite(e.amount) ? e.amount : 0),
      payment_method: e.payment_method ?? 'cash',
    })
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!editing) return
    setSaving(true)
    try {
      const r = await fetch(`/api/expenses/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editing.date,
          category_key: editing.category_key,
          description: editing.description,
          amount: Number(editing.amount),
          payment_method: editing.payment_method,
        }),
      })

      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(data?.details || data?.error || 'Failed to update expense.')
      }

      toast.success('Expense updated.')
      setEditOpen(false)
      router.refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update expense.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteExpense(e: ExpenseRow) {
    const ok = window.confirm('Delete this expense permanently?')
    if (!ok) return

    setDeletingId(e.id)
    try {
      const r = await fetch(`/api/expenses/${e.id}`, { method: 'DELETE' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(data?.details || data?.error || 'Failed to delete expense.')
      }

      toast.success('Expense deleted.')
      router.refresh()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete expense.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      {expenses.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted))]">No expenses in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[hsl(var(--border))]">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">Receipt</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 pl-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-[hsl(var(--border))]/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{e.date}</td>
                  <td className="py-2 pr-3">
                    {e.category_key ? labelByKey[e.category_key] ?? e.category_key : '—'}
                  </td>
                  <td className="py-2 pr-3 text-[hsl(var(--muted))]">{e.description ?? '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{paymentLabel(e.payment_method)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {e.receipt_path ? (
                      <div className="flex items-center gap-2">
                        {isImageReceipt(e.receipt_mime, e.receipt_path) ? (
                          <button
                            type="button"
                            onClick={() => openPreview(e)}
                            className="rounded-lg border border-[hsl(var(--border))] overflow-hidden h-8 w-8"
                            title="Preview receipt"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/expenses/${e.id}/receipt`}
                              alt={e.receipt_filename ? `Receipt ${e.receipt_filename}` : 'Receipt'}
                              className="h-8 w-8 object-cover"
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPreview(e)}
                            className="text-[11px] px-2 py-1 rounded-xl border border-[hsl(var(--border))] bg-white"
                            title="Preview receipt (PDF)"
                          >
                            PDF
                          </button>
                        )}

                        <button type="button" className="text-xs underline" onClick={() => openPreview(e)}>
                          Preview
                        </button>
                      </div>
                    ) : (
                      <span className="text-[hsl(var(--muted))]">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-medium whitespace-nowrap">{formatEGP(e.amount)}</td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(e)}
                        className="rounded-xl border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExpense(e)}
                        disabled={deletingId === e.id}
                        className="rounded-xl border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {deletingId === e.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
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
                  onClick={close}
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
      >
        {!editing ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Date</span>
                <Input
                  type="date"
                  value={editing.date}
                  onChange={(e) => setEditing((prev) => (prev ? { ...prev, date: e.target.value } : prev))}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Category</span>
                <Select
                  value={editing.category_key}
                  onChange={(e) => setEditing((prev) => (prev ? { ...prev, category_key: e.target.value } : prev))}
                >
                  <option value="">Choose…</option>
                  {categoryOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editing.amount}
                  onChange={(e) => setEditing((prev) => (prev ? { ...prev, amount: e.target.value } : prev))}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment method</span>
                <Select
                  value={editing.payment_method}
                  onChange={(e) => setEditing((prev) => (prev ? { ...prev, payment_method: e.target.value } : prev))}
                >
                  <option value="cash">Cash</option>
                  <option value="visa">Visa card</option>
                  <option value="instapay">Instapay</option>
                  <option value="bank_transfer">Bank transfer</option>
                </Select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Description</span>
              <textarea
                value={editing.description}
                onChange={(e) => setEditing((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                rows={3}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
              />
            </label>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submitEdit} loading={saving} loadingText="Saving…">
                Save changes
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
