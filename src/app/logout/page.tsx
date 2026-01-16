'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

function safeNext(nextPath: string | null) {
  if (!nextPath) return '/'
  if (nextPath.startsWith('/') && !nextPath.startsWith('//')) return nextPath
  return '/'
}

export default function LogoutPage() {
  const router = useRouter()
  const sp = useSearchParams()

  useEffect(() => {
    ;(async () => {
      const next = safeNext(sp.get('next'))
      const supabase = createSupabaseBrowserClient()

      // 1) Clear browser session
      await supabase.auth.signOut({ scope: 'local' })

      // 2) Clear SSR cookies via /auth sync
      try {
        await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'SIGNED_OUT' }),
        })
      } catch {}

      router.replace(`/login?next=${encodeURIComponent(next)}`)
      router.refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-bold">Signing out…</h1>
    </main>
  )
}
