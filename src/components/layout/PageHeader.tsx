import * as React from 'react'
import Container from './Container'
export default function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))]">
      <Container className="py-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-[hsl(var(--muted))]">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      </Container>
    </div>
  )
}
