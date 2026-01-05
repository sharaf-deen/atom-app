// src/app/auth/complete-invite/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

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

export default function CompleteInvitePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function run() {
      const { access_token, refresh_token, error, error_description } = parseHash(
        window.location.hash,
      )

      if (error || error_description) {
        setError(error_description || error || 'Invalid or expired link.')
        return
      }

      if (!access_token || !refresh_token) {
        setError('Invalid or expired link.')
        return
      }

      const { error: setErr } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      })

      if (setErr) {
        setError(setErr.message)
        return
      }

      // Session OK → on enchaîne sur la page pour choisir un mot de passe
      router.replace('/auth/set-password')
    }

    run()
  }, [router])

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
