import * as React from 'react'
import Container from './Container'
import PageHeaderText from './PageHeaderText'
import ReloadButton from '@/components/ReloadButton'

export default function PageHeader({
  title,
  subtitle,
  right,
  showReload = false,
}: {
  title: string
  subtitle?: React.ReactNode
  right?: React.ReactNode
  showReload?: boolean
}) {
  return (
    <div className="page-header border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))]">
      <Container className="py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <PageHeaderText title={title} subtitle={subtitle} />
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
