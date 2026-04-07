'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

type EditableStatus = 'draft' | 'ordered' | 'canceled'
type Status = EditableStatus | 'partially_received' | 'received'

const EDITABLE_STATUS_OPTIONS: Array<{ value: EditableStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'canceled', label: 'Canceled' },
]

export default function SupplierOrderHeaderEditor({
  id,
  reference,
  supplierName,
  expectedAt,
  notes,
  status,
}: {
  id: string
  reference: string | null
  supplierName: string | null
  expectedAt: string | null
  notes: string | null
  status: Status
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

  async function save() {
    if (!dirty || busy) return
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

  return (
    <div className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <Input label="Supplier" value={nextSupplierName} onChange={(e) => setNextSupplierName(e.target.value)} disabled={busy} />
        <Input label="Reference" value={nextReference} onChange={(e) => setNextReference(e.target.value)} disabled={busy} />
        <Input label="Expected date" type="date" value={nextExpectedAt} onChange={(e) => setNextExpectedAt(e.target.value)} disabled={busy} />
        {statusEditable ? (
          <Select label="Status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as EditableStatus)} disabled={busy}>
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

      <Input label="Notes" value={nextNotes} onChange={(e) => setNextNotes(e.target.value)} disabled={busy} />

      {feedback.msg ? <InlineAlert variant={feedback.kind === 'error' ? 'error' : 'success'}>{feedback.msg}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save header'}
        </Button>
      </div>
    </div>
  )
}
