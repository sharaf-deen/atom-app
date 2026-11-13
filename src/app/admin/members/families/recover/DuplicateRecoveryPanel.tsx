'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type Family = {
  id: string
  name: string
  guardians: { auth_user_id: string; name: string; email: string; is_primary: boolean }[]
  members: { member_id: string; name: string }[]
}
type Preview = {
  can_recover: boolean
  blockers: string[]
  archived_member_ids: string[]
  existing_login_preserved: boolean
}

export default function DuplicateRecoveryPanel({ families }: { families: Family[] }) {
  const router = useRouter()
  const [familyId, setFamilyId] = React.useState('')
  const [guardianId, setGuardianId] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>([])
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [feedback, setFeedback] = React.useState('')
  const family = families.find(item => item.id === familyId)
  const sortedGuardians = family?.guardians ?? []
  const sortedMembers = family?.members ?? []

  function reset() {
    setPreview(null)
    setFeedback('')
  }

  async function request(action: 'preview' | 'execute') {
    if (!familyId || !guardianId || selected.length !== 2) {
      setFeedback('Select a family, guardian and exactly two mistaken member IDs.')
      return
    }
    setBusy(true)
    setFeedback('')
    try {
      const response = await fetch('/api/admin/families/duplicate-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action, familyId, guardianAuthUserId: guardianId,
          memberIds: selected.slice().sort(),
          reason, confirmed: action === 'execute',
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Operation refused')
      if (action === 'preview') {
        setPreview(data.preview as Preview)
        setFeedback(data.preview?.can_recover
          ? 'Preview passed. Review the IDs and confirm the recovery.'
          : 'Recovery blocked. Resolve the listed dependencies before continuing.')
      } else {
        setPreview(null)
        setSelected([])
        setFeedback('Recovery recorded. The guardian now has a member profile; both old IDs are reserved.')
        router.refresh()
      }
    } catch (error) {
      setPreview(null)
      setFeedback(error instanceof Error ? error.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border p-5">
      <p className="text-sm text-amber-700">
        Super Admin only. A recovery archives and unlinks both mistaken profiles but never deletes or reuses their Member IDs.
        It is blocked if linked historical records exist; these must be reviewed separately.
      </p>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Family</span>
        <select aria-label="Family" className="w-full rounded border p-2" value={familyId}
          onChange={event => { setFamilyId(event.target.value); setGuardianId(''); setSelected([]); reset() }}>
          <option value="">Select a family</option>
          {families.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {family ? (
        <>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Actual guardian / future member</span>
            <select aria-label="Guardian" className="w-full rounded border p-2" value={guardianId}
              onChange={event => { setGuardianId(event.target.value); reset() }}>
              <option value="">Select guardian</option>
              {sortedGuardians.map(item => (
                <option value={item.auth_user_id} key={item.auth_user_id}>
                  {item.name} · {item.email}{item.is_primary ? ' · Primary' : ''}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Select exactly two profiles created in error</legend>
            {sortedMembers.map(member => (
              <label className="flex items-center gap-2" key={member.member_id}>
                <input type="checkbox" checked={selected.includes(member.member_id)}
                  disabled={!selected.includes(member.member_id) && selected.length >= 2}
                  onChange={event => {
                    setSelected(old => event.target.checked ? [...old,member.member_id] : old.filter(id => id !== member.member_id))
                    reset()
                  }}/>
                <span>{member.name} — {member.member_id}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" disabled={busy || !guardianId || selected.length !== 2}
            className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
            onClick={() => void request('preview')}>1. Preview recovery</button>
        </>
      ) : null}
      {preview ? (
        <div className="space-y-3 rounded border p-4">
          <div className="font-semibold">{preview.can_recover ? 'Ready to recover' : 'Blocked — no changes made'}</div>
          <div className="text-sm">Reserved IDs: {(preview.archived_member_ids || []).join(' and ')}</div>
          {(preview.blockers || []).length > 0 ? (
            <ul className="list-disc pl-5 text-sm">{preview.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>
          ) : null}
          {preview.can_recover ? (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Reason for audit (minimum 10 characters)</span>
                <textarea className="w-full rounded border p-2" rows={3} value={reason}
                  onChange={event => setReason(event.target.value)} />
              </label>
              <button type="button" className="rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-50"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void request('execute')}>2. Confirm guarded recovery</button>
            </>
          ) : null}
        </div>
      ) : null}
      {feedback ? <p role="status" className="text-sm">{feedback}</p> : null}
    </section>
  )
}
