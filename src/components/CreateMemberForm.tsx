// src/components/CreateMemberForm.tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'

type NewMemberPayload = {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  // YYYY-MM-DD
  date_of_birth?: string
}

type Status = { kind: '' | 'info' | 'success' | 'error'; msg: string }

function ageFromDob(dob?: string) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const [y, m, d] = dob.split('-').map(Number)
  const born = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(born.getTime())) return null

  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (born.getTime() > today.getTime()) return null

  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const mm = today.getUTCMonth() - born.getUTCMonth()
  if (mm < 0 || (mm === 0 && today.getUTCDate() < born.getUTCDate())) age--
  if (age < 0) return null
  return age
}

export default function CreateMemberForm() {
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<NewMemberPayload>({ email: '', date_of_birth: '' })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: '', msg: '' })
  const [createdId, setCreatedId] = useState<string | null>(null)

  function update<K extends keyof NewMemberPayload>(k: K, v: NewMemberPayload[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function resetForm() {
    setForm({ email: '', date_of_birth: '' })
    setStatus({ kind: '', msg: '' })
    setCreatedId(null)
  }

  const emailOk = !!(form.email || '').trim()

  const age = useMemo(() => ageFromDob(form.date_of_birth || ''), [form.date_of_birth])
  const ageGroup = age === null ? null : age < 17 ? 'Kid' : 'Adult'
  const dobOk = age !== null // valid + not in future

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: 'info', msg: 'Creating member…' })
    setCreatedId(null)

    const payload = {
      email: (form.email || '').trim().toLowerCase(),
      first_name: (form.first_name || '').trim() || undefined,
      last_name: (form.last_name || '').trim() || undefined,
      phone: (form.phone || '').trim() || undefined,
      date_of_birth: (form.date_of_birth || '').trim() || undefined,
      // aliases camelCase (au cas où on les supporte côté API)
      firstName: (form.first_name || '').trim() || undefined,
      lastName: (form.last_name || '').trim() || undefined,
      dateOfBirth: (form.date_of_birth || '').trim() || undefined,
    }

    try {
      const r = await fetch('/api/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const j = await r.json().catch(() => ({} as any))

      if (!r.ok || !j?.ok) {
        const msg = j?.details || j?.error || 'Failed to create member'
        setStatus({ kind: 'error', msg })
        toast.error('Create failed')
        return
      }

      const id: string = j.user?.id || j.id || j.user_id
      setCreatedId(id || null)

      setStatus({ kind: 'success', msg: 'Member created. An invite email was sent.' })
      toast.success('Member created')

      // Reset the form so you can create another member right away
      setForm({ email: '', date_of_birth: '' })
      // Refresh server data (lists/stats on the page)
      router.refresh()
      // Focus back to the email field
      setTimeout(() => emailRef.current?.focus(), 50)

    } catch (e: any) {
      const msg = String(e?.message || e)
      setStatus({ kind: 'error', msg })
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
      <h3 className="text-lg font-semibold">Create new member</h3>
      <p className="mt-1 text-sm text-[hsl(var(--muted))]">
        An invite email will be sent so the member can set their password.
      </p>

      {status.msg ? (
        <div className="mt-3">
          <InlineAlert
            variant={status.kind === 'error' ? 'error' : status.kind === 'success' ? 'success' : 'info'}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span>{status.msg}</span>
              {status.kind === 'success' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {createdId ? (
                    <a className="underline" href={`/members/${createdId}`} target="_self" rel="noreferrer">
                      View member
                    </a>
                  ) : null}

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // Clear the success banner and keep the form ready
                      setStatus({ kind: '', msg: '' })
                      setCreatedId(null)
                      setTimeout(() => emailRef.current?.focus(), 50)
                    }}
                  >
                    Create another
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

        <label className="grid gap-1">
          <span className="text-sm font-medium">Date of birth *</span>
          <input
            type="date"
            required
            value={form.date_of_birth ?? ''}
            onChange={(e) => update('date_of_birth', e.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            disabled={busy}
            max={new Date().toISOString().slice(0, 10)}
          />
          <span className="text-[11px] text-[hsl(var(--muted))]">
            {dobOk && ageGroup ? `Auto category: ${ageGroup} (${age} years old)` : 'Used to classify the member as Kid (<17) or Adult (>=17).'}
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
    </div>
  )
}
