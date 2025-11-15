// src/components/SignOutButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function SignOutButton({ className = '' }: { className?: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')

  async function onSignOut() {
    setLoading(true)
    setErr('')
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' })
      const data = await res.json()
      if (data?.ok) {
        // Redirige vers la page de login (ou l’accueil si tu préfères)
        router.replace('/login')
      } else {
        setErr(data?.error ?? 'Failed to sign out')
      }
    } catch {
      setErr('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSignOut}
        disabled={loading}
        className={`px-3 py-1.5 rounded border hover:bg-gray-50 ${className}`}
      >
        {loading ? 'Signing out…' : 'Logout'}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}
