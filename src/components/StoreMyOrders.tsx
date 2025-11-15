// src/components/StoreMyOrders.tsx
'use client'

import { useEffect, useState } from 'react'
import { humanStatus } from '@/lib/order'
import { formatCurrency } from '@/lib/money'

type ItemRow = {
  id: string
  name: string | null
  qty: number
  unit_price_cents: number
  currency: string | null
}

type OrderRow = {
  id: string
  status: 'pending' | 'confirmed' | 'ready' | 'delivered' | 'canceled'
  total_cents: number
  discount_pct: number | null
  preferred_payment: string | null
  note: string | null
  created_at: string
  items: ItemRow[]
}

export default function StoreMyOrders() {
  const [items, setItems] = useState<OrderRow[]>([])
  const [err, setErr] = useState('')
  const [page, setPage] = useState(1)

  async function load() {
    setErr('')
    try {
      const r = await fetch(`/api/store/orders/list?mine=1&page=${page}&limit=20`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to load orders')
        return
      }
      setItems(j.items || [])
    } catch (e:any) {
      setErr(String(e?.message || e))
    }
  }

  useEffect(() => { load() }, [page])

  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">My orders</h2>
        <button onClick={load} className="ml-2 px-2 py-1 rounded border hover:bg-gray-50 text-sm">Refresh</button>
        {err && <span className="text-xs text-red-600">{err}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="px-2 py-1 rounded border" onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
          <span className="text-xs">Page {page}</span>
          <button className="px-2 py-1 rounded border" onClick={()=>setPage(p=>p+1)}>Next</button>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {items.map(o => (
          <div key={o.id} className="rounded-lg border p-3 bg-gray-50">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium">Order #{o.id.slice(0,8)}</div>
              <div className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString()}</div>
              <div className="ml-auto text-sm">
                Total: <strong>{formatCurrency(o.total_cents, 'en-EG', 'EGP')}</strong>
                {o.discount_pct ? <span className="text-xs text-gray-500"> (−{o.discount_pct}%)</span> : null}
              </div>
            </div>

            <div className="mt-1 text-sm">
              Status: <strong>{humanStatus(o.status)}</strong>
            </div>

            <ul className="mt-2 text-sm list-disc pl-5">
              {o.items?.map(it => (
                <li key={it.id}>
                  {it.name} × {it.qty} — {formatCurrency(it.unit_price_cents, 'en-EG', it.currency || 'EGP')}
                </li>
              ))}
            </ul>

            {o.note && <div className="mt-2 text-xs text-gray-600">Note: {o.note}</div>}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-sm text-gray-500">No orders yet.</div>
        )}
      </div>
    </section>
  )
}
