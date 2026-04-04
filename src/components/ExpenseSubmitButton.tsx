'use client'

import { useFormStatus } from 'react-dom'

import SaveButton from '@/components/forms/SaveButton'

type Props = {
  idleLabel?: string
  pendingLabel?: string
}

export default function ExpenseSubmitButton({
  idleLabel = 'Save expense',
  pendingLabel = 'Saving…',
}: Props) {
  const { pending } = useFormStatus()

  return (
    <div className="space-y-1">
      <SaveButton idleLabel={idleLabel} pendingLabel={pendingLabel} />

      {pending ? (
        <p className="text-xs text-[hsl(var(--muted))]">Uploading receipt and saving. Please avoid tapping twice.</p>
      ) : null}
    </div>
  )
}
