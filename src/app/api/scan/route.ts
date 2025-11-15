// src/app/api/kiosk/scan/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function normQR(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const raw = v.trim()
  if (!raw) return null
  return raw.startsWith('ATOM:') ? 'atom:' + raw.slice(5) : raw
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth + staff
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
    const actorId = auth.user.id

    // Staff ? (RPC si présente, sinon fallback)
    let isStaff = false
    {
      const { data: rpcData, error: rpcErr } = await supa.rpc('is_staff', { uid: actorId })
      if (rpcErr) {
        const { data: me } = await supa
          .from('profiles')
          .select('role')
          .eq('user_id', actorId)
          .maybeSingle<{ role: string | null }>()
        isStaff = ['reception', 'admin', 'super_admin'].includes(me?.role ?? 'member')
      } else {
        isStaff = !!rpcData
      }
    }
    if (!isStaff) return json(403, { ok: false, error: 'FORBIDDEN' })

    // 2) Payload → QR
    const body = await req.json().catch(() => ({} as any))
    const qrRaw = body?.qr ?? body?.code ?? body?.member_qr
    const qr = normQR(qrRaw)
    if (!qr) return json(400, { ok: false, error: 'INVALID_QR' })

    // 3) Résoudre le membre par QR
    const { data: prof, error: profErr } = await supa
      .from('profiles')
      .select('user_id')
      .eq('qr_code', qr)
      .maybeSingle<{ user_id: string }>()
    if (profErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profErr.message })
    if (!prof) return json(404, { ok: false, error: 'UNKNOWN_QR' })

    // 4) Appel de la RPC atomique
    const { data: out, error: rpcErr2 } = await supa.rpc('scan_and_record', { p_member_id: prof.user_id })
    if (rpcErr2) {
      // en cas d’erreur inattendue côté SQL
      return json(500, { ok: false, error: 'SCAN_RPC_ERROR', details: rpcErr2.message })
    }

    // 5) La fonction renvoie déjà la structure finale
    return json(200, out ?? { ok: false, error: 'EMPTY_RPC_RESPONSE' })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
