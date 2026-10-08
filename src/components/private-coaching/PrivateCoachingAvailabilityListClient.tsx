'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import { formatPrivateCoachingSlotTime, privateCoachingSlotStatusLabel } from '@/lib/privateCoaching'

type SlotRow = { id: string; coachName: string; slotDate: string; startTime: string; endTime: string; status: string; note: string | null; createdAt: string; isBackdated: boolean; assignedMemberName: string | null; assignedMemberMeta: string | null; backdatedReason: string | null }
type Props = { rows: SlotRow[] }
const VIEWS = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }] as const
function todayInputValue() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function isPastDate(value: string) { return value < todayInputValue() }
function formatDate(value: string) { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' }) }
function statusClass(status: string) { if (status === 'available') return 'border-emerald-200 bg-emerald-50 text-emerald-700'; if (status === 'booked') return 'border-blue-200 bg-blue-50 text-blue-700'; return 'border-slate-200 bg-slate-50 text-slate-700' }

export default function PrivateCoachingAvailabilityListClient({ rows }: Props) {
  const router = useRouter()
  const [view, setView] = React.useState<(typeof VIEWS)[number]['value']>('upcoming')
  const [confirmRow, setConfirmRow] = React.useState<SlotRow | null>(null)
  const [busyId, setBusyId] = React.useState('')
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })
  const filteredRows = React.useMemo(() => view === 'all' ? rows : view === 'past' ? rows.filter((row) => isPastDate(row.slotDate)) : rows.filter((row) => !isPastDate(row.slotDate)), [rows, view])
  const summaryItems: ConfirmActionSummaryItem[] = confirmRow ? [
    { label: 'Coach', value: confirmRow.coachName }, { label: 'Date', value: formatDate(confirmRow.slotDate) }, { label: 'Time', value: `${formatPrivateCoachingSlotTime(confirmRow.startTime)} - ${formatPrivateCoachingSlotTime(confirmRow.endTime)}` }, { label: 'Status', value: privateCoachingSlotStatusLabel(confirmRow.status) }, { label: 'Member', value: confirmRow.assignedMemberName || 'Open availability' }, { label: 'Note', value: confirmRow.note || '—' },
  ] : []

  async function cancelSlot() {
    if (!confirmRow) return
    setBusyId(confirmRow.id); setStatus({ kind: '', message: '' })
    try {
      const response = await fetch(`/api/private-coaching/slots/${encodeURIComponent(confirmRow.id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) { setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not cancel slot.' }); return }
      setConfirmRow(null); setStatus({ kind: 'success', message: 'Availability slot cancelled.' }); router.refresh()
    } catch (error: any) { setStatus({ kind: 'error', message: error?.message || 'Could not cancel slot.' }) } finally { setBusyId('') }
  }

  return <div className="space-y-4">
    {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}
    <div className="flex flex-col gap-3 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-2">{VIEWS.map((item) => <button key={item.value} type="button" onClick={() => setView(item.value)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${view === item.value ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))]'}`}>{item.label}</button>)}</div><div className="text-sm font-semibold text-[hsl(var(--muted))]">{filteredRows.length} slot(s)</div></div>
    {filteredRows.length ? <div className="grid gap-3">{filteredRows.map((row) => <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(row.status)}`}>{privateCoachingSlotStatusLabel(row.status)}</span>{row.isBackdated ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Past correction</span> : null}</div><div className="mt-3 font-semibold">{formatDate(row.slotDate)} · {formatPrivateCoachingSlotTime(row.startTime)} - {formatPrivateCoachingSlotTime(row.endTime)}</div><div className="mt-1 text-sm text-[hsl(var(--muted))]">{row.coachName}</div>{row.assignedMemberName ? <div className="mt-2 text-sm"><span className="font-semibold">{row.assignedMemberName}</span>{row.assignedMemberMeta ? <span className="text-[hsl(var(--muted))]"> · {row.assignedMemberMeta}</span> : null}</div> : null}{row.backdatedReason ? <div className="mt-2 text-sm text-amber-900">{row.backdatedReason}</div> : null}{row.note ? <div className="mt-2 text-sm text-[hsl(var(--muted))]">{row.note}</div> : null}</div>{row.status === 'available' ? <Button type="button" variant="outline" onClick={() => setConfirmRow(row)} disabled={Boolean(busyId)}>Cancel slot</Button> : null}</div></div>)}</div> : <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))]">No availability slot matches this view.</div>}
    <ConfirmActionModal open={Boolean(confirmRow)} title="Cancel availability slot?" description="This slot will no longer be bookable." confirmLabel="Cancel slot" pendingLabel="Cancelling…" pending={Boolean(confirmRow && busyId === confirmRow.id)} tone="destructive" summaryItems={summaryItems} warning="Only available slots can be cancelled here. Existing booking history is not deleted." onCancel={() => { if (!busyId) setConfirmRow(null) }} onConfirm={cancelSlot} />
  </div>
}
