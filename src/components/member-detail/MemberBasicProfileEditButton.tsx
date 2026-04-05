'use client'

import { useEffect, useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SaveButton from '@/components/forms/SaveButton'
import { useSafeSubmit } from '@/lib/forms/useSafeSubmit'

type Props = {
  userId: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  dateOfBirth: string | null
}

type DraftState = {
  first_name: string
  last_name: string
  phone: string
  date_of_birth: string
}

function normalizeDraft(values: DraftState): DraftState {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    phone: values.phone.trim(),
    date_of_birth: values.date_of_birth.trim(),
  }
}

function toInitialDraft(props: Props): DraftState {
  return {
    first_name: props.firstName ?? '',
    last_name: props.lastName ?? '',
    phone: props.phone ?? '',
    date_of_birth: props.dateOfBirth ?? '',
  }
}

export default function MemberBasicProfileEditButton(props: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DraftState>(() => toInitialDraft(props))

  useEffect(() => {
    if (!open) {
      setDraft(toInitialDraft(props))
    }
  }, [open, props.dateOfBirth, props.firstName, props.lastName, props.phone])

  const initial = useMemo(() => normalizeDraft(toInitialDraft(props)), [props])
  const current = useMemo(() => normalizeDraft(draft), [draft])
  const hasChanges = JSON.stringify(initial) !== JSON.stringify(current)

  const { submit, isPending } = useSafeSubmit({
    action: async () => {
      const res = await fetch(`/api/members/${encodeURIComponent(props.userId)}/basic-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      })

      let json: any = null
      try {
        json = await res.json()
      } catch {
        json = null
      }

      if (!res.ok) {
        return {
          ok: false as const,
          message: json?.error || 'Save failed',
          description: json?.details || undefined,
        }
      }

      return {
        ok: true as const,
        message: json?.message || 'Saved',
      }
    },
    defaultSuccessMessage: 'Saved',
    defaultErrorMessage: 'Save failed',
    onSuccess: async () => {
      setOpen(false)
    },
  })

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit basic info
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!isPending) setOpen(false)
        }}
        title="Edit basic profile"
        className="w-[min(92vw,34rem)]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit({ form: e.currentTarget })
          }}
          className="grid gap-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">First name</span>
              <input
                value={draft.first_name}
                onChange={(e) => setDraft((prev) => ({ ...prev, first_name: e.target.value }))}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
                maxLength={80}
                disabled={isPending}
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Last name</span>
              <input
                value={draft.last_name}
                onChange={(e) => setDraft((prev) => ({ ...prev, last_name: e.target.value }))}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
                maxLength={80}
                disabled={isPending}
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Phone</span>
            <input
              value={draft.phone}
              onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              maxLength={32}
              disabled={isPending}
              inputMode="tel"
              autoComplete="tel"
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Date of birth</span>
            <input
              type="date"
              value={draft.date_of_birth}
              onChange={(e) => setDraft((prev) => ({ ...prev, date_of_birth: e.target.value }))}
              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
              disabled={isPending}
            />
          </label>

          <p className="text-xs text-[hsl(var(--muted))]">
            This edit is limited to basic member identity fields only. Email, role, member ID, and subscription data are unchanged.
          </p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <SaveButton idleLabel="Save changes" pendingLabel="Saving..." loading={isPending} disabled={!hasChanges} />
          </div>
        </form>
      </Modal>
    </>
  )
}
