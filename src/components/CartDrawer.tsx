// src/components/CartDrawer.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

type Line = { product_id: string; qty: number; product?: any }

function price(cents: number) { return `${(cents/100).toFixed(2)} EGP` }

export default function CartDrawer() {
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  // écouter les ajouts depuis Catalog
  useEffect(() => {
    function onAdd(e: any) {
      const { product_id, qty, product } = e.detail || {}
      setLines(prev => {
        const i = prev.findIndex(l => l.product_id === product_id)
        if (i >= 0) {
          const copy = [...prev]
          copy[i] = { ...copy[i], qty: copy[i].qty + (qty || 1) }
          return copy
        }
        return [...prev, { product_id, qty: qty || 1, product }]
      })
    }
    window.addEventListener('cart:add', onAdd as any)
    return () => window.removeEventListener('cart:add', onAdd as any)
  }, [])

  const total = useMemo(() => {
    // Affichage seulement (le vrai total sera recalc côté serveur avec réduction)
    return lines.reduce((sum, l) => sum + ((l.product?.price_cents || 0) * l.qty), 0)
  }, [lines])

  function changeQty(id: string, q: number) {
    setLines(prev => prev.map(l => l.product_id === id ? { ...l, qty: Math.max(1, q) } : l))
  }
  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.product_id !== id))
  }
  function reset() {
    setLines([])
    setMsg('')
  }

  async function checkout(preorder = false) {
    if (lines.length === 0) return
    setBusy(true); setMsg('')
    try {
      const payload = {
        items: lines.map(l => ({ product_id: l.product_id, qty: l.qty })),
        preorder,
      }
      const r = await fetch('/api/store/orders/create', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setMsg(j?.error || 'Order failed')
        return
      }
      const applied = j.discount_percent || 0
      setMsg(`Order placed! Discount: ${applied}%. Total: ${(j.total_cents/100).toFixed(2)} EGP. ${j.payment_instructions}`)
      setLines([])
    } catch (e:any) {
      setMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Cart</h2>
      {lines.length === 0 ? (
        <div className="mt-2 text-sm text-gray-500">Your cart is empty.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {lines.map(l => (
            <div key={l.product_id} className="flex items-center gap-3 rounded border p-2 bg-gray-50">
              <div className="flex-1">
                <div className="text-sm font-medium">{l.product?.name || l.product_id}</div>
                <div className="text-xs text-gray-500">
                  {l.product?.category} · {[l.product?.color, l.product?.size].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="text-sm">{price(l.product?.price_cents || 0)}</div>
              <input
                type="number"
                value={l.qty}
                onChange={(e) => changeQty(l.product_id, Number(e.target.value || 1))}
                className="w-16 px-2 py-1 border rounded"
                min={1}
              />
              <button onClick={() => removeLine(l.product_id)} className="px-2 py-1 rounded border hover:bg-white">Remove</button>
            </div>
          ))}
          <div className="flex items-center gap-3 mt-3">
            <div className="font-semibold">Subtotal (no discount yet): {price(total)}</div>
            <div className="ml-auto flex items-center gap-2">
              <button disabled={busy || lines.length===0} onClick={() => checkout(false)} className="px-3 py-1.5 rounded border bg-black text-white">
                Place order
              </button>
              <button disabled={busy || lines.length===0} onClick={() => checkout(true)} className="px-3 py-1.5 rounded border">
                Place pre-order
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && <div className="mt-3 text-sm text-gray-700">{msg}</div>}
      {lines.length > 0 && (
        <div className="mt-2">
          <button onClick={reset} className="text-xs text-gray-600 underline">Clear cart</button>
        </div>
      )}
    </section>
  )
}
