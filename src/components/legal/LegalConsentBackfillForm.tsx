'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type LegalDocument = {
  id: string
  title: string
  version_label: string
  published_url: string
}

function ageFromDob(dob?: string | null) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const [y, m, d] = dob.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(born.getTime())) return null

  const now = new Date()
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const mm = now.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && now.getUTCDate() < born.getUTCDate())) age--
  return age >= 0 ? age : null
}

export default function LegalConsentBackfillForm({
  memberUserId,
  memberDateOfBirth,
  participantName,
  requiredDocuments,
  acceptedDocumentIds,
  isSelf,
  canStaffRecord,
}: {
  memberUserId: string
  memberDateOfBirth: string | null
  participantName: string
  requiredDocuments: LegalDocument[]
  acceptedDocumentIds: string[]
  isSelf: boolean
  canStaffRecord: boolean
}) {
  const router = useRouter()
  const age = useMemo(() => ageFromDob(memberDateOfBirth), [memberDateOfBirth])
  const isMinor = age !== null ? age < 18 : null

  const missingDocuments = requiredDocuments.filter((doc) => !acceptedDocumentIds.includes(doc.id))
  const [checked, setChecked] = useState<string[]>(acceptedDocumentIds)
  const [acceptorName, setAcceptorName] = useState(isMinor === false ? participantName : '')
  const [capacity, setCapacity] = useState<'participant' | 'parent' | 'legal_guardian'>(
    isMinor ? 'parent' : 'participant',
  )
  const [relationship, setRelationship] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (missingDocuments.length === 0) return null

  const minorSelfBlocked = isMinor === true && isSelf && !canStaffRecord
  const identityOk =
    isMinor === false
      ? capacity === 'participant' && acceptorName.trim().length >= 2
      : isMinor === true
        ? (capacity === 'parent' || capacity === 'legal_guardian') &&
          acceptorName.trim().length >= 2 &&
          relationship.trim().length >= 2
        : false

  const allRequiredChecked = requiredDocuments.every((doc) => checked.includes(doc.id))
  const canSubmit = !busy && !minorSelfBlocked && identityOk && allRequiredChecked

  function toggle(id: string, value: boolean) {
    setChecked((current) => {
      if (value) return current.includes(id) ? current : [...current, id]
      return current.filter((item) => item !== id)
    })
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`/api/members/${memberUserId}/legal-consents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legal_acceptance: {
            accepted_document_version_ids: checked,
            acceptor_name: acceptorName.trim(),
            acceptor_capacity: capacity,
            guardian_relationship: isMinor ? relationship.trim() : null,
          },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.details || data?.error || 'LEGAL_CONSENT_FAILED')
      }
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="font-semibold text-amber-950">Action required</div>
      <p className="mt-1 text-sm text-amber-900">
        {missingDocuments.length} current legal document{missingDocuments.length === 1 ? '' : 's'} still need acceptance.
        Existing acceptance history will be preserved.
      </p>

      {memberDateOfBirth === null ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          Date of birth is required before legal acceptance can be recorded.
        </div>
      ) : minorSelfBlocked ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-amber-950">
          This participant is under 18. A parent or legal guardian must accept the documents. Reception/Admin can record that acceptance after the guardian has reviewed them.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2">
            {requiredDocuments.map((doc) => {
              const alreadyAccepted = acceptedDocumentIds.includes(doc.id)
              return (
                <label
                  key={doc.id}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
                    alreadyAccepted ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={checked.includes(doc.id)}
                    disabled={alreadyAccepted || busy}
                    onChange={(event) => toggle(doc.id, event.target.checked)}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{doc.title}</span>{' '}
                    <span className="text-xs text-[hsl(var(--muted))]">v{doc.version_label}</span>
                    <span className="block text-xs text-[hsl(var(--muted))]">
                      {alreadyAccepted ? 'Already accepted' : 'Acceptance required'}
                      {' · '}
                      <a href={doc.published_url} target="_blank" rel="noreferrer" className="underline">
                        Open document
                      </a>
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm font-medium">{isMinor ? 'Parent / guardian full name *' : 'Participant full name *'}</span>
              <input
                value={acceptorName}
                disabled={busy}
                onChange={(event) => setAcceptorName(event.target.value)}
                className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              />
            </label>

            {isMinor ? (
              <label className="grid gap-1">
                <span className="text-sm font-medium">Capacity *</span>
                <select
                  value={capacity}
                  disabled={busy}
                  onChange={(event) => setCapacity(event.target.value as 'parent' | 'legal_guardian')}
                  className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                >
                  <option value="parent">Parent</option>
                  <option value="legal_guardian">Legal guardian</option>
                </select>
              </label>
            ) : null}

            {isMinor ? (
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-sm font-medium">Relationship to participant *</span>
                <input
                  value={relationship}
                  disabled={busy}
                  onChange={(event) => setRelationship(event.target.value)}
                  placeholder="Mother, father, legal guardian…"
                  className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                />
              </label>
            ) : null}
          </div>

          {error ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
          ) : null}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="mt-4 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Recording…' : isSelf ? 'Accept current documents' : 'Record guardian/member acceptance'}
          </button>

          <p className="mt-2 text-xs text-amber-900">
            The staff account records the transaction only. The name above must be the person who actually reviewed and accepted the documents.
          </p>
        </>
      )}
    </div>
  )
}
