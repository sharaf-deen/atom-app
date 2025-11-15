// src/app/auth/callback/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [msg, setMsg] = useState('Finalizing sign-in…')

  useEffect(() => {
    const run = async () => {
      try {
        const hash = typeof window !== 'undefined' ? window.location.hash : ''
        const params = new URLSearchParams(hash.replace(/^#/, ''))
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        const type = params.get('type') // 'invite' | 'recovery' | etc.
        const error_description = params.get('error_description')

        if (error_description) {
          setMsg(`Auth error: ${error_description}`)
          return
        }
        if (!access_token || !refresh_token) {
          setMsg('No auth tokens found in URL.')
          return
        }

        const supabase = createSupabaseBrowserClient()
        const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
        if (setErr) {
          setMsg(`setSession failed: ${setErr.message}`)
          return
        }

        // Sync côté serveur (cookies)
        await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'SIGNED_IN', session: (await supabase.auth.getSession()).data.session }),
        })

        // Nettoie le hash de l'URL
        window.history.replaceState({}, '', window.location.pathname)

        // Redirige : invite / recovery → set password ; sinon → profile
        if (type === 'invite' || type === 'recovery') {
          router.replace('/auth/set-password')
        } else {
          router.replace('/profile')
        }
      } catch (e) {
        setMsg('Unexpected error during callback.')
      }
    }
    run()
  }, [router])

  return (
    <main className="p-6 max-w-md mx-auto">
      <p className="text-sm">{msg}</p>
    </main>
  )
}
