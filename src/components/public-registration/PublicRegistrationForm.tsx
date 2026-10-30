'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { MemberProgramOption } from '@/lib/memberPrograms'

type LegalDocument = { id: string; title: string; version: string; url: string }

type Props = { programs: MemberProgramOption[]; documents: LegalDocument[]; submitEnabled: boolean }

function validAge(dob: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const [year, month, day] = dob.split('-').map(Number)
  const birth = new Date(Date.UTC(year, month - 1, day))
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return null
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const now = new Date(Date.UTC(Number(byType.year), Number(byType.month) - 1, Number(byType.day)))
  if (birth > now) return null
  let age = now.getUTCFullYear() - year
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age--
  return age >= 0 ? age : null
}

export default function PublicRegistrationForm({ programs, documents, submitEnabled }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [program, setProgram] = useState('')
  const [accepted, setAccepted] = useState<string[]>([])
  const [signerConfirmed, setSignerConfirmed] = useState(false)
  const [guardianName, setGuardianName] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [guardianRelationship, setGuardianRelationship] = useState('')
  const age = useMemo(() => validAge(dob), [dob])
  const isMinor = age !== null && age < 18
  const eligiblePrograms = useMemo(() => programs.filter(p => age === null ||
    ((p.age_min === null || age >= p.age_min) && (p.age_max === null || age <= p.age_max))), [programs, age])
  const selectedProgram = eligiblePrograms.some(p => p.key === program) ? program : ''
  const className = 'w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-black'
  const allAccepted = documents.every(d => accepted.includes(d.id))

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!submitEnabled || submitting || age === null || !selectedProgram || !allAccepted || !signerConfirmed) return
    setSubmitError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/public-registration/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_key: crypto.randomUUID(), first_name: firstName, last_name: lastName,
          email: isMinor ? '' : email, phone, date_of_birth: dob, program_key: selectedProgram,
          ...(isMinor ? { guardian_name: guardianName, guardian_email: guardianEmail, guardian_relationship: guardianRelationship } : {}),
          accepted_document_version_ids: accepted,
        }),
      })
      if (!res.ok) { setSubmitError(res.status === 400 ? 'Please review your details and legal documents.' : 'Registration is temporarily unavailable. Please contact ATOM Reception.'); return }
      setSubmitted(true)
    } catch { setSubmitError('Connection error. Please try again or contact ATOM Reception.') }
    finally { setSubmitting(false) }
  }

  if (submitted) return <main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="text-2xl font-semibold">Registration request received</h1><p className="mt-4" role="status">If eligible, ATOM Reception will review your request and arrange email verification. No member account or paid subscription has been created.</p><Link href="/" className="mt-6 inline-block underline">Home</Link></main>

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted))]">ATOM Jiu-Jitsu</p>
          <h1 className="mt-1 text-2xl font-semibold">Member registration</h1>
        </div>
        <Link href="/" className="text-sm underline underline-offset-4">Home</Link>
      </div>
      {!submitEnabled && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        <strong>Registration preview.</strong> This form is not accepting submissions yet. No account, membership or invitation email will be created in this phase.
      </div>}
      <form className="space-y-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-6" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">First name *
            <input className={className} required autoComplete="given-name" maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Last name *
            <input className={className} required autoComplete="family-name" maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} />
          </label>
          {!isMinor && (
            <label className="block text-sm font-medium">Email *
              <input className={className} type="email" required autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
            </label>
          )}
          <label className="block text-sm font-medium">Phone
            <input className={className} type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Date of birth *
            <input className={className} type="date" required value={dob} onChange={e => { setDob(e.target.value); setProgram(''); setAccepted([]); setSignerConfirmed(false) }} />
            {dob && age === null ? <span className="mt-1 block text-xs text-red-700">Enter a valid date of birth.</span> : null}
          </label>
          <label className="block text-sm font-medium">Academy program *
            <select className={className} required disabled={age === null} value={selectedProgram} onChange={e => setProgram(e.target.value)}>
              <option value="">Select a program</option>
              {eligiblePrograms.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
        </div>
        {isMinor ? (
          <fieldset className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4">
            <legend className="px-2 font-semibold">Parent / legal guardian</legend>
            <p className="text-xs text-[hsl(var(--muted))]">A parent or legal guardian must review and accept the legal documents for a child.</p>
            <label className="block text-sm">Parent / guardian full name *
              <input className={className} required maxLength={200} value={guardianName} onChange={e => setGuardianName(e.target.value)} />
            </label>
            <label className="block text-sm">Parent / guardian email *
              <input className={className} type="email" required maxLength={254} value={guardianEmail} onChange={e => setGuardianEmail(e.target.value)} />
            </label>
            <label className="block text-sm">Relationship *
              <select className={className} required value={guardianRelationship} onChange={e => setGuardianRelationship(e.target.value)}>
                <option value="">Select relationship</option>
                <option value="mother">Mother</option>
                <option value="father">Father</option>
                <option value="legal_guardian">Legal guardian</option>
              </select>
            </label>
          </fieldset>
        ) : null}
        <fieldset className="space-y-3">
          <legend className="font-semibold">Legal documents</legend>
          <p className="text-xs text-[hsl(var(--muted))]">The participant (or parent/guardian for minors) must read and accept each required document separately.</p>
          {documents.map(doc => (
            <div key={doc.id} className="flex gap-3 rounded-xl border border-[hsl(var(--border))] p-3">
              <input type="checkbox" className="mt-1" checked={accepted.includes(doc.id)} onChange={e => setAccepted(old => e.target.checked ? [...old, doc.id] : old.filter(id => id !== doc.id))} aria-label={`Accept ${doc.title}`} />
              <span className="text-sm"><a href={doc.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{doc.title}</a> <span className="text-xs">v{doc.version}</span></span>
            </div>
          ))}
        </fieldset>
        <label className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
          <input type="checkbox" className="mt-1" required checked={signerConfirmed}
            onChange={e => setSignerConfirmed(e.target.checked)} />
          <span>{isMinor
            ? 'I confirm that I am the parent or legal guardian named above and that I personally selected the legal documents above. My identity and authority will be verified before legal consent can be finalized.'
            : 'I confirm I am the adult participant named above and that I personally selected the legal documents above. These selections will be verified before legal consent can be finalized.'}</span>
        </label>
        <p className="text-xs text-[hsl(var(--muted))]">An account will only be created after server-side verification and explicit confirmation. Submitting this form will not activate a paid membership.</p>
        {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}
        <button type={submitEnabled ? 'submit' : 'button'} disabled={!submitEnabled || submitting || age === null || !selectedProgram || !allAccepted || !signerConfirmed} className="w-full rounded-xl bg-black px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{!submitEnabled ? 'Submit registration — available soon' : submitting ? 'Submitting…' : 'Submit registration request'}</button>
        <p className="text-center text-xs text-[hsl(var(--muted))]">{submitEnabled ? 'Reception will review eligible requests before email verification.' : 'Preview only · No data is sent'} · {allAccepted ? 'Documents checked' : 'Document review incomplete'}</p>
      </form>
    </main>
  )
}
