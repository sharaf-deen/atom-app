import React from 'react'
import PageHeaderText from '@/components/layout/PageHeaderText'

type Props = {
  title: string
  subtitle?: React.ReactNode
  right?: React.ReactNode
  className?: string
}

/**
 * Compatibility PageHeader for older screens.
 * New screens should prefer @/components/layout/PageHeader.
 */
export default function PageHeader({ title, subtitle, right, className }: Props) {
  return (
    <div className={['flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className || ''].join(' ')}>
      <PageHeaderText title={title} subtitle={subtitle} />
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  )
}
