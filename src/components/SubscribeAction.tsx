'use client'

import { useMemo, useState } from 'react'

type Props = { memberId: string; memberName?: string }

export default function SubscribeAction({ memberId, memberName }: Props) {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<'1m'|'3m'|'6m'|'12m'|'sessions'>('1m')
  const [amount, setAmount] = useState<string>('')
  const [paidAt, setPaidAt] = useState<string>(() => {
    const now = new Date()
    const tz = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    return tz.toISOString().slice(0,16) // yyyy-MM-ddTHH:mm
  })
  const [sessions, setSessions] = useState<string>('10')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string>('')

  const showSessions = plan === 'sessions'

  async function submit() {
    try {
      setPending(true)
      setMsg('')
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          plan,
          amount: amount ? Number(amount) : undefined,
          paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
          sessions: showSessions ? Number(sessions) : undefined,
        }),
      })
      const data = await res.json()
      if (data?.ok) {
        setMsg('Subscription created ✓')
        setTimeout(() => { setOpen(false); setMsg('') }, 1200)
      } else {
        setMsg(data?.error ?? 'Failed')
      }
    } catch {
      setMsg('Network error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <button onClick={() => setOpen(true)} className="px-3 py-1 border rounded hover:bg-gray-50">
          Subscribe
        </button>
      ) : (
        <div className="p-3 border rounded-lg bg-white shadow-sm space-y-2 w-[360px]">
          <div className="text-sm font-medium">New subscription {memberName ? `for ${memberName}` : ''}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Plan
              <select value={plan} onChange={e=>setPlan(e.target.value as any)} className="mt-1 w-full px-2 py-1 border rounded">
                <option value="1m">1 month</option>
                <option value="3m">3 months</option>
                <option value="6m">6 months</option>
                <option value="12m">12 months</option>
                <option value="sessions">Sessions (45 days)</option>
              </select>
            </label>
            {showSessions && (
              <label className="text-sm">Sessions
                <input type="number" min={1} value={sessions} onChange={e=>setSessions(e.target.value)} className="mt-1 w-full px-2 py-1 border rounded" />
              </label>
            )}
            <label className="text-sm col-span-2">Amount
              <input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 499.00" className="mt-1 w-full px-2 py-1 border rounded" />
            </label>
            <label className="text-sm col-span-2">Payment date
              <input type="datetime-local" value={paidAt} onChange={e=>setPaidAt(e.target.value)} className="mt-1 w-full px-2 py-1 border rounded" />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => setOpen(false)} className="text-sm px-2 py-1 rounded hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={pending} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
          {!!msg && <div className="text-xs">{msg}</div>}
        </div>
      )}
    </div>
  )
}
