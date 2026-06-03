'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

type EditableStatus = 'draft' | 'ordered' | 'canceled'
type Status = EditableStatus | 'partially_received' | 'received'
type ConfirmMode = 'save' | 'delete' | null

const EDITABLE_STATUS_OPTIONS: Array<{ value: EditableStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'canceled', label: 'Canceled' },
]

function statusLabel(value: Status | EditableStatus | null | undefined) {
  if (!value) return '—'
  return EDITABLE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value.replaceAll('_', ' ')
}

function changedValue(previousValue: string | null | undefined, nextValue: string | null | undefined) {
  const previous = String(previousValue ?? '').trim()
  const next = String(nextValue ?? '').trim()
  if (previous === next) return next || '—'
  return `${previous || '—'} → ${next || '—'}`
}

export default function SupplierOrderHeaderEditor({
  id,
  reference,
  supplierName,
  expectedAt,
  notes,
  status,
  canDelete = true,
  deleteBlockedReason,
}: {
  id: string
  reference: string | null
  supplierName: string | null
  expectedAt: string | null
  notes: string | null
  status: Status
  canDelete?: boolean
  deleteBlockedReason?: string | null
}) {
  const router = useRouter()
  const [nextReference, setNextReference] = useState(reference ?? '')
  const [nextSupplierName, setNextSupplierName] = useState(supplierName ?? '')
  const [nextExpectedAt, setNextExpectedAt] = useState(expectedAt ?? '')
  const [nextNotes, setNextNotes] = useState(notes ?? '')
  const [nextStatus, setNextStatus] = useState<EditableStatus>(
    status === 'draft' || status === 'ordered' || status === 'canceled' ? status : 'ordered'
  )
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null)
  const [feedback, setFeedback] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })

  const statusEditable = status === 'draft' || status === 'ordered' || status === 'canceled'
  const dirty = useMemo(
    () =>
      nextReference !== (reference ?? '') ||
      nextSupplierName !== (supplierName ?? '') ||
      nextExpectedAt !== (expectedAt ?? '') ||
      nextNotes !== (notes ?? '') ||
      (statusEditable && nextStatus !== status),
    [nextReference, reference, nextSupplierName, supplierName, nextExpectedAt, expectedAt, nextNotes, notes, nextStatus, statusEditable, status]
  )

  const saveSummaryItems = useMemo(
    () => [
      { label: 'Order ID', value: id.slice(0, 8) },
      { label: 'Supplier', value: changedValue(supplierName, nextSupplierName) },
      { label: 'Reference', value: changedValue(reference, nextReference) },
      { label: 'Expected date', value: changedValue(expectedAt, nextExpectedAt) },
      { label: 'Status', value: statusEditable ? `${statusLabel(status)} → ${statusLabel(nextStatus)}` : statusLabel(status) },
      { label: 'Notes', value: changedValue(notes, nextNotes) },
      { label: 'Stock impact', value: 'No stock movement from header changes.' },
      { label: 'Linked expenses', value: 'None automatic.' },
    ],
    [expectedAt, id, nextExpectedAt, nextNotes, nextReference, nextStatus, nextSupplierName, notes, reference, status, statusEditable, supplierName]
  )

  const deleteSummaryItems = useMemo(
    () => [
      { label: 'Order ID', value: id.slice(0, 8) },
      { label: 'Supplier', value: supplierName || '—' },
      { label: 'Reference', value: reference || '—' },
      { label: 'Expected date', value: expectedAt || '—' },
      { label: 'Status', value: statusLabel(status) },
      { label: 'Notes', value: notes || '—' },
      { label: 'Impact', value: 'The supplier order will be deleted only if the backend allows it.' },
    ],
    [expectedAt, id, notes, reference, status, supplierName]
  )

  function requestSave() {
    if (!dirty || busy || deleting) return
    if (!nextSupplierName.trim()) {
      setFeedback({ kind: 'error', msg: 'Supplier name is required.' })
      toast.error('Supplier name is required')
      return
    }

    setFeedback({ kind: '', msg: '' })
    setConfirmMode('save')
  }

  async function saveConfirmed() {
    if (!dirty || busy || deleting) return
    if (!nextSupplierName.trim()) {
      setFeedback({ kind: 'error', msg: 'Supplier name is required.' })
      toast.error('Supplier name is required')
      return
    }

    setBusy(true)
    setFeedback({ kind: '', msg: '' })

    try {
      const response = await fetch('/api/store/supplier-orders/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          reference: nextReference.trim() || null,
          supplier_name: nextSupplierName.trim(),
          expected_at: nextExpectedAt || null,
          notes: nextNotes.trim() || null,
          status: statusEditable ? nextStatus : undefined,
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        const message = json?.details || json?.error || 'Update failed'
        setFeedback({ kind: 'error', msg: message })
        toast.error('Supplier order update failed')
        return
      }

      setConfirmMode(null)
      setFeedback({ kind: 'success', msg: 'Supplier order updated.' })
      toast.success('Supplier order updated')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (error: any) {
      const message = String(error?.message || error)
      setFeedback({ kind: 'error', msg: message })
      toast.error('Supplier order update failed')
    } finally {
      setBusy(false)
    }
  }

  function requestDelete() {
    if (!canDelete || busy || deleting) return
    setFeedback({ kind: '', msg: '' })
    setConfirmMode('delete')
  }

  async function deleteConfirmed() {
    if (!canDelete || busy || deleting) return

    setDeleting(true)
    setFeedback({ kind: '', msg: '' })
    try {
      const response = await fetch(`/api/store/supplier-orders/delete?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        const message = json?.details || json?.error || 'Delete failed'
        setFeedback({ kind: 'error', msg: message })
        toast.error(message)
        return
      }

      setConfirmMode(null)
      toast.success('Supplier order deleted')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (error: any) {
      const message = String(error?.message || error)
      setFeedback({ kind: 'error', msg: message })
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <Input label="Supplier" value={nextSupplierName} onChange={(e) => setNextSupplierName(e.target.value)} disabled={busy || deleting} />
        <Input label="Reference" value={nextReference} onChange={(e) => setNextReference(e.target.value)} disabled={busy || deleting} />
        <Input label="Expected date" type="date" value={nextExpectedAt} onChange={(e) => setNextExpectedAt(e.target.value)} disabled={busy || deleting} />
        {statusEditable ? (
          <Select label="Status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as EditableStatus)} disabled={busy || deleting}>
            {EDITABLE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : (
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
            <div className="mb-1 text-xs text-[hsl(var(--muted))]">Status</div>
            <div className="font-medium">{status.replaceAll('_', ' ')}</div>
          </div>
        )}
      </div>

      <Input label="Notes" value={nextNotes} onChange={(e) => setNextNotes(e.target.value)} disabled={busy || deleting} />

      {deleteBlockedReason ? <InlineAlert compact variant="info">{deleteBlockedReason}</InlineAlert> : null}
      {feedback.msg ? <InlineAlert variant={feedback.kind === 'error' ? 'error' : 'success'}>{feedback.msg}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={requestSave} disabled={!dirty || busy || deleting} loading={busy} loadingText="Saving…">
          Save header
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={requestDelete}
          disabled={!canDelete || busy || deleting}
          loading={deleting}
          loadingText="Deleting…"
        >
          Delete order
        </Button>
      </div>

      <ConfirmActionModal
        open={confirmMode === 'save'}
        title="Confirm supplier order update"
        description="Please review the supplier order header changes before saving."
        confirmLabel="Confirm & save"
        pendingLabel="Saving…"
        pending={busy}
        summaryItems={saveSummaryItems}
        warning="This updates the supplier order header only. Stock is not changed by this action."
        onCancel={() => setConfirmMode(null)}
        onConfirm={saveConfirmed}
      />

      <ConfirmActionModal
        open={confirmMode === 'delete'}
        title="Delete supplier order?"
        description="Please review this supplier order before deleting it."
        confirmLabel="Confirm delete"
        pendingLabel="Deleting…"
        tone="destructive"
        pending={deleting}
        summaryItems={deleteSummaryItems}
        warning="This is a destructive action. Existing backend guards still decide if the order can be deleted."
        onCancel={() => setConfirmMode(null)}
        onConfirm={deleteConfirmed}
      />
    </div>
  )
}
