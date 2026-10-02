export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type ParsedRow = Record<string, string>

const DATE_ALIASES = [
  'date','transactiondate','bookingdate','operationdate','postingdate','transaction_date',
  'dateoperation','dateoperationcomptable',
]
const VALUE_DATE_ALIASES = ['valuedate','value_date','datevaleur']
const DESCRIPTION_ALIASES = [
  'description','details','detail','narration','memo','libelle','label','transactiondescription',
  'operation','descriptionoperation',
]
const REFERENCE_ALIASES = ['reference','ref','transactionreference','transactionid','idoperation']
const COUNTERPARTY_ALIASES = ['counterparty','beneficiary','sender','receiver','merchant','name','contrepartie']
const DEBIT_ALIASES = ['debit','withdrawal','withdrawals','debits','sortie']
const CREDIT_ALIASES = ['credit','deposit','deposits','credits','entree']
const AMOUNT_ALIASES = ['amount','transactionamount','montant','value']
const BALANCE_ALIASES = ['balance','runningbalance','availablebalance','solde']

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
}

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map((header) => normalizeHeader(header))
  const index = normalized.findIndex((header) => aliases.includes(header))
  return index >= 0 ? headers[index] : null
}

function detectDelimiter(line: string) {
  const candidates = [',', ';', '\t']
  let best = ','
  let bestCount = -1
  for (const delimiter of candidates) {
    let count = 0
    let quoted = false
    for (const char of line) {
      if (char === '"') quoted = !quoted
      else if (!quoted && char === delimiter) count += 1
    }
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

function parseCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(clean.split(/\r?\n/, 1)[0] ?? '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]
    const next = clean[i + 1]

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, '').trim())
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  row.push(field.replace(/\r$/, '').trim())
  if (row.some((value) => value.length > 0)) rows.push(row)

  if (rows.length < 2) return { headers: [] as string[], rows: [] as ParsedRow[] }

  const headers = rows[0].map((value, index) => value || `column_${index + 1}`)
  const data = rows.slice(1).map((values) => {
    const out: ParsedRow = {}
    headers.forEach((header, index) => {
      out[header] = values[index] ?? ''
    })
    return out
  })

  return { headers, rows: data }
}

function parseMoney(value: unknown) {
  let raw = String(value ?? '').trim()
  if (!raw) return null

  let negative = false
  if (/^\(.*\)$/.test(raw)) {
    negative = true
    raw = raw.slice(1, -1)
  }

  raw = raw
    .replace(/[A-Za-z\u0600-\u06FF£€$]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\d,.\-+]/g, '')

  if (!raw) return null

  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) {
      raw = raw.replace(/\./g, '').replace(',', '.')
    } else {
      raw = raw.replace(/,/g, '')
    }
  } else if (comma >= 0) {
    const after = raw.length - comma - 1
    raw = after === 2 ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  } else {
    raw = raw.replace(/,/g, '')
  }

  const valueNumber = Number(raw)
  if (!Number.isFinite(valueNumber)) return null
  const n = Math.round(valueNumber * 100) / 100
  return negative ? -Math.abs(n) : n
}

function parseDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) {
    const [, y, m, d] = match
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return validIsoDate(iso) ? iso : null
  }

  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (match) {
    const [, d, m, y] = match
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return validIsoDate(iso) ? iso : null
  }

  return null
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function fingerprint(args: {
  date: string
  valueDate: string | null
  amount: number
  description: string
  reference: string | null
  counterparty: string | null
}) {
  const normalized = [
    args.date,
    args.valueDate ?? '',
    args.amount.toFixed(2),
    args.description.trim().toLowerCase().replace(/\s+/g, ' '),
    (args.reference ?? '').trim().toLowerCase(),
    (args.counterparty ?? '').trim().toLowerCase(),
  ].join('|')

  return createHash('sha256').update(normalized).digest('hex')
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (me.role !== 'super_admin') return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ ok: false, error: 'INVALID_FORM_DATA' }, 400)
  }

  const file = form.get('file')
  const accountId = String(form.get('account_id') ?? '').trim()

  if (!(file instanceof File)) return json({ ok: false, error: 'CSV_FILE_REQUIRED' }, 400)
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return json({ ok: false, error: 'INVALID_ACCOUNT' }, 400)
  if (!file.name.toLowerCase().endsWith('.csv')) return json({ ok: false, error: 'CSV_ONLY_FOR_BANKING_1A' }, 400)
  if (file.size > 5 * 1024 * 1024) return json({ ok: false, error: 'FILE_TOO_LARGE' }, 400)

  const admin = createSupabaseAdminClient()

  const { data: account, error: accountError } = await admin
    .from('bank_accounts')
    .select('id,currency,is_active')
    .eq('id', accountId)
    .maybeSingle()

  if (accountError) return json({ ok: false, error: 'ACCOUNT_LOOKUP_FAILED', details: accountError.message }, 500)
  if (!account || !account.is_active) return json({ ok: false, error: 'BANK_ACCOUNT_NOT_FOUND' }, 404)

  const text = await file.text()
  const parsed = parseCsv(text)
  if (!parsed.headers.length || !parsed.rows.length) {
    return json({ ok: false, error: 'EMPTY_OR_INVALID_CSV' }, 400)
  }

  const dateHeader = findHeader(parsed.headers, DATE_ALIASES)
  const valueDateHeader = findHeader(parsed.headers, VALUE_DATE_ALIASES)
  const descriptionHeader = findHeader(parsed.headers, DESCRIPTION_ALIASES)
  const referenceHeader = findHeader(parsed.headers, REFERENCE_ALIASES)
  const counterpartyHeader = findHeader(parsed.headers, COUNTERPARTY_ALIASES)
  const debitHeader = findHeader(parsed.headers, DEBIT_ALIASES)
  const creditHeader = findHeader(parsed.headers, CREDIT_ALIASES)
  const amountHeader = findHeader(parsed.headers, AMOUNT_ALIASES)
  const balanceHeader = findHeader(parsed.headers, BALANCE_ALIASES)

  if (!dateHeader) {
    return json({
      ok: false,
      error: 'DATE_COLUMN_NOT_FOUND',
      details: `Headers detected: ${parsed.headers.join(', ')}`,
    }, 400)
  }

  if (!amountHeader && !debitHeader && !creditHeader) {
    return json({
      ok: false,
      error: 'AMOUNT_COLUMNS_NOT_FOUND',
      details: 'Expected Amount or Debit/Credit columns.',
    }, 400)
  }

  const { data: importRow, error: importError } = await admin
    .from('bank_statement_imports')
    .insert({
      account_id: accountId,
      filename: file.name.slice(0, 240),
      file_size_bytes: file.size,
      status: 'processing',
      imported_by: me.id,
    })
    .select('id')
    .single()

  if (importError || !importRow) {
    return json({ ok: false, error: 'IMPORT_LOG_CREATE_FAILED', details: importError?.message }, 500)
  }

  let skipped = 0
  const transactions: any[] = []
  const dates: string[] = []

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]
    const date = parseDate(row[dateHeader])
    if (!date) {
      skipped += 1
      continue
    }

    const valueDate = valueDateHeader ? parseDate(row[valueDateHeader]) : null
    let amount: number | null = null

    if (amountHeader) {
      amount = parseMoney(row[amountHeader])
    } else {
      const credit = creditHeader ? parseMoney(row[creditHeader]) : null
      const debit = debitHeader ? parseMoney(row[debitHeader]) : null
      if (credit !== null && Math.abs(credit) > 0) amount = Math.abs(credit)
      else if (debit !== null && Math.abs(debit) > 0) amount = -Math.abs(debit)
    }

    if (amount === null || amount === 0) {
      skipped += 1
      continue
    }

    const description = String(descriptionHeader ? row[descriptionHeader] : '').trim() || 'Bank transaction'
    const reference = String(referenceHeader ? row[referenceHeader] : '').trim() || null
    const counterparty = String(counterpartyHeader ? row[counterpartyHeader] : '').trim() || null
    const runningBalance = balanceHeader ? parseMoney(row[balanceHeader]) : null

    const fp = fingerprint({
      date,
      valueDate,
      amount,
      description,
      reference,
      counterparty,
    })

    transactions.push({
      account_id: accountId,
      import_id: importRow.id,
      transaction_date: date,
      value_date: valueDate,
      description: description.slice(0, 1000),
      reference: reference?.slice(0, 300) ?? null,
      counterparty: counterparty?.slice(0, 300) ?? null,
      amount: Math.abs(amount),
      direction: amount > 0 ? 'credit' : 'debit',
      running_balance: runningBalance,
      currency: account.currency || 'EGP',
      fingerprint: fp,
      source_row: index + 2,
      raw_data: row,
    })
    dates.push(date)
  }

  let inserted = 0
  let duplicates = 0

  try {
    for (let offset = 0; offset < transactions.length; offset += 200) {
      const chunk = transactions.slice(offset, offset + 200)
      const { data, error } = await admin
        .from('bank_transactions')
        .upsert(chunk, {
          onConflict: 'account_id,fingerprint',
          ignoreDuplicates: true,
        })
        .select('id')

      if (error) throw error
      const count = Array.isArray(data) ? data.length : 0
      inserted += count
      duplicates += chunk.length - count
    }

    const sortedDates = [...dates].sort()
    const { error: updateError } = await admin
      .from('bank_statement_imports')
      .update({
        status: 'completed',
        row_count: parsed.rows.length,
        inserted_count: inserted,
        duplicate_count: duplicates,
        skipped_count: skipped,
        date_from: sortedDates[0] ?? null,
        date_to: sortedDates[sortedDates.length - 1] ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    if (updateError) throw updateError

    return json({
      ok: true,
      import_id: importRow.id,
      inserted,
      duplicates,
      skipped,
      row_count: parsed.rows.length,
      headers: {
        date: dateHeader,
        value_date: valueDateHeader,
        description: descriptionHeader,
        reference: referenceHeader,
        counterparty: counterpartyHeader,
        amount: amountHeader,
        debit: debitHeader,
        credit: creditHeader,
        balance: balanceHeader,
      },
    })
  } catch (error: any) {
    await admin
      .from('bank_statement_imports')
      .update({
        status: 'failed',
        row_count: parsed.rows.length,
        inserted_count: inserted,
        duplicate_count: duplicates,
        skipped_count: skipped,
        error_message: String(error?.message ?? error ?? 'Import failed').slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    return json({ ok: false, error: 'BANK_IMPORT_FAILED', details: String(error?.message ?? error) }, 500)
  }
}
