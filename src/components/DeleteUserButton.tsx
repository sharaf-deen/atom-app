'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type Props = {
  userId: string
  email?: string | null
  memberId?: string | null
  className?: string
}

export default function DeleteUserButton({ userId, email, memberId, className }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const label = useMemo(() => {
    const safeEmail = String(email ?? '').trim()
    const safeMemberId = String(memberId ?? '').trim()
    if (safeEmail) return safeEmail
    if (safeMemberId) return safeMemberId
    return 'this user'
  }, [email, memberId])

  const canDelete = typed.trim().toUpperCase() === 'DELETE'

  useEffect(() => {
    if (!confirming) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [confirming])

  async function onDelete() {
    if (busy || !canDelete) return

    setBusy(true)
    try {
      const r = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ userId }),
      })

      const j = await r.json().catch(() => ({} as any))

      if (!r.ok) {
        toast.error('Delete failed', {
          description: j?.details || j?.error || 'Unable to delete this user.',
        })
        return
      }

      toast.success('User deleted', {
        description: label,
      })

      router.push('/members?deleted=1')
      router.refresh()
    } catch (e: any) {
      toast.error('Network error', {
        description: e?.message || String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={
          (className ?? '') +
          ' rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100'
        }
      >
        Delete user
      </button>
    )
  }

  return (
    <div className={(className ?? '') + ' min-w-[280px] rounded-2xl border border-red-200 bg-red-50 p-3'}>
      <div className="text-sm font-semibold text-red-800">Delete user permanently</div>
      <p className="mt-1 text-xs leading-5 text-red-700">
        This permanently deletes the auth account and profile for <strong>{label}</strong>. This action cannot be undone.
      </p>

      <div className="mt-3 space-y-2" aria-live="polite">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-red-700">
          Type DELETE to confirm
        </label>
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) {
              e.preventDefault()
              setConfirming(false)
              setTyped('')
            }
            if (e.key === 'Enter' && canDelete) {
              e.preventDefault()
              onDelete()
            }
          }}
          className="w-full rounded-xl border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-300"
        />
        <p className="text-[11px] text-red-700">Press Enter to confirm, or Esc to cancel.</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            if (busy) return
            setConfirming(false)
            setTyped('')
          }}
          disabled={busy}
          className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03] disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!canDelete || busy}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Confirm delete'}
        </button>
      </div>
    </div>
  )
}
