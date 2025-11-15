// src/app/login/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>('')

  // Si déjà connecté, évite d'afficher la page inutilement
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (data.session) {
        window.location.replace('/') // hard redirect pour forcer la nav SSR à voir la session
      }
    })()
    return () => {
      mounted = false
    }
  }, [supabase])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setErr(error.message)
        return
      }

      // 1) Synchronise la session côté serveur (cookies pour RSC/middleware)
      const r = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j?.error ?? 'Server sync failed')
        return
      }

      // 2) ✅ Hard redirect (garantit que les cookies sont pris en compte)
      window.location.replace('/')
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">Login</h1>

      <form onSubmit={onSubmit} className="grid gap-3 border rounded-xl p-4 bg-white">
        <label className="grid gap-1">
          <span className="text-sm">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-3 py-2 border rounded"
            autoComplete="email"
            required
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-3 py-2 border rounded"
            autoComplete="current-password"
            required
            minLength={8}
          />
        </label>

        <button disabled={busy} className="px-4 py-2 border rounded hover:bg-gray-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {!!err && <div className="text-sm text-red-600">{err}</div>}
      </form>

      <p className="mt-3 text-xs text-gray-500">
        If you were invited, use the link from your email first to set your password.
      </p>
    </main>
  )
}
