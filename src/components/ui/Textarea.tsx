'use client'
import * as React from 'react'
type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }
export default function Textarea({ label, hint, className = '', ...props }: Props) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium">{label}</span>}
      <textarea
        className={`w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] ${className}`}
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-[hsl(var(--muted))]">{hint}</span>}
    </label>
  )
}
