import React from 'react'

type Props = {
  title: string
  subtitle?: string
  right?: React.ReactNode
  className?: string
}

export default function PageHeader({ title, subtitle, right, className }: Props) {
  return (
    <div className={['flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className || ''].join(' ')}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  )
}
