'use client'

import { useEffect, useMemo, useState } from 'react'

export type InactiveFollowupStatus =
  | 'to_contact'
  | 'contacted'
  | 'will_renew'
  | 'not_interested'
  | 'moved_academy'
  | 'created_by_mistake'
  | 'resolved'

export type InactiveStaffRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: 'reception' | 'admin' | 'super_admin'
}

export type InactiveActivityRow = {
  id: string
  member_id: string
  activity_type: string
  summary: string
  details: Record<string, unknown>
  actor_user_id: string | null
  occurred_at: string
}

export type InactiveTemplateRow = {
  id: string
  channel: 'whatsapp' | 'email'
  template_key: 'general_follow_up' | 'renewal' | 'no_membership' | 'cancelled' | 'win_back'
  language: 'en' | 'ar'
  label: string
  subject_template: string | null
  body_template: string
  is_active: boolean
  updated_at: string
}

type Props = {
  memberId: string
  memberName: string
  atomId?: string | null
  email?: string | null
  phone?: string | null
  reasonLabel: string
  reasonDetail: string
  suggestedAction: string
  inactiveDays: number | null
  latestSubscriptionLabel: string
  latestSubscriptionPlan: string | null
  latestSubscriptionEndDate: string | null
  latestAmountDue: number
  profileHref: string
  subscriptionsHref: string
  initialStatus: InactiveFollowupStatus
  initialNote: string
  initialNextFollowUpAt: string
  initialAssignedTo: string
  initialLastContactedAt: string
  initialReviewedAt: string
  staff: InactiveStaffRow[]
  templates: InactiveTemplateRow[]
  initialActivities: InactiveActivityRow[]
}

const STATUS_OPTIONS: { value: InactiveFollowupStatus; label: string }[] = [
  { value: 'to_contact', label: 'To contact' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'will_renew', label: 'Will renew' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'moved_academy', label: 'Moved academy' },
  { value: 'created_by_mistake', label: 'Created by mistake' },
  { value: 'resolved', label: 'Resolved' },
]

const TEMPLATE_LABELS: Record<InactiveTemplateRow['template_key'], string> = {
  general_follow_up: 'General follow-up',
  renewal: 'Renewal',
  no_membership: 'No membership yet',
  cancelled: 'Cancelled membership',
  win_back: 'Win-back',
}

function staffName(row?: InactiveStaffRow | null) {
  if (!row) return 'Unassigned'
  const full = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
  return full || row.email || row.role
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim() || 'there'
}

function normalizePhoneForWhatsApp(phone?: string | null) {
  const raw = String(phone ?? '').trim().replace(/[^\d+]/g, '')
  if (!raw) return ''
  if (raw.startsWith('+')) return raw.slice(1)
  if (raw.startsWith('00')) return raw.slice(2)
  if (raw.startsWith('0')) return `20${raw.slice(1)}`
  return raw
}

function fmtDate(value?: string | null, language: 'en' | 'ar' = 'en') {
  if (!value) return language === 'ar' ? 'غير محدد' : 'not specified'
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Africa/Cairo',
  }).format(date)
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  }).format(date)
}

function fmtMoney(value: number, language: 'en' | 'ar') {
  try {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${Math.round(value)} EGP`
  }
}

function defaultTemplate(reasonLabel: string): InactiveTemplateRow['template_key'] {
  if (reasonLabel === 'Expired') return 'renewal'
  if (reasonLabel === 'No membership yet') return 'no_membership'
  if (reasonLabel === 'Cancelled') return 'cancelled'
  if (reasonLabel === 'Depleted legacy') return 'win_back'
  return 'general_follow_up'
}

function applyVariables(value: string | null, language: 'en' | 'ar', props: Props) {
  const vars: Record<string, string> = {
    first_name: firstName(props.memberName),
    inactive_days: props.inactiveDays === null ? (language === 'ar' ? 'فترة' : 'some time') : String(props.inactiveDays),
    expiry_date: fmtDate(props.latestSubscriptionEndDate, language),
    due_amount: fmtMoney(props.latestAmountDue, language),
    plan: props.latestSubscriptionPlan || (language === 'ar' ? 'الاشتراك' : 'membership'),
  }

  return String(value ?? '').replace(
    /{{\s*(first_name|inactive_days|expiry_date|due_amount|plan)\s*}}/g,
    (_, key: string) => vars[key] ?? '',
  )
}

export default function InactiveFollowupActions(props: Props) {
  const {
    memberId, memberName, atomId, email, phone, reasonLabel, reasonDetail, suggestedAction,
    latestSubscriptionLabel, profileHref, subscriptionsHref, staff, templates,
  } = props

  const [status, setStatus] = useState<InactiveFollowupStatus>(props.initialStatus)
  const [note, setNote] = useState(props.initialNote)
  const [nextFollowUpAt, setNextFollowUpAt] = useState(String(props.initialNextFollowUpAt || '').slice(0, 16))
  const [assignedTo, setAssignedTo] = useState(props.initialAssignedTo)
  const [lastContactedAt, setLastContactedAt] = useState(props.initialLastContactedAt)
  const [reviewedAt, setReviewedAt] = useState(props.initialReviewedAt)
  const [activities, setActivities] = useState(props.initialActivities)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [composerChannel, setComposerChannel] = useState<'whatsapp' | 'email' | null>(null)
  const [templateKey, setTemplateKey] = useState<InactiveTemplateRow['template_key']>(defaultTemplate(reasonLabel))
  const [language, setLanguage] = useState<'en' | 'ar'>('en')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const staffMap = useMemo(() => new Map(staff.map((row) => [row.user_id, row])), [staff])
  const selectedTemplate = useMemo(() => {
    if (!composerChannel) return null
    return templates.find((row) =>
      row.channel === composerChannel
      && row.template_key === templateKey
      && row.language === language
      && row.is_active
    ) ?? null
  }, [templates, composerChannel, templateKey, language])

  useEffect(() => {
    if (!composerChannel || !selectedTemplate) {
      setSubject('')
      setMessage('')
      return
    }
    setSubject(applyVariables(selectedTemplate.subject_template, language, props))
    setMessage(applyVariables(selectedTemplate.body_template, language, props))
  }, [composerChannel, selectedTemplate, language, memberName, reasonLabel, props.inactiveDays, props.latestSubscriptionEndDate, props.latestAmountDue, props.latestSubscriptionPlan])

  function mergeFollowup(row: any) {
    setStatus(row.status as InactiveFollowupStatus)
    setNote(row.note ?? '')
    setNextFollowUpAt(String(row.next_follow_up_at ?? '').slice(0, 16))
    setAssignedTo(row.assigned_to ?? '')
    setLastContactedAt(row.last_contacted_at ?? '')
    setReviewedAt(row.reviewed_at ?? '')
  }

  async function saveFollowup(markReviewed: boolean) {
    setBusy(true)
    setNotice(null)
    setError(null)

    try {
      const res = await fetch('/api/admin/members/inactive-followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          status,
          note,
          assigned_to: assignedTo || null,
          next_follow_up_at: status === 'resolved' ? null : (nextFollowUpAt || null),
          mark_reviewed: markReviewed,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.details || json?.error || 'Save failed')
      mergeFollowup(json.followup)
      if (json.activity) setActivities((rows) => [json.activity as InactiveActivityRow, ...rows])
      setNotice(markReviewed ? 'Marked as reviewed.' : 'Follow-up saved.')
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Save failed'))
    } finally {
      setBusy(false)
    }
  }

  async function addActivityNote() {
    const clean = note.trim()
    if (!clean) return

    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/members/inactive-followups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action: 'note', note: clean }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.details || json?.error || 'Could not add note')
      if (json.activity) setActivities((rows) => [json.activity as InactiveActivityRow, ...rows])
      setNotice('Activity note added.')
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Could not add note'))
    } finally {
      setBusy(false)
    }
  }

  async function logContact(channel: 'whatsapp' | 'call' | 'email') {
    const res = await fetch('/api/admin/members/inactive-followups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, action: 'log_contact', channel }),
    })
    const json = await res.json()
    if (!res.ok || !json?.ok) throw new Error(json?.details || json?.error || 'Contact log failed')
    if (json.followup) mergeFollowup(json.followup)
    if (json.activity) setActivities((rows) => [json.activity as InactiveActivityRow, ...rows])
  }

  async function openCall() {
    if (!phone || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await logContact('call')
      window.location.href = `tel:${phone}`
      setNotice('Call initiated and logged.')
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Could not open call'))
    } finally {
      setBusy(false)
    }
  }

  function openComposer(channel: 'whatsapp' | 'email') {
    setTemplateKey(defaultTemplate(reasonLabel))
    setLanguage('en')
    setComposerChannel(channel)
    setNotice(null)
    setError(null)
  }

  async function initiateMessage() {
    if (!composerChannel || !message.trim() || busy) return
    const waPhone = normalizePhoneForWhatsApp(phone)
    if (composerChannel === 'whatsapp' && !waPhone) return
    if (composerChannel === 'email' && !email) return

    const popup = composerChannel === 'whatsapp' ? window.open('', '_blank') : null
    setBusy(true)
    setError(null)

    try {
      await logContact(composerChannel)
      if (composerChannel === 'whatsapp') {
        const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(message.trim())}`
        if (popup) {
          try { popup.opener = null } catch {}
          popup.location.href = url
        } else {
          window.location.href = url
        }
      } else {
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(message.trim())}`
      }
      setNotice(`${composerChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} initiated and logged.`)
      setComposerChannel(null)
    } catch (caught: any) {
      popup?.close()
      setError(String(caught?.message ?? caught ?? 'Could not open message app'))
    } finally {
      setBusy(false)
    }
  }

  const waAvailable = Boolean(normalizePhoneForWhatsApp(phone))

  return (
    <div className="mt-3 space-y-3 border-t border-[hsl(var(--border))] pt-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted))]">
          <span>Status: <strong className="text-[hsl(var(--fg))]">{STATUS_OPTIONS.find((row) => row.value === status)?.label ?? status}</strong></span>
          <span>Assigned: <strong className="text-[hsl(var(--fg))]">{staffName(staffMap.get(assignedTo))}</strong></span>
          <span>Next: <strong className="text-[hsl(var(--fg))]">{nextFollowUpAt ? fmtDateTime(nextFollowUpAt) : '—'}</strong></span>
          <span>Last contact: <strong className="text-[hsl(var(--fg))]">{fmtDateTime(lastContactedAt)}</strong></span>
          <span>Reviewed: <strong className="text-[hsl(var(--fg))]">{reviewedAt ? fmtDateTime(reviewedAt) : 'No'}</strong></span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!waAvailable || busy} onClick={() => openComposer('whatsapp')} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800 disabled:opacity-40">
            WhatsApp
          </button>
          <button type="button" disabled={!phone || busy} onClick={() => void openCall()} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40">
            Call
          </button>
          <button type="button" disabled={!email || busy} onClick={() => openComposer('email')} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40">
            Email
          </button>
        </div>
      </div>

      <details className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">Follow-up & activity</summary>

        <div className="mt-3 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-sm font-semibold">Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as InactiveFollowupStatus)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-semibold">Assigned to</span>
              <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {staff.map((row) => <option key={row.user_id} value={row.user_id}>{staffName(row)}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-semibold">Next follow-up</span>
              <input
                type="datetime-local"
                value={status === 'resolved' ? '' : nextFollowUpAt}
                disabled={status === 'resolved'}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-100"
              />
            </label>

            <div className="flex items-end">
              <button type="button" disabled={busy} onClick={() => void saveFollowup(false)} className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? 'Saving…' : 'Save follow-up'}
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy} onClick={() => void saveFollowup(true)} className="rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">
              Mark as reviewed
            </button>
            <a href={subscriptionsHref} className="rounded-xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-center text-sm font-semibold">
              Open subscriptions
            </a>
          </div>

          <div className="flex gap-2">
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Internal note…" className="min-h-[72px] flex-1 rounded-xl border px-3 py-2 text-sm" />
            <button type="button" disabled={busy || !note.trim()} onClick={() => void addActivityNote()} className="self-end rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Add note
            </button>
          </div>

          <div className="rounded-xl bg-[hsl(var(--bg))] p-3 text-xs text-[hsl(var(--muted))]">
            <p><span className="font-semibold text-[hsl(var(--fg))]">Member:</span> {memberName} · {atomId || 'No ATOM ID'}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Reason:</span> {reasonLabel} — {reasonDetail}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Latest subscription:</span> {latestSubscriptionLabel}</p>
            <p><span className="font-semibold text-[hsl(var(--fg))]">Suggested action:</span> {suggestedAction}</p>
            <p><a href={profileHref} className="font-semibold underline">Open profile</a></p>
          </div>

          <div>
            <p className="text-sm font-semibold">Activity</p>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
              {activities.length ? activities.map((row) => (
                <div key={row.id} className="rounded-xl border px-3 py-2 text-sm">
                  <div>{row.summary}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {fmtDateTime(row.occurred_at)}
                    {row.actor_user_id ? ` · ${staffName(staffMap.get(row.actor_user_id))}` : ''}
                  </div>
                </div>
              )) : <div className="text-sm text-[hsl(var(--muted))]">No inactive follow-up activity yet.</div>}
            </div>
          </div>

          {notice ? <p className="text-sm font-medium text-emerald-700">{notice}</p> : null}
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        </div>
      </details>

      {composerChannel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Preview inactive member message">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Preview {composerChannel === 'whatsapp' ? 'WhatsApp' : 'email'}</h2>
                <p className="text-sm text-[hsl(var(--muted))]">{memberName} · {composerChannel === 'whatsapp' ? phone : email}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => setComposerChannel(null)} className="rounded-lg border px-3 py-1.5 text-sm font-semibold">Close</button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Message type</span>
                <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value as InactiveTemplateRow['template_key'])} className="w-full rounded-xl border px-3 py-2">
                  {(Object.keys(TEMPLATE_LABELS) as InactiveTemplateRow['template_key'][]).map((key) => <option key={key} value={key}>{TEMPLATE_LABELS[key]}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'ar')} className="w-full rounded-xl border px-3 py-2">
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </label>
            </div>

            {!selectedTemplate ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Template unavailable. Ask a Super Admin to check inactive message templates.
              </div>
            ) : (
              <div className="mt-4 space-y-3" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                {composerChannel === 'email' ? (
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Subject</span>
                    <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={300} className="w-full rounded-xl border px-3 py-2" />
                  </label>
                ) : null}
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Message preview</span>
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={9} maxLength={4000} className="w-full rounded-xl border px-3 py-2 leading-relaxed" />
                </label>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[hsl(var(--muted))]">Opening the app logs contact initiated; it does not confirm delivery.</p>
              <button
                type="button"
                disabled={!selectedTemplate || !message.trim() || (composerChannel === 'email' && !subject.trim()) || busy}
                onClick={() => void initiateMessage()}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Opening…' : `Open ${composerChannel === 'whatsapp' ? 'WhatsApp' : 'email app'}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
