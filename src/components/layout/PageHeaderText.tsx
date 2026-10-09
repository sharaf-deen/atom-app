import * as React from 'react'

export default function PageHeaderText({
  title,
  subtitle,
}: {
  title: string
  subtitle?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--fg))]">{title}</h1>
      {subtitle ? (
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[hsl(var(--muted))]">
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}
