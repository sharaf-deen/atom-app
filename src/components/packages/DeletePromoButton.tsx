'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import { deletePromo } from '@/app/packages-and-promos/actions'

export default function DeletePromoButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this promo?')) return

        // startTransition expects a synchronous callback (void).
        // Wrap the async work in an IIFE so TS is happy and React can prioritize updates.
        start(() => {
          void (async () => {
            try {
              await deletePromo(id)
              router.refresh()
            } catch (e: any) {
              alert(e?.message || 'Failed to delete promo')
            }
          })()
        })
      }}
      title="Delete promo"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </Button>
  )
}
