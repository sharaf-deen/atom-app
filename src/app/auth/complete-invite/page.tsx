// src/app/auth/complete-invite/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function parseHash(hash: string) {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    error: params.get('error'),
    error_description: params.get('error_description'),
    type: params.get('type'),
  }
}

function sanitizeNext(next: string | null) {
  if (!next) return '/'
  const n = next.trim()
  if (!n.startsWith('/')) return '/'
  if (n.startsWith('//')) return '/'
  if (n.includes('://')) return '/'
  if (n.includes('\\')) return '/'
  return n || '/'
}

export default function CompleteInvitePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const nextUrl = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function run() {
      const { access_token, refresh_token, error, error_description } = parseHash(window.location.hash)

      if (error || error_description) {
        setError(error_description || error || 'Invalid or expired link.')
        return
      }

      if (!access_token || !refresh_token) {
        setError('Invalid or expired link.')
        return
      }

      // 1) Set session in the browser
      const { data, error: setErr } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      })
      if (setErr) {
        setError(setErr.message)
        return
      }

      // 2) Sync cookies on the server (RSC/middleware)
      const r = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
      })

      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setError(j?.error ?? 'Server auth sync failed')
        return
      }

      // 3) Clean hash from URL (optional, avoids leaking tokens in history)
      try {
        const clean = window.location.pathname + window.location.search
        window.history.replaceState({}, document.title, clean)
      } catch {}

      // 4) Go set password, preserving next
      const dest =
        nextUrl && nextUrl !== '/'
          ? `/auth/set-password?next=${encodeURIComponent(nextUrl)}`
          : '/auth/set-password'

      router.replace(dest)
    }

    run()
  }, [router, supabase, nextUrl])

  if (error) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-2xl border border-red-300 bg-red-50 px-6 py-4 text-sm text-red-700 max-w-md text-center">
          <p className="font-semibold mb-1">Link error</p>
          <p>{error}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="rounded-2xl border bg-white px-6 py-4 shadow-sm text-sm text-gray-600">
        Activating your account…
      </div>
    </main>
  )
}
