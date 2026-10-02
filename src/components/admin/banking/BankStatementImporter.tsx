'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Account = {
  id: string
  display_name: string
  bank_name: string | null
  currency: string
}

export default function BankStatementImporter({ accounts }: { accounts: Account[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    if (!file || !accountId || busy) return
    setBusy(true)
    setResult(null)
    setError(null)

    try {
      const form = new FormData()
      form.set('account_id', accountId)
      form.set('file', file)

      const response = await fetch('/api/admin/banking/import', {
        method: 'POST',
        body: form,
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || 'Import failed.')
      }

      setResult(`${data.inserted} imported · ${data.duplicates} duplicate(s) ignored · ${data.skipped} skipped.`)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Import failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Import bank statement</h2>
        <p className="text-sm text-[hsl(var(--muted))]">
          Banking 1A accepts CSV exports only. Imported transactions are read-only and deduplicated automatically.
        </p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Bank account</span>
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.display_name}{account.bank_name ? ` · ${account.bank_name}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">CSV statement</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
          />
        </label>

        <button
          type="button"
          disabled={!file || !accountId || busy}
          onClick={() => void upload()}
          className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Importing…' : 'Import CSV'}
        </button>
      </div>

      <details className="mt-4 rounded-xl bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">Supported CSV columns</summary>
        <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted))]">
          Required: a transaction date plus either Amount or Debit/Credit columns. Optional columns include Description,
          Reference, Counterparty, Value Date and Balance. Common English and French-style header names are detected automatically.
        </p>
      </details>

      {result ? <p className="mt-3 text-sm font-medium text-emerald-700">{result}</p> : null}
      {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}
    </div>
  )
}
