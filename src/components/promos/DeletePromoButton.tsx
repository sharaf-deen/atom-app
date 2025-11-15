'use client'

import React, { useTransition } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import { deletePromo } from '@/app/packages-and-promos/actions'

type Props = {
  id: string
  label?: string
}

export default function DeletePromoButton({ id, label = 'Delete' }: Props) {
  const [pending, startTransition] = useTransition()

  const onDelete = () => {
    if (!confirm('Supprimer définitivement cette promotion ? Cette action est irréversible.')) {
      return
    }
    startTransition(async () => {
      try {
        await deletePromo(id)
        toast.success('Promotion supprimée')
      } catch (e) {
        console.error(e)
        toast.error('Erreur lors de la suppression')
      }
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onDelete}
      disabled={pending}
      className="border border-red-400 text-red-600 hover:bg-red-50"
    >
      {pending ? '...' : label}
    </Button>
  )
}
