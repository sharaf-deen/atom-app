import * as React from 'react'
type Props = React.PropsWithChildren<{ className?: string; hover?: boolean }>
export function Card({ className = '', hover = false, children }: Props) {
  const base = 'rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--cardfg))] p-5 shadow-soft'
  const hv = hover ? ' hover:shadow-md hover:shadow-black/10 transition' : ''
  return <div className={`${base}${hv} ${className}`}>{children}</div>
}
export function CardHeader({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={'mb-2 flex items-center justify-between ' + className}>{children}</div>
}
export function CardTitle({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <h3 className={'text-lg font-semibold tracking-tight ' + className}>{children}</h3>
}
export function CardContent({ className = '', children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={className}>{children}</div>
}
