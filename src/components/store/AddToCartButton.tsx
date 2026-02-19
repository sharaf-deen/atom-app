// src/components/store/AddToCartButton.tsx
'use client'

import { toast } from 'sonner'

type ProductLite = {
  id: string
  name: string
  price_cents: number
  currency?: string | null
  inventory_qty?: number | null
  color?: string | null
  size?: string | null
}

export default function AddToCartButton({ product }: { product: ProductLite }) {
  const qty = Number(product.inventory_qty ?? 0)
  const disabled = qty <= 0

  function add() {
    if (disabled) {
      toast.error('Out of stock')
      return
    }

    try {
      const ev = new CustomEvent('cart:add', {
        detail: {
          product_id: product.id,
          qty: 1,
          product: {
            id: product.id,
            name: product.name,
            price_cents: product.price_cents,
            currency: product.currency ?? 'EGP',
          },
          variant: {
            color: product.color ?? undefined,
            size: product.size ?? undefined,
          },
        },
      })
      window.dispatchEvent(ev)

      // optional: auto-open cart UI if a panel listens to it
      window.dispatchEvent(new CustomEvent('cart:open'))
    } catch {}

    toast.success('Added to cart')
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm font-medium border ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
      }`}
      title={disabled ? 'Out of stock' : 'Add to cart'}
    >
      {disabled ? 'Out of stock' : 'Add to cart'}
    </button>
  )
}
