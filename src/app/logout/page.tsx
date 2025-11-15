'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function LogoutPage() {
  const router = useRouter()

  useEffect(() => {
    ;(async () => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      await supabase.auth.signOut({ scope: 'local' })   // clear storage côté navigateur
      await fetch('/api/auth/signout', { method: 'POST' }) // clear cookies SSR
      router.replace('/login')
      router.refresh() // force le layout à relire une session vide
    })()
  }, [router])

  return <main className="max-w-sm mx-auto p-6"><h1 className="text-xl font-bold">Signing out…</h1></main>
}
