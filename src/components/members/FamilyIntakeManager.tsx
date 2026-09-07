'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

const CHILD_MODES = [
  { value: 'visitor', label: 'Trial / Visitor' },
  { value: 'member', label: 'Enroll as Member now' },
  { value: 'existing_visitor', label: 'Link existing Visitor' },
  { value: 'existing_member', label: 'Link existing Member' },
] as const

const SOURCE_OPTIONS = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Other' },
] as const

type ChildMode = (typeof CHILD_MODES)[number]['value']
type SourceKey = (typeof SOURCE_OPTIONS)[number]['value']

type GuardianResult = {
  kind: 'guardian'
  auth_user_id: string
  family_id: string
  family_name: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  relationship: string | null
  is_primary: boolean
}

type ChildSearchResult = {
  kind: 'visitor' | 'member'
  id: string
  member_id?: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  date_of_birth: string | null
  status?: string | null
  trial_date?: string | null
  linked_member_id?: string | null
  family_intake_id?: string | null
  current_family?: { id: string; name: string } | null
}

type ChildDraft = {
  key: string
  mode: ChildMode
  firstName: string
  lastName: string
  dateOfBirth: string
  phone: string
  trialDate: string
  sourceKey: SourceKey
  visitorTrialId: string
  memberId: string
  searchQuery: string
  searchResults: ChildSearchResult[]
  searching: boolean
  selectedLabel: string
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

function newChild(index = 0): ChildDraft {
  return {
    key: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    mode: 'visitor',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    trialDate: todayDateOnly(),
    sourceKey: 'walk_in',
    visitorTrialId: '',
    memberId: '',
    searchQuery: '',
    searchResults: [],
    searching: false,
    selectedLabel: '',
  }
}

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'Unnamed'
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? data : {}
}

function modeNeedsFamily(mode: ChildMode) {
  return mode === 'member' || mode === 'existing_member'
}

export default function FamilyIntakeManager({ actorRole }: { actorRole: string }) {
  const router = useRouter()
  const [guardianMode, setGuardianMode] = React.useState<'new' | 'existing'>('new')
  const [guardianFirstName, setGuardianFirstName] = React.useState('')
  const [guardianLastName, setGuardianLastName] = React.useState('')
  const [guardianPhone, setGuardianPhone] = React.useState('')
  const [guardianEmail, setGuardianEmail] = React.useState('')
  const [guardianRelationship, setGuardianRelationship] = React.useState('parent')
  const [existingGuardianAuthUserId, setExistingGuardianAuthUserId] = React.useState('')
  const [existingGuardianFamily, setExistingGuardianFamily] = React.useState<{ id: string; name: string } | null>(null)

  const [guardianSearchQuery, setGuardianSearchQuery] = React.useState('')
  const [guardianSearching, setGuardianSearching] = React.useState(false)
  const [guardianResults, setGuardianResults] = React.useState<GuardianResult[]>([])

  const [familyName, setFamilyName] = React.useState('')
  const [children, setChildren] = React.useState<ChildDraft[]>([newChild(0)])
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lastResult, setLastResult] = React.useState<any>(null)

  const hasMemberChild = children.some((child) => modeNeedsFamily(child.mode))

  function updateChild(key: string, patch: Partial<ChildDraft>) {
    setChildren((current) => current.map((child) => (child.key === key ? { ...child, ...patch } : child)))
  }

  function resetForm() {
    setGuardianMode('new')
    setGuardianFirstName('')
    setGuardianLastName('')
    setGuardianPhone('')
    setGuardianEmail('')
    setGuardianRelationship('parent')
    setExistingGuardianAuthUserId('')
    setExistingGuardianFamily(null)
    setGuardianSearchQuery('')
    setGuardianResults([])
    setFamilyName('')
    setChildren([newChild(0)])
    setLastResult(null)
    setMessage(null)
    setError(null)
  }

  async function searchGuardians() {
    const q = guardianSearchQuery.trim()
    if (q.length < 2) {
      setGuardianResults([])
      return
    }
    setGuardianSearching(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/family-intake/search?scope=guardian&q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) throw new Error(data.details || data.error || 'Guardian search failed')
      setGuardianResults(Array.isArray(data.items) ? data.items : [])
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setGuardianSearching(false)
    }
  }

  function selectGuardian(result: GuardianResult) {
    setGuardianMode('existing')
    setExistingGuardianAuthUserId(result.auth_user_id)
    setExistingGuardianFamily({ id: result.family_id, name: result.family_name })
    setGuardianFirstName(result.first_name ?? '')
    setGuardianLastName(result.last_name ?? '')
    setGuardianPhone(result.phone ?? '')
    setGuardianEmail(result.email ?? '')
    setGuardianRelationship(result.relationship || 'parent')
    setFamilyName(result.family_name)
    setGuardianResults([])
    setGuardianSearchQuery('')
    setMessage(`Using existing guardian in ${result.family_name}.`)
    setError(null)
  }

  function clearExistingGuardian() {
    setGuardianMode('new')
    setExistingGuardianAuthUserId('')
    setExistingGuardianFamily(null)
    setGuardianFirstName('')
    setGuardianLastName('')
    setGuardianPhone('')
    setGuardianEmail('')
    setGuardianRelationship('parent')
    setFamilyName('')
    setMessage(null)
  }

  async function searchChild(child: ChildDraft) {
    const q = child.searchQuery.trim()
    if (q.length < 2) {
      updateChild(child.key, { searchResults: [] })
      return
    }
    updateChild(child.key, { searching: true })
    setError(null)
    try {
      const response = await fetch(`/api/admin/family-intake/search?scope=child&q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) throw new Error(data.details || data.error || 'Child search failed')
      const kind = child.mode === 'existing_visitor' ? 'visitor' : 'member'
      const results = (Array.isArray(data.items) ? data.items : []).filter((item: ChildSearchResult) => item.kind === kind)
      updateChild(child.key, { searchResults: results, searching: false })
    } catch (cause: any) {
      updateChild(child.key, { searching: false })
      setError(String(cause?.message || cause))
    }
  }

  function selectChildResult(child: ChildDraft, result: ChildSearchResult) {
    if (result.kind === 'visitor') {
      updateChild(child.key, {
        visitorTrialId: result.id,
        memberId: '',
        firstName: result.first_name ?? '',
        lastName: result.last_name ?? '',
        phone: result.phone ?? '',
        dateOfBirth: result.date_of_birth ?? '',
        selectedLabel: `${fullName(result.first_name, result.last_name)} · Visitor${result.trial_date ? ` · ${result.trial_date}` : ''}`,
        searchResults: [],
        searchQuery: '',
      })
    } else {
      updateChild(child.key, {
        memberId: result.id,
        visitorTrialId: '',
        firstName: result.first_name ?? '',
        lastName: result.last_name ?? '',
        phone: result.phone ?? '',
        dateOfBirth: result.date_of_birth ?? '',
        selectedLabel: `${fullName(result.first_name, result.last_name)} · ${result.member_id ?? 'Member'}${result.current_family ? ` · ${result.current_family.name}` : ''}`,
        searchResults: [],
        searchQuery: '',
      })
    }
  }

  function changeChildMode(child: ChildDraft, mode: ChildMode) {
    updateChild(child.key, {
      mode,
      visitorTrialId: '',
      memberId: '',
      selectedLabel: '',
      searchQuery: '',
      searchResults: [],
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setLastResult(null)

    if (!guardianFirstName.trim()) {
      setError('Guardian first name is required.')
      return
    }
    if (!guardianPhone.trim() && !guardianEmail.trim()) {
      setError('Guardian phone or email is required.')
      return
    }
    if (hasMemberChild && guardianMode === 'new' && !guardianEmail.trim()) {
      setError('Guardian email is required when a child is enrolled as a member now.')
      return
    }

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if ((child.mode === 'visitor' || child.mode === 'member') && (!child.firstName.trim() || !child.lastName.trim())) {
        setError(`Child ${index + 1}: first and last name are required.`)
        return
      }
      if (child.mode === 'existing_visitor' && !child.visitorTrialId) {
        setError(`Child ${index + 1}: select an existing Visitor.`)
        return
      }
      if (child.mode === 'existing_member' && !child.memberId) {
        setError(`Child ${index + 1}: select an existing Member.`)
        return
      }
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/admin/family-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guardian: {
            mode: guardianMode,
            existingAuthUserId: guardianMode === 'existing' ? existingGuardianAuthUserId : undefined,
            firstName: guardianFirstName,
            lastName: guardianLastName,
            phone: guardianPhone,
            email: guardianEmail,
            relationship: guardianRelationship,
          },
          familyName: familyName.trim(),
          children: children.map((child) => ({
            mode: child.mode,
            firstName: child.firstName,
            lastName: child.lastName,
            dateOfBirth: child.dateOfBirth,
            phone: child.phone,
            visitorTrialId: child.visitorTrialId,
            memberId: child.memberId,
            trialDate: child.trialDate,
            sourceKey: child.sourceKey,
          })),
        }),
      })
      const data = await readJson(response)

      if (!response.ok || data.ok !== true) {
        if (data.error === 'POSSIBLE_GUARDIAN_DUPLICATE' && data.candidate) {
          const candidate = data.candidate as GuardianResult
          setError(`Possible existing guardian found in ${candidate.family_name}. Use the existing guardian instead of creating a duplicate.`)
          setGuardianResults([{ ...candidate, kind: 'guardian', relationship: 'parent', is_primary: true }])
          setGuardianSearchQuery(candidate.email || candidate.phone || '')
          return
        }
        throw new Error(data.details || data.error || 'Family intake failed')
      }

      setLastResult(data)
      setMessage(data.message || 'Family intake completed.')
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Family Intake</h1>
          <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted))]">
            Register a guardian and several children in one front-desk flow. Trial-only intake does not create a Family Account or parent login.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/visitors">Visitors</Button>
          {actorRole !== 'reception' ? <Button asChild variant="outline" href="/admin/members/families">Family Accounts</Button> : null}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {message ? <InlineAlert variant="success">{message}</InlineAlert> : null}
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      </div>

      {lastResult ? (
        <Card className="mt-4">
          <CardHeader><CardTitle>Intake saved</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div><span className="font-semibold">Intake:</span> {lastResult.intake_id}</div>
              <div><span className="font-semibold">Family:</span> {lastResult.family_id ? 'Created / reused' : 'Not created yet — trial stage'}</div>
              <div><span className="font-semibold">Children:</span> {Array.isArray(lastResult.children) ? lastResult.children.length : 0}</div>
              <div className="pt-2"><Button type="button" onClick={resetForm}>Start another family intake</Button></div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-5">
          <Card>
            <CardHeader><CardTitle>1. Guardian / Parent</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                <div className="text-sm font-semibold">Search before creating</div>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Search by guardian name, phone or email to avoid duplicate parent accounts and families.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input value={guardianSearchQuery} onChange={(event) => setGuardianSearchQuery(event.target.value)} placeholder="Guardian name, phone or email" />
                  <Button type="button" variant="outline" onClick={searchGuardians} disabled={guardianSearching}>{guardianSearching ? 'Searching…' : 'Search'}</Button>
                </div>
                {guardianResults.length ? (
                  <div className="mt-3 space-y-2">
                    {guardianResults.map((result) => (
                      <button
                        type="button"
                        key={`${result.family_id}:${result.auth_user_id}`}
                        onClick={() => selectGuardian(result)}
                        className="w-full rounded-xl border border-[hsl(var(--border))] bg-white p-3 text-left hover:bg-slate-50"
                      >
                        <div className="font-semibold">{fullName(result.first_name, result.last_name)}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{result.phone || 'No phone'} · {result.email || 'No email'} · {result.family_name}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {guardianMode === 'existing' ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  Existing guardian selected. {existingGuardianFamily ? `${existingGuardianFamily.name} will be reused.` : ''}
                  <div className="mt-2"><Button type="button" variant="outline" onClick={clearExistingGuardian}>Use a new guardian instead</Button></div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">First name<Input className="mt-1" value={guardianFirstName} onChange={(event) => setGuardianFirstName(event.target.value)} disabled={guardianMode === 'existing'} /></label>
                <label className="text-sm font-medium">Last name<Input className="mt-1" value={guardianLastName} onChange={(event) => setGuardianLastName(event.target.value)} disabled={guardianMode === 'existing'} /></label>
                <label className="text-sm font-medium">Phone<Input className="mt-1" value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} disabled={guardianMode === 'existing'} /></label>
                <label className="text-sm font-medium">Email<Input className="mt-1" type="email" value={guardianEmail} onChange={(event) => setGuardianEmail(event.target.value)} disabled={guardianMode === 'existing'} /></label>
                <label className="text-sm font-medium">Relationship
                  <Select className="mt-1" value={guardianRelationship} onChange={(event) => setGuardianRelationship(event.target.value)} disabled={guardianMode === 'existing'}>
                    <option value="father">Father</option>
                    <option value="mother">Mother</option>
                    <option value="parent">Parent</option>
                    <option value="guardian">Guardian</option>
                    <option value="other">Other</option>
                  </Select>
                </label>
                {hasMemberChild && guardianMode === 'new' ? (
                  <label className="text-sm font-medium">Family name
                    <Input className="mt-1" value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder={`${guardianLastName || guardianFirstName || 'Family'} Family`} />
                  </label>
                ) : null}
              </div>

              <div className="mt-3 text-xs text-[hsl(var(--muted))]">
                {hasMemberChild
                  ? 'Because at least one child will be a Member, ATOM will create/reuse the Family Account and guardian login. Guardian email is required for a new guardian.'
                  : 'Trial-only intake stores the guardian contact without creating a Family Account or Auth login. This keeps the database clean if the visitor never enrolls.'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>2. Children</CardTitle>
                <Button type="button" variant="outline" onClick={() => setChildren((current) => current.length >= 8 ? current : [...current, newChild(current.length)])} disabled={children.length >= 8}>+ Add child</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {children.map((child, index) => {
                  const existingMode = child.mode === 'existing_visitor' || child.mode === 'existing_member'
                  return (
                    <div key={child.key} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">Child {index + 1}</div>
                        {children.length > 1 ? <Button type="button" variant="outline" onClick={() => setChildren((current) => current.filter((item) => item.key !== child.key))}>Remove</Button> : null}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-sm font-medium">Registration type
                          <Select className="mt-1" value={child.mode} onChange={(event) => changeChildMode(child, event.target.value as ChildMode)}>
                            {CHILD_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </Select>
                        </label>
                      </div>

                      {existingMode ? (
                        <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                          <div className="text-sm font-semibold">Find existing {child.mode === 'existing_visitor' ? 'Visitor' : 'Member'}</div>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <Input value={child.searchQuery} onChange={(event) => updateChild(child.key, { searchQuery: event.target.value })} placeholder="Name, phone, email or Member ID" />
                            <Button type="button" variant="outline" onClick={() => searchChild(child)} disabled={child.searching}>{child.searching ? 'Searching…' : 'Search'}</Button>
                          </div>
                          {child.selectedLabel ? <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">Selected: {child.selectedLabel}</div> : null}
                          {child.searchResults.length ? (
                            <div className="mt-2 space-y-2">
                              {child.searchResults.map((result) => (
                                <button type="button" key={`${result.kind}:${result.id}`} onClick={() => selectChildResult(child, result)} className="w-full rounded-xl border border-[hsl(var(--border))] bg-white p-3 text-left hover:bg-slate-50">
                                  <div className="font-semibold">{fullName(result.first_name, result.last_name)}</div>
                                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                                    {result.kind === 'member' ? (result.member_id || 'Member') : `Visitor · ${result.trial_date || 'trial'}`}
                                    {result.current_family ? ` · ${result.current_family.name}` : ''}
                                    {result.linked_member_id ? ' · already linked to member' : ''}
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="text-sm font-medium">First name<Input className="mt-1" value={child.firstName} onChange={(event) => updateChild(child.key, { firstName: event.target.value })} /></label>
                          <label className="text-sm font-medium">Last name<Input className="mt-1" value={child.lastName} onChange={(event) => updateChild(child.key, { lastName: event.target.value })} /></label>
                          <label className="text-sm font-medium">Date of birth<Input className="mt-1" type="date" value={child.dateOfBirth} onChange={(event) => updateChild(child.key, { dateOfBirth: event.target.value })} /></label>
                          <label className="text-sm font-medium">Child phone (optional)<Input className="mt-1" value={child.phone} onChange={(event) => updateChild(child.key, { phone: event.target.value })} /></label>
                          {child.mode === 'visitor' ? (
                            <>
                              <label className="text-sm font-medium">Trial date<Input className="mt-1" type="date" value={child.trialDate} onChange={(event) => updateChild(child.key, { trialDate: event.target.value })} /></label>
                              <label className="text-sm font-medium">Source
                                <Select className="mt-1" value={child.sourceKey} onChange={(event) => updateChild(child.key, { sourceKey: event.target.value as SourceKey })}>
                                  {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </Select>
                              </label>
                            </>
                          ) : null}
                        </div>
                      )}

                      <p className="mt-3 text-xs text-[hsl(var(--muted))]">
                        {child.mode === 'visitor' ? 'Creates a Visitor trial only. No member profile is created.' : null}
                        {child.mode === 'member' ? 'Creates a family-managed Member profile without a separate child login/email.' : null}
                        {child.mode === 'existing_visitor' ? 'Keeps the existing Visitor record and attaches it to this guardian intake. Conversion happens later in Lot 2B.' : null}
                        {child.mode === 'existing_member' ? 'Links the existing Member only if the profile is not already attached to another family.' : null}
                      </p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>3. Review & create</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div><span className="font-semibold">Guardian:</span> {fullName(guardianFirstName, guardianLastName)}</div>
                <div><span className="font-semibold">Children:</span> {children.length}</div>
                <div><span className="font-semibold">Family Account now:</span> {hasMemberChild || existingGuardianFamily ? 'Yes / reuse existing' : 'No — trial intake only'}</div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create family intake'}</Button>
                <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}>Reset</Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </main>
  )
}
