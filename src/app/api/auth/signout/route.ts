// src/app/api/auth/signout/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

export async function POST() {
  // on prépare la réponse d’abord pour que Supabase écrive dessus
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const supabase = createSupabaseServerActionClient({ response: res })
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return res
  } catch {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 })
  }
}
