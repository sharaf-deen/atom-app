// src/components/ui/InlineAlert.tsx
import * as React from 'react'

type Variant = 'info' | 'success' | 'warning' | 'error'

const STYLES: Record<Variant, string> = {
  info: 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--fg))]',
  success: 'border border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border border-amber-300 bg-amber-50 text-amber-900',
  error: 'border border-rose-300 bg-rose-50 text-rose-900',
}

export default function InlineAlert({
  variant = 'info',
  title,
  children,
  className = '',
  role,
  compact = false,
  ariaLive,
}: {
  variant?: Variant
  title?: string
  children: React.ReactNode
  className?: string
  role?: 'status' | 'alert'
  compact?: boolean
  ariaLive?: 'polite' | 'assertive'
}) {
  const computedRole = role ?? (variant === 'error' ? 'alert' : 'status')
  const sizeClass = compact ? 'rounded-xl px-3 py-2 text-xs' : 'rounded-2xl px-3 py-2 text-sm'
  return (
    <div className={`${sizeClass} ${STYLES[variant]} ${className}`} role={computedRole} aria-live={ariaLive}>
      {title ? <div className="mb-0.5 font-medium">{title}</div> : null}
      <div className={variant === 'info' ? 'text-[hsl(var(--muted))]' : ''}>{children}</div>
    </div>
  )
}
