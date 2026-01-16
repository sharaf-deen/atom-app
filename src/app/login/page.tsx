// src/app/login/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function sanitizeNext(next: string | null) {
  if (!next) return '/'
  const n = next.trim()

  if (!n.startsWith('/')) return '/'
  if (n.startsWith('//')) return '/'
  if (n.includes('://')) return '/'
  if (n.includes('\\')) return '/'

  return n || '/'
}

export default function LoginPage() {
  const searchParams = useSearchParams()
  const nextUrl = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])

  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>('') // info banner
  const [err, setErr] = useState<string>('')

  // If already logged in -> redirect
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (data.session) {
        setStatus('You are already signed in. Redirecting…')
        window.location.replace(nextUrl)
      }
    })()
    return () => {
      mounted = false
    }
  }, [supabase, nextUrl])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr('')
    setStatus('')
    setBusy(true)

    try {
      setStatus('Signing in…')

      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setErr(error.message)
        setStatus('')
        return
      }

      setStatus('Syncing session…')

      // Sync cookies server-side so middleware/RSC see the session
      const r = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
      })

      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErr(j?.error ?? 'Server sync failed')
        setStatus('')
        return
      }

      setStatus('Signed in. Redirecting…')
      window.location.replace(nextUrl)
    } catch {
      setErr('Network error')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Login</h1>
        <p className="text-sm text-gray-600">
          {nextUrl !== '/' ? `Continue to: ${nextUrl}` : 'Sign in to continue.'}
        </p>
      </div>

      {(!!status || !!err) && (
        <div
          className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
            err ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-700'
          }`}
        >
          {err || status}
        </div>
      )}

      <form onSubmit={onSubmit} className="grid gap-3 border rounded-2xl p-5 bg-white shadow-sm">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-3 py-2 border rounded-lg"
            autoComplete="email"
            required
            disabled={busy}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-3 py-2 border rounded-lg"
            autoComplete="current-password"
            required
            minLength={8}
            disabled={busy}
          />
        </label>

        <button
          disabled={busy}
          className={`mt-1 w-full rounded-lg px-4 py-2 text-sm font-medium ${
            busy ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
          }`}
        >
          {busy ? 'Please wait…' : 'Sign in'}
        </button>

        <div className="text-xs text-gray-500 space-y-1 pt-1">
          <p>If you were invited, use the link from your email first to set your password.</p>
          <p>
            Forgot your password? <a className="underline" href="/reset">Reset here</a>
          </p>
        </div>
      </form>
    </main>
  )
}
