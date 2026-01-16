// src/app/login/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function sanitizeNext(next: string | null) {
  if (!next) return '/'
  const n = next.trim()

  // Only allow internal paths
  if (!n.startsWith('/')) return '/'
  if (n.startsWith('//')) return '/'
  if (n.includes('://')) return '/'
  if (n.includes('\\')) return '/'

  return n || '/'
}

export default function LoginPage() {
  const searchParams = useSearchParams()

  const nextUrl = useMemo(() => {
    return sanitizeNext(searchParams.get('next'))
  }, [searchParams])

  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>('')

  // Si déjà connecté, redirige directement vers next (ou /)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (data.session) {
        window.location.replace(nextUrl) // hard redirect pour que SSR/middleware voient la session
      }
    })()
    return () => {
      mounted = false
    }
  }, [supabase, nextUrl])

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

      // Sync cookies côté serveur (RSC/middleware)
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

      // Redirect final vers next (ou /)
      window.location.replace(nextUrl)
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-1">Login</h1>
      <p className="text-sm text-gray-600 mb-4">
        {nextUrl !== '/' ? `Continue to: ${nextUrl}` : 'Sign in to continue.'}
      </p>

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

      <div className="mt-3 text-xs text-gray-500 space-y-1">
        <p>If you were invited, use the link from your email first to set your password.</p>
        <p>
          Forgot your password? <a className="underline" href="/reset">Reset here</a>
        </p>
      </div>
    </main>
  )
}
