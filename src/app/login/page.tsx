'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function safeNext(input: string | null): string {
  if (!input) return '/'
  const v = input.trim()
  // accepte uniquement un chemin relatif (sécurité)
  if (v.startsWith('/') && !v.startsWith('//')) return v
  return '/'
}

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient()
  const sp = useSearchParams()

  const next = useMemo(() => safeNext(sp.get('next') || sp.get('redirectedFrom')), [sp])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  // Si déjà connecté, redirige direct
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (data.session) window.location.replace(next || '/')
    })()
    return () => { mounted = false }
  }, [supabase, next])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr('')
    setInfo('')
    setBusy(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // message plus friendly
        setErr(error.message.toLowerCase().includes('invalid')
          ? 'Incorrect email or password.'
          : error.message
        )
        return
      }

      // ✅ Sync cookies serveur
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

      // ✅ redirect propre
      window.location.replace(next || '/')
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function sendResetLink() {
    setErr('')
    setInfo('')
    if (!email.trim()) {
      setErr('Enter your email first.')
      return
    }

    setBusy(true)
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/reset`,
      })
      if (error) {
        setErr(error.message)
        return
      }
      setInfo('✅ Reset link sent. Check your email.')
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Login</h1>

      {next !== '/' && (
        <div className="text-sm rounded-xl border bg-white p-3">
          Please sign in to continue.
        </div>
      )}

      <form onSubmit={onSubmit} className="grid gap-3 border rounded-xl p-4 bg-white">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Email</span>
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
          <span className="text-sm font-medium">Password</span>
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

        <button
          disabled={busy}
          className={`px-4 py-2 border rounded ${busy ? 'opacity-60' : 'hover:bg-gray-50'}`}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={sendResetLink}
          disabled={busy}
          className={`px-4 py-2 border rounded ${busy ? 'opacity-60' : 'hover:bg-gray-50'}`}
        >
          {busy ? 'Please wait…' : 'Forgot password? Send reset link'}
        </button>

        {!!err && <div className="text-sm text-red-600">{err}</div>}
        {!!info && <div className="text-sm text-green-700">{info}</div>}
      </form>

      <p className="text-xs text-gray-500">
        If you were invited, use the link from your email first to set your password.
      </p>
    </main>
  )
}
