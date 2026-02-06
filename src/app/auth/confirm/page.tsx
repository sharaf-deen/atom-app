'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import InlineAlert from '@/components/ui/InlineAlert'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

type OtpType = 'recovery' | 'magiclink' | 'invite' | 'signup' | 'email_change'

function sanitizeNext(next: string | null) {
  if (!next) return '/reset'
  const n = next.trim()
  if (!n.startsWith('/')) return '/reset'
  if (n.startsWith('//')) return '/reset'
  if (n.includes('://')) return '/reset'
  if (n.includes('\\')) return '/reset'
  return n || '/reset'
}

function normalizeType(raw: string | null): OtpType {
  const t = (raw || 'recovery').toLowerCase()
  if (t === 'recovery') return 'recovery'
  if (t === 'magiclink') return 'magiclink'
  if (t === 'invite') return 'invite'
  if (t === 'signup') return 'signup'
  if (t === 'email_change') return 'email_change'
  return 'recovery'
}

function ConfirmInner() {
  const sp = useSearchParams()
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [msg, setMsg] = useState('Confirming your link…')

  const tokenHash =
    sp.get('token_hash') ||
    sp.get('token') ||
    sp.get('tokenHash') ||
    sp.get('tokenhash') ||
    ''

  const type = normalizeType(sp.get('type'))
  const nextPath = useMemo(() => sanitizeNext(sp.get('next')), [sp])

  useEffect(() => {
    let mounted = true

    ;(async () => {
      try {
        if (!tokenHash) {
          throw new Error('Missing token_hash in URL.')
        }

        setStatus('loading')
        setMsg('Validating link…')

        const { error } = await supabase.auth.verifyOtp({
          type,
          token_hash: tokenHash,
        } as any)

        if (error) throw error

        // Sync cookies server-side (comme /login) pour que middleware/RSC voient la session
        try {
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            await fetch('/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
            })
          }
        } catch {
          // pas bloquant
        }

        if (!mounted) return
        setStatus('ok')
        setMsg('Link confirmed. Redirecting…')

        // Redirection finale
        router.replace(nextPath)
      } catch (e: any) {
        if (!mounted) return
        setStatus('error')
        setMsg(`Link error: ${String(e?.message || e)}`)
      }
    })()

    return () => {
      mounted = false
    }
  }, [supabase, tokenHash, type, nextPath, router])

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Confirm link</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">
          We are validating your link…
        </p>
      </div>

      <InlineAlert variant={status === 'error' ? 'error' : 'info'}>
        {msg}
      </InlineAlert>

      <div className="mt-4 text-xs text-[hsl(var(--muted))] space-y-2">
        <p>
          If this page doesn’t redirect, you can continue here:{' '}
          <Link className="underline" href={nextPath}>
            Continue
          </Link>
        </p>
        <p>
          Or request a new reset link from:{' '}
          <Link className="underline" href="/reset">
            Reset password
          </Link>
        </p>
        <p>
          Back to:{' '}
          <Link className="underline" href="/login">
            Login
          </Link>
        </p>
      </div>
    </main>
  )
}

export default function ConfirmPage() {
  // useSearchParams doit être dans Suspense (Next.js)
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6" />}>
      <ConfirmInner />
    </Suspense>
  )
}
