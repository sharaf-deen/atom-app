// src/components/OrdersAdminList.tsx
'use client'

import { useEffect, useState } from 'react'

type Item = {
  product_id: string
  qty: number
  unit_price_cents: number
  discount_percent: number
  final_price_cents: number
}
type Order = {
  id: string
  member: { email: string|null; first_name: string|null; last_name: string|null } | null
  status: 'preorder'|'pending'|'confirmed'|'delivered'|'canceled'
  payment_method: 'cash'|'visa_in_gym'|'bank_transfer'|'instapay'|null
  notes: string|null
  discount_percent: number
  role_snapshot: string|null
  total_cents: number
  created_at: string
  items: Item[]
}

function fmtPrice(c: number) { return `${(c/100).toFixed(2)} EGP` }

export default function OrdersAdminList() {
  const [orders, setOrders] = useState<Order[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [messageMap, setMessageMap] = useState<Record<string, string>>({})

  async function load(status?: string) {
    setLoading(true); setErr('')
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      const r = await fetch(`/api/store/orders/list?${qs}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setErr(j?.error || 'Failed to load orders')
      } else {
        setOrders(j.items || [])
      }
    } catch (e:any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function sendMessage(orderId: string) {
    const body = (messageMap[orderId] || '').trim()
    if (!body) return
    const r = await fetch('/api/store/orders/message', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ order_id: orderId, body }),
    })
    const j = await r.json()
    if (!r.ok || !j?.ok) {
      alert(j?.error || 'Failed to send')
      return
    }
    setMessageMap(m => ({ ...m, [orderId]: '' }))
    alert('Message sent to customer.')
  }

  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Orders</h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => load()} className="text-sm px-2 py-1 rounded border hover:bg-gray-50">All</button>
          <button onClick={() => load('preorder')} className="text-sm px-2 py-1 rounded border hover:bg-gray-50">Preorders</button>
          <button onClick={() => load('pending')} className="text-sm px-2 py-1 rounded border hover:bg-gray-50">Pending</button>
          <button onClick={() => load('confirmed')} className="text-sm px-2 py-1 rounded border hover:bg-gray-50">Confirmed</button>
          <button onClick={() => load('delivered')} className="text-sm px-2 py-1 rounded border hover:bg-gray-50">delivered</button>
          <button onClick={() => load('canceled')} className="text-sm px-2 py-1 rounded border hover:bg-gray-50">canceled</button>
        </div>
      </div>

      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
      {loading ? <div className="mt-2 text-sm text-gray-500">Loading…</div> : null}

      <div className="mt-3 space-y-3">
        {orders.map(o => {
          const who = `${o.member?.first_name ?? ''} ${o.member?.last_name ?? ''}`.trim() || (o.member?.email ?? '')
          return (
            <div key={o.id} className="rounded-lg border p-3 bg-gray-50">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs px-2 py-0.5 rounded border bg-white">{o.status}</div>
                <div className="text-xs px-2 py-0.5 rounded border bg-white">{o.role_snapshot || 'member'}</div>
                <div className="ml-auto text-sm">{new Date(o.created_at).toLocaleString()}</div>
              </div>
              <div className="mt-1 text-sm text-gray-700">Customer: <strong>{who}</strong></div>
              <div className="mt-2 grid gap-2">
                {o.items.map((it, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <div>Product {it.product_id} · Qty {it.qty} · Unit {fmtPrice(it.unit_price_cents)} · Disc {it.discount_percent}%</div>
                    <div className="font-medium">{fmtPrice(it.final_price_cents)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 font-semibold">Total: {fmtPrice(o.total_cents)}</div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  value={messageMap[o.id] || ''}
                  onChange={(e)=>setMessageMap(m=>({ ...m, [o.id]: e.target.value }))}
                  placeholder="Message to customer about this order…"
                  className="flex-1 px-3 py-2 border rounded"
                />
                <button onClick={()=>sendMessage(o.id)} className="px-3 py-2 rounded border hover:bg-white">
                  Send
                </button>
              </div>
            </div>
          )
        })}
        {orders.length === 0 && <div className="text-sm text-gray-500">No orders yet.</div>}
      </div>
    </section>
  )
}
