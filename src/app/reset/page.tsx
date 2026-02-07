'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import PasswordInput from '@/components/ui/PasswordInput'

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
  const commons = ['password', '123456', '123456789', 'qwerty', '111111', '123123', 'abc123', 'letmein', 'azerty', '000000']
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
    code: get('code'),
    token: get('token') || get('token_hash'),
    type: get('type'),
    access_token: h.get('access_token'),
    refresh_token: h.get('refresh_token'),
  }
}

type Stage = 'exchanging' | 'request' | 'form' | 'done'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [stage, setStage] = useState<Stage>('exchanging')

  // Request reset link
  const [email, setEmail] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  // Set new password
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const [err, setErr] = useState<string>('')
  const [info, setInfo] = useState<string>('')

  const strength = useMemo(() => scorePassword(password), [password])
  const canSubmit =
    !busy &&
    password.length >= 8 &&
    password === confirm &&
    strength.score >= 3 &&
    !strength.common &&
    !strength.repeating

  useEffect(() => {
    const run = async () => {
      setErr('')
      setInfo('Finalizing your reset link…')

      try {
        const params = getURLParams(window.location.href)

        // 1) Most common after Supabase redirect: tokens in the hash
        if (params.access_token && params.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          })
          if (error) throw error

          // Sync cookies server-side for middleware / RSC
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            await fetch('/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
            }).catch(() => {})
          }

          setInfo('')
          setStage('form')
          return
        }

        // 2) Explicit email token flow (type=recovery & token_hash)
        if (params.type) {
          const otpType = (params.type || 'recovery') as
            | 'recovery'
            | 'magiclink'
            | 'invite'
            | 'signup'
            | 'email_change'

          const token_hash = params.token
          if (!token_hash) throw new Error('Reset link is missing token.')

          const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash } as any)
          if (error) throw error

          const { data } = await supabase.auth.getSession()
          if (data.session) {
            await fetch('/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
            }).catch(() => {})
          }

          setInfo('')
          setStage('form')
          return
        }

        // 3) PKCE code flow
        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code)
          if (error) throw error

          const { data } = await supabase.auth.getSession()
          if (data.session) {
            await fetch('/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'SIGNED_IN', session: data.session }),
            }).catch(() => {})
          }

          setInfo('')
          setStage('form')
          return
        }

        // 4) If already have a session
        const { data: sess } = await supabase.auth.getSession()
        if (sess.session) {
          setInfo('')
          setStage('form')
          return
        }

        // No params -> this is the "request reset link" entry
        setInfo('')
        setStage('request')
      } catch (e: any) {
        setInfo('')
        setErr(`Link error: ${e?.message || e}`)
        // Still allow the user to request a fresh link
        setStage('request')
      }
    }

    run()
  }, [supabase])

  async function sendResetLink(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setInfo('')
    setRequestSent(false)

    if (!email.trim()) return

    setRequestBusy(true)
    try {
      const redirectTo = `${window.location.origin}/reset`
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) throw error

      // Avoid account enumeration: always show a generic success message
      setRequestSent(true)
      setInfo('If an account exists for this email, a reset link has been sent.')
    } catch (e: any) {
      setErr(e?.message || 'Unable to send reset email')
    } finally {
      setRequestBusy(false)
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setInfo('')
    if (!canSubmit) return

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      setStage('done')
      setInfo('✅ Password updated. Redirecting…')
      setTimeout(() => router.replace('/profile'), 900)
    } catch (e: any) {
      setErr(e?.message || 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="max-w-md mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">
          {stage === 'request'
            ? 'Enter your email to receive a reset link.'
            : 'Choose a new password for your account.'}
        </p>
      </div>

      {info && stage !== 'done' && <InlineAlert variant="info">{info}</InlineAlert>}
      {err && <InlineAlert variant="error">{err}</InlineAlert>}

      {stage === 'exchanging' && !info && (
        <InlineAlert variant="info">Finalizing your reset link…</InlineAlert>
      )}

      {stage === 'request' && (
        <form
          onSubmit={sendResetLink}
          className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft"
        >
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            autoComplete="email"
            required
            disabled={requestBusy}
          />

          <Button type="submit" disabled={requestBusy}>
            {requestBusy ? 'Sending…' : 'Send reset link'}
          </Button>

          {requestSent && (
            <p className="text-xs text-[hsl(var(--muted))]">
              Check your inbox (and spam). The link will open this page again so you can set a new password.
            </p>
          )}

          <Button type="button" variant="outline" onClick={() => router.replace('/login')} disabled={requestBusy}>
            Back to login
          </Button>

        </form>
      )}

      {stage === 'form' && (
        <form
          onSubmit={submitNewPassword}
          className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft"
        >
          <PasswordInput
            label="New password"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            minLength={8}
            required
            autoComplete="new-password"
            disabled={busy}
          />

          {/* Strength meter */}
          <div className="space-y-1">
            <div className="h-2 w-full bg-gray-200 rounded overflow-hidden">
              <div
                className={`h-2 ${strengthColor(strength.score)}`}
                style={{
                  width: `${(Math.min(5, Math.max(0, strength.score)) / 5) * 100}%`,
                  transition: 'width 200ms ease',
                }}
              />
            </div>
            <div className="text-xs text-[hsl(var(--muted))]">
              Strength: <b className="text-[hsl(var(--fg))]">{strengthLabel(strength.score)}</b>
              {strength.common && ' • Avoid common passwords'}
              {strength.repeating && ' • Avoid repeated characters'}
            </div>
            <ul className="text-xs text-[hsl(var(--muted))] list-disc pl-4">
              <li className={password.length >= 8 ? 'text-emerald-700' : ''}>At least 8 characters</li>
              <li className={strength.lower && strength.upper ? 'text-emerald-700' : ''}>
                Mix of upper & lower case
              </li>
              <li className={strength.digit ? 'text-emerald-700' : ''}>Contains a number</li>
              <li className={strength.symbol ? 'text-emerald-700' : ''}>Contains a symbol</li>
            </ul>
          </div>

          <PasswordInput
            label="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm((e.target as HTMLInputElement).value)}
            minLength={8}
            required
            autoComplete="new-password"
            disabled={busy}
          />

          <Button type="submit" disabled={!canSubmit}>
            {busy ? 'Updating…' : 'Update password'}
          </Button>

          <p className="text-xs text-[hsl(var(--muted))]">
            If you opened this page without a link, go back and request a reset email.
          </p>
        </form>
      )}

      {stage === 'done' && info && <InlineAlert variant="success">{info}</InlineAlert>}
    </main>
  )
}
