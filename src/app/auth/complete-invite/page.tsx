// src/app/auth/complete-invite/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

type State =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'success'; message: string }

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

function loginUrl(nextUrl: string) {
  return nextUrl && nextUrl !== '/'
    ? `/login?next=${encodeURIComponent(nextUrl)}`
    : '/login'
}

function setPasswordUrl(nextUrl: string) {
  return nextUrl && nextUrl !== '/'
    ? `/auth/set-password?next=${encodeURIComponent(nextUrl)}`
    : '/auth/set-password'
}

export default function CompleteInvitePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const nextUrl = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])

  const [state, setState] = useState<State>({
    kind: 'loading',
    message: 'Activating your account…',
  })

  useEffect(() => {
    async function run() {
      // If user already has a session (rare), go straight to set-password
      const { data: s0 } = await supabase.auth.getSession()
      if (s0.session) {
        setState({ kind: 'success', message: 'Session detected. Redirecting…' })
        router.replace(setPasswordUrl(nextUrl))
        return
      }

      const { access_token, refresh_token, error, error_description } = parseHash(window.location.hash)

      if (error || error_description) {
        setState({
          kind: 'error',
          title: 'Link error',
          message: error_description || error || 'Invalid or expired invite link.',
        })
        return
      }

      if (!access_token || !refresh_token) {
        setState({
          kind: 'error',
          title: 'Invite link missing',
          message:
            'This invite link is invalid or has expired. Please request a new invite or sign in if you already have a password.',
        })
        return
      }

      setState({ kind: 'loading', message: 'Signing you in…' })

      // 1) Set session in browser
      const { data, error: setErr } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      })
      if (setErr) {
        setState({
          kind: 'error',
          title: 'Could not sign in',
          message: setErr.message,
        })
        return
      }

      // 2) Sync cookies for SSR/middleware
      const r = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
      })

      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setState({
          kind: 'error',
          title: 'Server sync failed',
          message: j?.error ?? 'Could not sync authentication cookies.',
        })
        return
      }

      // 3) Clean hash tokens from URL history
      try {
        const clean = window.location.pathname + window.location.search
        window.history.replaceState({}, document.title, clean)
      } catch {}

      setState({ kind: 'success', message: 'Account activated. Redirecting…' })

      // 4) Redirect to set password (preserve next)
      router.replace(setPasswordUrl(nextUrl))
    }

    run()
  }, [router, supabase, nextUrl])

  const goLogin = () => router.replace(loginUrl(nextUrl))
  const goSetPassword = () => router.replace(setPasswordUrl(nextUrl))

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Complete Invite</h1>

          {state.kind === 'loading' && (
            <p className="text-sm text-gray-600">{state.message}</p>
          )}

          {state.kind === 'success' && (
            <p className="text-sm text-gray-700">{state.message}</p>
          )}

          {state.kind === 'error' && (
            <>
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                <div className="font-semibold">{state.title}</div>
                <div className="mt-1">{state.message}</div>
              </div>

              <div className="pt-2 flex gap-2 flex-wrap">
                <button
                  onClick={goLogin}
                  className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Go to login
                </button>

                <button
                  onClick={goSetPassword}
                  className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
                >
                  I already have a password
                </button>
              </div>

              <p className="text-xs text-gray-500 pt-2">
                If you need a new invite, ask an administrator to resend it.
              </p>
            </>
          )}
        </div>

        {state.kind !== 'error' && (
          <div className="mt-4 text-xs text-gray-500">
            Please keep this tab open while we finish activating your account.
          </div>
        )}
      </div>
    </main>
  )
}
