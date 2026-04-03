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

const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
const VAR = {
  solid: 'bg-black text-white hover:opacity-95',
  outline: 'bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80',
  ghost: 'bg-transparent text-black hover:bg-black/5',
}
export default function Button({ asChild, href = '#', variant='solid', size='md', className='', ...props }: Props) {
  const { loading, loadingText, disabled, children, ...rest } = props
  const isLoading = Boolean(loading)

  // Tap feedback is intentionally subtle (and disabled when motion-reduce is on).
  const base =
    'inline-flex touch-manipulation items-center justify-center gap-2 rounded-2xl shadow-soft transition ease-soft transform-gpu active:scale-[0.98] active:translate-y-[1px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] disabled:opacity-50 disabled:pointer-events-none'
  const cls = `${base} ${VAR[variant]} ${sizes[size]} ${className}`

  // Link-like button
  if (asChild) {
    // loading state on links isn't ideal; keep it visual-only.
    return (
      <Link
        href={href}
        className={cls + (isLoading ? ' opacity-70 pointer-events-none' : '')}
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
