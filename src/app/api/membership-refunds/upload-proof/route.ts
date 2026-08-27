// src/app/api/membership-refunds/upload-proof/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const BUCKET = 'membership-refund-proofs'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanString(v: unknown, max = 200) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

function normalizeUuid(v: unknown) {
  const s = cleanString(v, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(s) ? s : ''
}

function safeFilename(name: string) {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)

  return cleaned || 'refund-proof'
}

function extensionForMime(mime: string) {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'application/pdf':
      return 'pdf'
    default:
      return 'bin'
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supabase.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const actorId = auth.user.id
    const { data: me, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', actorId)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = me?.role ?? 'member'
    const canUpload = role === 'admin' || role === 'super_admin'
    if (!canUpload) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return json(400, { ok: false, error: 'FILE_REQUIRED' })

    if (file.size <= 0) return json(400, { ok: false, error: 'EMPTY_FILE' })
    if (file.size > MAX_FILE_BYTES) {
      return json(400, { ok: false, error: 'FILE_TOO_LARGE', details: 'Maximum file size is 10 MB.' })
    }

    const mimeType = file.type || 'application/octet-stream'
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return json(400, {
        ok: false,
        error: 'UNSUPPORTED_FILE_TYPE',
        details: 'Allowed proof files: JPG, PNG, WEBP, PDF.',
      })
    }

    const memberId = normalizeUuid(form.get('memberId')) || 'unlinked-member'
    const subscriptionId = normalizeUuid(form.get('subscriptionId')) || 'no-subscription'
    const today = new Date().toISOString().slice(0, 10)
    const baseName = safeFilename(file.name || `refund-proof.${extensionForMime(mimeType)}`)
    const hasExtension = /\.[a-z0-9]{2,6}$/i.test(baseName)
    const finalName = hasExtension ? baseName : `${baseName}.${extensionForMime(mimeType)}`
    const storagePath = `${today}/${memberId}/${subscriptionId}/${crypto.randomUUID()}-${finalName}`

    const bytes = await file.arrayBuffer()
    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(bytes), {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
      })

    if (uploadErr) {
      const message = uploadErr.message ?? String(uploadErr)
      if (message.toLowerCase().includes('bucket') || message.toLowerCase().includes('not found')) {
        return json(500, {
          ok: false,
          error: 'MIGRATION_REQUIRED',
          details: 'Apply the Membership Refunds Lot 1D migration to create the proof storage bucket, then try again.',
        })
      }
      return json(500, { ok: false, error: 'UPLOAD_FAILED', details: message })
    }

    return json(200, {
      ok: true,
      bucket: BUCKET,
      proofPath: `${BUCKET}/${storagePath}`,
      proofUrl: `${BUCKET}/${storagePath}`,
      storagePath,
      fileName: file.name || finalName,
      mimeType,
      size: file.size,
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
