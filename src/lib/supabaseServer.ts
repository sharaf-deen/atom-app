// src/lib/supabaseServer.ts
import { cookies } from 'next/headers'
import { type CookieOptions, createServerClient } from '@supabase/ssr'
import type { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Client lecture seule (RSC / route GET)
 * - n'essaye pas d'écrire dans les cookies
 */
export function createSupabaseRSC() {
  const cookieStore = cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set() {
        // no-op (lecture seule)
      },
      remove() {
        // no-op (lecture seule)
      },
    },
  })
}

/**
 * Client pour routes mutantes (PATCH/POST…) – peut écrire les cookies
 */
export function createSupabaseServerActionClient(opts?: { response?: NextResponse }) {
  const cookieStore = cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        if (opts?.response) {
          opts.response.cookies.set({ name, value, ...options })
        } else {
          cookieStore.set({ name, value, ...options })
        }
      },
      remove(name: string, options: CookieOptions) {
        if (opts?.response) {
          opts.response.cookies.set({ name, value: '', ...options, maxAge: 0 })
        } else {
          cookieStore.set({ name, value: '', ...options, maxAge: 0 })
        }
      },
    },
  })
}
