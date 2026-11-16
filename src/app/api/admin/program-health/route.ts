export const runtime='nodejs'
export const dynamic='force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ok:false,error:'NOT_AUTHENTICATED'},{status:401})
  if (me.role !== 'super_admin') return NextResponse.json({ok:false,error:'FORBIDDEN'},{status:403})

  const body = await request.json().catch(() => null)
  if (typeof body?.programKey !== 'string' || !/^[a-z0-9-]{1,100}$/.test(body.programKey)
      || !(body.capacity === null || (Number.isInteger(body.capacity) && body.capacity >= 1 && body.capacity <= 500))
      || !Number.isInteger(body.warningPercent) || body.warningPercent < 50 || body.warningPercent > 100
      || typeof body.note !== 'string' || body.note.length > 2000) {
    return NextResponse.json({ok:false,error:'INVALID_PROGRAM_SETTINGS'},{status:400})
  }
  const db = createSupabaseAdminClient()
  const {data,error} = await db.rpc('atom_program_health_update',{
    p_actor:me.id,
    p_program_key:body.programKey,
    p_capacity:body.capacity,
    p_warning_percent:body.warningPercent,
    p_note:body.note
  })
  if (error) {
    console.error('[program-health-update]',error.code)
    return NextResponse.json({ok:false,error:'PROGRAM_HEALTH_UPDATE_FAILED'},{status:409})
  }
  revalidatePath('/admin/program-health')
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}})
}
