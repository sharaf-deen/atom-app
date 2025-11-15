// src/components/StoreOrdersList.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { OrderStatus, PaymentMethod } from '@/lib/order'
import { ORDER_STATUSES } from '@/lib/order'

type Mode = 'mine' | 'admin'

type OrderItemRow = {
  id: string
  product_id: string
  name?: string | null
  qty: number
  unit_price_cents: number
  final_price_cents: number
  currency?: string | null
}

type OrderRow = {
  id: string
  user_id: string | null
  created_by?: string | null
  owner_uid?: string | null
  member_id?: string | null
  status: OrderStatus
  total_cents: number
  discount_pct?: number | null
  preferred_payment?: PaymentMethod | null
  note?: string | null
  created_at: string
  customer_email?: string | null
  customer_name?: string | null
  items?: OrderItemRow[]
}

const PER_PAGE = 5

function fmtMoney(cents: number, currency = 'EGP') {
  const n = Number.isFinite(cents) ? Number(cents) : 0
  return `${(n / 100).toFixed(2)} ${currency}`
}

export default function StoreOrdersList({ mode = 'mine' }: { mode?: Mode }) {
  const [items, setItems] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string>('')
  const [msg, setMsg] = useState<string>('')

  const [editing, setEditing] = useState<Record<string, OrderStatus>>({})

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = useMemo(() => Math.max(1, Math.ceil(Number(total || 0) / PER_PAGE)), [total])

  const isAdmin = mode === 'admin'

  async function load(p = page) {
    setLoading(true)
    setErr('')
    setMsg('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', String(PER_PAGE))
      if (isAdmin) params.set('view', 'all')

      const r = await fetch(`/api/store/orders/list?${params.toString()}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to load orders')
        setItems([])
        setTotal(0)
        setPage(1)
        return
      }
      setItems(Array.isArray(j.items) ? (j.items as OrderRow[]) : [])
      setTotal(Number(j.total || 0))
      setPage(Number(j.page || p))
    } catch (e: any) {
      setErr(String(e?.message || e))
      setItems([])
      setTotal(0)
      setPage(1)
    } finally {
      setLoading(false)
    }
  }

  // Recharger quand le mode change
  useEffect(() => { load(1) }, [mode]) // important: dépendre de "mode", pas d’un bool dérivé

  function setRowStatus(id: string, s: OrderStatus) {
    setEditing((m) => ({ ...m, [id]: s }))
  }

  async function saveStatus(id: string) {
    const next = editing[id]
    if (!next) return
    setMsg('')
    setErr('')
    try {
      const r = await fetch('/api/store/orders/update-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, status: next }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Update failed')
        return
      }
      setMsg(`Order ${id.slice(0, 8)} → ${next}`)
      setEditing((m) => {
        const { [id]: _, ...rest } = m
        return rest
      })
      await load(page)
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  const columns = useMemo(() => {
    const base = [
      'Date',
      ...(isAdmin ? ['Customer'] as const : []),
      'Items',
      'Total',
      'Payment',
      'Status',
      'Note',
      ...(isAdmin ? ['Actions'] as const : []),
    ]
    return base
  }, [isAdmin])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button
          onClick={() => load(page)}
          className="text-sm px-2 py-1 rounded border hover:bg-gray-50"
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {msg && <span className="text-xs text-green-700">{msg}</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
        <div className="ml-auto text-xs text-gray-600">
          Page <strong>{page}</strong> / {totalPages} · Total {total} · {PER_PAGE}/page
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border rounded-lg bg-white">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 border-b">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const current = editing[o.id] ?? o.status
              const orderItems: OrderItemRow[] = Array.isArray((o as any).items) ? (o as any).items : []
              const currency = orderItems?.[0]?.currency || 'EGP'
              const buyer = (o.customer_name || o.customer_email || o.user_id || '—')
              return (
                <tr key={o.id} className="text-sm align-top">
                  <td className="px-3 py-2 border-b whitespace-nowrap">
                    {new Date(o.created_at).toLocaleString()}
                  </td>

                  {isAdmin && (
                    <td className="px-3 py-2 border-b">
                      {buyer}
                    </td>
                  )}

                  {/* Items */}
                  <td className="px-3 py-2 border-b">
                    {orderItems.length > 0 ? (
                      <ul className="space-y-1">
                        {orderItems.map((it) => (
                          <li key={it.id} className="text-xs leading-5">
                            <div className="font-medium">
                              {it.name || 'Item'}
                            </div>
                            <div className="text-gray-600">
                              Qty: <strong>{it.qty}</strong> · Unit: {fmtMoney(it.unit_price_cents, it.currency || currency)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>

                  {/* Total */}
                  <td className="px-3 py-2 border-b">{fmtMoney(o.total_cents, currency)}</td>

                  <td className="px-3 py-2 border-b">{o.preferred_payment || 'cash'}</td>

                  <td className="px-3 py-2 border-b">
                    {isAdmin ? (
                      <select
                        value={current}
                        onChange={(e) => setRowStatus(o.id, e.target.value as OrderStatus)}
                        className="px-2 py-1 border rounded"
                      >
                        {ORDER_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded border bg-gray-50">{o.status}</span>
                    )}
                  </td>

                  <td className="px-3 py-2 border-b">{o.note || '—'}</td>

                  {isAdmin && (
                    <td className="px-3 py-2 border-b">
                      <button
                        onClick={() => saveStatus(o.id)}
                        disabled={!editing[o.id]}
                        className="px-3 py-1.5 rounded border bg-black text-white disabled:opacity-50"
                        title="Save status"
                      >
                        Update
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}

            {items.length === 0 && !loading && (
              <tr>
                <td className="px-3 py-4 text-sm text-gray-500" colSpan={columns.length}>
                  No orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          onClick={() => load(Math.max(1, page - 1))}
          disabled={page <= 1 || loading}
          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Prev
        </button>
        <button
          onClick={() => load(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading}
          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}
