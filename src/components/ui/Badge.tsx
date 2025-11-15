import * as React from 'react'
export default function Badge({ children, className='' }: React.PropsWithChildren<{className?:string}>) {
  return <span className={`inline-flex items-center rounded-full border border-[hsl(var(--border))] px-2.5 py-0.5 text-xs ${className}`}>{children}</span>
}
