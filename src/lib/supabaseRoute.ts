// src/lib/supabaseRoute.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export function createSupabaseRouteClient(req: NextRequest) {
  const cookieOps: Array<
    | { type: 'set'; name: string; value: string; options: any }
    | { type: 'remove'; name: string; options: any }
  > = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          cookieOps.push({ type: 'set', name, value, options })
        },
        remove: (name: string, options: any) => {
          cookieOps.push({ type: 'remove', name, options })
        },
      },
    }
  )

  const applyCookies = (res: NextResponse) => {
    for (const op of cookieOps) {
      if (op.type === 'set') res.cookies.set({ name: op.name, value: op.value, ...op.options })
      else res.cookies.set({ name: op.name, value: '', ...op.options, maxAge: 0 })
    }
    return res
  }

  return { supabase, applyCookies }
}
