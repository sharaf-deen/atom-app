// src/components/SubscriptionManageRowActions.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

type SubscriptionRow = {
  id: string
  subscription_type: 'time' | 'sessions' | null
  plan: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  sessions_total: number | null
  sessions_used: number | null
  amount: number | null
  paid_at: string | null
}

function isISODateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export default function SubscriptionManageRowActions({ sub }: { sub: SubscriptionRow }) {
  const router = useRouter()
  const [openEdit, setOpenEdit] = useState(false)
  const [openFreeze, setOpenFreeze] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editStatus, setEditStatus] = useState(sub.status ?? 'active')
  const [editStart, setEditStart] = useState(sub.start_date ?? '')
  const [editEnd, setEditEnd] = useState(sub.end_date ?? '')
  const [editAmount, setEditAmount] = useState(String(sub.amount ?? 0))
  const [editSessionsTotal, setEditSessionsTotal] = useState(String(sub.sessions_total ?? 0))

  const [freezeDays, setFreezeDays] = useState('7')

  const statusOptions = useMemo(
    () => [
      { label: 'Active', value: 'active' },
      { label: 'Expired', value: 'expired' },
      // “Freeze” = suspended (blocks access)
      { label: 'Frozen (suspended)', value: 'suspended' },
    ],
    [],
  )

  async function callJson(url: string, payload: any) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.details || data?.error || 'Request failed'
      throw new Error(msg)
    }
    return data
  }

  async function onSaveEdit() {
    if (busy) return

    // Basic validations
    if (editStart && !isISODateOnly(editStart)) {
      toast.error('Start date must be YYYY-MM-DD')
      return
    }
    if (editEnd && !isISODateOnly(editEnd)) {
      toast.error('End date must be YYYY-MM-DD')
      return
    }
    const amountNum = Number(editAmount)
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error('Amount must be a positive number')
      return
    }
    const sessionsTotalNum = Number(editSessionsTotal)
    if (sub.subscription_type === 'sessions') {
      if (!Number.isFinite(sessionsTotalNum) || sessionsTotalNum < 0) {
        toast.error('Sessions total must be a positive number')
        return
      }
    }

    setBusy(true)
    try {
      await callJson('/api/subscriptions/update', {
        id: sub.id,
        patch: {
          status: editStatus,
          start_date: editStart || null,
          end_date: editEnd || null,
          amount: amountNum,
          sessions_total: sub.subscription_type === 'sessions' ? sessionsTotalNum : null,
        },
      })
      toast.success('Subscription updated')
      setOpenEdit(false)
      router.refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function onFreeze() {
    if (busy) return
    const d = Number(freezeDays)
    if (!Number.isFinite(d) || d <= 0 || d > 3650) {
      toast.error('Freeze days must be between 1 and 3650')
      return
    }

    setBusy(true)
    try {
      await callJson('/api/subscriptions/freeze', { id: sub.id, days: d })
      toast.success('Subscription frozen')
      setOpenFreeze(false)
      router.refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Freeze failed')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (busy) return
    if (!confirm('Delete this subscription? This cannot be undone.')) return

    setBusy(true)
    try {
      await callJson('/api/subscriptions/delete', { id: sub.id })
      toast.success('Subscription deleted')
      router.refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setOpenEdit(true)} disabled={busy}>
        Edit
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpenFreeze(true)} disabled={busy}>
        Freeze
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy} className="text-rose-700">
        Delete
      </Button>

      {/* Edit modal */}
      {openEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-white shadow-soft">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
              <div className="font-semibold">Edit subscription</div>
              <Button size="sm" variant="ghost" onClick={() => setOpenEdit(false)}>
                Close
              </Button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm font-medium mb-1">Status</div>
                  <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    {statusOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Amount</div>
                  <Input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="Amount" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm font-medium mb-1">Start date</div>
                  <Input value={editStart} onChange={(e) => setEditStart(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">End date</div>
                  <Input value={editEnd} onChange={(e) => setEditEnd(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
              </div>

              {sub.subscription_type === 'sessions' ? (
                <div>
                  <div className="text-sm font-medium mb-1">Sessions total</div>
                  <Input
                    value={editSessionsTotal}
                    onChange={(e) => setEditSessionsTotal(e.target.value)}
                    placeholder="Total sessions"
                  />
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
              <Button size="sm" variant="ghost" onClick={() => setOpenEdit(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSaveEdit} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Freeze modal */}
      {openFreeze && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-white shadow-soft">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
              <div className="font-semibold">Freeze subscription</div>
              <Button size="sm" variant="ghost" onClick={() => setOpenFreeze(false)}>
                Close
              </Button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-[hsl(var(--muted))]">
                Freezing will block access immediately and extend the end date by the same number of days.
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Number of days</div>
                <Input value={freezeDays} onChange={(e) => setFreezeDays(e.target.value)} placeholder="e.g. 7" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))]">
              <Button size="sm" variant="ghost" onClick={() => setOpenFreeze(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={onFreeze} disabled={busy}>
                {busy ? 'Freezing…' : 'Freeze'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
