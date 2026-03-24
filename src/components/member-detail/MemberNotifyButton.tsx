'use client'

import { useMemo, useState } from 'react'
import { Bell } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'

type NotificationKind = 'info' | 'order_update' | 'billing' | 'promo'

type Props = {
  userId: string
  fullName: string
  memberId?: string | null
}

export default function MemberNotifyButton({ userId, fullName, memberId }: Props) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<NotificationKind>('info')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const cleanName = useMemo(() => fullName.trim() || 'Member', [fullName])

  function reset() {
    setTitle('')
    setBody('')
    setKind('info')
    setBusy(false)
    setFeedback('')
    setError('')
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
    reset()
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedBody = body.trim()
    if (!trimmedBody) {
      setError('Please enter a message.')
      return
    }

    setBusy(true)
    setError('')
    setFeedback('')

    try {
      const response = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'custom',
          user_ids: [userId],
          title: title.trim() || undefined,
          body: trimmedBody,
          kind,
        }),
      })

      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        setError(json?.details || json?.error || 'Failed to send notification.')
        setBusy(false)
        return
      }

      const delivered = Number(json?.count || 0)
      setFeedback(`Notification sent to ${delivered} recipient${delivered === 1 ? '' : 's'}.`)
      window.dispatchEvent(new Event('notifications:updated'))
      window.dispatchEvent(new Event('atom:reload'))
      setBusy(false)
      setTimeout(() => {
        setOpen(false)
        reset()
      }, 700)
    } catch (err: any) {
      setError(String(err?.message || err || 'Failed to send notification.'))
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-3 text-sm font-medium shadow-soft hover:bg-[hsl(var(--bg))]"
      >
        <Bell size={16} />
        Notify
      </button>

      <Modal open={open} onClose={closeModal} title="Send notification">
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-3 text-sm">
            <div className="font-semibold text-black">{cleanName}</div>
            {memberId ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">{memberId}</div> : null}
          </div>

          <Input
            label="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Membership reminder"
            disabled={busy}
            maxLength={120}
          />

          <Select
            label="Category"
            value={kind}
            onChange={(e) => setKind(e.target.value as NotificationKind)}
            disabled={busy}
          >
            <option value="info">Info</option>
            <option value="billing">Billing</option>
            <option value="promo">Promo</option>
            <option value="order_update">Order update</option>
          </Select>

          <Textarea
            label="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the message to send to this member."
            disabled={busy}
            rows={5}
          />

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}
          {feedback ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{feedback}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} loadingText="Sending...">
              Send notification
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
