// src/app/reset/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import InlineAlert from '@/components/ui/InlineAlert'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

/** ===== Password strength helpers ===== */
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

/** ===== URL helpers (query + hash) ===== */
function getURLParams(url: string) {
  const u = new URL(url)
  const q = new URLSearchParams(u.search)
  const h = new URLSearchParams(u.hash.replace(/^#/, ''))
  const get = (k: string) => q.get(k) ?? h.get(k)

  return {
    // Legacy PKCE code
    code: get('code'),

    // token_hash flow (recommended)
    token_hash: get('token_hash') || get('token'),
    type: get('type'),

    // Implicit flow tokens (hash)
    access_token: h.get('access_token'),
    refresh_token: h.get('refresh_token'),
  }
}

type Stage = 'request' | 'sending' | 'exchanging' | 'form' | 'done'

export default function ResetPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [stage, setStage] = useState<Stage>('request')
  const [info, setInfo] = useState<string>('')
  const [err, setErr] = useState<string>('')

  // request stage
  const [email, setEmail] = useState('')

  // form stage
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busyUpdate, setBusyUpdate] = useState(false)

  const strength = useMemo(() => scorePassword(password), [password])
  const canSubmit =
    stage === 'form' &&
    !busyUpdate &&
    password.length >= 8 &&
    password === confirm &&
    strength.score >= 3 &&
    !strength.common &&
    !strength.repeating

  useEffect(() => {
    let mounted = true

    const run = async () => {
      const params = getURLParams(window.location.href)

      // If arriving with params (callback)
      const isCallback =
        !!params.code ||
        (!!params.access_token && !!params.refresh_token) ||
        (!!params.type && !!params.token_hash)

      try {
        setErr('')

        // ✅ First: if no callback params but session already exists (ex: user came from /auth/confirm)
        if (!isCallback) {
          const { data } = await supabase.auth.getSession()
          if (!mounted) return

          if (data.session) {
            setStage('form')
            setInfo('')
            setErr('')
            return
          }

          setStage('request')
          return
        }

        // Callback path
        setStage('exchanging')
        setInfo('Finalizing your reset link…')

        // 1) Implicit tokens in hash
        if (params.access_token && params.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          })
          if (error) throw error
        }
        // 2) token_hash flow (recommended)
        else if (params.type && params.token_hash) {
          const otpType = (params.type || 'recovery') as
            | 'recovery'
            | 'magiclink'
            | 'invite'
            | 'signup'
            | 'email_change'

          const { error } = await supabase.auth.verifyOtp({
            type: otpType,
            token_hash: params.token_hash,
          } as any)

          if (error) throw error
        }
        // 3) Legacy PKCE code flow (works ONLY if same browser/context has code_verifier)
        else if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code)
          if (error) throw error
        } else {
          throw new Error('Reset link is missing required parameters.')
        }

        // Sync cookies server-side so middleware/RSC see the session (same as /login)
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

        // Clean URL (avoid refresh issues)
        window.history.replaceState({}, '', '/reset')

        if (!mounted) return
        setInfo('')
        setStage('form')
      } catch (e: any) {
        if (!mounted) return

        const msg = String(e?.message || e)

        // Friendly hint for classic PKCE verifier issue
        if (msg.toLowerCase().includes('code verifier') || msg.toLowerCase().includes('code_verifier')) {
          setErr(
            'Link error: this reset link was opened in a browser/context that does not have the required code verifier. ' +
              'Please request a new reset link below and open it directly in Safari/Chrome (avoid in-app browsers).'
          )
          setInfo('')
          setStage('request')
          return
        }

        setErr(`Link error: ${msg}`)
        setInfo('')
        setStage('request')
      }
    }

    run()
    return () => {
      mounted = false
    }
  }, [supabase])

  async function requestReset(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setInfo('')

    const em = email.trim()
    if (!em) return

    setStage('sending')
    setInfo('Sending reset email…')

    try {
      // Recommended: go through /auth/confirm (token_hash flow)
      const redirectTo = `${window.location.origin}/auth/confirm?next=/reset`

      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo })
      if (error) {
        setErr(error.message || 'Failed to send reset email.')
        setInfo('')
        setStage('request')
        return
      }

      // Security best practice: do not confirm account existence
      setInfo('If an account exists for this email, you will receive a reset link shortly.')
      setErr('')
      setStage('request')
    } catch (e: any) {
      setErr(String(e?.message || e) || 'Network error')
      setInfo('')
      setStage('request')
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setErr('')
    setInfo('Updating password…')
    setBusyUpdate(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setErr(error.message || 'Failed to update password.')
        setInfo('')
        setBusyUpdate(false)
        return
      }

      setErr('')
      setInfo('✅ Password updated. Redirecting…')
      setStage('done')

      setTimeout(() => router.replace('/profile'), 900)
    } catch (e: any) {
      setErr(String(e?.message || e) || 'Unexpected error')
      setInfo('')
      setBusyUpdate(false)
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">
          {stage === 'form' ? 'Choose a new password.' : 'Request a reset link to your email.'}
        </p>
      </div>

      {(!!err || !!info) && (
        <div className="mb-3">
          <InlineAlert variant={err ? 'error' : 'info'}>{err || info}</InlineAlert>
        </div>
      )}

      {(stage === 'request' || stage === 'sending') && (
        <form
          onSubmit={requestReset}
          className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft"
        >
          <label className="grid gap-1">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              autoComplete="email"
              required
              disabled={stage === 'sending'}
              placeholder="you@example.com"
            />
          </label>

          <button
            disabled={stage === 'sending'}
            className={`mt-1 w-full rounded-xl px-4 py-2 text-sm font-medium ${
              stage === 'sending' ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
            }`}
          >
            {stage === 'sending' ? 'Please wait…' : 'Send reset link'}
          </button>

          <div className="text-xs text-[hsl(var(--muted))]">
            <p>
              Back to{' '}
              <Link className="underline" href="/login">
                login
              </Link>
              .
            </p>
          </div>
        </form>
      )}

      {stage === 'exchanging' && (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <p className="text-sm text-[hsl(var(--muted))]">{info || 'Finalizing your reset link…'}</p>
        </div>
      )}

      {stage === 'form' && (
        <form
          onSubmit={submitNewPassword}
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
              disabled={busyUpdate}
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
              <li className={strength.lower && strength.upper ? 'text-emerald-700' : ''}>Mix of upper & lower case</li>
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
              disabled={busyUpdate}
            />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className={`mt-1 w-full rounded-xl px-4 py-2 text-sm font-medium ${
              canSubmit ? 'bg-black text-white hover:opacity-90' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
            title={!canSubmit ? 'Use a stronger password and ensure both fields match' : 'Update password'}
          >
            {busyUpdate ? 'Updating…' : 'Update password'}
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
          {info || '✅ Password updated. Redirecting…'}
        </div>
      )}
    </main>
  )
}
