'use client'
import * as React from 'react'
import { useTheme } from 'next-themes'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const isDark = (resolvedTheme || theme) === 'dark'
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={'rounded-2xl border border-black/10 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ' + className}
    >
      {isDark ? 'Light' : 'Dark'}
    </button>
  )
}
