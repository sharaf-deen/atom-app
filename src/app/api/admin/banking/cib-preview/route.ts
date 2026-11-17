export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'

type CsvRow = Record<string, string>
type Totals = { count: number; gross: number; fees: number; net: number }
type Comparison = { date: string; merchant: Totals; transactions: Totals; status: 'matched' | 'difference' }

function respond(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const text = source.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some(x => x.trim())) rows.push(row)
      row = []; cell = ''
    } else cell += c
  }
  if (quoted) throw new Error('Unclosed CSV quoted field')
  row.push(cell)
  if (row.some(x => x.trim())) rows.push(row)
  return rows
}

function readTable(source: string, required: string[]): CsvRow[] {
  const csv = parseCsv(source)
  if (csv.length < 2) throw new Error('CSV is empty')
  const headers = csv[0].map(s => s.trim().toLowerCase())
  const missing = required.filter(key => !headers.includes(key.toLowerCase()))
  if (missing.length) throw new Error('Missing CIB columns: ' + missing.join(', '))
  if (csv.length > 10001) throw new Error('Report exceeds 10,000 records')
  return csv.slice(1).map((cells, idx) => {
    const data: CsvRow = {}
    headers.forEach((key, i) => { data[key] = (cells[i] ?? '').trim() })
    if (cells.length !== headers.length) throw new Error('CSV column mismatch at row ' + (idx + 2))
    return data
  })
}

function dateKey(raw: string): string {
  const s = raw.trim()
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const iso = /^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)/.exec(s)
  if (iso) return iso[1] + '-' + iso[2].padStart(2, '0') + '-' + iso[3].padStart(2, '0')
  const dmy = /^([0-3]?\d)[-/]([01]?\d)[-/](\d{4})/.exec(s)
  if (dmy) return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0')
  throw new Error('Unrecognized settlement date: ' + s.slice(0, 30))
}

function cents(raw: string): number {
  const s = raw.replace(/,/g, '').trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Invalid CIB amount')
  return Math.round(Number(s) * 100)
}

function total(): Totals { return { count: 0, gross: 0, fees: 0, net: 0 } }
function add(t: Totals, gross: number, fees: number, net: number, count: number) {
  t.count += count; t.gross += gross; t.fees += fees; t.net += net
}
function display(t: Totals): Totals {
  return { count: t.count, gross: t.gross / 100, fees: t.fees / 100, net: t.net / 100 }
}
function ensureBalanced(gross: number, fees: number, net: number) {
  if (gross + fees !== net) throw new Error('CIB row does not balance: gross + commission != net')
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return respond({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (me.role !== 'super_admin') return respond({ ok: false, error: 'FORBIDDEN' }, 403)
  try {
    const form = await request.formData()
    const transactions = form.get('transactions')
    const merchants = form.get('merchants')
    if (!(transactions instanceof File) || !(merchants instanceof File)) {
      return respond({ ok: false, error: 'TWO_CIB_CSV_FILES_REQUIRED' }, 400)
    }
    if (![transactions, merchants].every(f => f.name.toLowerCase().endsWith('.csv') && f.size <= 2_000_000)) {
      return respond({ ok: false, error: 'CSV_FILES_MAX_2MB_ONLY' }, 400)
    }
    const tx = readTable(await transactions.text(), [
      'TerminalId', 'BatchNo', 'AccountNumber', 'settlementDate', 'TransactionDate',
      'TransactionAmount', 'TransactionCommission', 'TransactionNetAmount',
    ])
    const merchant = readTable(await merchants.text(), [
      'AccountNumber', 'SettlementDate', 'TransactionsAmount', 'TransactionsCommission',
      'TransactionsNetAmount', 'TransactionsCount',
    ])
    const byTx = new Map<string, Totals>()
    const byMerchant = new Map<string, Totals>()
    const salesByMonth = new Map<string, Totals>()
    const unique = new Set<string>()
    for (const row of tx) {
      if (row.terminalid !== '28276801') throw new Error('Unexpected CIB terminal')
      const settlement = dateKey(row.settlementdate)
      const sale = dateKey(row.transactiondate)
      const g = cents(row.transactionamount), f = cents(row.transactioncommission), n = cents(row.transactionnetamount)
      ensureBalanced(g, f, n)
      const fingerprint = [row.accountnumber, row.batchno, sale, row.approvalcode ?? '', row.cardnumber ?? '', g, f, n].join('|')
      if (unique.has(fingerprint)) throw new Error('Duplicate CIB transaction in uploaded reports')
      unique.add(fingerprint)
      const key = row.accountnumber + '|' + settlement
      if (!byTx.has(key)) byTx.set(key, total())
      add(byTx.get(key)!, g, f, n, 1)
      const month = sale.slice(0, 7)
      if (!salesByMonth.has(month)) salesByMonth.set(month, total())
      add(salesByMonth.get(month)!, g, f, n, 1)
    }
    for (const row of merchant) {
      const settlement = dateKey(row.settlementdate)
      const g = cents(row.transactionsamount), f = cents(row.transactionscommission), n = cents(row.transactionsnetamount)
      ensureBalanced(g, f, n)
      const count = Number(row.transactionscount)
      if (!Number.isInteger(count) || count < 1) throw new Error('Invalid transaction count')
      const key = row.accountnumber + '|' + settlement
      if (byMerchant.has(key)) throw new Error('Duplicate merchant settlement day')
      const t = total()
      add(t, g, f, n, count)
      byMerchant.set(key, t)
    }
    const dates = [...new Set([...byMerchant.keys(), ...byTx.keys()])].sort()
    const comparisons: Comparison[] = dates.map(key => {
      const a = byMerchant.get(key) ?? total(), b = byTx.get(key) ?? total()
      const matched = a.count === b.count && a.gross === b.gross && a.fees === b.fees && a.net === b.net
      return { date: key.split('|')[1], merchant: display(a), transactions: display(b), status: matched ? 'matched' : 'difference' }
    })
    return respond({
      ok: true, read_only: true, rows: { transactions: tx.length, statements: merchant.length },
      by_sale_month: [...salesByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, t]) => ({ month, ...display(t) })),
      comparisons,
      matched: comparisons.filter(x => x.status === 'matched').length,
      differences: comparisons.filter(x => x.status === 'difference').length,
      notice: 'Read-only file comparison. No bank or payment records were created or modified.',
    })
  } catch (error) {
    return respond({ ok: false, error: 'CIB_REPORT_VALIDATION_FAILED', details: String(error instanceof Error ? error.message : error) }, 400)
  }
}
