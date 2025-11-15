// app/api/admin/users/role/route.ts
import { NextResponse } from 'next/server'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


export async function POST(req: Request) {
  try {
    const { userId, newRole } = (await req.json()) as { userId?: string; newRole?: Role }
    if (!userId || !newRole) return NextResponse.json({ ok:false, error:'MISSING_PARAMS' }, { status:400 })

    const supabase = createSupabaseServerActionClient()

    const { data: authData } = await supabase.auth.getUser()
    const actor = authData.user
    if (!actor) return NextResponse.json({ ok:false, error:'NOT_AUTHENTICATED' }, { status:401 })

    const { data: actorProfile } = await supabase
      .from('profiles')
      .select('user_id, role')
      .eq('user_id', actor.id)
      .maybeSingle<{ user_id: string; role: Role | null }>()
    const actorRole = (actorProfile?.role ?? 'member') as Role

    // ... (le reste de ta logique canAssign + update reste identique)
    // veille juste à garder l’utilisation de supabase créé ci-dessus
    // ...
    return NextResponse.json({ ok:true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ ok:false, error:'SERVER_ERROR' }, { status:500 })
  }
}
