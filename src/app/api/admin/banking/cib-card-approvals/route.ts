export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function json(payload: unknown, status=200) {
  const response=NextResponse.json(payload,{status})
  response.headers.set('Cache-Control','no-store')
  return response
}
async function authorize() {
  const me=await getSessionUser()
  if (!me) return {error:json({ok:false,error:'NOT_AUTHENTICATED'},401)}
  if (me.role!=='super_admin') return {error:json({ok:false,error:'FORBIDDEN'},403)}
  return {userId:me.id}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const date=/^\d{4}-\d{2}-\d{2}$/
const batch=/^28276801(?:_[0-9]{6}|M[0-9]{6})$/
const kinds=new Set(['subscription','store','other_income'])

export async function GET() {
  const auth=await authorize()
  if (auth.error) return auth.error
  const admin=createSupabaseAdminClient()
  const {data,error}=await admin.from('cib_card_approvals')
    .select('id,transaction_key,terminal_batch,transaction_date,settlement_date,approval_code,gross_cents,evidence_note,approved_at,approved_by,released_at,release_reason,cib_card_approval_items(source_kind,source_id,amount_cents,released_at)')
    .order('approved_at',{ascending:false}).limit(300)
  if (error) return json({ok:false,error:'APPROVAL_LOOKUP_FAILED'},500)
  return json({ok:true,approvals:data??[]})
}

export async function POST(request: Request) {
  const auth=await authorize()
  if (auth.error) return auth.error
  let body: any
  try {body=await request.json()} catch {return json({ok:false,error:'INVALID_JSON'},400)}
  if (!body || typeof body!=='object' || typeof body.batch!=='string' || !batch.test(body.batch)
    || typeof body.transaction_date!=='string' || !date.test(body.transaction_date)
    || typeof body.settlement_date!=='string' || !date.test(body.settlement_date)
    || typeof body.approval_code!=='string' || !/^[A-Za-z0-9]{3,20}$/.test(body.approval_code)
    || !Number.isSafeInteger(body.gross_cents) || body.gross_cents<=0
    || !Array.isArray(body.items) || body.items.length<1 || body.items.length>4
    || typeof body.evidence_note!=='string' || body.evidence_note.trim().length<12
    || body.evidence_note.length>2000) return json({ok:false,error:'INVALID_APPROVAL_DATA'},400)
  const seen=new Set<string>()
  for (const item of body.items) {
    if (!item || !kinds.has(item.source) || typeof item.id!=='string' || !uuid.test(item.id))
      return json({ok:false,error:'INVALID_SOURCE'},400)
    const key=item.source+':'+item.id
    if (seen.has(key)) return json({ok:false,error:'DUPLICATE_SOURCE'},400)
    seen.add(key)
  }
  const admin=createSupabaseAdminClient()
  const {data,error}=await admin.rpc('cib_card_approve',{
    p_batch:body.batch,p_transaction_date:body.transaction_date,p_settlement_date:body.settlement_date,
    p_approval_code:body.approval_code,p_gross_cents:body.gross_cents,
    p_items:body.items.map((i:any)=>({source:i.source,id:i.id})),
    p_evidence_note:body.evidence_note.trim(),p_actor:auth.userId,
  })
  if (error) return json({ok:false,error:'APPROVAL_REJECTED',details:error.message},409)
  return json({ok:true,approval_id:data})
}

export async function DELETE(request: Request) {
  const auth=await authorize()
  if (auth.error) return auth.error
  let body: any
  try {body=await request.json()} catch {return json({ok:false,error:'INVALID_JSON'},400)}
  if (typeof body?.id!=='string'||!uuid.test(body.id)
    ||typeof body?.reason!=='string'||body.reason.trim().length<12||body.reason.length>2000)
    return json({ok:false,error:'INVALID_RELEASE_REQUEST'},400)
  const admin=createSupabaseAdminClient()
  const {error}=await admin.rpc('cib_card_release',{
    p_id:body.id,p_reason:body.reason.trim(),p_actor:auth.userId,
  })
  if (error) return json({ok:false,error:'RELEASE_REJECTED',details:error.message},409)
  return json({ok:true})
}
