'use client'
import * as React from 'react'
import Link from 'next/link'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  href?: string
  variant?: 'solid' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
const VAR = {
  solid: 'bg-black text-white hover:opacity-95',
  outline: 'bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80',
  ghost: 'bg-transparent text-black hover:bg-black/5',
}
export default function Button({ asChild, href = '#', variant='solid', size='md', className='', ...props }: Props) {
  const base = 'inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] disabled:opacity-50 disabled:pointer-events-none'
  const cls = `${base} ${VAR[variant]} ${sizes[size]} ${className}`
  if (asChild) { return <Link href={href} className={cls}>{props.children}</Link> }
  return <button className={cls} {...props} />
}
