'use client'
import * as React from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  href?: string
  variant?: 'solid' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  loadingText?: string
  className?: string
}

const sizes = {
  sm: 'min-h-10 px-3.5 py-2 text-sm',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-5 py-3 text-base',
}

const VAR = {
  solid: 'border border-black bg-black text-white hover:opacity-95',
  outline: 'border border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--surface-2))]',
  ghost: 'border border-transparent bg-transparent text-black hover:bg-black/5',
}

export default function Button({ asChild, href = '#', variant='solid', size='md', className='', ...props }: Props) {
  const { loading, loadingText, disabled, children, ...rest } = props
  const isLoading = Boolean(loading)

  const base =
    'inline-flex min-w-0 touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-semibold shadow-soft transition ease-soft transform-gpu active:scale-[0.985] active:translate-y-[1px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] disabled:pointer-events-none disabled:opacity-50'
  const cls = `${base} ${VAR[variant]} ${sizes[size]} ${className}`

  if (asChild) {
    return (
      <Link
        href={href}
        className={cls + (isLoading ? ' pointer-events-none opacity-70' : '')}
        aria-disabled={isLoading ? true : undefined}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {isLoading && loadingText ? loadingText : children}
      </Link>
    )
  }

  return (
    <button
      className={cls}
      disabled={disabled || isLoading}
      aria-busy={isLoading ? true : undefined}
      {...rest}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {isLoading && loadingText ? (
        <span>{loadingText}</span>
      ) : (
        <span className={isLoading ? 'opacity-70' : ''}>{children}</span>
      )}
    </button>
  )
}
