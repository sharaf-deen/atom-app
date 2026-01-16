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
}: {
  variant?: Variant
  title?: string
  children: React.ReactNode
  className?: string
  role?: 'status' | 'alert'
}) {
  const computedRole = role ?? (variant === 'error' ? 'alert' : 'status')
  return (
    <div className={`rounded-2xl px-3 py-2 text-sm ${STYLES[variant]} ${className}`} role={computedRole}>
      {title ? <div className="font-medium mb-0.5">{title}</div> : null}
      <div className={variant === 'info' ? 'text-[hsl(var(--muted))]' : ''}>{children}</div>
    </div>
  )
}
