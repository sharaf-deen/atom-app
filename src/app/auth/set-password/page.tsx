// src/app/auth/set-password/page.tsx
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import InlineAlert from '@/components/ui/InlineAlert'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

/** ===== Password strength helpers (same as /reset) ===== */
function scorePassword(pw: string) {
  const res = {
    lengthOK: pw.length >= 8,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
    common: false,
    repeating: /(.)\1\1/.test(pw),
    hasEmailLike: /@/.test(pw),
    entropyScore: 0,
  }

  const commons = [
    'password',
    '123456',
    '123456789',
    'qwerty',
    '111111',
    '123123',
    'abc123',
    'letmein',
    'azerty',
    '000000',
  ]
  const lowerPw = pw.toLowerCase()
  res.common = commons.some((c) => lowerPw.includes(c))

  let charset = 0
  if (res.lower) charset += 26
  if (res.upper) charset += 26
  if (res.digit) charset += 10
  if (res.symbol) charset += 33

  const perChar = charset ? Math.log2(charset) : 0
  res.entropyScore = Math.round(perChar * pw.length)

  let score = 0
  if (res.lengthOK) score++
  if (res.lower && res.upper) score++
  if (res.digit) score++
  if (res.symbol) score++
  if (res.entropyScore >= 50) score++
  if (res.common || res.repeating || res.hasEmailLike) score = Math.max(0, score - 1)

  return { ...res, score }
}

function strengthLabel(score: number) {
  if (score <= 1) return 'Very weak'
  if (score === 2) return 'Weak'
  if (score === 3) return 'Medium'
  if (score === 4) return 'Strong'
  return 'Very strong'
}

function strengthColor(score: number) {
  return ['bg-red-500', 'bg-red-500', 'bg-yellow-500', 'bg-amber-500', 'bg-green-500', 'bg-green-600'][
    Math.min(5, Math.max(0, score))
  ]
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

type Stage = 'checking' | 'form' | 'done' | 'blocked'

function SetPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextUrl = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])

  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [stage, setStage] = useState<Stage>('checking')
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const strength = useMemo(() => scorePassword(password), [password])

  const canSubmit =
    stage === 'form' &&
    !busy &&
    password.length >= 8 &&
    password === confirm &&
    strength.score >= 3 &&
    !strength.common &&
    !strength.repeating

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setErr('')
      setInfo('Checking session…')

      const { data } = await supabase.auth.getSession()
      if (!mounted) return

      if (!data.session) {
        setInfo('')
        setErr(
          'You need an active session to set your password. Please open the invite link again, or sign in if you already have a password.'
        )
        setStage('blocked')
        return
      }

      setInfo('')
      setStage('form')
    })()

    return () => {
      mounted = false
    }
  }, [supabase])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setErr('')
    setInfo('Updating password…')

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setErr(error.message || 'Failed to set password.')
        setInfo('')
        setBusy(false)
        return
      }

      // Sync cookies server-side (same pattern as /login and /reset)
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
        // ignore
      }

      setErr('')
      setInfo('✅ Password set. Redirecting…')
      setStage('done')

      setTimeout(() => router.replace(nextUrl), 900)
    } catch (e: any) {
      setErr(String(e?.message || e) || 'Unexpected error')
      setInfo('')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Set your password</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">Choose a password to activate your account.</p>
      </div>

      {(!!err || !!info) && (
        <div className="mb-3">
          <InlineAlert variant={err ? 'error' : 'info'}>{err || info}</InlineAlert>
        </div>
      )}

      {stage === 'checking' && (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <p className="text-sm text-[hsl(var(--muted))]">Checking session…</p>
        </div>
      )}

      {stage === 'blocked' && (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <p className="text-sm text-[hsl(var(--muted))]">
            Please open the invite email link again to activate your account.
          </p>

          <div className="mt-3 text-xs text-[hsl(var(--muted))]">
            Or go to{' '}
            <Link className="underline" href="/login">
              login
            </Link>
            .
          </div>
        </div>
      )}

      {stage === 'form' && (
        <form
          onSubmit={submit}
          className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft"
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium">New password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              disabled={busy}
            />
          </label>

          {/* Strength meter */}
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
              <div
                className={`h-2 ${strengthColor(strength.score)}`}
                style={{
                  width: `${(Math.min(5, Math.max(0, strength.score)) / 5) * 100}%`,
                  transition: 'width 200ms ease',
                }}
              />
            </div>

            <div className="text-xs text-[hsl(var(--muted))]">
              Strength: <b>{strengthLabel(strength.score)}</b>
              {strength.common && ' • Avoid common passwords'}
              {strength.repeating && ' • Avoid repeated characters'}
            </div>

            <ul className="list-disc pl-4 text-xs text-[hsl(var(--muted))]">
              <li className={password.length >= 8 ? 'text-emerald-700' : ''}>At least 8 characters</li>
              <li className={strength.lower && strength.upper ? 'text-emerald-700' : ''}>
                Mix of upper & lower case
              </li>
              <li className={strength.digit ? 'text-emerald-700' : ''}>Contains a number</li>
              <li className={strength.symbol ? 'text-emerald-700' : ''}>Contains a symbol</li>
            </ul>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Confirm password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
              disabled={busy}
            />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className={`mt-1 w-full rounded-xl px-4 py-2 text-sm font-medium ${
              canSubmit ? 'bg-black text-white hover:opacity-90' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
            title={!canSubmit ? 'Use a stronger password and ensure both fields match' : 'Set password'}
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>

          <div className="text-xs text-[hsl(var(--muted))]">
            <Link className="underline" href="/login">
              Back to login
            </Link>
          </div>
        </form>
      )}

      {stage === 'done' && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-800 shadow-soft">
          {info || '✅ Password set. Redirecting…'}
        </div>
      )}
    </main>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6" />}>
      <SetPasswordInner />
    </Suspense>
  )
}
