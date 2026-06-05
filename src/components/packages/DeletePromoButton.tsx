'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import { deletePromo } from '@/app/packages-and-promos/actions'

export default function DeletePromoButton({ id, title }: { id: string; title?: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const promoTitle = String(title ?? '').trim() || 'Selected promo'

  function confirmDelete() {
    if (pending) return

    start(() => {
      void (async () => {
        try {
          await deletePromo(id)
          setConfirmOpen(false)
          router.refresh()
        } catch (e: any) {
          setConfirmOpen(false)
          alert(e?.message || 'Failed to delete promo')
        }
      })()
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        title="Delete promo"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>

      <ConfirmActionModal
        open={confirmOpen}
        title="Delete promo?"
        description="Review this promo before removing it from Packages & Promos."
        confirmLabel="Confirm delete"
        pendingLabel="Deleting…"
        cancelLabel="Cancel"
        tone="destructive"
        pending={pending}
        summaryItems={[
          { label: 'Promo', value: promoTitle },
          { label: 'Impact', value: 'Promo will be removed from the public promos list.' },
        ]}
        warning="This is a destructive action for the public promos display."
        onCancel={() => {
          if (!pending) setConfirmOpen(false)
        }}
        onConfirm={confirmDelete}
      />
    </>
  )
}
