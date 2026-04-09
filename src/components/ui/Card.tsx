import * as React from 'react'
type Props = React.PropsWithChildren<{ className?: string; hover?: boolean }>

export function Card({ className = '', hover = false, children }: Props) {
  const base =
    'rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--cardfg))] p-5 shadow-soft'
  const hv = hover ? ' transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/10' : ''
  return <div className={`${base}${hv} ${className}`}>{children}</div>
}

export function CardHeader({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={'mb-3 flex items-center justify-between ' + className}>{children}</div>
}

export function CardTitle({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <h3 className={'text-xl font-semibold tracking-tight ' + className}>{children}</h3>
}

export function CardContent({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={className}>{children}</div>
}
