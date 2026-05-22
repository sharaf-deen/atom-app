'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Modal from '@/components/ui/Modal'
import SaveButton from '@/components/forms/SaveButton'
import { useSafeSubmit } from '@/lib/forms/useSafeSubmit'
import { formatCurrency, toPriceString } from '@/lib/money'

export type StoreFundingRow = {
  id: string
  funding_date: string
  type: string | null
  title: string | null
  amount_cents: number | null
  currency: string | null
  payment_method: string | null
  source_name: string | null
  note: string | null
  attachment_path: string | null
  attachment_mime: string | null
  attachment_filename: string | null
  created_at: string | null
  updated_at: string | null
}

type Option = { value: string; label: string }

type Props = {
  fundingRows: StoreFundingRow[]
  fundingTypes: Option[]
  paymentMethods: Option[]
  canManage: boolean
  returnQueryString?: string
  focusFundingId?: string
}

type EditableFunding = {
  id: string
  funding_date: string
  type: string
  title: string
  amount: string
  payment_method: string
  source_name: string
  note: string
}

function typeLabel(types: Option[], value?: string | null) {
  return types.find((item) => item.value === value)?.label ?? value?.replaceAll('_', ' ') ?? '—'
}

function paymentLabel(paymentMethods: Option[], value?: string | null) {
  return paymentMethods.find((item) => item.value === value)?.label ?? value?.replaceAll('_', ' ') ?? '—'
}

function typeBadgeClass(value?: string | null) {
  if (value === 'loan_received') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'loan_repayment') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
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
  return `/api/admin/store/funding/${id}/attachment`
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
  return qs ? `/admin/store/funding?${qs}` : '/admin/store/funding'
}

function parseErrorMessage(data: any, fallback: string) {
  return data?.details || data?.error || fallback
}

function normalizeDecimalInput(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return raw

  let cleaned = raw.replace(/\s+/g, '').replace(/[^0-9.,-]/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(',', '.')
  }

  return cleaned
}

export default function StoreFundingTableClient({
  fundingRows,
  fundingTypes,
  paymentMethods,
  canManage,
  returnQueryString = '',
  focusFundingId = '',
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
  const [editing, setEditing] = useState<EditableFunding | null>(null)
  const [editingFile, setEditingFile] = useState<File | null>(null)
  const [deletingFunding, setDeletingFunding] = useState<StoreFundingRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { submit: submitEdit, isPending: saving } = useSafeSubmit({
    action: async () => {
      if (!editing) return { ok: false as const, message: 'No funding entry selected.' }

      const form = new FormData()
      form.set('funding_date', editing.funding_date)
      form.set('type', editing.type)
      form.set('title', editing.title)
      form.set('amount', normalizeDecimalInput(editing.amount))
      form.set('payment_method', editing.payment_method)
      form.set('source_name', editing.source_name)
      form.set('note', editing.note)
      if (editingFile) form.set('attachment', editingFile)

      const res = await fetch(`/api/admin/store/funding/${editing.id}`, {
        method: 'PATCH',
        body: form,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false as const, message: parseErrorMessage(data, 'Update failed.') }
      }

      return { ok: true as const, message: 'Store funding updated', refresh: false }
    },
    defaultSuccessMessage: 'Store funding updated',
    defaultErrorMessage: 'Update failed.',
    onSuccess: async () => {
      const href = redirectHref(returnQueryString, { updated: '1', deleted: '', saved: '', error: '' })
      setEditOpen(false)
      setEditingFile(null)
      router.replace(href)
      router.refresh()
    },
  })

  const activeIsImage = useMemo(() => {
    if (!activeAttachment) return false
    return isImageAttachment(activeAttachment.mime, activeAttachment.path)
  }, [activeAttachment])

  function openPreview(row: StoreFundingRow) {
    setActiveAttachment({
      id: row.id,
      url: attachmentUrl(row.id),
      filename: row.attachment_filename,
      mime: row.attachment_mime,
      path: row.attachment_path,
    })
    setPreviewOpen(true)
  }

  function openEdit(row: StoreFundingRow) {
    if (!canManage) return
    setEditing({
      id: row.id,
      funding_date: row.funding_date,
      type: row.type || 'loan_received',
      title: row.title || '',
      amount: toPriceString(row.amount_cents),
      payment_method: row.payment_method || 'cash',
      source_name: row.source_name || '',
      note: row.note || '',
    })
    setEditingFile(null)
    setEditOpen(true)
  }

  function openDelete(row: StoreFundingRow) {
    if (!canManage) return
    setDeletingFunding(row)
    setDeleteOpen(true)
  }

  async function onSaveEdit() {
    await submitEdit()
  }

  async function onDeleteFunding() {
    if (!deletingFunding) return

    try {
      setDeleting(true)
      const res = await fetch(`/api/admin/store/funding/${deletingFunding.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(parseErrorMessage(data, 'Delete failed.'))

      toast.success('Store funding entry deleted')
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
        {fundingRows.map((row) => {
          const hasAttachment = Boolean(row.attachment_path)
          return (
            <div
              id={`store-funding-${row.id}`}
              key={row.id}
              className={`rounded-2xl border bg-white p-4 shadow-soft ${focusFundingId === row.id ? 'border-emerald-300 ring-2 ring-emerald-200/70 bg-emerald-50/30' : 'border-[hsl(var(--border))]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-[hsl(var(--muted))]">{row.funding_date}</div>
                  <div className="mt-1 truncate font-semibold">{row.title || 'Store funding'}</div>
                  <span className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${typeBadgeClass(row.type)}`}>
                    {typeLabel(fundingTypes, row.type)}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">{formatCurrency(row.amount_cents, 'en-EG', row.currency || 'EGP')}</div>
                  <span className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentBadgeClass(row.payment_method)}`}>
                    {paymentLabel(paymentMethods, row.payment_method)}
                  </span>
                </div>
              </div>

              <div className="mt-3 text-sm text-[hsl(var(--muted))]">
                {row.source_name ? `${row.source_name} · ` : ''}{row.note?.trim() ? row.note : 'No note'}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {hasAttachment ? (
                  <>
                    <button type="button" onClick={() => openPreview(row)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                      View attachment
                    </button>
                    <a href={attachmentUrl(row.id)} target="_blank" rel="noreferrer" className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                      Open
                    </a>
                  </>
                ) : (
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-[11px] font-medium text-[hsl(var(--muted))]">No attachment</span>
                )}

                {canManage ? (
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={() => openEdit(row)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                      Edit
                    </button>
                    <button type="button" onClick={() => openDelete(row)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50">
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
              <th className="py-3 pr-3 font-medium">Entry</th>
              <th className="py-3 pr-3 font-medium">Type</th>
              <th className="py-3 pr-3 font-medium">Payment</th>
              <th className="py-3 pr-3 text-right font-medium">Amount</th>
              <th className="py-3 pr-3 font-medium">Attachment</th>
              {canManage ? <th className="py-3 text-right font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {fundingRows.map((row) => {
              const hasAttachment = Boolean(row.attachment_path)
              return (
                <tr id={`store-funding-${row.id}`} key={row.id} className={`border-b border-[hsl(var(--border))] align-top ${focusFundingId === row.id ? 'bg-emerald-50/50' : ''}`}>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.funding_date}</td>
                  <td className="py-3 pr-3">
                    <div className="font-medium">{row.title || 'Store funding'}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">
                      {row.source_name ? `${row.source_name} · ` : ''}{row.note?.trim() ? row.note : 'No note'}
                    </div>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${typeBadgeClass(row.type)}`}>
                      {typeLabel(fundingTypes, row.type)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${paymentBadgeClass(row.payment_method)}`}>
                      {paymentLabel(paymentMethods, row.payment_method)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right font-semibold whitespace-nowrap">{formatCurrency(row.amount_cents, 'en-EG', row.currency || 'EGP')}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {hasAttachment ? (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openPreview(row)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                          View
                        </button>
                        <a href={attachmentUrl(row.id)} target="_blank" rel="noreferrer" className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
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
                        <button type="button" onClick={() => openEdit(row)} className="rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--bg))]/80">
                          Edit
                        </button>
                        <button type="button" onClick={() => openDelete(row)} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">
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
            <img src={activeAttachment.url} alt={activeAttachment.filename || 'Store funding attachment'} className="max-h-[65vh] w-full rounded-xl object-contain" />
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

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit store funding" className="max-h-[88vh] overflow-y-auto">
        {editing ? (
          <div className="grid gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Date</span>
              <input type="date" value={editing.funding_date} onChange={(event) => setEditing({ ...editing, funding_date: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Type</span>
              <select value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {fundingTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Title</span>
              <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Amount (EGP)</span>
                <input type="text" inputMode="decimal" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: event.target.value })} placeholder="17264.00" className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Payment</span>
                <select value={editing.payment_method} onChange={(event) => setEditing({ ...editing, payment_method: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Source / lender</span>
              <input value={editing.source_name} onChange={(event) => setEditing({ ...editing, source_name: event.target.value })} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
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

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete store funding">
        {deletingFunding ? (
          <div className="space-y-4">
            <p className="text-sm text-[hsl(var(--muted))]">
              This will remove the funding entry from the active Store accounting view, but keep the row as a soft-deleted audit record.
            </p>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/50 p-3 text-sm">
              <div className="font-semibold">{deletingFunding.title || 'Store funding'}</div>
              <div className="text-[hsl(var(--muted))]">{deletingFunding.funding_date} · {formatCurrency(deletingFunding.amount_cents, 'en-EG', deletingFunding.currency || 'EGP')}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteOpen(false)} className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--bg))]/80">
                Cancel
              </button>
              <button type="button" disabled={deleting} onClick={onDeleteFunding} className="rounded-xl border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
