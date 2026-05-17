'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Modal from '@/components/ui/Modal'
import SaveButton from '@/components/forms/SaveButton'
import { useSafeSubmit } from '@/lib/forms/useSafeSubmit'
import { formatCurrency, toPriceString } from '@/lib/money'

export type StoreExpenseRow = {
  id: string
  expense_date: string
  category: string | null
  title: string | null
  amount_cents: number | null
  currency: string | null
  payment_method: string | null
  supplier_order_id: string | null
  supplier_order_reference?: string | null
  supplier_order_supplier_name?: string | null
  supplier_order_status?: string | null
  vendor_name: string | null
  note: string | null
  attachment_path: string | null
  attachment_mime: string | null
  attachment_filename: string | null
  created_at: string | null
  updated_at: string | null
}

type Option = { value: string; label: string }

type Props = {
  expenses: StoreExpenseRow[]
  categories: Option[]
  paymentMethods: Option[]
  supplierOrders: Array<Option & { supplierName?: string | null; totalCents?: number | null }>
  canManage: boolean
  returnQueryString?: string
  focusExpenseId?: string
}

type EditableExpense = {
  id: string
  expense_date: string
  category: string
  title: string
  amount: string
  payment_method: string
  supplier_order_id: string
  vendor_name: string
  note: string
}

function categoryLabel(categories: Option[], value?: string | null) {
  return categories.find((item) => item.value === value)?.label ?? value ?? '—'
}

function paymentLabel(paymentMethods: Option[], value?: string | null) {
  return paymentMethods.find((item) => item.value === value)?.label ?? value?.replaceAll('_', ' ') ?? '—'
}

function supplierOrderDisplay(expense: StoreExpenseRow) {
  if (!expense.supplier_order_id) return ''
  const ref = expense.supplier_order_reference?.trim() || `Order ${expense.supplier_order_id.slice(0, 8)}`
  const supplier = expense.supplier_order_supplier_name?.trim() || 'Supplier'
  return `${ref} · ${supplier}`
}

function supplierStatusLabel(status?: string | null) {
  return status?.replaceAll('_', ' ') || 'linked'
}

function paymentBadgeClass(value?: string | null) {
  const method = String(value || '')
  if (method === 'cash') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (method === 'card') return 'border-violet-200 bg-violet-50 text-violet-700'
  if (method === 'instapay') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (method === 'bank_transfer') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function isImageAttachment(mime?: string | null, path?: string | null) {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return true
  const p = (path || '').toLowerCase()
  return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.gif')
}

function attachmentUrl(id: string) {
  return `/api/admin/store/expenses/${id}/attachment`
}

function redirectHref(returnQueryString?: string, patch?: Record<string, string>) {
  const search = new URLSearchParams(returnQueryString || '')
  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!value) search.delete(key)
      else search.set(key, value)
    }
  }
  const qs = search.toString()
  return qs ? `/admin/store/expenses?${qs}` : '/admin/store/expenses'
}

function parseErrorMessage(data: any, fallback: string) {
  return data?.details || data?.error || fallback
}

export default function StoreExpensesTableClient({
  expenses,
  categories,
  paymentMethods,
  supplierOrders,
  canManage,
  returnQueryString = '',
  focusExpenseId = '',
}: Props) {
  const router = useRouter()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [activeAttachment, setActiveAttachment] = useState<{
    id: string
    url: string
    filename?: string | null
    mime?: string | null
    path?: string | null
  } | null>(null)
  const [editing, setEditing] = useState<EditableExpense | null>(null)
  const [editingFile, setEditingFile] = useState<File | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<StoreExpenseRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { submit: submitEdit, isPending: saving } = useSafeSubmit({
    action: async () => {
      if (!editing) return { ok: false as const, message: 'No expense selected.' }

      const form = new FormData()
      form.set('expense_date', editing.expense_date)
      form.set('category', editing.category)
      form.set('title', editing.title)
      form.set('amount', editing.amount)
      form.set('payment_method', editing.payment_method)
      form.set('supplier_order_id', editing.supplier_order_id)
      form.set('vendor_name', editing.vendor_name)
      form.set('note', editing.note)
      if (editingFile) form.set('attachment', editingFile)

      const res = await fetch(`/api/admin/store/expenses/${editing.id}`, {
        method: 'PATCH',
        body: form,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false as const, message: parseErrorMessage(data, 'Update failed.') }
      }

      return { ok: true as const, message: 'Store expense updated', refresh: false }
    },
    defaultSuccessMessage: 'Store expense updated',
    defaultErrorMessage: 'Update failed.',
    onSuccess: async () => {
      const href = redirectHref(returnQueryString, { updated: '1', deleted: '', saved: '', error: '' })
      setEditOpen(false)
      setEditingFile(null)
      router.replace(href)
      router.refresh()
    },
  })

  useEffect(() => {
    const id = focusExpenseId.trim()
    if (!id) return

    let attempts = 0
    let timer: number | null = null

    const run = () => {
      attempts += 1
      const el = document.getElementById(`store-expense-${id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      if (attempts < 12) timer = window.setTimeout(run, 180)
    }

    timer = window.setTimeout(run, 500)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [focusExpenseId, expenses])

  const activeIsImage = useMemo(() => {
    if (!activeAttachment) return false
    return isImageAttachment(activeAttachment.mime, activeAttachment.path)
  }, [activeAttachment])

  function openPreview(expense: StoreExpenseRow) {
    setActiveAttachment({
      id: expense.id,
      url: attachmentUrl(expense.id),
      filename: expense.attachment_filename,
      mime: expense.attachment_mime,
      path: expense.attachment_path,
    })
    setPreviewOpen(true)
  }

  function openEdit(expense: StoreExpenseRow) {
    if (!canManage) return
    setEditing({
      id: expense.id,
      expense_date: expense.expense_date,
      category: expense.category || 'other',
      title: expense.title || '',
      amount: toPriceString(expense.amount_cents),
      payment_method: expense.payment_method || 'cash',
      supplier_order_id: expense.supplier_order_id || '',
      vendor_name: expense.vendor_name || '',
      note: expense.note || '',
    })
    setEditingFile(null)
    setEditOpen(true)
  }

  function openDelete(expense: StoreExpenseRow) {
    if (!canManage) return
    setDeletingExpense(expense)
    setDeleteOpen(true)
  }

  async function onSaveEdit() {
    await submitEdit()
  }

  async function onDeleteExpense() {
    if (!deletingExpense) return

    try {
      setDeleting(true)
      const res = await fetch(`/api/admin/store/expenses/${deletingExpense.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(parseErrorMessage(data, 'Delete failed.'))

      toast.success('Store expense deleted')
      const href = redirectHref(returnQueryString, { deleted: '1', updated: '', saved: '', error: '' })
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
      <div className="space-y-3 md:hidden">
        {expenses.map((expense) => {
          const hasAttachment = Boolean(expense.attachment_path)
          const linkedSupplierOrder = supplierOrderDisplay(expense)
          return (
            <div
              id={`store-expense-${expense.id}`}
              key={expense.id}
              className={`rounded-2xl border bg-white p-4 shadow-soft ${focusExpenseId === expense.id ? 'border-emerald-300 ring-2 ring-emerald-200/70 bg-emerald-50/30' : 'border-[hsl(var(--border))]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-[hsl(var(--muted))]">{expense.expense_date}</div>
                  <div className="mt-1 truncate font-semibold">{expense.title || 'Store expense'}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{categoryLabel(categories, expense.category)}</div>
                  {linkedSupplierOrder ? (
                    <div className="mt-1 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                      {linkedSupplierOrder}
                    </div>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">{formatCurrency(expense.amount_cents, 'en-EG', expense.currency || 'EGP')}</div>
                  <span className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentBadgeClass(expense.payment_method)}`}>
                    {paymentLabel(paymentMethods, expense.payment_method)}
                  </span>
                </div>
              </div>

              <div className="mt-3 text-sm text-[hsl(var(--muted))]">
                {expense.vendor_name ? `${expense.vendor_name} · ` : ''}{expense.note?.trim() ? expense.note : 'No note'}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {hasAttachment ? (
                  <>
                    <button type="button" onClick={() => openPreview(expense)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                      View attachment
                    </button>
                    <a href={attachmentUrl(expense.id)} target="_blank" rel="noreferrer" className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                      Open
                    </a>
                  </>
                ) : (
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-[11px] font-medium text-[hsl(var(--muted))]">No attachment</span>
                )}

                {canManage ? (
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={() => openEdit(expense)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                      Edit
                    </button>
                    <button type="button" onClick={() => openDelete(expense)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50">
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[hsl(var(--muted))]">
            <tr className="border-b border-[hsl(var(--border))]">
              <th className="py-3 pr-3 font-medium">Date</th>
              <th className="py-3 pr-3 font-medium">Expense</th>
              <th className="py-3 pr-3 font-medium">Category</th>
              <th className="py-3 pr-3 font-medium">Supplier order</th>
              <th className="py-3 pr-3 font-medium">Payment</th>
              <th className="py-3 pr-3 text-right font-medium">Amount</th>
              <th className="py-3 pr-3 font-medium">Attachment</th>
              {canManage ? <th className="py-3 text-right font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => {
              const hasAttachment = Boolean(expense.attachment_path)
              const linkedSupplierOrder = supplierOrderDisplay(expense)
              return (
                <tr id={`store-expense-${expense.id}`} key={expense.id} className={`border-b border-[hsl(var(--border))] align-top ${focusExpenseId === expense.id ? 'bg-emerald-50/50' : ''}`}>
                  <td className="py-3 pr-3 whitespace-nowrap">{expense.expense_date}</td>
                  <td className="py-3 pr-3">
                    <div className="font-medium">{expense.title || 'Store expense'}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">
                      {expense.vendor_name ? `${expense.vendor_name} · ` : ''}{expense.note?.trim() ? expense.note : 'No note'}
                    </div>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">{categoryLabel(categories, expense.category)}</td>
                  <td className="py-3 pr-3">
                    {linkedSupplierOrder ? (
                      <div>
                        <div className="text-xs font-medium">{linkedSupplierOrder}</div>
                        <div className="mt-0.5 text-[11px] text-[hsl(var(--muted))]">{supplierStatusLabel(expense.supplier_order_status)}</div>
                      </div>
                    ) : <span className="text-xs text-[hsl(var(--muted))]">—</span>}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentBadgeClass(expense.payment_method)}`}>
                      {paymentLabel(paymentMethods, expense.payment_method)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right font-semibold whitespace-nowrap">{formatCurrency(expense.amount_cents, 'en-EG', expense.currency || 'EGP')}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {hasAttachment ? (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openPreview(expense)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                          View
                        </button>
                        <a href={attachmentUrl(expense.id)} target="_blank" rel="noreferrer" className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                          Open
                        </a>
                      </div>
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted))]">—</span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openEdit(expense)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                          Edit
                        </button>
                        <button type="button" onClick={() => openDelete(expense)} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Attachment" className="max-h-[88vh] overflow-y-auto">
        {!activeAttachment ? null : activeIsImage ? (
          <div className="space-y-3">
            <img src={activeAttachment.url} alt={activeAttachment.filename || 'Store expense attachment'} className="max-h-[65vh] w-full rounded-xl object-contain" />
            <a href={activeAttachment.url} target="_blank" rel="noreferrer" className="inline-flex rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              Open full size
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[hsl(var(--muted))]">PDF attachment: {activeAttachment.filename || 'attachment'}</p>
            <a href={activeAttachment.url} target="_blank" rel="noreferrer" className="inline-flex rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
              Open PDF
            </a>
          </div>
        )}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit store expense" className="max-h-[88vh] overflow-y-auto">
        {editing ? (
          <div className="grid gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Date</span>
              <input type="date" value={editing.expense_date} onChange={(event) => setEditing({ ...editing, expense_date: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Title</span>
              <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount (EGP)</span>
                <input type="number" min="0" step="0.01" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment</span>
                <select value={editing.payment_method} onChange={(event) => setEditing({ ...editing, payment_method: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Related supplier order</span>
              <select value={editing.supplier_order_id} onChange={(event) => setEditing({ ...editing, supplier_order_id: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">No supplier order link</option>
                {supplierOrders.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Optional accounting link only. It does not update stock or supplier order status.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Vendor / supplier</span>
              <input value={editing.vendor_name} onChange={(event) => setEditing({ ...editing, vendor_name: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Note</span>
              <textarea value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} rows={3} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Add / replace attachment</span>
              <input type="file" accept="image/*,application/pdf" onChange={(event) => setEditingFile(event.target.files?.[0] || null)} className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-white" />
              <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Leave empty to keep the current attachment.</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditOpen(false)} className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Cancel
              </button>
              <SaveButton type="button" loading={saving} pendingLabel="Saving…" idleLabel="Save changes" onClick={onSaveEdit} />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete store expense">
        {deletingExpense ? (
          <div className="space-y-4">
            <p className="text-sm text-[hsl(var(--muted))]">
              This will remove the expense from the active Store accounting view, but keep the row as a soft-deleted audit record.
            </p>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3 text-sm">
              <div className="font-semibold">{deletingExpense.title || 'Store expense'}</div>
              <div className="text-[hsl(var(--muted))]">{deletingExpense.expense_date} · {formatCurrency(deletingExpense.amount_cents, 'en-EG', deletingExpense.currency || 'EGP')}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteOpen(false)} className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Cancel
              </button>
              <button type="button" disabled={deleting} onClick={onDeleteExpense} className="rounded-xl border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
