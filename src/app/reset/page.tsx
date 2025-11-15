'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

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
  };
  const commons = ['password','123456','123456789','qwerty','111111','123123','abc123','letmein','azerty','000000'];
  const lowerPw = pw.toLowerCase();
  res.common = commons.some(c => lowerPw.includes(c));

  let charset = 0;
  if (res.lower) charset += 26;
  if (res.upper) charset += 26;
  if (res.digit) charset += 10;
  if (res.symbol) charset += 33;

  const perChar = charset ? Math.log2(charset) : 0;
  res.entropyScore = Math.round(perChar * pw.length);

  let score = 0;
  if (res.lengthOK) score++;
  if (res.lower && res.upper) score++;
  if (res.digit) score++;
  if (res.symbol) score++;
  if (res.entropyScore >= 50) score++;
  if (res.common || res.repeating || res.hasEmailLike) score = Math.max(0, score - 1);

  return { ...res, score };
}
function strengthLabel(score: number) {
  if (score <= 1) return 'Very weak';
  if (score === 2) return 'Weak';
  if (score === 3) return 'Medium';
  if (score === 4) return 'Strong';
  return 'Very strong';
}
function strengthColor(score: number) {
  return [
    'bg-red-500','bg-red-500','bg-yellow-500','bg-amber-500','bg-green-500','bg-green-600'
  ][Math.min(5, Math.max(0, score))];
}

/** ===== URL helpers (query + hash) ===== */
function getURLParams(url: string) {
  const u = new URL(url);
  const q = new URLSearchParams(u.search);
  const h = new URLSearchParams(u.hash.replace(/^#/, ''));
  const get = (k: string) => q.get(k) ?? h.get(k);

  return {
    // PKCE code
    code: get('code'),

    // Email token flow
    token: get('token') || get('token_hash'),
    type: get('type'), // recovery | magiclink | invite | signup | email_change

    // Fragment tokens after Supabase verify redirect
    access_token: h.get('access_token'),
    refresh_token: h.get('refresh_token'),
    token_type: h.get('token_type'),
    expires_in: h.get('expires_in'),
  };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'exchanging'|'form'|'done'|'error'>('exchanging');
  const [msg, setMsg] = useState('Finalizing your reset link…');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);
  const canSubmit =
    !busy &&
    password.length >= 8 &&
    password === confirm &&
    strength.score >= 3 &&
    !strength.common &&
    !strength.repeating;

  useEffect(() => {
    const run = async () => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      try {
        const params = getURLParams(window.location.href);

        // 1) Cas le plus courant après redirect Supabase: tokens dans le hash
        if (params.access_token && params.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (error) throw error;
          setStage('form');
          return;
        }

        // 2) Email token flow explicite (type=recovery & token(_hash))
        if (params.type) {
          const otpType = (params.type || 'recovery') as
            | 'recovery' | 'magiclink' | 'invite' | 'signup' | 'email_change';

          const token_hash = params.token ?? params.code;
          if (!token_hash) {
            throw new Error('Reset link is missing token.');
          }

          const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash } as any);
          if (error) throw error;
          setStage('form');
          return;
        }

        // 3) PKCE code flow (moins courant pour reset)
        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          setStage('form');
          return;
        }

        // 4) Dernier recours : si la session est déjà en place
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setStage('form');
          return;
        }

        throw new Error('Reset link is missing required parameters.');
      } catch (e: any) {
        setMsg(`Link error: ${e?.message || e}`);
        setStage('error');
      }
    };
    run();
  }, []);

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    if (!canSubmit) return;

    setBusy(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMsg(`❌ ${error.message}`);
        setBusy(false);
        return;
      }
      setStage('done');
      setMsg('✅ Password updated. Redirecting…');
      setTimeout(() => router.replace('/profile'), 900);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || 'Unexpected error'}`);
      setBusy(false);
    }
  }

  return (
    <main className="max-w-sm mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Reset your password</h1>

      {stage === 'exchanging' && (
        <div className="p-3 border rounded bg-white">{msg}</div>
      )}

      {stage === 'error' && (
        <div className="p-3 border rounded bg-red-50 border-red-300 text-sm">
          {msg}<br />
          <span className="text-gray-600">
            Try requesting a new reset link from the login page.
          </span>
        </div>
      )}

      {stage === 'form' && (
        <form onSubmit={submitNewPassword} className="space-y-3 border rounded p-4 bg-white">
          <label className="text-sm">
            New password
            <input
              type="password"
              className="mt-1 w-full border rounded px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>

          {/* Strength meter */}
          <div className="space-y-1">
            <div className="h-2 w-full bg-gray-200 rounded overflow-hidden">
              <div
                className={`h-2 ${strengthColor(strength.score)}`}
                style={{
                  width: `${((Math.min(5, Math.max(0, strength.score))) / 5) * 100}%`,
                  transition: 'width 200ms ease',
                }}
              />
            </div>
            <div className="text-xs text-gray-600">
              Strength: <b>{strengthLabel(strength.score)}</b>
              {strength.common && ' • Avoid common passwords'}
              {strength.repeating && ' • Avoid repeated characters'}
            </div>
            <ul className="text-xs text-gray-600 list-disc pl-4">
              <li className={password.length >= 8 ? 'text-green-700' : ''}>At least 8 characters</li>
              <li className={strength.lower && strength.upper ? 'text-green-700' : ''}>Mix of upper & lower case</li>
              <li className={strength.digit ? 'text-green-700' : ''}>Contains a number</li>
              <li className={strength.symbol ? 'text-green-700' : ''}>Contains a symbol</li>
            </ul>
          </div>

          <label className="text-sm">
            Confirm password
            <input
              type="password"
              className="mt-1 w-full border rounded px-3 py-2"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full border rounded px-4 py-2 ${canSubmit ? 'bg-gray-50 hover:bg-gray-100' : 'bg-gray-100 opacity-60 cursor-not-allowed'}`}
            title={!canSubmit ? 'Use a stronger password and ensure both fields match' : 'Update password'}
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>

          {msg && (
            <div className={`mt-2 p-2 border rounded text-sm ${
              msg.startsWith('✅') ? 'bg-green-50 border-green-300' :
              msg.startsWith('❌') ? 'bg-red-50 border-red-300' : 'bg-white'
            }`}>
              {msg}
            </div>
          )}
        </form>
      )}

      {stage === 'done' && (
        <div className="p-3 border rounded bg-green-50 border-green-300 text-sm">{msg}</div>
      )}
    </main>
  );
}
