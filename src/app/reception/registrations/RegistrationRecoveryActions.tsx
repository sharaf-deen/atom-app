'use client'

import { useState } from 'react'

type RecoveryState =
  | 'ACTIVATED' | 'MANUAL_REVIEW' | 'IDENTITY_REVIEW_REQUIRED'
  | 'PASSWORD_REPORTED_ACTIVATION_INCOMPLETE' | 'SESSION_USED_ACTIVATION_INCOMPLETE'
  | 'RESEND_AVAILABLE' | 'INVITATION_PENDING'

type Diagnosis = {
  ok: boolean
  code?: string
  state?: RecoveryState
  resend_allowed?: boolean
  resend_attempts?: number
}

const guidance: Record<RecoveryState, string> = {
  ACTIVATED: 'Technical account activation is already recorded. Check legal consent separately.',
  MANUAL_REVIEW: 'Account checkpoints conflict or are incomplete. Do not create another account or resend an invitation.',
  IDENTITY_REVIEW_REQUIRED: 'The Auth user does not match verified registration provenance. Manual security review required.',
  PASSWORD_REPORTED_ACTIVATION_INCOMPLETE: 'Password setup was reported but activation did not finalize. Review the account; never mark it activated manually.',
  SESSION_USED_ACTIVATION_INCOMPLETE: 'The parent opened an authenticated session, but ATOM activation is incomplete. If the parent already knows their password, ask them to sign in and open /auth/complete-existing-registration. They confirm their current password; it is not changed. Do not resend an invitation without identity review.',
  RESEND_AVAILABLE: 'No login recorded. A controlled invitation resend can be requested with Super Admin confirmation.',
  INVITATION_PENDING: 'No login recorded. Resend is unavailable due to feature settings, cooldown, attempt limits, or an unresolved delivery attempt.',
}

/** This UI can only request an existing RPC-guarded action; no client-side authorization. */
export default function RegistrationRecoveryActions({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function call(action: 'diagnose' | 'resend') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/admin/public-registration/activation/recovery', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId, action,
          ...(action === 'resend' ? { reason: reason.trim(), confirm: true } : {}),
        }),
      })
      const result = await response.json() as Diagnosis
      if (!response.ok || !result.ok) throw new Error(result.code || 'RECOVERY_UNAVAILABLE')
      if (action === 'resend') {
        if (result.code !== 'RESEND_RECORDED') throw new Error('RESEND_OUTCOME_REVIEW_REQUIRED')
        setNotice('Invitation resend recorded. Ask the parent to open the newest email.')
        setConfirmed(false)
        setReason('')
        setDiagnosis(null)
      } else {
        setDiagnosis(result)
      }
    } catch (e) {
      setDiagnosis(null)
      setError(e instanceof Error ? e.message : 'RECOVERY_UNAVAILABLE')
    } finally {
      setBusy(false)
    }
  }

  return <div className="mt-2 w-full border-t border-[hsl(var(--border))] pt-2 text-sm">
    <button type="button" className="min-h-[44px] rounded-lg border px-3 py-2 font-medium"
      aria-expanded={open} onClick={() => { setOpen(!open); setDiagnosis(null); setError(''); setNotice(''); setConfirmed(false) }}>
      {open ? 'Close account recovery' : 'Super Admin: account recovery'}
    </button>
    {open && <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-700">Read-only diagnosis first. No new account, password, legal consent or membership is created.</p>
      <button type="button" disabled={busy} onClick={() => void call('diagnose')}
        className="min-h-[44px] rounded-lg border border-black px-3 py-2 font-medium disabled:opacity-50">
        {busy ? 'Checking…' : 'Check existing account'}
      </button>
      {diagnosis?.state && <div aria-live="polite" className="space-y-2">
        <p className="font-semibold">{diagnosis.state.replaceAll('_', ' ')}</p>
        <p className="text-xs text-slate-700">{guidance[diagnosis.state]}</p>
        {diagnosis.state === 'SESSION_USED_ACTIVATION_INCOMPLETE' && <p className="text-xs text-slate-700">
          Share this link with the account holder: <a className="underline" href="/auth/complete-existing-registration" target="_blank" rel="noopener noreferrer">Complete existing registration</a>. They must authenticate on their own device.
        </p>}
        {diagnosis.resend_allowed && <>
          <label className="block font-medium">Reason for sending another invitation (12–1000 characters)
            <textarea rows={3} maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false) }}
              className="mt-1 w-full rounded-lg border border-slate-400 bg-white p-2" />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            <span>I verified the existing account and authorize one audited resend. I understand the delivery result may require manual review.</span>
          </label>
          <button type="button" disabled={busy || !confirmed || reason.trim().length < 12}
            onClick={() => void call('resend')} className="min-h-[44px] rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">
            Confirm — resend invitation
          </button>
        </>}
      </div>}
      {notice && <p role="status" className="text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="text-red-800">Recovery unavailable ({error}). Refresh the diagnosis before any further action.</p>}
    </div>}
  </div>
}
