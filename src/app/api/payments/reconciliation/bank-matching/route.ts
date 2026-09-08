export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const BUCKET = 'reconciliation-bank-statements'
const BASELINE = '2026-08-01'
const MAX_FILE_BYTES = 5 * 1024 * 1024
const BANK_METHODS = new Set(['instapay', 'card', 'bank_transfer'])
const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream',
])

type ParsedLine = {
  row_number: number
  transaction_date: string
  value_date: string | null
  description: string | null
  reference: string | null
  debit_amount: number
  credit_amount: number
  currency: string
  raw_payload: Record<string, string>
}

function json(status: number, body: any) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanString(value: unknown, max = 500) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
}

function normalizeUuid(value: unknown) {
  const text = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : ''
}

function safeFilename(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 160) || 'bank-statement.csv'
  )
}

function pageUrl(req: Request, params: Record<string, string | number>) {
  const url = new URL('/admin/payments/reconciliation/bank-matching', req.url)
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }
  return url
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) {
    return { actorId: '', role: '', error: authError?.message || 'NOT_AUTHENTICATED' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  return {
    actorId: auth.user.id,
    role: profile?.role ?? 'member',
    error: profileError?.message ?? '',
  }
}

function delimiterCount(line: string, delimiter: string) {
  let count = 0
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') i += 1
      else quoted = !quoted
    } else if (!quoted && char === delimiter) {
      count += 1
    }
  }
  return count
}

function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5)
  const candidates = [',', ';', '\t']
  return candidates
    .map((delimiter) => ({
      delimiter,
      score: sample.reduce((sum, line) => sum + delimiterCount(line, delimiter), 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ','
}

function parseCsvRows(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (!quoted && char === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }

    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      cell = ''
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader))
  return headers.findIndex((header) => normalizedAliases.has(header))
}

function parseMoney(value: string) {
  let raw = String(value ?? '').trim()
  if (!raw) return 0

  let negative = false
  if (/^\(.*\)$/.test(raw)) {
    negative = true
    raw = raw.slice(1, -1)
  }

  raw = raw
    .replace(/\b(EGP|LE|L\.E\.?|USD|EUR)\b/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d,.\-+]/g, '')

  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    raw = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
  } else if (lastComma >= 0) {
    const decimalDigits = raw.length - lastComma - 1
    raw = decimalDigits === 2 ? raw.replace(',', '.') : raw.replace(/,/g, '')
  } else {
    raw = raw.replace(/,/g, '')
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  const amount = negative ? -Math.abs(parsed) : parsed
  return Math.round(amount * 100) / 100
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function validDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function parseDateOnly(value: string) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    return validDateParts(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : ''
  }

  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    return validDateParts(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : ''
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function parseStatement(text: string) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''), detectDelimiter(text))
  if (rows.length < 2) throw new Error('CSV_EMPTY_OR_HEADER_ONLY')

  const rawHeaders = rows[0].map((header) => header.trim())
  const headers = rawHeaders.map(normalizeHeader)

  const transactionDateIndex = findHeaderIndex(headers, [
    'transaction date', 'transaction_date', 'date', 'booking date', 'posting date', 'transactiondate',
  ])
  const valueDateIndex = findHeaderIndex(headers, ['value date', 'value_date', 'valuedate'])
  const descriptionIndex = findHeaderIndex(headers, [
    'description', 'details', 'narrative', 'transaction details', 'transaction description', 'remarks',
  ])
  const referenceIndex = findHeaderIndex(headers, [
    'reference', 'ref', 'transaction reference', 'transaction id', 'transaction number', 'cheque number',
  ])
  const debitIndex = findHeaderIndex(headers, ['debit', 'debit amount', 'withdrawal', 'withdrawals', 'debitamount'])
  const creditIndex = findHeaderIndex(headers, ['credit', 'credit amount', 'deposit', 'deposits', 'creditamount'])
  const amountIndex = findHeaderIndex(headers, ['amount', 'transaction amount', 'transactionamount'])
  const currencyIndex = findHeaderIndex(headers, ['currency', 'ccy'])

  if (transactionDateIndex < 0) throw new Error('CSV_TRANSACTION_DATE_COLUMN_REQUIRED')
  if (debitIndex < 0 && creditIndex < 0 && amountIndex < 0) throw new Error('CSV_AMOUNT_COLUMNS_REQUIRED')

  const accepted: ParsedLine[] = []
  let skipped = 0

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    const transactionDate = parseDateOnly(row[transactionDateIndex] ?? '')
    if (!transactionDate || transactionDate < BASELINE) {
      skipped += 1
      continue
    }

    let debit = debitIndex >= 0 ? Math.abs(parseMoney(row[debitIndex] ?? '')) : 0
    let credit = creditIndex >= 0 ? Math.abs(parseMoney(row[creditIndex] ?? '')) : 0

    if (debitIndex < 0 && creditIndex < 0 && amountIndex >= 0) {
      const amount = parseMoney(row[amountIndex] ?? '')
      if (amount > 0) credit = amount
      if (amount < 0) debit = Math.abs(amount)
    }

    if ((debit <= 0 && credit <= 0) || (debit > 0 && credit > 0)) {
      skipped += 1
      continue
    }

    const rawPayload: Record<string, string> = {}
    rawHeaders.forEach((header, column) => {
      rawPayload[header || `column_${column + 1}`] = String(row[column] ?? '').trim().slice(0, 2000)
    })

    accepted.push({
      row_number: index + 1,
      transaction_date: transactionDate,
      value_date: valueDateIndex >= 0 ? parseDateOnly(row[valueDateIndex] ?? '') || null : null,
      description: descriptionIndex >= 0 ? cleanString(row[descriptionIndex], 1000) || null : null,
      reference: referenceIndex >= 0 ? cleanString(row[referenceIndex], 300) || null : null,
      debit_amount: Math.round(debit * 100) / 100,
      credit_amount: Math.round(credit * 100) / 100,
      currency: currencyIndex >= 0 ? cleanString(row[currencyIndex], 8).toUpperCase() || 'EGP' : 'EGP',
      raw_payload: rawPayload,
    })
  }

  if (!accepted.length) throw new Error('CSV_NO_ELIGIBLE_ROWS_FROM_BASELINE')
  return { accepted, skipped }
}

async function insertLines(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 250) {
    const { error } = await admin
      .from('reconciliation_bank_statement_lines')
      .insert(rows.slice(index, index + 250))
    if (error) throw new Error(`BANK_LINES_INSERT_FAILED: ${error.message}`)
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) {
      return NextResponse.redirect(new URL('/login?next=/admin/payments/reconciliation/bank-matching', req.url), 303)
    }
    if (actor.error) return NextResponse.redirect(pageUrl(req, { error: 'PROFILE_LOOKUP_FAILED' }), 303)
    if (actor.role !== 'super_admin') return NextResponse.redirect(pageUrl(req, { error: 'SUPER_ADMIN_REQUIRED' }), 303)

    const admin = makeAdminClient()
    if (!admin) return NextResponse.redirect(pageUrl(req, { error: 'SERVICE_ROLE_MISSING' }), 303)

    const form = await req.formData()
    const action = cleanString(form.get('action'), 80)

    if (action === 'import_statement') {
      const rawFile = form.get('file')
      const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
      if (!file) return NextResponse.redirect(pageUrl(req, { error: 'FILE_REQUIRED' }), 303)
      if (file.size > MAX_FILE_BYTES) return NextResponse.redirect(pageUrl(req, { error: 'FILE_TOO_LARGE' }), 303)

      const mimeType = file.type || 'application/octet-stream'
      if (!/\.csv$/i.test(file.name || '') && !ALLOWED_MIME_TYPES.has(mimeType)) {
        return NextResponse.redirect(pageUrl(req, { error: 'CSV_REQUIRED' }), 303)
      }

      const bytes = Buffer.from(await file.arrayBuffer())
      const fileSha256 = createHash('sha256').update(bytes).digest('hex')
      const { data: duplicate, error: duplicateError } = await admin
        .from('reconciliation_bank_imports')
        .select('id')
        .eq('file_sha256', fileSha256)
        .maybeSingle()
      if (duplicateError) return NextResponse.redirect(pageUrl(req, { error: 'DUPLICATE_CHECK_FAILED' }), 303)
      if (duplicate?.id) return NextResponse.redirect(pageUrl(req, { error: 'STATEMENT_ALREADY_IMPORTED' }), 303)

      let parsed: ReturnType<typeof parseStatement>
      try {
        parsed = parseStatement(bytes.toString('utf8'))
      } catch (cause: any) {
        return NextResponse.redirect(pageUrl(req, { error: cleanString(cause?.message || 'CSV_PARSE_FAILED', 120) }), 303)
      }

      const dates = parsed.accepted.map((row) => row.transaction_date).sort()
      const importId = randomUUID()
      const filename = safeFilename(file.name || 'bank-statement.csv')
      const storagePath = `${new Date().toISOString().slice(0, 10)}/${importId}/${filename}`
      const totalCredit = parsed.accepted.reduce((sum, row) => sum + row.credit_amount, 0)
      const totalDebit = parsed.accepted.reduce((sum, row) => sum + row.debit_amount, 0)

      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
      })
      if (uploadError) {
        const message = String(uploadError.message ?? '').toLowerCase()
        return NextResponse.redirect(pageUrl(req, {
          error: message.includes('bucket') || message.includes('not found') ? 'MIGRATION_REQUIRED' : 'STATEMENT_UPLOAD_FAILED',
        }), 303)
      }

      const { error: importError } = await admin.from('reconciliation_bank_imports').insert({
        id: importId,
        bank_name: cleanString(form.get('bank_name'), 80) || 'CIB',
        account_label: cleanString(form.get('account_label'), 120) || null,
        statement_from: dates[0],
        statement_to: dates[dates.length - 1],
        original_filename: file.name || filename,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size_bytes: file.size,
        file_sha256: fileSha256,
        row_count: parsed.accepted.length,
        skipped_row_count: parsed.skipped,
        total_credit: Math.round(totalCredit * 100) / 100,
        total_debit: Math.round(totalDebit * 100) / 100,
        imported_by: actor.actorId,
      })

      if (importError) {
        await admin.storage.from(BUCKET).remove([storagePath])
        return NextResponse.redirect(pageUrl(req, { error: 'STATEMENT_SAVE_FAILED' }), 303)
      }

      try {
        await insertLines(admin, parsed.accepted.map((row) => ({ import_id: importId, ...row })))
      } catch {
        await admin.from('reconciliation_bank_statement_lines').delete().eq('import_id', importId)
        await admin.from('reconciliation_bank_imports').delete().eq('id', importId)
        await admin.storage.from(BUCKET).remove([storagePath])
        return NextResponse.redirect(pageUrl(req, { error: 'BANK_LINES_INSERT_FAILED' }), 303)
      }

      return NextResponse.redirect(pageUrl(req, { imported: parsed.accepted.length, skipped: parsed.skipped }), 303)
    }

    if (action === 'match_line') {
      const lineId = normalizeUuid(form.get('line_id'))
      const batchId = normalizeUuid(form.get('batch_id'))
      const note = cleanString(form.get('note'), 500) || null
      if (!lineId || !batchId) return NextResponse.redirect(pageUrl(req, { error: 'INVALID_MATCH_TARGET' }), 303)

      const [lineResult, batchResult, activeMatchResult] = await Promise.all([
        admin.from('reconciliation_bank_statement_lines').select('id,transaction_date,credit_amount').eq('id', lineId).maybeSingle(),
        admin.from('payment_validation_batches').select('id,payment_method,business_date,deleted_at').eq('id', batchId).maybeSingle(),
        admin.from('reconciliation_bank_matches').select('id').eq('statement_line_id', lineId).is('released_at', null).maybeSingle(),
      ])

      if (lineResult.error || batchResult.error || activeMatchResult.error) {
        return NextResponse.redirect(pageUrl(req, { error: 'MATCH_LOOKUP_FAILED' }), 303)
      }
      if (!lineResult.data?.id || Number(lineResult.data.credit_amount ?? 0) <= 0) {
        return NextResponse.redirect(pageUrl(req, { error: 'CREDIT_LINE_REQUIRED' }), 303)
      }
      if (activeMatchResult.data?.id) return NextResponse.redirect(pageUrl(req, { error: 'BANK_LINE_ALREADY_MATCHED' }), 303)

      const batch = batchResult.data
      if (
        !batch?.id || batch.deleted_at || !BANK_METHODS.has(String(batch.payment_method)) ||
        !batch.business_date || String(batch.business_date) < BASELINE
      ) {
        return NextResponse.redirect(pageUrl(req, { error: 'BATCH_NOT_ELIGIBLE' }), 303)
      }

      const { error } = await admin.from('reconciliation_bank_matches').insert({
        batch_id: batchId,
        statement_line_id: lineId,
        matched_amount: Number(lineResult.data.credit_amount),
        note,
        matched_by: actor.actorId,
      })
      if (error) {
        return NextResponse.redirect(pageUrl(req, {
          error: String(error.message ?? '').toLowerCase().includes('unique') ? 'BANK_LINE_ALREADY_MATCHED' : 'MATCH_SAVE_FAILED',
        }), 303)
      }
      return NextResponse.redirect(pageUrl(req, { matched: '1' }), 303)
    }

    if (action === 'release_match') {
      const matchId = normalizeUuid(form.get('match_id'))
      const reason = cleanString(form.get('release_reason'), 500)
      if (!matchId) return NextResponse.redirect(pageUrl(req, { error: 'INVALID_MATCH_ID' }), 303)
      if (reason.length < 3) return NextResponse.redirect(pageUrl(req, { error: 'RELEASE_REASON_REQUIRED' }), 303)

      const { data: existing, error: lookupError } = await admin
        .from('reconciliation_bank_matches')
        .select('id,released_at')
        .eq('id', matchId)
        .maybeSingle()
      if (lookupError || !existing?.id) return NextResponse.redirect(pageUrl(req, { error: 'MATCH_NOT_FOUND' }), 303)
      if (existing.released_at) return NextResponse.redirect(pageUrl(req, { error: 'MATCH_ALREADY_RELEASED' }), 303)

      const { error } = await admin
        .from('reconciliation_bank_matches')
        .update({
          released_at: new Date().toISOString(),
          released_by: actor.actorId,
          release_reason: reason,
        })
        .eq('id', matchId)
        .is('released_at', null)
      if (error) return NextResponse.redirect(pageUrl(req, { error: 'MATCH_RELEASE_FAILED' }), 303)
      return NextResponse.redirect(pageUrl(req, { released: '1' }), 303)
    }

    return NextResponse.redirect(pageUrl(req, { error: 'UNKNOWN_ACTION' }), 303)
  } catch (cause: any) {
    return NextResponse.redirect(pageUrl(req, { error: 'SERVER_ERROR', details: cleanString(cause?.message || String(cause), 120) }), 303)
  }
}

export async function GET(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })
    if (actor.role !== 'admin' && actor.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const statementId = normalizeUuid(new URL(req.url).searchParams.get('statementId'))
    if (!statementId) return json(400, { ok: false, error: 'INVALID_STATEMENT_ID' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { data: statement, error } = await admin
      .from('reconciliation_bank_imports')
      .select('id,storage_path')
      .eq('id', statementId)
      .maybeSingle()
    if (error) return json(500, { ok: false, error: 'STATEMENT_LOOKUP_FAILED', details: error.message })
    if (!statement?.storage_path) return json(404, { ok: false, error: 'STATEMENT_NOT_FOUND' })

    const storagePath = String(statement.storage_path).replace(/^\/+/, '').replace(/\.\./g, '')
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 60)
    if (signedError || !signed?.signedUrl) {
      return json(404, { ok: false, error: 'STATEMENT_FILE_NOT_FOUND', details: signedError?.message ?? 'Unable to create signed URL.' })
    }
    return NextResponse.redirect(signed.signedUrl)
  } catch (cause: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: cause?.message ?? String(cause) })
  }
}
