'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
}

export default function PasswordInput({ label, hint, className = '', id, ...props }: Props) {
  const [show, setShow] = React.useState(false)
  const autoId = React.useId()
  const inputId = id ?? autoId

  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="mb-1 block text-sm font-medium">{label}</span>}

      <div className="relative">
        <input
          id={inputId}
          {...props}
          type={show ? 'text' : 'password'}
          className={`w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 pr-10 text-sm placeholder:text-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] ${className}`}
        />

        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[hsl(var(--muted))] hover:bg-black/5"
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {hint && <span className="mt-1 block text-xs text-[hsl(var(--muted))]">{hint}</span>}
    </label>
  )
}
