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
      <h1 className="break-words text-xl font-semibold leading-tight tracking-tight text-[hsl(var(--fg))] sm:text-2xl">{title}</h1>
      {subtitle ? (
        <p className="mt-1 max-w-3xl text-sm leading-5 text-[hsl(var(--muted))] sm:leading-6">
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}
