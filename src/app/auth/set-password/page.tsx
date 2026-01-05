// src/app/auth/set-password/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    const { error: updErr } = await supabase.auth.updateUser({ password })

    setBusy(false)

    if (updErr) {
      setError(updErr.message)
      return
    }

    setSuccess('Password set successfully. You can now log in.')
    // Petite pause puis redirection vers la page login
    setTimeout(() => {
      router.replace('/login')
    }, 1500)
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-soft space-y-4"
      >
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="text-sm text-gray-500">
          Choose a password for your Atom Jiu-Jitsu account. You will use it next time you log in.
        </p>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
            {success}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">New password</label>
          <input
            type="password"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Confirm password</label>
          <input
            type="password"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
            busy ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
          }`}
        >
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </main>
  )
}
