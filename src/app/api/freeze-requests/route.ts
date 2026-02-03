// src/app/api/freeze-requests/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

type Json = Record<string, unknown>

/** Factory Supabase (signature SSR de ta version: cookies {get,set,remove}) */
function createSupabaseFromApiRoute() {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get: (name: string) => cookies().get(name)?.value,
      set: () => {},
      remove: () => {},
    },
  })
}

export async function POST() {
  try {
    const supabase = createSupabaseFromApiRoute()

    // Auth (on garde l’auth pour éviter de donner des infos aux non-loggés)
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' } as Json, { status: 401 })
    }

    // ✅ Feature removed
    return NextResponse.json(
      { error: 'Freeze requests are disabled in the app. Please talk to reception.' } as Json,
      { status: 410 } // Gone
    )
  } catch (e: any) {
    return NextResponse.json({ error: 'Server error', details: e?.message ?? String(e) } as Json, { status: 500 })
  }
}
