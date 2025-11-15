// src/lib/session.ts
import { headers } from 'next/headers'            // ✅ marche sur Next 13/14/15
import { createSupabaseRSC } from '@/lib/supabaseServer'

export type Role =
  | 'member'
  | 'assistant_coach'
  | 'coach'
  | 'reception'
  | 'admin'
  | 'super_admin'

export type SessionUser = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  phone: string | null
  member_id: string | null
  role: Role
  qr_code: string | null
  id_photo_path?: string | null
}

type ProfileRow = {
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  member_id: string | null
  qr_code: string | null
  id_photo_path: string | null
}

/**
 * Récupère l'utilisateur courant (server) sans cache.
 * L'appel à `headers()` force le rendu dynamique (équivalent à noStore()).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  headers() // ✅ opt-out du cache de rendu

  const supabase = createSupabaseRSC()

  // 1) Auth user
  let authUser: any = null
  try {
    const { data } = await supabase.auth.getUser()
    authUser = data.user ?? null
  } catch (e: any) {
    console.warn('auth.getUser failed:', e?.message || e)
    return null
  }
  if (!authUser) return null

  const u: { id: string; email: string | null; user_metadata?: any } = {
    id: authUser.id,
    email: authUser.email ?? null,
    user_metadata: authUser.user_metadata ?? {},
  }

  // 2) Profile (best-effort)
  let p: ProfileRow | null = null
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('email, first_name, last_name, role, phone, member_id, qr_code, id_photo_path')
      .eq('user_id', u.id)
      .maybeSingle<ProfileRow>()
    if (error) {
      console.warn('profiles lookup error:', error.message)
    } else {
      p = data ?? null
    }
  } catch (e: any) {
    console.warn('profiles fetch failed:', e?.message || e)
  }

  // 3) Champs finalisés
  const firstName = (p?.first_name ?? u.user_metadata?.first_name ?? null) as string | null
  const lastName  = (p?.last_name  ?? u.user_metadata?.last_name  ?? null) as string | null
  const email     = (u.email ?? p?.email ?? null) as string | null
  const phone     = (p?.phone ?? null) as string | null
  const member_id = (p?.member_id ?? null) as string | null
  const role      = (p?.role ?? 'member') as Role
  const qr_code   = (p?.qr_code ?? null) as string | null
  const id_photo_path = (p?.id_photo_path ?? null) as string | null

  const full_name =
    ([firstName ?? '', lastName ?? ''].join(' ').trim() || email || null) as string | null

  return {
    id: u.id,
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    member_id,
    full_name,
    role,
    qr_code,
    id_photo_path,
  }
}
