// Reconciliation 1C — append-only evidence / proof
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const BUCKET = 'reconciliation-proofs'
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

function cleanString(v: unknown, max = 250) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function normalizeUuid(v: unknown) {
  const s = cleanString(v, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : ''
}

function safeFilename(name: string) {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)

  return cleaned || 'reconciliation-proof'
}

function extensionForMime(mime: string) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'application/pdf') return 'pdf'
  return 'bin'
}

function cleanStoragePath(value: string | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const withoutBucket = raw.startsWith(`${BUCKET}/`)
    ? raw.slice(BUCKET.length + 1)
    : raw

  return withoutBucket.replace(/^\/+/, '').replace(/\.\./g, '')
}

function evidencePageUrl(req: Request, params: Record<string, string>) {
  const url = new URL('/admin/payments/reconciliation/evidence', req.url)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  return url
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authErr } = await supabase.auth.getUser()

  if (authErr || !auth.user) {
    return {
      supabase,
      actorId: '',
      role: '',
      error: authErr?.message || 'NOT_AUTHENTICATED',
    }
  }

  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  return {
    supabase,
    actorId: auth.user.id,
    role: me?.role ?? 'member',
    error: meErr?.message ?? '',
  }
}

export async function POST(req: Request) {
  let uploadedStoragePath = ''

  try {
    const actor = await getActor()

    if (!actor.actorId) {
      return NextResponse.redirect(
        new URL('/login?next=/admin/payments/reconciliation/evidence', req.url),
        303
      )
    }

    if (actor.error) {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'PROFILE_LOOKUP_FAILED' }),
        303
      )
    }

    if (actor.role !== 'super_admin') {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'SUPER_ADMIN_REQUIRED' }),
        303
      )
    }

    const admin = makeAdminClient()
    if (!admin) {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'SERVICE_ROLE_MISSING' }),
        303
      )
    }

    const form = await req.formData()
    const batchId = normalizeUuid(form.get('batch_id'))
    const reference = cleanString(form.get('reference'), 250)
    const rawFile = form.get('file')
    const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null

    if (!batchId) {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'INVALID_BATCH' }),
        303
      )
    }

    if (!reference && !file) {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'REFERENCE_OR_FILE_REQUIRED', batch: batchId.slice(0, 8) }),
        303
      )
    }

    const { data: batch, error: batchErr } = await admin
      .from('payment_validation_batches')
      .select('id, deleted_at')
      .eq('id', batchId)
      .maybeSingle()

    if (batchErr) {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'BATCH_LOOKUP_FAILED' }),
        303
      )
    }

    if (!batch?.id || batch.deleted_at) {
      return NextResponse.redirect(
        evidencePageUrl(req, { error: 'BATCH_NOT_AVAILABLE' }),
        303
      )
    }

    let originalFilename: string | null = null
    let mimeType: string | null = null
    let fileSizeBytes: number | null = null

    if (file) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.redirect(
          evidencePageUrl(req, { error: 'FILE_TOO_LARGE', batch: batchId.slice(0, 8) }),
          303
        )
      }

      mimeType = file.type || 'application/octet-stream'
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return NextResponse.redirect(
          evidencePageUrl(req, { error: 'UNSUPPORTED_FILE_TYPE', batch: batchId.slice(0, 8) }),
          303
        )
      }

      originalFilename = cleanString(file.name || 'reconciliation-proof', 240)
      fileSizeBytes = file.size

      const today = new Date().toISOString().slice(0, 10)
      const baseName = safeFilename(
        file.name || `reconciliation-proof.${extensionForMime(mimeType)}`
      )
      const hasExtension = /\.[a-z0-9]{2,6}$/i.test(baseName)
      const finalName = hasExtension
        ? baseName
        : `${baseName}.${extensionForMime(mimeType)}`

      uploadedStoragePath = `${today}/${batchId}/${crypto.randomUUID()}-${finalName}`

      const bytes = await file.arrayBuffer()
      const { error: uploadErr } = await admin.storage
        .from(BUCKET)
        .upload(uploadedStoragePath, Buffer.from(bytes), {
          cacheControl: '3600',
          contentType: mimeType,
          upsert: false,
        })

      if (uploadErr) {
        const message = String(uploadErr.message ?? '')
        const code =
          message.toLowerCase().includes('bucket') ||
          message.toLowerCase().includes('not found')
            ? 'MIGRATION_REQUIRED'
            : 'UPLOAD_FAILED'

        return NextResponse.redirect(
          evidencePageUrl(req, { error: code, batch: batchId.slice(0, 8) }),
          303
        )
      }
    }

    const { data: evidence, error: insertErr } = await admin
      .from('payment_validation_batch_evidence')
      .insert({
        batch_id: batchId,
        reference: reference || null,
        proof_path: uploadedStoragePath || null,
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        created_by: actor.actorId,
      })
      .select('id')
      .single()

    if (insertErr || !evidence?.id) {
      if (uploadedStoragePath) {
        await admin.storage.from(BUCKET).remove([uploadedStoragePath])
      }

      return NextResponse.redirect(
        evidencePageUrl(req, {
          error: 'EVIDENCE_SAVE_FAILED',
          batch: batchId.slice(0, 8),
        }),
        303
      )
    }

    return NextResponse.redirect(
      evidencePageUrl(req, {
        saved: '1',
        batch: batchId.slice(0, 8),
      }),
      303
    )
  } catch (e: any) {
    return NextResponse.redirect(
      evidencePageUrl(req, {
        error: 'SERVER_ERROR',
        details: cleanString(e?.message ?? String(e), 120),
      }),
      303
    )
  }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })

    const canView = actor.role === 'admin' || actor.role === 'super_admin'
    if (!canView) return json(403, { ok: false, error: 'FORBIDDEN' })

    const url = new URL(req.url)
    const evidenceId = normalizeUuid(url.searchParams.get('evidenceId'))
    if (!evidenceId) return json(400, { ok: false, error: 'INVALID_EVIDENCE_ID' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const { data: evidence, error } = await admin
      .from('payment_validation_batch_evidence')
      .select('id, proof_path')
      .eq('id', evidenceId)
      .maybeSingle()

    if (error) return json(500, { ok: false, error: 'EVIDENCE_LOOKUP_FAILED', details: error.message })
    if (!evidence?.proof_path) return json(404, { ok: false, error: 'PROOF_NOT_FOUND' })

    const storagePath = cleanStoragePath(evidence.proof_path)
    if (!storagePath) return json(404, { ok: false, error: 'PROOF_NOT_FOUND' })

    const { data: signed, error: signedErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60)

    if (signedErr || !signed?.signedUrl) {
      return json(404, {
        ok: false,
        error: 'PROOF_NOT_FOUND',
        details: signedErr?.message ?? 'Unable to create signed URL.',
      })
    }

    return NextResponse.redirect(signed.signedUrl)
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
