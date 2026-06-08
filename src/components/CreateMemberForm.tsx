// src/components/CreateMemberForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import ConfirmActionModal, { type ConfirmActionSummaryItem } from '@/components/ui/ConfirmActionModal'
import { cairoToday } from '@/lib/cairoDate'

type NewMemberPayload = {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  // YYYY-MM-DD
  date_of_birth?: string
  visitor_trial_id?: string
}

type Status = { kind: '' | 'info' | 'success' | 'warning' | 'error'; msg: string }

type CreateOutcome =
  | 'invited_new_user'
  | 'existing_profile'
  | 'existing_auth_user'

type InviteMode = 'custom_qr' | 'custom_qr_failed' | 'supabase_default' | 'none'

type ExistingMemberRef = {
  user_id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
}

function dobPartsFromIso(dob?: string) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return { day: '', month: '', year: '' }
  }

  const [year, month, day] = dob.split('-')
  return { day, month, year }
}

function buildInitialForm(initialValues?: Partial<NewMemberPayload>): NewMemberPayload {
  return {
    email: (initialValues?.email || '').trim(),
    first_name: (initialValues?.first_name || '').trim() || undefined,
    last_name: (initialValues?.last_name || '').trim() || undefined,
    phone: (initialValues?.phone || '').trim() || undefined,
    date_of_birth: (initialValues?.date_of_birth || '').trim(),
    visitor_trial_id: (initialValues?.visitor_trial_id || '').trim() || undefined,
  }
}

function ageFromDob(dob?: string) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const [y, m, d] = dob.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(born.getTime())) return null

  // Strict validity check (avoid JS date rollover e.g. 2024-02-31)
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== m - 1 || born.getUTCDate() !== d) return null

  const [ty, tm, td] = cairoToday().split('-').map(Number)
  const today = new Date(Date.UTC(ty, tm - 1, td))
  if (born.getTime() > today.getTime()) return null

  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  if (age < 0) return null
  return age
}

function formatDateForSummary(dateOnly?: string) {
  const raw = (dateOnly || '').trim()
  if (!raw) return '—'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const date = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return raw

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return raw
  }
}

function cleanText(value?: string | null) {
  return (value || '').trim()
}

export default function CreateMemberForm({
  initialValues,
}: {
  initialValues?: Partial<NewMemberPayload>
}) {
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)
  const submitLockRef = useRef(false)

  const initialForm = useMemo(() => buildInitialForm(initialValues), [initialValues])

  const [form, setForm] = useState<NewMemberPayload>(initialForm)
  const [dobParts, setDobParts] = useState<{ day: string; month: string; year: string }>(() =>
    dobPartsFromIso(initialForm.date_of_birth),
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: '', msg: '' })
  const [existingMember, setExistingMember] = useState<ExistingMemberRef | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function setDobPart(part: 'day' | 'month' | 'year', value: string) {
    setDobParts((prev) => {
      const next = { ...prev, [part]: value }
      const iso = next.year && next.month && next.day ? `${next.year}-${next.month}-${next.day}` : ''
      update('date_of_birth', iso)
      return next
    })
  }

  useEffect(() => {
    setForm(initialForm)
    setDobParts(dobPartsFromIso(initialForm.date_of_birth))
    setStatus({ kind: '', msg: '' })
    setExistingMember(null)
    setConfirmOpen(false)
    submitLockRef.current = false
    setBusy(false)
  }, [initialForm])

  function update<K extends keyof NewMemberPayload>(k: K, v: NewMemberPayload[K]) {
    if (k === 'email') setExistingMember(null)
    setForm((f) => ({ ...f, [k]: v }))
  }

  function resetForm() {
    setForm(initialForm)
    setDobParts(dobPartsFromIso(initialForm.date_of_birth))
    setStatus({ kind: '', msg: '' })
    setExistingMember(null)
    setConfirmOpen(false)
  }

  const emailOk = !!(form.email || '').trim()
  const age = useMemo(() => ageFromDob(form.date_of_birth || ''), [form.date_of_birth])
  const ageGroup = age === null ? null : age < 17 ? 'Kid' : 'Adult'
  const dobOk = age !== null // valid + not in future

  const memberSummaryItems = useMemo<ConfirmActionSummaryItem[]>(() => {
    const firstName = cleanText(form.first_name)
    const lastName = cleanText(form.last_name)
    const fullName = [firstName, lastName].filter(Boolean).join(' ')
    const email = cleanText(form.email).toLowerCase()
    const phone = cleanText(form.phone)

    const items: ConfirmActionSummaryItem[] = [
      { label: 'Full name', value: fullName || '—' },
      { label: 'Email', value: email || '—' },
      { label: 'Phone', value: phone || '—' },
      { label: 'Date of birth', value: formatDateForSummary(form.date_of_birth) },
      {
        label: 'Age / category',
        value: dobOk && ageGroup && age !== null ? `${age} years old · ${ageGroup}` : 'Invalid or missing',
      },
      { label: 'Role', value: 'member' },
      { label: 'Invite impact', value: 'Invite email will be sent if this is a new email.' },
      { label: 'Access impact', value: 'A new member profile will be created for app and scan access.' },
    ]

    if (form.visitor_trial_id) {
      items.push({ label: 'Visitor trial', value: 'This visitor trial will be linked to the new member.' })
    }

    return items
  }, [age, ageGroup, dobOk, form.date_of_birth, form.email, form.first_name, form.last_name, form.phone, form.visitor_trial_id])

  function buildPayload() {
    const email = cleanText(form.email).toLowerCase()

    return {
      email,
      first_name: cleanText(form.first_name) || undefined,
      last_name: cleanText(form.last_name) || undefined,
      phone: cleanText(form.phone) || undefined,
      date_of_birth: cleanText(form.date_of_birth) || undefined,
      visitor_trial_id: cleanText(form.visitor_trial_id) || undefined,
      // aliases camelCase (au cas où on les supporte côté API)
      firstName: cleanText(form.first_name) || undefined,
      lastName: cleanText(form.last_name) || undefined,
      dateOfBirth: cleanText(form.date_of_birth) || undefined,
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitLockRef.current || busy || !emailOk || !dobOk) return

    setExistingMember(null)
    setConfirmOpen(true)
  }

  async function createMemberConfirmed() {
    if (submitLockRef.current || busy || !emailOk || !dobOk) return

    submitLockRef.current = true
    setBusy(true)
    setStatus({ kind: 'info', msg: 'Creating member…' })
    setExistingMember(null)

    const payload = buildPayload()

    try {
      const r = await fetch('/api/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const j = await r.json().catch(() => ({} as any))

      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Failed to create member'
        const duplicateMember = j?.existing_member?.user_id ? (j.existing_member as ExistingMemberRef) : null
        setExistingMember(duplicateMember)
        setStatus({ kind: 'error', msg })
        toast.error(duplicateMember ? 'Email already used' : 'Create failed', {
          description: duplicateMember
            ? 'Open the existing member instead of creating a new one.'
            : undefined,
        })
        return
      }

      const id: string = j.user?.id || j.id || j.user_id
      const outcome = (j?.outcome || 'invited_new_user') as CreateOutcome
      const inviteSent = !!j?.invite_sent
      const nextInviteMode = (j?.invite_mode || 'none') as InviteMode

      if (outcome === 'invited_new_user' && inviteSent) {
        const description = nextInviteMode === 'custom_qr' ? 'Invite email with QR code sent.' : 'Invite email sent.'
        setStatus({ kind: 'success', msg: `Member created. ${description}` })
        toast.success('Member created', { description })
      } else if (outcome === 'invited_new_user' && !inviteSent && nextInviteMode === 'custom_qr_failed') {
        setStatus({
          kind: 'warning',
          msg: 'Member created, but the custom invite email with QR code could not be sent.',
        })
        toast.success('Member created', {
          description: 'Open the member profile and use Resend invite if needed.',
        })
      } else if (outcome === 'existing_profile') {
        setStatus({
          kind: 'warning',
          msg: 'This email already belongs to an existing member. Profile updated. No invite email was sent.',
        })
        toast.success('Existing member updated', {
          description: 'No new invite email was sent.',
        })
      } else {
        setStatus({
          kind: 'warning',
          msg: 'Member profile saved, but no new invite email was sent because the auth account already exists.',
        })
        toast.success('Member profile saved', {
          description: 'Use Resend invite from the member profile if needed.',
        })
      }

      if (id) {
        router.push(`/members/${id}`)
        return
      }

      router.refresh()
    } catch (e: any) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'error', msg })
      toast.error('Network error')
    } finally {
      submitLockRef.current = false
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
      <h3 className="text-lg font-semibold">Create new member</h3>
      <p className="mt-1 text-sm text-[hsl(var(--muted))]">
        If the email is new, an invite email will be sent. Duplicate emails are blocked to protect the existing account.
      </p>
      {form.visitor_trial_id ? (
        <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Visitor trial conversion mode: create the member here and the visitor record will be linked automatically.
        </div>
      ) : null}

      {status.msg ? (
        <div className="mt-3">
          <InlineAlert
            variant={
              status.kind === 'error'
                ? 'error'
                : status.kind === 'success'
                  ? 'success'
                  : status.kind === 'warning'
                    ? 'warning'
                    : 'info'
            }
          >
            <div className="grid gap-3">
              <span>{status.msg}</span>
              {existingMember?.user_id ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => router.push(`/members/${existingMember.user_id}`)}>
                    Open existing member
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      emailRef.current?.focus()
                      emailRef.current?.select()
                    }}
                  >
                    Use another email
                  </Button>
                </div>
              ) : null}
            </div>
          </InlineAlert>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Email *</span>
          <input
            type="email"
            required
            ref={emailRef}
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            placeholder="name@example.com"
            disabled={busy}
          />
          <span className="text-[11px] text-[hsl(var(--muted))]">
            Reception / kiosk safety: if this email already exists, creation is blocked and you can open the existing member.
          </span>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Phone</span>
          <input
            type="tel"
            value={form.phone ?? ''}
            onChange={(e) => update('phone', e.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            placeholder="+201…"
            disabled={busy}
          />
        </label>

        <label className="grid gap-1 sm:col-span-2">
          <span className="text-sm font-medium">Date of birth *</span>

          <div className="grid grid-cols-3 gap-2">
            <select
              required
              value={dobParts.day}
              onChange={(e) => setDobPart('day', e.target.value)}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              disabled={busy}
            >
              <option value="" disabled>
                DD
              </option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              required
              value={dobParts.month}
              onChange={(e) => setDobPart('month', e.target.value)}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              disabled={busy}
            >
              <option value="" disabled>
                MM
              </option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              required
              value={dobParts.year}
              onChange={(e) => setDobPart('year', e.target.value)}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
              disabled={busy}
            >
              <option value="" disabled>
                YYYY
              </option>
              {Array.from({ length: new Date().getUTCFullYear() - 1900 + 1 }, (_, i) => String(new Date().getUTCFullYear() - i)).map(
                (y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ),
              )}
            </select>
          </div>

          <span className="text-[11px] text-[hsl(var(--muted))]">
            {dobOk && ageGroup
              ? `Auto category: ${ageGroup} (${age} years old)`
              : 'Used to classify the member as Kid (<17) or Adult (>=17).'}
          </span>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">First name</span>
          <input
            value={form.first_name ?? ''}
            onChange={(e) => update('first_name', e.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            placeholder="Ahmed"
            disabled={busy}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Last name</span>
          <input
            value={form.last_name ?? ''}
            onChange={(e) => update('last_name', e.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            placeholder="Mohamed"
            disabled={busy}
          />
        </label>

        <div className="mt-2 flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy || !emailOk || !dobOk}>
            {busy ? 'Creating…' : 'Create member'}
          </Button>

          <Button type="button" variant="outline" onClick={resetForm} disabled={busy}>
            Reset
          </Button>
        </div>
      </form>

      <ConfirmActionModal
        open={confirmOpen}
        title="Confirm member creation"
        description="Please verify the new member details before creating the profile. Pay special attention to the email address."
        confirmLabel="Confirm & create member"
        pendingLabel="Creating…"
        cancelLabel="Cancel"
        pending={busy}
        summaryItems={memberSummaryItems}
        warning="This will create a new member profile. If the email is wrong, the account may need manual correction later."
        onCancel={() => {
          if (!busy) setConfirmOpen(false)
        }}
        onConfirm={createMemberConfirmed}
      />
    </div>
  )
}
