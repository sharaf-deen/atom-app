'use client'

import { useState } from 'react'
import type { ProspectMemberReconciliationRow, ProspectRow } from '@/app/admin/prospects/page'

export type ReconciliationFilter =
  | 'all'
  | 'became_member'
  | 'linked'
  | 'unique_match'
  | 'active_membership'
  | 'ambiguous'
  | 'unmatched'

type SummaryProps = {
  rows: ProspectMemberReconciliationRow[]
  activeFilter: ReconciliationFilter
  onSelect: (filter: ReconciliationFilter) => void
}

type MatchProps = {
  prospect: ProspectRow
  reconciliation: ProspectMemberReconciliationRow | null
  canManage: boolean
}

const FILTER_LABELS: Record<ReconciliationFilter, string> = {
  all: 'All compared',
  became_member: 'Became members',
  linked: 'Confirmed links',
  unique_match: 'Matches to confirm',
  active_membership: 'Active memberships',
  ambiguous: 'Ambiguous',
  unmatched: 'Not found',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(date)
}

function matchBasisLabel(value: ProspectMemberReconciliationRow['match_basis']) {
  if (value === 'email_and_phone') return 'same email and phone'
  if (value === 'email') return 'same email'
  if (value === 'phone') return 'same phone'
  if (value === 'linked') return 'confirmed link'
  return 'no exact match'
}

export function matchesReconciliationFilter(
  row: ProspectMemberReconciliationRow | null | undefined,
  filter: ReconciliationFilter,
) {
  if (filter === 'all') return true
  if (!row) return filter === 'unmatched'
  if (filter === 'became_member') return Boolean(row.member_user_id && row.became_member_after_prospect)
  if (filter === 'active_membership') return row.has_active_membership
  return row.reconciliation_state === filter
}

export function ProspectMemberReconciliationSummary({ rows, activeFilter, onSelect }: SummaryProps) {
  const counts: Record<ReconciliationFilter, number> = {
    all: rows.length,
    became_member: rows.filter((row) => row.member_user_id && row.became_member_after_prospect).length,
    linked: rows.filter((row) => row.reconciliation_state === 'linked').length,
    unique_match: rows.filter((row) => row.reconciliation_state === 'unique_match').length,
    active_membership: rows.filter((row) => row.has_active_membership).length,
    ambiguous: rows.filter((row) => row.reconciliation_state === 'ambiguous').length,
    unmatched: rows.filter((row) => row.reconciliation_state === 'unmatched').length,
  }
  const conversionRate = counts.all > 0 ? Math.round((counts.became_member / counts.all) * 100) : 0

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Prospect → Member comparison</h2>
        <p className="text-sm text-[hsl(var(--muted))]">
          Exact links, emails and phone numbers only. Names are never matched automatically.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {(Object.keys(FILTER_LABELS) as ReconciliationFilter[]).map((filter) => {
          const active = activeFilter === filter
          const urgent = (filter === 'ambiguous' || filter === 'unique_match') && counts[filter] > 0
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(filter)}
              className={`rounded-2xl border p-3 text-left shadow-soft transition ${
                active
                  ? 'border-black bg-black text-white'
                  : urgent
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-[hsl(var(--border))] bg-white hover:border-slate-400'
              }`}
            >
              <div className={`text-[11px] font-medium uppercase tracking-wide ${active ? 'text-white/70' : 'text-[hsl(var(--muted))]'}`}>
                {FILTER_LABELS[filter]}
              </div>
              <div className="mt-1 text-xl font-semibold">{counts[filter]}</div>
            </button>
          )
        })}
      </div>
      <div className="text-xs text-[hsl(var(--muted))]">
        Observed conversion rate: <strong className="text-[hsl(var(--foreground))]">{conversionRate}%</strong>
        {' · '}Based on member accounts or memberships created after the first prospect enquiry.
      </div>
    </section>
  )
}

export default function ProspectMemberMatch({ prospect, reconciliation, canManage }: MatchProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!reconciliation || reconciliation.reconciliation_state === 'unmatched') {
    return (
      <div className="mt-3 text-xs text-[hsl(var(--muted))]">
        Member comparison: no exact member match found.
      </div>
    )
  }

  if (reconciliation.reconciliation_state === 'ambiguous') {
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
        <strong>Member match needs review.</strong>{' '}
        {reconciliation.candidate_count} profiles share this email or phone. Open Details → Convert to Member to review safely.
      </div>
    )
  }

  const isLinked = reconciliation.reconciliation_state === 'linked'
  const memberUserId = reconciliation.member_user_id
  const memberName = reconciliation.member_full_name || reconciliation.member_email || reconciliation.member_code || 'Member'
  const timing = reconciliation.days_to_first_membership
  const timingText = timing === null
    ? reconciliation.became_member_after_prospect
      ? 'Member account created after the enquiry.'
      : 'No membership recorded.'
    : timing >= 0
      ? `First membership ${timing === 0 ? 'on the enquiry date' : `${timing} day${timing === 1 ? '' : 's'} after the enquiry`}.`
      : `Membership predates the enquiry by ${Math.abs(timing)} day${Math.abs(timing) === 1 ? '' : 's'}.`

  async function confirmMatch() {
    if (!canManage || !memberUserId || busy) return
    const confirmed = window.confirm(
      `Confirm that prospect ${prospect.full_name} is member ${memberName}? This will mark the prospect as Joined and preserve its history.`,
    )
    if (!confirmed) return

    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: prospect.id,
          action: 'link_member',
          member_user_id: memberUserId,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.ok !== true) throw new Error(data?.details || data?.error || 'Member link failed.')
      window.location.reload()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Member link failed.'))
      setBusy(false)
    }
  }

  return (
    <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${isLinked ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{isLinked ? 'Confirmed member' : 'Exact member match to confirm'}: {memberName}</strong>
            {reconciliation.member_code ? <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">{reconciliation.member_code}</span> : null}
            {reconciliation.has_active_membership ? <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">Active membership</span> : null}
          </div>
          <div className="mt-1 text-xs opacity-80">
            {matchBasisLabel(reconciliation.match_basis)} · Account {formatDate(reconciliation.member_created_at)}
            {' · '}First membership {formatDate(reconciliation.first_membership_start_date)}
            {' · '}{reconciliation.subscription_count} membership{reconciliation.subscription_count === 1 ? '' : 's'}
          </div>
          <div className="mt-1 text-xs opacity-80">{timingText}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {reconciliation.member_user_id ? (
            <a href={`/members/${reconciliation.member_user_id}`} className="rounded-lg border border-current/20 bg-white px-3 py-1.5 text-xs font-semibold text-black">
              Open Member
            </a>
          ) : null}
          {!isLinked && canManage ? (
            <button type="button" onClick={() => void confirmMatch()} disabled={busy} className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? 'Linking…' : 'Confirm match'}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <div className="mt-2 text-xs font-medium text-rose-700">{error}</div> : null}
    </div>
  )
}
