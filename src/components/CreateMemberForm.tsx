// src/components/CreateMemberForm.tsx
'use client'

import { useState } from 'react'

type NewMemberPayload = {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
}

export default function CreateMemberForm() {
  const [form, setForm] = useState<NewMemberPayload>({ email: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [createdId, setCreatedId] = useState<string | null>(null)

  function update<K extends keyof NewMemberPayload>(k: K, v: NewMemberPayload[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    setSuccess('')
    setCreatedId(null)

    // normalisation: trim & email en lower-case
    const payload = {
      email: (form.email || '').trim().toLowerCase(),
      first_name: (form.first_name || '').trim() || undefined,
      last_name: (form.last_name || '').trim() || undefined,
      phone: (form.phone || '').trim() || undefined,
      // aliases camelCase — au cas où le handler accepte ce format
      firstName: (form.first_name || '').trim() || undefined,
      lastName: (form.last_name || '').trim() || undefined,
    }

    try {
      const r = await fetch('/api/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to create member')
        return
      }
      const id: string = j.user?.id || j.id || j.user_id
      setCreatedId(id || null)
      setSuccess('Member created. An invite email was sent.')
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  function resetForm() {
    setForm({ email: '' })
    setErr('')
    setSuccess('')
    setCreatedId(null)
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <h3 className="text-lg font-semibold">Create new member</h3>
      <p className="text-sm text-gray-500 mt-1">
        An invite email will be sent so the member can set their password.
      </p>

      {!!err && (
        <div className="mt-3 text-sm rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2">
          {err}
        </div>
      )}
      {!!success && (
        <div className="mt-3 text-sm rounded border border-green-300 bg-green-50 text-green-800 px-3 py-2">
          {success}{' '}
          {createdId && (
            <a className="underline" href={`/members/${createdId}`} target="_self" rel="noreferrer">
              View member
            </a>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm">Email *</span>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            className="px-3 py-2 border rounded"
            placeholder="name@example.com"
            disabled={busy}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Phone</span>
          <input
            type="tel"
            value={form.phone ?? ''}
            onChange={(e) => update('phone', e.target.value)}
            className="px-3 py-2 border rounded"
            placeholder="+201…"
            disabled={busy}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">First name</span>
          <input
            value={form.first_name ?? ''}
            onChange={(e) => update('first_name', e.target.value)}
            className="px-3 py-2 border rounded"
            placeholder="Ahmed"
            disabled={busy}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Last name</span>
          <input
            value={form.last_name ?? ''}
            onChange={(e) => update('last_name', e.target.value)}
            className="px-3 py-2 border rounded"
            placeholder="Mohamed"
            disabled={busy}
          />
        </label>

        <div className="sm:col-span-2 flex gap-2 mt-2">
          <button
            type="submit"
            disabled={busy || !form.email}
            className={`px-3 py-2 rounded border ${busy || !form.email ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'}`}
          >
            {busy ? 'Creating…' : 'Create member'}
          </button>
          <button
            type="button"
            onClick={resetForm}
            disabled={busy}
            className="px-3 py-2 rounded border hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  )
}
