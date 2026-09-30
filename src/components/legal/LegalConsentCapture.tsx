'use client'

import { useEffect, useMemo, useState } from 'react'

export type LegalConsentPayload = {
  accepted_document_version_ids: string[]
  acceptor_name: string
  acceptor_capacity: 'participant' | 'parent' | 'legal_guardian'
  guardian_relationship?: string
}

type LegalDocument = {
  id: string
  key: 'privacy_policy' | 'terms_of_use' | 'liability_waiver'
  title: string
  version: string
  url: string
  status: 'draft' | 'active'
  required: boolean
}

function ageFromDob(dob?: string) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const [y, m, d] = dob.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (
    Number.isNaN(born.getTime()) ||
    born.getUTCFullYear() !== y ||
    born.getUTCMonth() !== m - 1 ||
    born.getUTCDate() !== d
  ) return null

  let today = new Date()
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(today)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    today = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
  } catch {
    today = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  }

  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  return age >= 0 ? age : null
}

function agreementText(key: LegalDocument['key']) {
  if (key === 'privacy_policy') return 'I have read and acknowledge the ATOM Privacy Policy.'
  if (key === 'terms_of_use') return 'I have read and agree to the ATOM Terms of Use.'
  return 'I have read and accept the ATOM Liability Waiver & Assumption of Risk Agreement.'
}

export default function LegalConsentCapture({
  dateOfBirth,
  participantName,
  disabled,
  onChange,
  onValidityChange,
}: {
  dateOfBirth?: string
  participantName?: string
  disabled?: boolean
  onChange: (value: LegalConsentPayload) => void
  onValidityChange: (valid: boolean) => void
}) {
  const [documents, setDocuments] = useState<LegalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [acceptedIds, setAcceptedIds] = useState<string[]>([])
  const [acceptorName, setAcceptorName] = useState('')
  const [capacity, setCapacity] = useState<'participant' | 'parent' | 'legal_guardian'>('participant')
  const [relationship, setRelationship] = useState('')

  const age = useMemo(() => ageFromDob(dateOfBirth), [dateOfBirth])
  const isMinor = age !== null ? age < 18 : null

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const response = await fetch('/api/legal-documents/registration', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data?.ok !== true) {
          throw new Error(data?.details || data?.error || 'LEGAL_DOCUMENTS_FAILED')
        }
        if (!cancelled) setDocuments(Array.isArray(data.documents) ? data.documents : [])
      } catch (error: any) {
        if (!cancelled) setLoadError(String(error?.message || error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isMinor === false) {
      setCapacity('participant')
      setRelationship('')
      if (!acceptorName.trim() && participantName?.trim()) {
        setAcceptorName(participantName.trim())
      }
    } else if (isMinor === true && capacity === 'participant') {
      setCapacity('parent')
      setAcceptorName('')
    }
  }, [isMinor, participantName, acceptorName, capacity])

  useEffect(() => {
    const requiredIds = documents.filter((doc) => doc.required).map((doc) => doc.id)
    const documentsOk = requiredIds.every((id) => acceptedIds.includes(id))
    const identityOk =
      !!acceptorName.trim() &&
      (isMinor === false
        ? capacity === 'participant'
        : isMinor === true
          ? (capacity === 'parent' || capacity === 'legal_guardian') && !!relationship.trim()
          : false)

    const valid = !loading && !loadError && documentsOk && identityOk

    onChange({
      accepted_document_version_ids: acceptedIds,
      acceptor_name: acceptorName.trim(),
      acceptor_capacity: capacity,
      guardian_relationship: isMinor ? relationship.trim() : undefined,
    })
    onValidityChange(valid)
  }, [acceptedIds, acceptorName, capacity, documents, isMinor, relationship, loading, loadError, onChange, onValidityChange])

  function toggle(id: string, checked: boolean) {
    setAcceptedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((value) => value !== id)
    })
  }

  return (
    <div className="sm:col-span-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
      <div className="font-semibold">Legal acceptance</div>
      <p className="mt-1 text-xs text-[hsl(var(--muted))]">
        Each required document must be accepted separately. The member or guardian is the accepting person; the staff account only records the acceptance.
      </p>

      {loading ? (
        <div className="mt-3 text-sm text-[hsl(var(--muted))]">Loading legal documents…</div>
      ) : loadError ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          Legal documents could not be loaded: {loadError}
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {documents.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-3">
              {doc.status === 'draft' ? (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded border bg-gray-100" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      <a href={doc.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {doc.title}
                      </a>{' '}
                      <span className="text-xs text-[hsl(var(--muted))]">v{doc.version}</span>
                    </div>
                    <div className="mt-1 text-xs text-amber-700">
                      Pending legal review — not yet required for registration.
                    </div>
                  </div>
                </div>
              ) : (
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={acceptedIds.includes(doc.id)}
                    onChange={(event) => toggle(doc.id, event.target.checked)}
                    disabled={disabled}
                    className="mt-1 h-4 w-4"
                  />
                  <span className="min-w-0 text-sm">
                    {agreementText(doc.key)}{' '}
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline underline-offset-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Open document
                    </a>
                    <span className="ml-1 text-xs text-[hsl(var(--muted))]">v{doc.version}</span>
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>
      )}

      {age === null ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Enter a valid date of birth to determine who must accept the legal documents.
        </div>
      ) : isMinor ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Parent / guardian full name *</span>
            <input
              value={acceptorName}
              onChange={(event) => setAcceptorName(event.target.value)}
              disabled={disabled}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              placeholder="Full legal name"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Capacity *</span>
            <select
              value={capacity}
              onChange={(event) => setCapacity(event.target.value as 'parent' | 'legal_guardian')}
              disabled={disabled}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            >
              <option value="parent">Parent</option>
              <option value="legal_guardian">Legal guardian</option>
            </select>
          </label>

          <label className="grid gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Relationship to participant *</span>
            <input
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
              disabled={disabled}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              placeholder="Mother, father, legal guardian…"
            />
          </label>

          <div className="sm:col-span-2 text-xs text-[hsl(var(--muted))]">
            The participant is under 18. Acceptance must be provided by a parent or legal guardian.
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Participant accepting the documents *</span>
            <input
              value={acceptorName}
              onChange={(event) => setAcceptorName(event.target.value)}
              disabled={disabled}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              placeholder="Member full legal name"
            />
          </label>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
            The participant is 18 or older and accepts the documents personally.
          </div>
        </div>
      )}
    </div>
  )
}
