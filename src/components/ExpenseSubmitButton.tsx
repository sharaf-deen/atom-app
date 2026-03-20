'use client'

import { useFormStatus } from 'react-dom'

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
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="inline-flex items-center justify-center rounded-2xl shadow-soft bg-black text-white px-5 py-2.5 text-sm font-medium hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? pendingLabel : idleLabel}
      </button>

      {pending ? (
        <p className="text-xs text-[hsl(var(--muted))]">Uploading receipt and saving. Please avoid tapping twice.</p>
      ) : null}
    </div>
  )
}
