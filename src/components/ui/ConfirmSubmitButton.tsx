'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'

type SummaryItem = {
  label: string
  value: string | number | null | undefined
}

type FieldSummaryItem = {
  label: string
  name: string
  kind?: 'text' | 'egp' | 'method' | 'date'
  emptyValue?: string
  maxLength?: number
}

type DifferenceSummary = {
  expectedName?: string
  countedName?: string
  label?: string
}

type Props = {
  children: React.ReactNode
  disabled?: boolean
  className?: string
  variant?: 'solid' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  confirmTitle: string
  confirmDescription?: string
  confirmButtonLabel: string
  pendingLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'destructive'
  staticItems?: SummaryItem[]
  fieldItems?: FieldSummaryItem[]
  difference?: DifferenceSummary
}

function readFormValue(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function parseAmount(value: string) {
  const normalized = value.replace(/,/g, '').trim()
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

function formatEGP(value: string | number | null | undefined) {
  const amount = typeof value === 'number' ? value : parseAmount(String(value ?? ''))
  if (amount == null) return '—'

  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} EGP`
  }
}

function formatMethod(value: string) {
  const raw = value.trim()
  if (!raw) return '—'
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string) {
  const raw = value.trim()
  if (!raw) return '—'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const date = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return raw

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return raw
  }
}

function formatFieldValue(value: string, item: FieldSummaryItem) {
  if (!value) return item.emptyValue ?? '—'

  if (item.kind === 'egp') return formatEGP(value)
  if (item.kind === 'method') return formatMethod(value)
  if (item.kind === 'date') return formatDate(value)

  const maxLength = item.maxLength ?? 120
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}…` : value
}

function formatDifference(value: number) {
  const abs = Math.abs(value)
  const suffix = value === 0 ? 'matched' : value > 0 ? 'over' : 'short'
  return `${formatEGP(abs)} ${suffix}`
}

function buttonSizeClass(size: NonNullable<Props['size']>) {
  if (size === 'sm') return 'min-h-10 px-3.5 py-2 text-sm'
  if (size === 'lg') return 'min-h-12 px-5 py-3 text-base'
  return 'min-h-11 px-4 py-2.5 text-sm'
}

function buttonVariantClass(variant: NonNullable<Props['variant']>) {
  if (variant === 'outline') return 'border border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--surface-2))]'
  if (variant === 'ghost') return 'border border-transparent bg-transparent text-black hover:bg-black/5'
  return 'border border-black bg-black text-white hover:opacity-95'
}

const buttonBaseClass = 'inline-flex min-w-0 touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-semibold shadow-soft transition ease-soft transform-gpu active:scale-[0.985] active:translate-y-[1px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] disabled:pointer-events-none disabled:opacity-50'

function usePendingLabel(defaultLabel: React.ReactNode, pendingLabel: string) {
  const { pending } = useFormStatus()
  return {
    pending,
    label: pending ? pendingLabel : defaultLabel,
  }
}

export default function ConfirmSubmitButton({
  children,
  disabled = false,
  className = '',
  variant = 'solid',
  size = 'md',
  confirmTitle,
  confirmDescription,
  confirmButtonLabel,
  pendingLabel = 'Saving…',
  cancelLabel = 'Cancel',
  tone = 'default',
  staticItems = [],
  fieldItems = [],
  difference,
}: Props) {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const hiddenSubmitRef = React.useRef<HTMLButtonElement | null>(null)
  const confirmedRef = React.useRef(false)
  const [open, setOpen] = React.useState(false)
  const [summaryItems, setSummaryItems] = React.useState<SummaryItem[]>(staticItems)
  const { pending, label } = usePendingLabel(children, pendingLabel)

  const buildSummary = React.useCallback(() => {
    const form = triggerRef.current?.closest('form')
    if (!form) {
      setSummaryItems(staticItems)
      return
    }

    const formData = new FormData(form)
    const nextItems: SummaryItem[] = [...staticItems]

    for (const item of fieldItems) {
      nextItems.push({
        label: item.label,
        value: formatFieldValue(readFormValue(formData, item.name), item),
      })
    }

    if (difference) {
      const expected = parseAmount(readFormValue(formData, difference.expectedName ?? 'expected_amount'))
      const counted = parseAmount(readFormValue(formData, difference.countedName ?? 'counted_amount'))

      if (expected != null && counted != null) {
        nextItems.push({
          label: difference.label ?? 'Difference',
          value: formatDifference(counted - expected),
        })
      }
    }

    setSummaryItems(nextItems)
  }, [difference, fieldItems, staticItems])

  const openConfirmation = React.useCallback(() => {
    if (disabled || pending) return
    buildSummary()
    setOpen(true)
  }, [buildSummary, disabled, pending])

  React.useEffect(() => {
    const form = triggerRef.current?.closest('form')
    if (!form || disabled) return undefined

    const handleSubmit = (event: SubmitEvent) => {
      if (confirmedRef.current) {
        confirmedRef.current = false
        return
      }

      event.preventDefault()
      event.stopPropagation()
      openConfirmation()
    }

    form.addEventListener('submit', handleSubmit)
    return () => form.removeEventListener('submit', handleSubmit)
  }, [disabled, openConfirmation])

  React.useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  function submitConfirmed() {
    const submitter = hiddenSubmitRef.current
    if (!submitter) return

    confirmedRef.current = true
    submitter.click()
  }

  const confirmVariant = tone === 'destructive' ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700' : 'border-black bg-black text-white hover:opacity-95'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || pending}
        aria-busy={pending ? true : undefined}
        className={`${buttonBaseClass} ${buttonVariantClass(variant)} ${buttonSizeClass(size)} ${className}`}
        onClick={openConfirmation}
      >
        <span>{label}</span>
      </button>

      <button ref={hiddenSubmitRef} type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
        Submit
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-submit-title"
            className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-5 shadow-2xl"
          >
            <div className="space-y-2">
              <h2 id="confirm-submit-title" className="text-lg font-semibold text-black">
                {confirmTitle}
              </h2>
              {confirmDescription ? <p className="text-sm text-[hsl(var(--muted))]">{confirmDescription}</p> : null}
            </div>

            {summaryItems.length ? (
              <dl className="mt-4 divide-y divide-[hsl(var(--border))] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/40 text-sm">
                {summaryItems.map((item) => (
                  <div key={`${item.label}:${String(item.value ?? '')}`} className="grid grid-cols-[0.9fr_1.1fr] gap-3 px-3 py-2">
                    <dt className="text-[hsl(var(--muted))]">{item.label}</dt>
                    <dd className="break-words text-right font-medium text-black">{String(item.value ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Please review the summary before confirming.
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={`${buttonBaseClass} ${buttonVariantClass('outline')} ${buttonSizeClass('md')}`}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submitConfirmed}
                className={`inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-soft transition disabled:pointer-events-none disabled:opacity-50 ${confirmVariant}`}
              >
                {pending ? pendingLabel : confirmButtonLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
