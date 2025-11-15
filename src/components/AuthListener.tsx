// src/components/AuthListener.tsx
'use client'

import { useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

export default function AuthListener() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Synchronise les cookies serveur à chaque évènement
      await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, session }),
      })
    })
    return () => subscription.subscription.unsubscribe()
  }, [])
  return null
}
