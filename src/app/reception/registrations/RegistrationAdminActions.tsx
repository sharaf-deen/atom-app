'use client'

import { useState } from 'react'

type Step = 'WAIT_FOR_VERIFICATION' | 'REVIEW_IDENTITY_AND_CLAIM' | 'CREATE_AUTH_MANUALLY' | 'RECONCILE_AUTH' | 'COMPLETE_MEMBER_FAMILY_MANUALLY' | 'SEND_INVITATION_MANUALLY' | 'RECONCILE_INVITATION' | 'WAIT_FOR_ACTIVATION' | 'CHECK_LEGAL_CONSENT' | 'BLOCKED_REQUIRES_REVIEW'
type Plan = { step: Step; reason: string; reviewRequired: boolean; readyForAutomaticExecution: false }
type PlanResponse = { ok: boolean; plan?: Plan; code?: string }
type TransitionResponse = { ok: boolean; code: string; nextStep?: string }

const labels: Record<Step, string> = {
  WAIT_FOR_VERIFICATION: 'Await email verification',
  REVIEW_IDENTITY_AND_CLAIM: 'Identity review required',
  CREATE_AUTH_MANUALLY: 'Super Admin must create Auth account',
  RECONCILE_AUTH: 'Investigate interrupted Auth creation',
  COMPLETE_MEMBER_FAMILY_MANUALLY: 'Finalize Member and Family records',
  SEND_INVITATION_MANUALLY: 'Super Admin must send invitation',
  RECONCILE_INVITATION: 'Investigate invitation delivery',
  WAIT_FOR_ACTIVATION: 'Await account activation',
  CHECK_LEGAL_CONSENT: 'Check legal consent separately',
  BLOCKED_REQUIRES_REVIEW: 'Blocked — manual investigation needed',
}
const actions: Partial<Record<Step, 'RECONCILE_AUTH' | 'COMPLETE_MEMBER_FAMILY'>> = {
  RECONCILE_AUTH: 'RECONCILE_AUTH',
  COMPLETE_MEMBER_FAMILY_MANUALLY: 'COMPLETE_MEMBER_FAMILY',
}

/** Super Admin client controls only. Endpoints re-check Auth, role, state and DB constraints. */
export default function RegistrationAdminActions({ requestId }: { requestId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function readPlan() {
    setLoading(true); setPlan(null); setError(''); setMessage(''); setConfirmed(false); setSubmitted(false)
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
    const action = plan && actions[plan.step]
    if (!action || !confirmed || submitted || (action === 'RECONCILE_AUTH' && reason.trim().length < 10)) return
    setLoading(true); setError(''); setMessage(''); setSubmitted(true)
    try {
      const res = await fetch('/api/admin/public-registration/provisioning/transition', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action, reason: reason.trim(), confirm: true }),
      })
      const body = (await res.json()) as TransitionResponse
      if (!res.ok || !body.ok) throw new Error(body.code || 'TRANSITION_FAILED')
      setPlan(null); setMessage('Action recorded. Refresh the registration list to see updated status.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'TRANSITION_FAILED')
      // A failed response can be ambiguous. Do not permit retry from this panel.
      setPlan(null)
    } finally { setLoading(false) }
  }

  return <div className="mt-2 w-full border-t border-[hsl(var(--border))] pt-2 text-sm">
    <button type="button" aria-expanded={expanded} onClick={() => {
      setExpanded(!expanded); setPlan(null); setError(''); setMessage(''); setConfirmed(false); setSubmitted(false)
    }} className="min-h-[44px] rounded-lg border border-[hsl(var(--border))] px-3 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      {expanded ? 'Close Super Admin tools' : 'Super Admin: inspect next step'}
    </button>
    {expanded && <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-700">Privileged diagnostics only. No action happens when opening this panel.</p>
      <button type="button" disabled={loading || submitted} onClick={readPlan} className="min-h-[44px] rounded-lg border border-black px-3 py-2 font-medium disabled:opacity-50">{loading ? 'Checking…' : 'Refresh server diagnosis'}</button>
      {plan && <div className="space-y-2" aria-live="polite">
        <p className="font-semibold">{labels[plan.step]}</p>
        <p className="break-words text-xs text-slate-700">Diagnostic code: {plan.reason}</p>
        <p className="text-xs text-slate-700">No automatic execution. Authorization and state are checked again on submission.</p>
        {actions[plan.step] && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="font-semibold text-amber-950">Sensitive manual operation</p>
          {plan.step === 'RECONCILE_AUTH' && <div>
            <label htmlFor={`reason-${requestId}`} className="block text-sm font-medium">Reason for reconciliation (minimum 10 characters)</label>
            <textarea id={`reason-${requestId}`} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-400 bg-white p-2" />
          </div>}
          <label className="flex min-h-[44px] items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5" /><span>I reviewed the request and authorize this one operation. No automatic retry after failure.</span></label>
          <button type="button" disabled={!confirmed || loading || submitted || (plan.step === 'RECONCILE_AUTH' && reason.trim().length < 10)} onClick={perform} className="min-h-[44px] rounded-lg bg-black px-4 py-2 font-medium text-white disabled:opacity-50">{plan.step === 'RECONCILE_AUTH' ? 'Reconcile existing Auth account' : 'Finalize Member & Family'}</button>
        </div>}
      </div>}
      {message && <p role="status" className="text-emerald-800">{message}</p>}
      {error && <p role="alert" className="break-words text-red-800">Operation unavailable ({error}). Review state; do not retry blindly.</p>}
    </div>}
  </div>
}
