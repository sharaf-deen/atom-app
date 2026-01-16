// src/app/auth/set-password/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

function loginUrl(nextUrl: string) {
  return nextUrl && nextUrl !== '/'
    ? `/login?next=${encodeURIComponent(nextUrl)}`
    : '/login'
}

export default function SetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const nextUrl = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Require a session to set password (invite flow)
  useEffect(() => {
    ;(async () => {
      setChecking(true)
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.replace(loginUrl(nextUrl))
        return
      }
      setChecking(false)
    })()
  }, [supabase, router, nextUrl])

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

    if (updErr) {
      setBusy(false)
      setError(updErr.message)
      return
    }

    // Resync cookies server side (safe)
    const { data: sess } = await supabase.auth.getSession()
    if (sess.session) {
      await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_IN', session: sess.session }),
      }).catch(() => {})
    }

    setBusy(false)
    setSuccess('Password set successfully. Redirecting…')

    setTimeout(() => {
      window.location.replace(nextUrl || '/')
    }, 900)
  }

  if (checking) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm text-sm text-gray-600">
          Checking session…
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="text-sm text-gray-500 mt-1">
          Choose a password for your Atom account.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
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
              minLength={8}
              required
              autoComplete="new-password"
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
              minLength={8}
              required
              autoComplete="new-password"
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

          <button
            type="button"
            onClick={() => router.replace(loginUrl(nextUrl))}
            className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            disabled={busy}
          >
            Back to login
          </button>

          <p className="text-xs text-gray-500 pt-1">
            After saving, you’ll be redirected to{' '}
            <span className="font-medium">{nextUrl || '/'}</span>.
          </p>
        </form>
      </div>
    </main>
  )
}
