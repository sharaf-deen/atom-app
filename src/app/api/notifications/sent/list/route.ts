export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { clampInt, isSimpleKey, sanitizeSearch } from '@/lib/inputGuard'

function reply(status:number,body:unknown){
  const res=NextResponse.json(body,{status})
  res.headers.set('Cache-Control','no-store')
  return res
}

export async function GET(req:Request){
  const me=await getSessionUser()
  if(!me)return reply(401,{ok:false,error:'NOT_AUTHENTICATED'})
  if(!['admin','super_admin','head_coach'].includes(me.role)){
    return reply(403,{ok:false,error:'FORBIDDEN'})
  }
  const params=new URL(req.url).searchParams
  const page=clampInt(params.get('page'),1,1,10000)
  const limit=clampInt(params.get('limit'),8,1,20)
  const kindRaw=sanitizeSearch(params.get('kind'),{max:32}).toLowerCase()
  const kind=kindRaw==='all'?'':kindRaw
  const q=sanitizeSearch(params.get('q'),{max:80})
  if(kind&&!isSimpleKey(kind,32))return reply(400,{ok:false,error:'INVALID_KIND'})

  try{
    const db=createSupabaseAdminClient()
    const {data,error}=await db.rpc('atom_notifications_sent_groups',{
      p_actor:me.id,
      p_page:page,
      p_limit:limit,
      p_kind:kind||null,
      p_search:q||null,
    })
    if(error){
      console.error('[notification-sent-groups]',error.code)
      return reply(500,{ok:false,error:'SENT_GROUP_QUERY_FAILED'})
    }
    return reply(200,data)
  }catch{
    return reply(500,{ok:false,error:'SERVER_ERROR'})
  }
}
