'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

type Row = { id: string; name: string; kind: 'adult' | 'family'; status: string; tone: string; date: string }
type Filter = 'all' | 'adult' | 'family' | 'attention'

const steps = {
  adult: [
    'Search for an existing Member before creating an account.',
    'Open the existing Member registration form and enter verified details.',
    'Check required documents and finish payment only through the usual authorized workflow.',
  ],
  family: [
    'Search Family Operations for the parent, existing family and child.',
    'Use supervised Family Intake to enter guardian and child information.',
    'Review the family relationship and legal requirements before any conversion.',
  ],
}

export default function RegistrationDeskClient({ rows, loadError }: { rows: Row[]; loadError: boolean }) {
  const [journey, setJourney] = useState<'adult' | 'family'>('adult')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const attention = (r: Row) => /review|expired/i.test(r.status)
  const filtered = useMemo(() => rows.filter(r => {
    const matches = r.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    return matches && (filter === 'all' || (filter === 'attention' ? attention(r) : r.kind === filter))
  }), [rows, query, filter])
  const cards: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'adult', label: 'Adults', count: rows.filter(r => r.kind === 'adult').length },
    { key: 'family', label: 'Families', count: rows.filter(r => r.kind === 'family').length },
    { key: 'attention', label: 'Needs review', count: rows.filter(attention).length },
  ]
  return <div className="space-y-5">
    <section aria-labelledby="new-registration" className="rounded-2xl border border-[hsl(var(--border))] p-4 sm:p-5">
      <h2 id="new-registration" className="text-lg font-semibold">Start a registration</h2>
      <p className="mt-1 text-sm text-[hsl(var(--muted))]">Choose a path. Existing authorized forms are reused; no new public account is created from this page.</p>
      <div role="group" aria-label="Registration type" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {([['adult', 'Adult', 'One adult Member'], ['family', 'Parent & child', 'Guardian and dependents']] as const).map(([key, label, description]) => <button key={key} type="button" onClick={() => setJourney(key)} aria-pressed={journey === key} className={`min-h-[80px] rounded-xl border-2 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${journey === key ? 'border-black bg-slate-50' : 'border-[hsl(var(--border))]'}`}><span className="block font-semibold">{label}</span><span className="mt-1 block text-sm text-[hsl(var(--muted))]">{description}</span></button>)}
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 p-4">
        <h3 className="font-semibold">{journey === 'adult' ? 'Adult registration checklist' : 'Parent & child checklist'}</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{steps[journey].map(step => <li key={step}>{step}</li>)}</ol>
        <Link href={journey === 'adult' ? '/kiosk' : '/admin/members/family-operations'} className="mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{journey === 'adult' ? 'Open Adult Registration' : 'Open Family Operations'} →</Link>
      </div>
    </section>
    <section aria-labelledby="requests-heading" className="rounded-2xl border border-[hsl(var(--border))] p-4 sm:p-5">
      <h2 id="requests-heading" className="text-lg font-semibold">Registration follow-up</h2>
      <p className="mt-1 text-xs text-[hsl(var(--muted))]">30 most recent public requests only · Read-only · Sensitive actions require Super Admin.</p>
      {loadError ? <p role="alert" className="mt-4 text-sm text-red-700">Requests could not be loaded. Contact an administrator.</p> : <>
        <label htmlFor="registration-search" className="mt-4 block text-sm font-medium">Find a request by name</label>
        <input id="registration-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Member or child name" className="mt-2 min-h-[44px] w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-base" />
        <div role="group" aria-label="Filter registrations" className="mt-3 flex flex-wrap gap-2">{cards.map(card => <button key={card.key} type="button" aria-pressed={filter === card.key} onClick={() => setFilter(card.key)} className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium ${filter === card.key ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))]'}`}>{card.label} ({card.count})</button>)}</div>
        <p role="status" className="mt-3 text-xs text-[hsl(var(--muted))]">Showing {filtered.length} of {rows.length} recent requests</p>
        {filtered.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">No matching requests in the latest 30. Try another name or filter.</p> : <ul className="mt-3 space-y-2">{filtered.map(row => <li key={row.id} className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words font-medium">{row.name}</p><p className="text-xs text-[hsl(var(--muted))]">{row.kind === 'adult' ? 'Adult' : 'Parent & child'} · {row.date}</p></div><span className={`inline-flex self-start rounded-full px-3 py-1 text-xs font-semibold sm:self-auto ${row.tone}`}>{row.status}</span></li>)}</ul>}
      </>}
    </section>
    <Link href="/reception" className="inline-flex min-h-[44px] items-center text-sm underline underline-offset-4">← Reception home</Link>
  </div>
}
