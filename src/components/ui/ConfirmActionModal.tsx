'use client'

import * as React from 'react'

export type ConfirmActionSummaryItem = {
  label: string
  value: React.ReactNode
}

type Props = {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  pendingLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'destructive'
  pending?: boolean
  summaryItems?: ConfirmActionSummaryItem[]
  warning?: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

const buttonBaseClass =
  'inline-flex min-h-11 min-w-0 touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-soft transition ease-soft transform-gpu active:scale-[0.985] active:translate-y-[1px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] disabled:pointer-events-none disabled:opacity-50'

function confirmButtonClass(tone: NonNullable<Props['tone']>) {
  if (tone === 'destructive') return 'border border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
  return 'border border-black bg-black text-white hover:opacity-95'
}

export default function ConfirmActionModal({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = 'Saving…',
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
  summaryItems = [],
  warning = 'Please review the summary before confirming.',
  onCancel,
  onConfirm,
}: Props) {
  React.useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, open, pending])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
        className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-5 shadow-2xl"
      >
        <div className="space-y-2">
          <h2 id="confirm-action-title" className="text-lg font-semibold text-black">
            {title}
          </h2>
          {description ? <p className="text-sm text-[hsl(var(--muted))]">{description}</p> : null}
        </div>

        {summaryItems.length ? (
          <dl className="mt-4 divide-y divide-[hsl(var(--border))] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 text-sm">
            {summaryItems.map((item, index) => (
              <div key={`${item.label}:${index}`} className="grid grid-cols-[0.9fr_1.1fr] gap-3 px-3 py-2">
                <dt className="text-[hsl(var(--muted))]">{item.label}</dt>
                <dd className="break-words text-right font-medium text-black">{item.value === null || item.value === undefined || item.value === '' ? '—' : item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {warning ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {warning}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={`${buttonBaseClass} border border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--surface-2))]`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={`${buttonBaseClass} ${confirmButtonClass(tone)}`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
