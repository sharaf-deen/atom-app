// src/app/api/debug/whoami/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


export async function GET() {
  const supa = createSupabaseServerActionClient()
  const { data, error } = await supa.auth.getUser()
  if (error) return NextResponse.json({ ok:false, error: error.message }, { status:500 })
  return NextResponse.json({
    ok: true,
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
  })
}
