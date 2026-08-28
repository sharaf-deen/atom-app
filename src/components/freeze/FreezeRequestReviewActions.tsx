
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  requestId: string
  subscriptionId: string | null
  from: string
  to: string | null
}

export default function FreezeRequestReviewActions({ requestId, subscriptionId, from, to }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function markReview(action: 'approve' | 'deny', note = '') {
    const res = await fetch('/api/freeze-requests/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: requestId, action, note }),
    })
    const json = await res.json().catch(() => null)
    return { res, json }
  }

  async function approve() {
    if (!subscriptionId || !to) { setError('This request is missing subscription/date information.'); return }
    if (!window.confirm(`Approve and apply this freeze from ${from} to ${to}?`)) return
    setBusy('approve'); setError(null)
    try {
      const applyRes = await fetch('/api/subscriptions/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: subscriptionId, action: 'create', from, to }),
      })
      const applyJson = await applyRes.json().catch(() => null)

      // If this is a retry after the freeze was already applied, the review endpoint
      // verifies the exact matching freeze and can safely finalize the request.
      if (!applyRes.ok) {
        const reviewRetry = await markReview('approve')
        if (reviewRetry.res.ok && reviewRetry.json?.ok) { router.refresh(); return }
        throw new Error(applyJson?.error || 'Could not apply the freeze.')
      }

      const review = await markReview('approve')
      if (!review.res.ok || !review.json?.ok) {
        throw new Error(review.json?.error === 'FREEZE_NOT_APPLIED' ? 'Freeze was applied but the request audit could not be finalized. Click Approve again.' : (review.json?.error || 'Freeze applied, but request status could not be finalized.'))
      }
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Could not approve freeze request.')
    } finally { setBusy(null) }
  }

  async function deny() {
    const note = window.prompt('Reason / internal note for rejecting this request:')
    if (note === null) return
    if (!note.trim()) { setError('A rejection note is required.'); return }
    if (!window.confirm('Reject this freeze request?')) return
    setBusy('deny'); setError(null)
    try {
      const review = await markReview('deny', note.trim())
      if (!review.res.ok || !review.json?.ok) throw new Error(review.json?.error || 'Could not reject freeze request.')
      router.refresh()
    } catch (e: any) { setError(e?.message || 'Could not reject freeze request.') }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button onClick={approve} disabled={!!busy} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'approve' ? 'Applying…' : 'Approve & apply'}</button>
        <button onClick={deny} disabled={!!busy} className="rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'deny' ? 'Rejecting…' : 'Reject'}</button>
      </div>
      {error ? <div className="text-xs text-rose-700">{error}</div> : null}
    </div>
  )
}
