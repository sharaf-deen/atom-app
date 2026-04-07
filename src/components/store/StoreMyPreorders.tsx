'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/money'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'

type PreorderRow = {
  id: string
  product_name: string
  product_category: 'kimono' | 'rashguard' | 'short' | 'belt' | null
  product_color: string | null
  product_size: string | null
  qty: number
  unit_price_cents: number
  total_cents: number
  deposit_cents: number
  balance_due_cents: number
  status: 'pending' | 'confirmed' | 'ordered_from_supplier' | 'ready' | 'completed' | 'canceled'
  note: string | null
  created_at: string
}

function preorderStatusPill(status: PreorderRow['status']) {
  switch (status) {
    case 'pending':
      return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">Pending</span>
    case 'confirmed':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">Confirmed</span>
    case 'ordered_from_supplier':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">Ordered from supplier</span>
    case 'ready':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">Ready</span>
    case 'completed':
      return <span className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-[11px] font-medium text-black">Completed</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">Canceled</span>
  }
}

export default function StoreMyPreorders() {
  const [items, setItems] = useState<PreorderRow[]>([])
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (nextPage = page) => {
    setBusy(true)
    setError('')

    try {
      const res = await fetch(`/api/store/preorders/list?mine=1&page=${nextPage}&limit=5`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setError(json?.details || json?.error || 'Failed to load preorders')
        setItems([])
        setHasMore(false)
        return
      }

      const rows = Array.isArray(json.items) ? json.items : []
      setItems(rows)
      setHasMore(Boolean(json.hasMore))
      setPage(Number.isFinite(Number(json.page)) ? Number(json.page) : nextPage)
    } catch (e: any) {
      setError(String(e?.message || e))
      setItems([])
      setHasMore(false)
    } finally {
      setBusy(false)
    }
  }, [page])

  useEffect(() => {
    void load(page)
  }, [load, page])

  useEffect(() => {
    const onCreated = () => {
      setPage(1)
      void load(1)
    }
    window.addEventListener('store:preorder:created', onCreated)
    return () => window.removeEventListener('store:preorder:created', onCreated)
  }, [load])

  return (
    <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">My preorders</div>
        <div className="text-xs text-[hsl(var(--muted))]">Track your requests here.</div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load(page)} loading={busy} loadingText="Refreshing…">
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <InlineAlert variant="error" compact>
          {error}
        </InlineAlert>
      ) : null}

      <div className="space-y-2">
        {!busy && items.length === 0 ? (
          <div className="text-sm text-[hsl(var(--muted))]">No preorders yet.</div>
        ) : null}

        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{item.product_name}</div>
                <div className="text-xs text-[hsl(var(--muted))]">
                  {item.product_category ?? 'product'}
                  {item.product_color ? ` · ${item.product_color}` : ''}
                  {item.product_size ? ` · ${item.product_size}` : ''}
                  {` · Qty ${item.qty}`}
                </div>
              </div>
              {preorderStatusPill(item.status)}
            </div>

            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Total</div>
                <div className="font-medium">{formatCurrency(item.total_cents ?? 0, 'en-EG', 'EGP')}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Deposit</div>
                <div className="font-medium">{formatCurrency(item.deposit_cents ?? 0, 'en-EG', 'EGP')}</div>
              </div>
              <div>
                <div className="text-xs text-[hsl(var(--muted))]">Balance due</div>
                <div className="font-medium">{formatCurrency(item.balance_due_cents ?? 0, 'en-EG', 'EGP')}</div>
              </div>
            </div>

            <div className="mt-2 text-xs text-[hsl(var(--muted))]">
              Created {new Date(item.created_at).toLocaleString('en-GB', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>

            {item.note ? <div className="mt-2 text-sm text-[hsl(var(--muted))]">Note: {item.note}</div> : null}
          </div>
        ))}
      </div>

      {(page > 1 || hasMore) ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={busy || page <= 1}
          >
            Prev
          </Button>
          <div className="text-xs text-[hsl(var(--muted))]">Page {page}</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={busy || !hasMore}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}
