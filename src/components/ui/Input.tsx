'use client'

import * as React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
}

const Input = React.forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, className = '', ...props },
  ref,
) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-semibold text-black">{label}</span>}
      <input
        ref={ref}
        className={`min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-[hsl(var(--muted))] shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] ${className}`}
        {...props}
      />
      {hint && <span className="mt-1.5 block text-xs text-[hsl(var(--muted))]">{hint}</span>}
    </label>
  )
})

Input.displayName = 'Input'

export default Input
