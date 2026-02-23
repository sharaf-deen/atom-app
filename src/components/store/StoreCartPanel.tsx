// src/components/store/StoreCartPanel.tsx
'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

const StoreCart = dynamic(() => import('@/components/StoreCart'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading cart…</div>,
})

export default function StoreCartPanel() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('cart:open', onOpen as EventListener)
    return () => window.removeEventListener('cart:open', onOpen as EventListener)
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl px-4 py-2 text-sm font-medium border hover:bg-gray-50"
        >
          {open ? 'Hide cart' : 'Open cart'}
        </button>
      </div>

      {open ? <StoreCart /> : null}
    </div>
  )
}
