export const runtime='nodejs'
export const dynamic='force-dynamic'

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export async function POST(){
  const me=await getSessionUser()
  if(!me)return NextResponse.json({ok:false,error:'NOT_AUTHENTICATED'},{status:401,headers:{'Cache-Control':'no-store'}})
  try{
    const db=createSupabaseAdminClient()
    const {data,error}=await db.rpc('atom_notifications_clear_read',{p_actor:me.id})
    if(error){
      console.error('[notifications-clear-read]',error.code)
      return NextResponse.json({ok:false,error:'CLEAR_READ_FAILED'},{status:500})
    }
    return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}})
  }catch{
    return NextResponse.json({ok:false,error:'SERVER_ERROR'},{status:500})
  }
}
