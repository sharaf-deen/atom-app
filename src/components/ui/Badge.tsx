import * as React from 'react'

export default function Badge({ children, className='' }: React.PropsWithChildren<{className?:string}>) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-[11px] font-semibold tracking-[0.01em] text-black ${className}`}
    >
      {children}
    </span>
  )
}
