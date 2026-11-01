'use client'

import { useState } from 'react'

type Decision = 'verified' | 'rejected' | 'requires_review'
type EvidenceMethod = 'in_person_documents' | 'verified_official_record' | 'other_reviewed_evidence'
type Review = {
  id: string
  decision: Decision
  evidence_method: EvidenceMethod
  evidence_reference: string
  review_note: string
  reviewed_by: string
  reviewed_at: string
}
type ApiResult = { ok?: boolean; code?: string; reviews?: Review[]; review?: { id: string; decision: Decision; reviewed_at: string } }
type Props = { familyId: string; guardianAuthUserId: string; memberUserId: string }

const decisionLabels: Record<Decision, string> = {
  verified: 'Verified — authority confirmed',
  rejected: 'Rejected — authority not confirmed',
  requires_review: 'Requires review — no authorization',
}
const methodLabels: Record<EvidenceMethod, string> = {
  in_person_documents: 'Documents checked in person',
  verified_official_record: 'Verified official record',
  other_reviewed_evidence: 'Other independently reviewed evidence',
}

export default function GuardianAuthorityReviewPanel({ familyId, guardianAuthUserId, memberUserId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<Review[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [decision, setDecision] = useState<Decision>('requires_review')
  const [method, setMethod] = useState<EvidenceMethod>('in_person_documents')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const endpoint = '/api/admin/family-guardian-verification'
  const params = new URLSearchParams({
    family_id: familyId,
    guardian_auth_user_id: guardianAuthUserId,
    member_user_id: memberUserId,
  })

  async function refresh() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store' })
      const body = await res.json() as ApiResult
      if (!res.ok || !body.ok || !Array.isArray(body.reviews)) throw new Error(body.code || 'HISTORY_UNAVAILABLE')
      setHistory(body.reviews)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HISTORY_UNAVAILABLE')
      setHistory(null)
    } finally { setLoading(false) }
  }

  async function submit() {
    if (loading || submitted || !confirmed || history === null || reference.trim().length < 4 ||
        reference.trim().length > 160 || note.trim().length < 12 || note.trim().length > 1000) return
    setLoading(true)
    setSubmitted(true) // Never offer a blind retry after an ambiguous network failure.
    setError('')
    setMessage('')
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          family_id: familyId,
          guardian_auth_user_id: guardianAuthUserId,
          member_user_id: memberUserId,
          decision,
          evidence_method: method,
          evidence_reference: reference.trim(),
          review_note: note.trim(),
        }),
      })
      const body = await res.json() as ApiResult
      if (!res.ok || !body.ok || !body.review) throw new Error(body.code || 'REVIEW_RECORD_FAILED')
      setMessage('Decision recorded. Check the history before taking any further action. No consent was signed automatically.')
      setConfirmed(false)
      setHistory(null)
      setReference('')
      setNote('')
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'REVIEW_RECORD_FAILED'}. Check history before any further submission.`)
      setHistory(null)
    } finally { setLoading(false) }
  }

  const latest = history?.[0]
  return (
    <div className="mt-2 w-full border-t border-[hsl(var(--border))] pt-2 text-sm">
      <button type="button" aria-expanded={expanded} onClick={() => {
        setExpanded(!expanded)
        setError('')
        setMessage('')
      }} className="min-h-[44px] rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-medium">
        {expanded ? 'Close guardian verification' : 'Super Admin: guardian verification'}
      </button>
      {expanded && <div className="mt-3 space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
        <p className="text-xs text-slate-700">For this child and guardian only. Review original evidence before selecting a decision. All decisions are permanent and auditable; a new review supersedes the previous one.</p>
        <button type="button" disabled={loading} onClick={refresh} className="min-h-[44px] rounded-lg border border-black px-3 py-2 font-medium disabled:opacity-50">
          {loading ? 'Loading…' : 'Load / refresh decision history'}
        </button>
        {history !== null && <div className="space-y-2">
          <p className="font-semibold">{latest ? `Latest decision: ${decisionLabels[latest.decision]}` : 'No guardian authority review recorded'}</p>
          <p className="text-xs text-slate-700">Showing the latest {history.length} reviews for this exact guardian and child.</p>
          {history.length > 0 && <ol className="max-h-48 list-decimal space-y-2 overflow-auto pl-5 text-xs">
            {history.map(item => <li key={item.id} className="break-words">
              <strong>{decisionLabels[item.decision]}</strong> · {new Date(item.reviewed_at).toLocaleString('en-GB')} · {methodLabels[item.evidence_method]}
              <span className="block">Evidence reference: {item.evidence_reference}</span>
              <span className="block">Review note: {item.review_note}</span>
            </li>)}
          </ol>}
        </div>}
        {history !== null && !submitted && <div className="space-y-3 rounded-xl bg-slate-50 p-3">
          <h3 className="font-semibold">Record a new, explicit staff decision</h3>
          <label className="block font-medium">Decision
            <select value={decision} onChange={e => { setDecision(e.target.value as Decision); setConfirmed(false) }} className="mt-1 min-h-[44px] w-full rounded-lg border p-2">
              {Object.entries(decisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block font-medium">Evidence method
            <select value={method} onChange={e => { setMethod(e.target.value as EvidenceMethod); setConfirmed(false) }} className="mt-1 min-h-[44px] w-full rounded-lg border p-2">
              {Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block font-medium">Evidence reference (4–160 characters)
            <input value={reference} maxLength={160} onChange={e => { setReference(e.target.value); setConfirmed(false) }} placeholder="Internal evidence reference; do not paste an ID scan" className="mt-1 min-h-[44px] w-full rounded-lg border p-2" />
          </label>
          <label className="block font-medium">Review note (12–1000 characters)
            <textarea value={note} maxLength={1000} rows={3} onChange={e => { setNote(e.target.value); setConfirmed(false) }} className="mt-1 w-full rounded-lg border p-2" />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>I personally reviewed the evidence and authorize recording <strong>{decisionLabels[decision]}</strong> for this guardian and child. This action cannot be edited or deleted and does not itself record legal consent.</span>
          </label>
          <button type="button" disabled={loading || !confirmed || reference.trim().length < 4 || note.trim().length < 12} onClick={submit} className="min-h-[44px] rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">
            Record this decision
          </button>
        </div>}
        {message && <p role="status" className="text-emerald-800">{message}</p>}
        {error && <p role="alert" className="text-red-800">Verification unavailable ({error}).</p>}
        {submitted && <p className="text-xs text-slate-700">Submission locked to prevent duplicate reviews. Reload this panel or the page and inspect history before a new decision.</p>}
      </div>}
    </div>
  )
}
