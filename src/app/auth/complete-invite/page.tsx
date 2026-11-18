// src/app/auth/complete-invite/page.tsx
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
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
  if (!next) return '/profile'
  const n = next.trim()
  if (!n.startsWith('/')) return '/profile'
  if (n.startsWith('//')) return '/profile'
  if (n.includes('://')) return '/profile'
  if (n.includes('\\')) return '/profile'
  return n || '/profile'
}

function loginUrl(nextUrl: string) {
  return nextUrl && nextUrl !== '/profile'
    ? `/login?next=${encodeURIComponent(nextUrl)}`
    : '/login'
}

/**
 * We interpret "next" on /auth/complete-invite as:
 * "where to go AFTER password is set".
 *
 * If someone passes next=/auth/set-password by mistake:
 * - we convert it to /profile (default)
 * - or if next=/auth/set-password?next=/something -> we extract /something
 */
function resolveNextAfterPassword(rawNext: string | null) {
  const nextUrl = sanitizeNext(rawNext)

  if (nextUrl.startsWith('/auth/set-password')) {
    // Try to extract nested next from "/auth/set-password?next=/profile"
    try {
      const u = new URL(`http://local${nextUrl}`)
      const nested = u.searchParams.get('next')
      const nestedSanitized = sanitizeNext(nested)

      // Prevent self-loop
      if (nestedSanitized.startsWith('/auth/set-password')) return '/profile'
      return nestedSanitized || '/profile'
    } catch {
      return '/profile'
    }
  }

  return nextUrl || '/profile'
}

function setPasswordUrl(nextAfterPassword: string) {
  return nextAfterPassword && nextAfterPassword !== '/profile'
    ? `/auth/set-password?next=${encodeURIComponent(nextAfterPassword)}`
    : '/auth/set-password'
}


// Avoid an indefinite spinner when browser auth storage or a network request stalls.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${step} timed out. Please try again.`)), ms)
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

function CompleteInviteInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  // "next" means: destination AFTER password is set
  const nextAfterPassword = useMemo(
    () => resolveNextAfterPassword(searchParams.get('next')),
    [searchParams],
  )

  const [state, setState] = useState<State>({
    kind: 'loading',
    message: 'Activating your account…',
  })

  useEffect(() => {
    let cancelled = false
    const fail = (title: string, message: string) => {
      if (!cancelled) setState({ kind: 'error', title, message })
    }
    const redirectToPassword = () => {
      if (cancelled) return
      // Remove credentials from browser history only after establishing a session.
      try {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search)
      } catch {}
      setState({ kind: 'success', message: 'Account activated. Redirecting…' })
      router.replace(setPasswordUrl(nextAfterPassword))
    }

    async function run() {
      try {
        // Read credentials before the auth client can consume the URL fragment.
        const { access_token, refresh_token, error, error_description } = parseHash(window.location.hash)
        if (error || error_description) {
          fail('Link error', error_description || error || 'Invalid or expired invite link.')
          return
        }

        // A freshly opened invite contains tokens. Handle them before checking any
        // previously stored session (which can belong to a different account).
        if (access_token && refresh_token) {
          if (!cancelled) setState({ kind: 'loading', message: 'Signing you in…' })
          const { data, error: setErr } = await withTimeout(
            supabase.auth.setSession({ access_token, refresh_token }),
            12000,
            'Invitation sign-in',
          )
          if (setErr || !data.session) {
            fail('Could not sign in', setErr?.message || 'No session was returned for this invitation.')
            return
          }
        } else {
          // Supabase may already have consumed the invite fragment automatically;
          // on a reopened link, an established session can still be used.
          const { data, error: sessionErr } = await withTimeout(
            supabase.auth.getSession(),
            12000,
            'Session check',
          )
          if (sessionErr || !data.session) {
            fail(
              'Invitation not available',
              'We could not find an active invitation session. Please reopen the latest invitation email or ask ATOM reception for a new link.',
            )
            return
          }
        }

        if (cancelled) return
        setState({ kind: 'loading', message: 'Finishing activation…' })

        const { data: current, error: sessionErr } = await withTimeout(
          supabase.auth.getSession(),
          12000,
          'Session confirmation',
        )
        if (sessionErr || !current.session) {
          fail('Session unavailable', 'Your invitation session could not be confirmed. Please retry.')
          return
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 12000)
        try {
          const response = await fetch('/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ event: 'SIGNED_IN', session: current.session }),
            signal: controller.signal,
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            fail('Server sync failed', payload?.error ?? 'Could not sync authentication cookies.')
            return
          }
        } finally {
          clearTimeout(timer)
        }

        redirectToPassword()
      } catch (e) {
        fail(
          'Activation could not finish',
          e instanceof Error ? e.message : 'An unexpected error occurred. Please retry.',
        )
      }
    }

    void run()
    return () => { cancelled = true }
  }, [router, supabase, nextAfterPassword])

  const retry = () => window.location.reload()
  const goLogin = () => router.replace(loginUrl(nextAfterPassword))
  const goSetPassword = () => router.replace(setPasswordUrl(nextAfterPassword))

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Complete Invite</h1>

          {state.kind === 'loading' && <p className="text-sm text-gray-600">{state.message}</p>}

          {state.kind === 'success' && <p className="text-sm text-gray-700">{state.message}</p>}

          {state.kind === 'error' && (
            <>
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                <div className="font-semibold">{state.title}</div>
                <div className="mt-1">{state.message}</div>
              </div>

              <div className="pt-2 flex gap-2 flex-wrap">\n                <button onClick={retry} className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">\n                  Try again\n                </button>
                <button onClick={goLogin} className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                  Go to login
                </button>

                <button onClick={goSetPassword} className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                  I already have a password
                </button>
              </div>

              <p className="text-xs text-gray-500 pt-2">If you need a new invite, ask an administrator to resend it.</p>
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

export default function CompleteInvitePage() {
  return (
    <Suspense fallback={<main className="flex min-h-[70vh] items-center justify-center px-4" />}>
      <CompleteInviteInner />
    </Suspense>
  )
}
