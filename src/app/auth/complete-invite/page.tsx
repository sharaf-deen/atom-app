'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function getURLParams(href: string) {
  const u = new URL(href)
  const q = u.searchParams
  const h = new URLSearchParams(u.hash.replace(/^#/, ''))
  const get = (k: string) => q.get(k) ?? h.get(k)

  return {
    code: get('code'),
    type: get('type'), // invite | recovery | magiclink...
    token_hash: get('token_hash') ?? get('token'),
    access_token: h.get('access_token'),
    refresh_token: h.get('refresh_token'),
    error: get('error'),
    error_description: get('error_description'),
    next: q.get('next') ?? q.get('redirect_to') ?? q.get('redirectedFrom'),
  }
}

function safeNext(input: string | null): string {
  if (!input) return '/'
  const v = input.trim()
  if (v.startsWith('/') && !v.startsWith('//')) return v
  // si c'est une url complète de ton domaine, on récupère son pathname
  try {
    const u = new URL(v)
    if (typeof window !== 'undefined' && u.origin === window.location.origin) {
      return `${u.pathname}${u.search}`
    }
  } catch {}
  return '/'
}

export default function CompleteInvitePage() {
  const router = useRouter()
  const sp = useSearchParams()
  const next = useMemo(() => safeNext(sp.get('next') || sp.get('redirect_to')), [sp])

  const [stage, setStage] = useState<'working' | 'error'>('working')
  const [msg, setMsg] = useState('Activating your account…')

  async function run() {
    setStage('working')
    setMsg('Activating your account…')

    const supabase = createSupabaseBrowserClient()

    try {
      const p = getURLParams(window.location.href)

      if (p.error || p.error_description) {
        throw new Error(p.error_description || p.error || 'Invalid or expired link.')
      }

      // 1) tokens dans le hash
      if (p.access_token && p.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        })
        if (error) throw error
      }
      // 2) OTP / email token flow (type=invite + token(_hash))
      else if (p.type && p.token_hash) {
        const { error } = await supabase.auth.verifyOtp({
          type: p.type as any,
          token_hash: p.token_hash,
        } as any)
        if (error) throw error
      }
      // 3) PKCE code flow
      else if (p.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(p.code)
        if (error) throw error
      }
      // 4) dernier recours: session déjà là ?
      else {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Invalid or expired link.')
      }

      setMsg('Finalizing…')

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Session missing after activation.')

      // ✅ Sync cookies serveur
      const r = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'SIGNED_IN', session }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'Server sync failed.')
      }

      // Nettoie l'URL (enlève tokens/hash)
      window.history.replaceState({}, '', '/auth/complete-invite')

      // ✅ ensuite: choisir un mot de passe
      router.replace(`/auth/set-password?next=${encodeURIComponent(next || '/')}`)
    } catch (e: any) {
      setStage('error')
      setMsg(e?.message || 'Invalid or expired link.')
    }
  }

  useEffect(() => { run() }, []) // eslint-disable-line

  if (stage === 'error') {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-soft space-y-3 text-center">
          <h1 className="text-lg font-semibold text-red-700">Link error</h1>
          <p className="text-sm text-gray-700">{msg}</p>

          <div className="flex gap-2 justify-center pt-2">
            <button
              onClick={run}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
            >
              Retry
            </button>
            <button
              onClick={() => router.replace('/login')}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:opacity-90"
            >
              Go to login
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-soft text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
        <p className="text-sm text-gray-700">{msg}</p>
      </div>
    </main>
  )
}
