// src/app/auth/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

/**
 * Reçoit les événements d'auth du client (SIGNED_IN / SIGNED_OUT)
 * et synchronise les cookies côté serveur.
 */
export async function POST(req: Request) {
  try {
    const { event, session } = await req.json().catch(() => ({}))

    const supabase = createSupabaseServerActionClient()

    if (event === 'SIGNED_IN' && session) {
      // Met à jour les cookies en important la session reçue
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      })
      return NextResponse.json({ ok: true })
    }

    if (event === 'SIGNED_OUT') {
      await supabase.auth.signOut()
      return NextResponse.json({ ok: true })
    }

    // Par défaut : on force un getSession pour rafraîchir si besoin
    await supabase.auth.getSession()
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'AUTH_SYNC_FAILED' }, { status: 500 })
  }
}
