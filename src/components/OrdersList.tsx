// src/components/OrdersList.tsx
'use client'

import { useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/money'
import type { OrderStatus } from '@/lib/order'

type Item = {
  product_id: string
  name: string
  qty: number
  unit_price_cents: number
  currency: string | null
}

type Row = {
  id: string
  member_id: string | null
  created_by: string | null
  status: OrderStatus
  total_cents: number
  discount_pct: number
  preferred_payment: 'cash' | 'card' | 'bank_transfer' | 'instapay' | null
  note: string | null
  created_at: string
  items: Item[]
  member: { email: string | null; name: string | null } | null
  creator: { email: string | null; name: string | null } | null
}

export default function OrdersList({
  mode = 'mine', // 'mine' | 'admin'
}: {
  mode?: 'mine' | 'admin'
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)

  async function load(p = page) {
    setBusy(true)
    setErr('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', '20')
      if (mode === 'admin') params.set('view', 'all')

      const r = await fetch(`/api/store/orders/list?${params.toString()}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to load orders')
        return
      }
      setRows(j.items || [])
      setTotal(j.total || 0)
      setPage(j.page || p)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">
          {mode === 'admin' ? 'All orders' : 'My orders'}
        </h2>
        <button onClick={() => load(page)} className="ml-auto text-sm px-2 py-1 rounded border hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

      <div className="mt-3 space-y-3">
        {rows.map(o => {
          const totalTxt = formatCurrency(o.total_cents, 'en-EG', 'EGP')
          const buyer =
            o.member?.name || o.member?.email || (o.member_id ? o.member_id.slice(0, 8) : '—')
          return (
            <div key={o.id} className="border rounded-lg p-3 bg-gray-50">
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-medium">#{o.id.slice(0, 8)}</div>
                <div className="text-sm text-gray-600">Buyer: {buyer}</div>
                <div className="text-sm text-gray-600">Status: <b>{o.status}</b></div>
                <div className="text-sm text-gray-600">Total: <b>{totalTxt}</b> {o.discount_pct ? `(−${o.discount_pct}%)` : ''}</div>
                <div className="text-sm text-gray-600">Payment: {o.preferred_payment || 'cash'}</div>
                <div className="text-xs text-gray-500 ml-auto">{new Date(o.created_at).toLocaleString()}</div>
              </div>

              {o.note && <div className="mt-2 text-sm">Note: {o.note}</div>}

              <div className="mt-2 text-sm">
                <div className="font-medium mb-1">Items</div>
                <ul className="list-disc ml-5">
                  {o.items.map((it, idx) => (
                    <li key={idx}>
                      {it.name} × {it.qty} —{' '}
                      {formatCurrency(it.unit_price_cents, 'en-EG', it.currency || 'EGP')}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
        {rows.length === 0 && !err && (
          <div className="text-sm text-gray-500">No orders.</div>
        )}
      </div>

      {/* Pagination simple */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => load(Math.max(1, page - 1))}
          disabled={busy || page <= 1}
          className="px-2 py-1 rounded border disabled:opacity-50"
        >
          Prev
        </button>
        <span className="text-sm">Page {page}</span>
        <button
          onClick={() => load(page + 1)}
          disabled={busy || rows.length === 0 || rows.length < 20}
          className="px-2 py-1 rounded border disabled:opacity-50"
        >
          Next
        </button>
        <span className="text-xs text-gray-500 ml-auto">Total: {total}</span>
      </div>
    </section>
  )
}
