import * as React from 'react'
import Container from './Container'
import ReloadButton from '@/components/ReloadButton'

export default function PageHeader({
  title,
  subtitle,
  right,
  showReload = false,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  showReload?: boolean
}) {
  return (
    <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))]">
      <Container className="py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-[hsl(var(--muted))]">{subtitle}</p>}
          </div>

          {(right || showReload) && (
            <div className="w-full sm:w-auto flex flex-wrap items-center gap-2 sm:ml-auto">
              {right}
              {showReload ? <ReloadButton /> : null}
            </div>
          )}
        </div>
      </Container>
    </div>
  )
}
