'use client'
import * as React from 'react'
type Props = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }
export default function Input({ label, hint, className = '', ...props }: Props) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium">{label}</span>}
      <input
        className={`w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] ${className}`}
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-[hsl(var(--muted))]">{hint}</span>}
    </label>
  )
}
