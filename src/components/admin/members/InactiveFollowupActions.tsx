'use client'

import { useMemo, useState, useTransition } from 'react'

import Button from '@/components/ui/Button'

type FollowupStatus =
  | 'to_contact'
  | 'contacted'
  | 'will_renew'
  | 'not_interested'
  | 'moved_academy'
  | 'created_by_mistake'
  | 'resolved'

type Props = {
  memberId: string
  memberName: string
  atomId?: string | null
  email?: string | null
  phone?: string | null
  reasonLabel: string
  reasonDetail: string
  suggestedAction: string
  latestSubscriptionLabel: string
  profileHref: string
  subscriptionsHref: string
  initialStatus: FollowupStatus
  initialNote: string
  initialNextFollowUpAt: string
}

const STATUS_OPTIONS: { value: FollowupStatus; label: string }[] = [
  { value: 'to_contact', label: 'To contact' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'will_renew', label: 'Will renew' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'moved_academy', label: 'Moved academy' },
  { value: 'created_by_mistake', label: 'Created by mistake' },
  { value: 'resolved', label: 'Resolved' },
]

function normalizePhoneForWhatsApp(phone?: string | null) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('20')) return digits
  if (digits.length === 11 && digits.startsWith('0')) return `20${digits.slice(1)}`
  return digits
}

function memberFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'there'
}

export default function InactiveFollowupActions({
  memberId,
  memberName,
  atomId,
  email,
  phone,
  reasonLabel,
  reasonDetail,
  suggestedAction,
  latestSubscriptionLabel,
  profileHref,
  subscriptionsHref,
  initialStatus,
  initialNote,
  initialNextFollowUpAt,
}: Props) {
  const [status, setStatus] = useState<FollowupStatus>(initialStatus)
  const [note, setNote] = useState(initialNote)
  const [nextFollowUpAt, setNextFollowUpAt] = useState(String(initialNextFollowUpAt || '').slice(0, 10))
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const whatsappMessage = useMemo(() => {
    const first = memberFirstName(memberName)
    if (reasonLabel === 'Expired subscription') {
      return `Hi ${first}, this is ATOM Jiu-Jitsu. We noticed your membership has expired. Would you like us to help you renew it?`
    }
    if (reasonLabel === 'Remaining due') {
      return `Hi ${first}, this is ATOM Jiu-Jitsu. We noticed there is a remaining due on your membership. Please contact reception so we can help you settle it.`
    }
    if (reasonLabel === 'Never subscribed') {
      return `Hi ${first}, this is ATOM Jiu-Jitsu. Your account is created, but no membership package is active yet. Would you like us to help you choose the right package?`
    }
    if (reasonLabel === 'Freeze ended') {
      return `Hi ${first}, this is ATOM Jiu-Jitsu. Your freeze period has ended. Would you like to resume your training and renew your membership?`
    }
    return `Hi ${first}, this is ATOM Jiu-Jitsu. We are following up about your membership and training status. Please let us know if you need any help.`
  }, [memberName, reasonLabel])

  const waPhone = normalizePhoneForWhatsApp(phone)
  const waHref = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(whatsappMessage)}` : ''

  async function copyMessage() {
    setCopied(false)
    setError(null)

    try {
      await navigator.clipboard.writeText(whatsappMessage)
      setCopied(true)
      setMessage('WhatsApp message copied.')
    } catch {
      setError('Could not copy. Select and copy the message manually.')
    }
  }

  function saveFollowup(markReviewed: boolean) {
    setError(null)
    setMessage(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/members/inactive-followups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_id: memberId,
            status,
            note,
            next_follow_up_at: nextFollowUpAt || null,
            mark_reviewed: markReviewed,
          }),
        })

        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          throw new Error(json?.details || json?.error || 'Save failed')
        }

        setMessage(markReviewed ? 'Marked as reviewed.' : 'Follow-up saved.')
      } catch (e: any) {
        setError(e?.message || 'Save failed')
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 border-t border-[hsl(var(--border))] pt-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Button asChild variant="outline" className="w-full" href={profileHref}>
          Open profile
        </Button>
        <Button asChild variant="outline" className="w-full" href={subscriptionsHref}>
          Open subscriptions
        </Button>
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold shadow-soft transition hover:bg-[hsl(var(--bg))]"
          >
            Open WhatsApp
          </a>
        ) : (
          <Button type="button" variant="outline" className="w-full pointer-events-none opacity-50">
            No WhatsApp phone
          </Button>
        )}
        <Button type="button" variant="outline" className="w-full" onClick={copyMessage}>
          {copied ? 'Copied' : 'Copy WhatsApp message'}
        </Button>
      </div>

      <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
        <summary className="cursor-pointer text-sm font-semibold">Follow-up details</summary>
        <div className="mt-3 space-y-3">
          <div className="rounded-xl bg-[hsl(var(--bg))] p-3 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--fg))]">Suggested message</p>
            <p className="mt-1 whitespace-pre-wrap">{whatsappMessage}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold">Follow-up status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as FollowupStatus)}
                className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-semibold">Next follow-up</span>
              <input
                type="date"
                value={nextFollowUpAt}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold">Internal note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="Example: contacted mother by WhatsApp, waiting for renewal decision."
              className="mt-1 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm outline-none focus:border-black"
            />
          </label>

          <div className="rounded-xl bg-[hsl(var(--bg))] p-3 text-xs text-[hsl(var(--muted))]">
            <p><span className="font-semibold text-[hsl(var(--fg))]">Member:</span> {memberName} · {atomId || 'No ATOM ID'}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Contact:</span> {email || 'No email'} · {phone || 'No phone'}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Reason:</span> {reasonLabel} — {reasonDetail}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Latest subscription:</span> {latestSubscriptionLabel}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Suggested action:</span> {suggestedAction}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => saveFollowup(false)}>
              {isPending ? 'Saving…' : 'Save follow-up'}
            </Button>
            <Button type="button" disabled={isPending} onClick={() => saveFollowup(true)}>
              {isPending ? 'Saving…' : 'Mark as reviewed'}
            </Button>
          </div>

          {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        </div>
      </details>
    </div>
  )
}
