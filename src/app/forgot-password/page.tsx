'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'

export default function ForgotPasswordPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [err, setErr] = useState<string>('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    setBusy(true)

    try {
      const redirectTo = `${window.location.origin}/reset` // IMPORTANT: ton chemin final
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) {
        setErr(error.message)
        return
      }
      // Message générique (sécurité)
      setMsg('If this email exists, a reset link has been sent. Check inbox/spam.')
      setEmail('')
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="max-w-sm mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Forgot password</h1>

      {err && <div className="p-3 border rounded bg-red-50 border-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 border rounded bg-green-50 border-green-300 text-sm">{msg}</div>}

      <form onSubmit={onSubmit} className="space-y-3 border rounded p-4 bg-white">
        <label className="text-sm">
          Email
          <input
            type="email"
            className="mt-1 w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </label>

        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="w-full border rounded px-4 py-2 bg-gray-50 hover:bg-gray-100 disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send reset link'}
        </button>

        <div className="text-xs text-gray-600">
          <Link className="underline" href="/login">Back to login</Link>
        </div>
      </form>
    </main>
  )
}
