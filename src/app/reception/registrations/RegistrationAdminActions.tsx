'use client'

import { useState } from 'react'

type Step = 'WAIT_FOR_VERIFICATION' | 'REVIEW_IDENTITY_AND_CLAIM' | 'CREATE_AUTH_MANUALLY' |
  'RECONCILE_AUTH' | 'COMPLETE_MEMBER_FAMILY_MANUALLY' | 'SEND_INVITATION_MANUALLY' |
  'RECONCILE_INVITATION' | 'WAIT_FOR_ACTIVATION' | 'CHECK_LEGAL_CONSENT' | 'BLOCKED_REQUIRES_REVIEW'
type Action = 'APPROVE' | 'REJECT' | 'CREATE_AUTH' | 'COMPLETE_MEMBER_FAMILY' | 'SEND_INVITATION' | 'RECONCILE_AUTH'
type Plan = { step: Step; reason: string; reviewRequired: boolean; readyForAutomaticExecution: false }
type PlanResponse = { ok: boolean; plan?: Plan; code?: string }
type TransitionResponse = { ok: boolean; code: string; nextStep?: string }

const labels: Record<Step, string> = {
  WAIT_FOR_VERIFICATION: 'Waiting for email verification',
  REVIEW_IDENTITY_AND_CLAIM: 'Ready for Super Admin identity review',
  CREATE_AUTH_MANUALLY: 'Approved — create Auth account',
  RECONCILE_AUTH: 'Auth creation uncertain — manual reconciliation required',
  COMPLETE_MEMBER_FAMILY_MANUALLY: 'Create Member / Family records',
  SEND_INVITATION_MANUALLY: 'Send account activation invitation',
  RECONCILE_INVITATION: 'Email outcome uncertain — investigate before sending again',
  WAIT_FOR_ACTIVATION: 'Invitation sent — awaiting password setup',
  CHECK_LEGAL_CONSENT: 'Account activated — verify outstanding legal consent',
  BLOCKED_REQUIRES_REVIEW: 'Blocked — manual investigation required',
}
const nextAction: Partial<Record<Step, Action>> = {
  REVIEW_IDENTITY_AND_CLAIM: 'APPROVE',
  CREATE_AUTH_MANUALLY: 'CREATE_AUTH',
  RECONCILE_AUTH: 'RECONCILE_AUTH',
  COMPLETE_MEMBER_FAMILY_MANUALLY: 'COMPLETE_MEMBER_FAMILY',
  SEND_INVITATION_MANUALLY: 'SEND_INVITATION',
}
const actionLabel: Record<Action, string> = {
  APPROVE: 'Approve this application',
  REJECT: 'Reject this application',
  CREATE_AUTH: 'Create Auth account',
  COMPLETE_MEMBER_FAMILY: 'Create Member / Family records',
  SEND_INVITATION: 'Send activation invitation',
  RECONCILE_AUTH: 'Reconcile interrupted Auth creation',
}

/** Read-only diagnosis first; every mutation has a new affirmative Super Admin confirmation. */
export default function RegistrationAdminActions({ requestId }: { requestId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [chosenAction, setChosenAction] = useState<Action | null>(null)
  const [submitted, setSubmitted] = useState(false)

  async function readPlan() {
    setLoading(true); setPlan(null); setError(''); setMessage(''); setChosenAction(null)
    setConfirmed(false); setSubmitted(false); setReason('')
    try {
      const res = await fetch('/api/admin/public-registration/provisioning/plan', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      const body = (await res.json()) as PlanResponse
      if (!res.ok || !body.ok || !body.plan) throw new Error(body.code || 'DIAGNOSTIC_UNAVAILABLE')
      setPlan(body.plan)
    } catch (e) { setError(e instanceof Error ? e.message : 'DIAGNOSTIC_UNAVAILABLE') }
    finally { setLoading(false) }
  }

  async function perform() {
    if (!chosenAction || !confirmed || submitted || loading) return
    if ((chosenAction === 'REJECT' || chosenAction === 'RECONCILE_AUTH') && reason.trim().length < 10) return
    setSubmitted(true); setLoading(true); setError(''); setMessage('')
    try {
      const url = chosenAction === 'RECONCILE_AUTH'
        ? '/api/admin/public-registration/provisioning/transition'
        : '/api/admin/public-registration/provisioning/advance'
      const action = chosenAction === 'RECONCILE_AUTH' ? 'RECONCILE_AUTH' : chosenAction
      const res = await fetch(url, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action, reason: reason.trim(), confirm: true }),
      })
      const body = (await res.json()) as TransitionResponse
      if (!res.ok || !body.ok) throw new Error(body.code || 'TRANSITION_FAILED')
      setPlan(null); setChosenAction(null); setConfirmed(false)
      setMessage('Step completed. Refresh the server diagnosis to review the next action.')
    } catch (e) {
      setPlan(null); setChosenAction(null); setConfirmed(false)
      setError(e instanceof Error ? e.message : 'TRANSITION_FAILED')
    } finally { setLoading(false) }
  }

  const canReject = plan?.step === 'WAIT_FOR_VERIFICATION' || plan?.step === 'REVIEW_IDENTITY_AND_CLAIM'
  const permittedAction = plan ? nextAction[plan.step] : null
  const requiringReason = chosenAction === 'REJECT' || chosenAction === 'RECONCILE_AUTH'

  return <div className="mt-2 w-full border-t border-[hsl(var(--border))] pt-2 text-sm">
    <button type="button" aria-expanded={expanded} onClick={() => {
      setExpanded(!expanded); setPlan(null); setChosenAction(null); setError(''); setMessage('')
      setConfirmed(false); setSubmitted(false)
    }} className="min-h-[44px] rounded-lg border px-3 py-2 font-medium">
      {expanded ? 'Close Super Admin review' : 'Super Admin: review / approve'}
    </button>
    {expanded && <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-700">Only Super Admin can approve or reject. No account, invitation, payment or enrollment is created by opening this panel.</p>
      <button type="button" disabled={loading} onClick={readPlan}
        className="min-h-[44px] rounded-lg border border-black px-3 py-2 font-medium disabled:opacity-50">
        {loading ? 'Checking…' : 'Refresh server diagnosis'}
      </button>

      {plan && <div className="space-y-3" aria-live="polite">
        <p className="font-semibold">{labels[plan.step]}</p>
        <p className="break-words text-xs text-slate-700">Diagnostic: {plan.reason}</p>
        {permittedAction && <button type="button" onClick={() => {
          setChosenAction(permittedAction); setConfirmed(false); setReason('')
        }} className="min-h-[44px] rounded-lg bg-black px-4 py-2 font-medium text-white">
          {actionLabel[permittedAction]}
        </button>}
        {canReject && <button type="button" onClick={() => {
          setChosenAction('REJECT'); setConfirmed(false); setReason('')
        }} className="ml-2 min-h-[44px] rounded-lg border border-red-800 px-4 py-2 font-medium text-red-900">
          Reject application
        </button>}
      </div>}

      {chosenAction && <div className="space-y-3 rounded-xl border border-amber-400 bg-amber-50 p-3">
        <p className="font-semibold">{actionLabel[chosenAction]}</p>
        <p className="text-xs text-amber-950">
          {chosenAction === 'APPROVE'
            ? 'I have checked identity, duplicate records and (for minors) the parent / guardian evidence. Approval only authorizes later manual provisioning steps.'
            : 'This performs only the selected operation, after fresh server-side authorization and state checks. It will not automatically run the next operation.'}
        </p>
        {requiringReason && <label className="block text-sm font-medium">
          {chosenAction === 'REJECT' ? 'Reason for rejection' : 'Reconciliation reason'} (at least 10 characters)
          <textarea rows={3} maxLength={chosenAction === 'REJECT' ? 500 : 1000} value={reason}
            onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-400 bg-white p-2" />
        </label>}
        <label className="flex min-h-[44px] items-start gap-2">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          <span>I have reviewed the dossier and explicitly authorize this one action. I understand interrupted actions must be investigated, not automatically retried.</span>
        </label>
        <button type="button" disabled={!confirmed || loading || submitted || (requiringReason && reason.trim().length < 10)}
          onClick={perform} className="min-h-[44px] rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? 'Processing…' : 'Confirm — ' + actionLabel[chosenAction]}
        </button>
        <button type="button" disabled={loading} onClick={() => { setChosenAction(null); setConfirmed(false) }}
          className="ml-3 underline">Cancel</button>
      </div>}

      {message && <p role="status" className="text-emerald-800">{message}</p>}
      {error && <p role="alert" className="break-words text-red-800">
        Operation unavailable ({error}). Inspect the current state before another attempt.
      </p>}
    </div>}
  </div>
}
