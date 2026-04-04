// src/components/CreateMemberForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import SaveButton from '@/components/forms/SaveButton'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import Modal from '@/components/ui/Modal'
import { cairoToday } from '@/lib/cairoDate'
import { useSafeSubmit } from '@/lib/forms/useSafeSubmit'

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

export default function CreateMemberForm({
  initialValues,
}: {
  initialValues?: Partial<NewMemberPayload>
}) {
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)

  const initialForm = useMemo(() => buildInitialForm(initialValues), [initialValues])

  const [form, setForm] = useState<NewMemberPayload>(initialForm)

  const [dobParts, setDobParts] = useState<{ day: string; month: string; year: string }>(() => dobPartsFromIso(initialForm.date_of_birth))

  function setDobPart(part: 'day' | 'month' | 'year', value: string) {
    setDobParts((prev) => {
      const next = { ...prev, [part]: value }
      const iso = next.year && next.month && next.day ? `${next.year}-${next.month}-${next.day}` : ''
      update('date_of_birth', iso)
      return next
    })
  }
  const [status, setStatus] = useState<Status>({ kind: '', msg: '' })
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [postCreateOpen, setPostCreateOpen] = useState(false)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null)
  const [createOutcome, setCreateOutcome] = useState<CreateOutcome | null>(null)
  const [inviteMode, setInviteMode] = useState<InviteMode>('none')
  const [existingMember, setExistingMember] = useState<ExistingMemberRef | null>(null)

  useEffect(() => {
    setForm(initialForm)
    setDobParts(dobPartsFromIso(initialForm.date_of_birth))
    setStatus({ kind: '', msg: '' })
    setCreatedId(null)
    setCreatedEmail(null)
    setCreateOutcome(null)
    setInviteMode('none')
    setExistingMember(null)
  }, [initialForm])

  function update<K extends keyof NewMemberPayload>(k: K, v: NewMemberPayload[K]) {
    if (k === 'email') setExistingMember(null)
    setForm((f) => ({ ...f, [k]: v }))
  }

  function resetForm() {
    setForm(initialForm)
    setDobParts(dobPartsFromIso(initialForm.date_of_birth))
    setStatus({ kind: '', msg: '' })
    setCreatedId(null)
    setCreatedEmail(null)
    setCreateOutcome(null)
    setInviteMode('none')
    setExistingMember(null)
  }

  const emailOk = !!(form.email || '').trim()

  const age = useMemo(() => ageFromDob(form.date_of_birth || ''), [form.date_of_birth])
  const ageGroup = age === null ? null : age < 17 ? 'Kid' : 'Adult'
  const dobOk = age !== null // valid + not in future

  const { submit, isPending } = useSafeSubmit<{ id: string | null }>({
    defaultSuccessMessage: 'Member created',
    defaultErrorMessage: 'Create failed',
    action: async () => {
      const email = (form.email || '').trim().toLowerCase()

      const payload = {
        email,
        first_name: (form.first_name || '').trim() || undefined,
        last_name: (form.last_name || '').trim() || undefined,
        phone: (form.phone || '').trim() || undefined,
        date_of_birth: (form.date_of_birth || '').trim() || undefined,
        visitor_trial_id: (form.visitor_trial_id || '').trim() || undefined,
        // aliases camelCase (au cas où on les supporte côté API)
        firstName: (form.first_name || '').trim() || undefined,
        lastName: (form.last_name || '').trim() || undefined,
        dateOfBirth: (form.date_of_birth || '').trim() || undefined,
      }

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

        return {
          ok: false as const,
          message: duplicateMember ? 'Email already used' : 'Create failed',
          description: duplicateMember ? 'Open the existing member instead of creating a new one.' : msg,
        }
      }

      const id: string = j.user?.id || j.id || j.user_id
      const outcome = (j?.outcome || 'invited_new_user') as CreateOutcome
      const inviteSent = !!j?.invite_sent
      const nextInviteMode = (j?.invite_mode || 'none') as InviteMode

      setCreatedId(id || null)
      setCreatedEmail(email)
      setCreateOutcome(outcome)
      setInviteMode(nextInviteMode)

      if (outcome === 'invited_new_user' && inviteSent) {
        const description = nextInviteMode === 'custom_qr' ? 'Invite email with QR code sent.' : 'Invite email sent.'
        setStatus({ kind: 'success', msg: `Member created. ${description}` })
        return {
          ok: true as const,
          message: 'Member created',
          description,
          data: { id: id || null },
        }
      }

      if (outcome === 'invited_new_user' && !inviteSent && nextInviteMode === 'custom_qr_failed') {
        setStatus({
          kind: 'warning',
          msg: 'Member created, but the custom invite email with QR code could not be sent.',
        })
        return {
          ok: true as const,
          message: 'Member created',
          description: 'Open the member profile and use Resend invite if needed.',
          data: { id: id || null },
        }
      }

      if (outcome === 'existing_profile') {
        setStatus({
          kind: 'warning',
          msg: 'This email already belongs to an existing member. Profile updated. No invite email was sent.',
        })
        return {
          ok: true as const,
          message: 'Existing member updated',
          description: 'No new invite email was sent.',
          data: { id: id || null },
        }
      }

      setStatus({
        kind: 'warning',
        msg: 'Member profile saved, but no new invite email was sent because the auth account already exists.',
      })
      return {
        ok: true as const,
        message: 'Member profile saved',
        description: 'Use Resend invite from the member profile if needed.',
        data: { id: id || null },
      }
    },
    onSuccess: async () => {
      setForm(initialForm)
      setDobParts(dobPartsFromIso(initialForm.date_of_birth))
      setPostCreateOpen(true)
    },
  })

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    setStatus({ kind: 'info', msg: 'Creating member…' })
    setCreatedId(null)
    setCreatedEmail(null)
    setCreateOutcome(null)
    setInviteMode('none')
    setExistingMember(null)

    await submit({ form: e.currentTarget })
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
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => router.push(`/members/${existingMember.user_id}`)}
                  >
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
            disabled={isPending}
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
            disabled={isPending}
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
              disabled={isPending}
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
              disabled={isPending}
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
              disabled={isPending}
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
            disabled={isPending}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium">Last name</span>
          <input
            value={form.last_name ?? ''}
            onChange={(e) => update('last_name', e.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            placeholder="Mohamed"
            disabled={isPending}
          />
        </label>

        <div className="mt-2 flex flex-wrap gap-2 sm:col-span-2">
          <SaveButton
            idleLabel="Create member"
            pendingLabel="Saving..."
            loading={isPending}
            disabled={!emailOk || !dobOk}
          />

          <Button type="button" variant="outline" onClick={resetForm} disabled={isPending}>
            Reset
          </Button>
        </div>
      </form>

      <Modal
        open={postCreateOpen}
        onClose={() => {
          setPostCreateOpen(false)
        }}
        title={
          createOutcome === 'invited_new_user'
            ? 'Member created'
            : createOutcome === 'existing_profile'
              ? 'Existing member found'
              : 'Member profile saved'
        }
      >
        <div className="grid gap-3">
          <p className="text-sm text-[hsl(var(--muted))]">
            {createOutcome === 'invited_new_user' ? (
              createdEmail ? (
                <>
                  {inviteMode === 'custom_qr' ? 'Invite email with QR code sent to ' : 'Invite email sent to '}<span className="font-medium text-black">{createdEmail}</span>.
                </>
              ) : (
                <>{inviteMode === 'custom_qr' ? 'Invite email with QR code has been sent.' : 'Invite email has been sent.'}</>
              )
            ) : createOutcome === 'existing_profile' ? (
              <>This email already belongs to an existing member. No new invite email was sent.</>
            ) : (
              <>
                The auth account already exists. No new invite email was sent. Open the member profile to use{' '}
                <span className="font-medium text-black">Resend invite</span> if needed.
              </>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                setPostCreateOpen(false)
                setStatus({ kind: '', msg: '' })
                setCreatedId(null)
                setCreatedEmail(null)
                setCreateOutcome(null)
                setInviteMode('none')
                setTimeout(() => emailRef.current?.focus(), 50)
              }}
            >
              Create another
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={!createdId}
              onClick={() => {
                if (!createdId) return
                setPostCreateOpen(false)
                router.push(`/members/${createdId}`)
              }}
            >
              Go to member profile
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPostCreateOpen(false)
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
