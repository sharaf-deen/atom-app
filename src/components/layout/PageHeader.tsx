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
    <div className="page-header border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))]">
      <Container className="py-5 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
            {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-[hsl(var(--muted))] sm:text-base">{subtitle}</p> : null}
          </div>

          {(right || showReload) && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              {right}
              {showReload ? <ReloadButton /> : null}
            </div>
          )}
        </div>
      </Container>
    </div>
  )
}
