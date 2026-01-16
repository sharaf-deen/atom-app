'use client'

import { useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

function sanitizeNext(next: string | null) {
  if (!next) return '/'
  const n = next.trim()
  if (!n.startsWith('/')) return '/'
  if (n.startsWith('//')) return '/'
  if (n.includes('://')) return '/'
  if (n.includes('\\')) return '/'
  return n || '/'
}

export default function LogoutPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const nextUrl = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])

  useEffect(() => {
    ;(async () => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      // Clear browser session
      await supabase.auth.signOut({ scope: 'local' })

      // Clear SSR cookies
      await fetch('/api/auth/signout', { method: 'POST' })

      // Redirect to login, preserving next
      const dest =
        nextUrl && nextUrl !== '/' ? `/login?next=${encodeURIComponent(nextUrl)}` : '/login'

      router.replace(dest)
      router.refresh()
    })()
  }, [router, nextUrl])

  return (
    <main className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-bold">Signing out…</h1>
    </main>
  )
}
