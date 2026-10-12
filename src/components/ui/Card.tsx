import * as React from 'react'
type Props = React.PropsWithChildren<{ className?: string; hover?: boolean }>

export function Card({ className = '', hover = false, children }: Props) {
  const base =
    'rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--cardfg))] p-4 shadow-soft sm:p-5'
  const hv = hover ? ' transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10' : ''
  return <div className={`${base}${hv} ${className}`}>{children}</div>
}

export function CardHeader({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={'mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ' + className}>{children}</div>
}

export function CardTitle({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <h3 className={'text-lg font-semibold tracking-tight sm:text-xl ' + className}>{children}</h3>
}

export function CardContent({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={className}>{children}</div>
}
