'use client'

import { useEffect, useMemo, useState } from 'react'

export type CrmFollowupStatus = 'to_contact' | 'contacted' | 'awaiting_reply' | 'follow_up' | 'resolved'
export type CrmMessageChannel = 'whatsapp' | 'email'
export type CrmMessageTemplateKey = 'general_follow_up' | 'renewal' | 'payment_due' | 'attendance_follow_up'
export type CrmMessageLanguage = 'en' | 'ar'

export type CrmFollowupRow = {
  member_id: string
  status: CrmFollowupStatus
  assigned_to: string | null
  next_follow_up_at: string | null
  last_contacted_at: string | null
  updated_at: string | null
}

export type CrmActivityRow = {
  id: string
  member_id: string
  activity_type: string
  summary: string
  details: Record<string, unknown>
  actor_user_id: string | null
  occurred_at: string
}

export type CrmStaffRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: 'reception' | 'admin' | 'super_admin'
}

export type CrmMessageTemplateRow = {
  id: string
  channel: CrmMessageChannel
  template_key: CrmMessageTemplateKey
  language: CrmMessageLanguage
  label: string
  subject_template: string | null
  body_template: string
  is_active: boolean
  updated_at: string
}

type Props = {
  memberId: string
  memberName: string
  memberCode: string | null
  email: string | null
  phone: string | null
  plan: string
  dueAmount: number
  endDate: string | null
  lastAttendanceDate: string | null
  noAttendance14d: boolean
  initialFollowup: CrmFollowupRow | null
  staff: CrmStaffRow[]
  templates: CrmMessageTemplateRow[]
  initialActivities: CrmActivityRow[]
}

const STATUS_OPTIONS: Array<{ value: CrmFollowupStatus; label: string }> = [
  { value: 'to_contact', label: 'To contact' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'awaiting_reply', label: 'Awaiting reply' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'resolved', label: 'Resolved' },
]

const TEMPLATE_LABELS: Record<CrmMessageTemplateKey, string> = {
  general_follow_up: 'General follow-up',
  renewal: 'Renewal',
  payment_due: 'Payment due',
  attendance_follow_up: 'Attendance follow-up',
}

function staffName(row?: CrmStaffRow | null) {
  if (!row) return 'Unassigned'
  const full = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
  return full || row.email || row.role
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName.trim() || 'there'
}

function normalizeWhatsappPhone(phone: string | null) {
  if (!phone) return ''
  const raw = phone.trim().replace(/[^\d+]/g, '')
  if (!raw) return ''
  if (raw.startsWith('+')) return raw.slice(1)
  if (raw.startsWith('00')) return raw.slice(2)
  if (raw.startsWith('0')) return `20${raw.slice(1)}`
  return raw
}

function localInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return shifted.toISOString().slice(0, 16)
}

function fmtDate(value: string | null, language: CrmMessageLanguage = 'en') {
  if (!value) return language === 'ar' ? 'غير محدد' : 'not specified'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Africa/Cairo',
  }).format(date)
}

function fmtDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  }).format(date)
}

function fmtMoney(value: number, language: CrmMessageLanguage) {
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

function defaultTemplateKey(args: Pick<Props, 'dueAmount' | 'endDate' | 'lastAttendanceDate' | 'noAttendance14d'>): CrmMessageTemplateKey {
  if (args.dueAmount > 0) return 'payment_due'
  if (args.endDate) {
    const end = new Date(`${args.endDate}T12:00:00`)
    const now = new Date()
    const diff = Math.ceil((end.getTime() - now.getTime()) / 86400000)
    if (diff <= 7) return 'renewal'
  }
  if (args.noAttendance14d) return 'attendance_follow_up'
  return 'general_follow_up'
}

function applyVariables(
  value: string | null,
  language: CrmMessageLanguage,
  props: Pick<Props, 'memberName' | 'dueAmount' | 'endDate' | 'lastAttendanceDate' | 'plan'>,
) {
  const variables: Record<string, string> = {
    first_name: firstName(props.memberName),
    due_amount: fmtMoney(props.dueAmount, language),
    expiry_date: fmtDate(props.endDate, language),
    last_attendance: fmtDate(props.lastAttendanceDate, language),
    plan: props.plan || (language === 'ar' ? 'الاشتراك' : 'membership'),
  }

  return String(value ?? '').replace(
    /{{\s*(first_name|due_amount|expiry_date|last_attendance|plan)\s*}}/g,
    (_, key: string) => variables[key] ?? '',
  )
}

export default function CrmMemberFollowupActions(props: Props) {
  const {
    memberId, memberName, memberCode, email, phone, plan, dueAmount, endDate,
    lastAttendanceDate, noAttendance14d, initialFollowup, staff, templates,
  } = props

  const [status, setStatus] = useState<CrmFollowupStatus>(initialFollowup?.status ?? 'to_contact')
  const [assignedTo, setAssignedTo] = useState(initialFollowup?.assigned_to ?? '')
  const [nextFollowUpAt, setNextFollowUpAt] = useState(localInput(initialFollowup?.next_follow_up_at ?? null))
  const [lastContactedAt, setLastContactedAt] = useState(initialFollowup?.last_contacted_at ?? null)
  const [activities, setActivities] = useState(props.initialActivities)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [composerChannel, setComposerChannel] = useState<CrmMessageChannel | null>(null)
  const [templateKey, setTemplateKey] = useState<CrmMessageTemplateKey>(defaultTemplateKey(props))
  const [language, setLanguage] = useState<CrmMessageLanguage>('en')
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
  }, [composerChannel, selectedTemplate, language, memberName, dueAmount, endDate, lastAttendanceDate, plan])

  function mergeFollowup(row: CrmFollowupRow) {
    setStatus(row.status)
    setAssignedTo(row.assigned_to ?? '')
    setNextFollowUpAt(localInput(row.next_follow_up_at))
    setLastContactedAt(row.last_contacted_at)
  }

  async function saveWorkflow() {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const response = await fetch('/api/admin/crm/followups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          status,
          assigned_to: assignedTo || null,
          next_follow_up_at: status === 'resolved' ? null : (nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null),
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Update failed.')
      mergeFollowup(data.followup as CrmFollowupRow)
      if (data.activity) setActivities((rows) => [data.activity as CrmActivityRow, ...rows])
      setNotice('CRM follow-up saved.')
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Update failed.'))
    } finally {
      setBusy(false)
    }
  }

  async function addNote() {
    const clean = note.trim()
    if (!clean) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const response = await fetch('/api/admin/crm/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action: 'note', note: clean }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Could not add note.')
      setActivities((rows) => [data.activity as CrmActivityRow, ...rows])
      setNote('')
      setNotice('Internal note added.')
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Could not add note.'))
    } finally {
      setBusy(false)
    }
  }

  async function logContact(channel: 'whatsapp' | 'call' | 'email') {
    const response = await fetch('/api/admin/crm/followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, action: 'log_contact', channel }),
    })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Could not log contact.')
    if (data.followup) mergeFollowup(data.followup as CrmFollowupRow)
    if (data.activity) setActivities((rows) => [data.activity as CrmActivityRow, ...rows])
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
      setError(String(caught?.message ?? caught ?? 'Could not open call.'))
    } finally {
      setBusy(false)
    }
  }

  function openComposer(channel: CrmMessageChannel) {
    setTemplateKey(defaultTemplateKey(props))
    setLanguage('en')
    setComposerChannel(channel)
    setNotice(null)
    setError(null)
  }

  async function initiateMessage() {
    if (!composerChannel || !message.trim() || busy) return
    const waDigits = normalizeWhatsappPhone(phone)
    if (composerChannel === 'whatsapp' && !waDigits) return
    if (composerChannel === 'email' && !email) return

    const popup = composerChannel === 'whatsapp' ? window.open('', '_blank') : null
    setBusy(true)
    setError(null)
    try {
      await logContact(composerChannel)
      if (composerChannel === 'whatsapp') {
        const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(message.trim())}`
        if (popup) {
          try { popup.opener = null } catch {}
          popup.location.href = url
        } else {
          window.location.href = url
        }
      } else {
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(message.trim())}`
      }
      setNotice(`${composerChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} contact initiated and logged.`)
      setComposerChannel(null)
    } catch (caught: any) {
      popup?.close()
      setError(String(caught?.message ?? caught ?? 'Could not open message app.'))
    } finally {
      setBusy(false)
    }
  }

  const assignedLabel = staffName(staffMap.get(assignedTo))
  const waAvailable = Boolean(normalizeWhatsappPhone(phone))

  return (
    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted))]">
          <span>Status: <strong className="text-[hsl(var(--foreground))]">{STATUS_OPTIONS.find((row) => row.value === status)?.label ?? status}</strong></span>
          <span>Assigned: <strong className="text-[hsl(var(--foreground))]">{assignedLabel}</strong></span>
          <span>Next follow-up: <strong className="text-[hsl(var(--foreground))]">{nextFollowUpAt ? fmtDateTime(new Date(nextFollowUpAt).toISOString()) : '—'}</strong></span>
          <span>Last contact: <strong className="text-[hsl(var(--foreground))]">{fmtDateTime(lastContactedAt)}</strong></span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!waAvailable || busy}
            onClick={() => openComposer('whatsapp')}
            className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800 disabled:opacity-40"
          >
            WhatsApp
          </button>
          <button
            type="button"
            disabled={!phone || busy}
            onClick={() => void openCall()}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Call
          </button>
          <button
            type="button"
            disabled={!email || busy}
            onClick={() => openComposer('email')}
            className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Email
          </button>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-blue-100 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">Follow-up & activity</summary>

        <div className="mt-3 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as CrmFollowupStatus)} className="w-full rounded-xl border px-3 py-2">
                {STATUS_OPTIONS.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium">Assigned to</span>
              <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="w-full rounded-xl border px-3 py-2">
                <option value="">Unassigned</option>
                {staff.map((row) => <option key={row.user_id} value={row.user_id}>{staffName(row)}</option>)}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="font-medium">Next follow-up</span>
              <input
                type="datetime-local"
                value={status === 'resolved' ? '' : nextFollowUpAt}
                disabled={status === 'resolved'}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
                className="w-full rounded-xl border px-3 py-2 disabled:bg-slate-100"
              />
            </label>

            <div className="flex items-end">
              <button type="button" disabled={busy} onClick={() => void saveWorkflow()} className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? 'Saving…' : 'Save follow-up'}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Add internal note…"
              className="min-h-[72px] flex-1 rounded-xl border px-3 py-2 text-sm"
            />
            <button type="button" disabled={busy || !note.trim()} onClick={() => void addNote()} className="self-end rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Add note
            </button>
          </div>

          <div>
            <div className="text-sm font-semibold">Activity</div>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
              {activities.length ? activities.map((row) => (
                <div key={row.id} className="rounded-xl border px-3 py-2 text-sm">
                  <div>{row.summary}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {fmtDateTime(row.occurred_at)}
                    {row.actor_user_id ? ` · ${staffName(staffMap.get(row.actor_user_id))}` : ''}
                  </div>
                </div>
              )) : <div className="text-sm text-[hsl(var(--muted))]">No CRM activity yet.</div>}
            </div>
          </div>

          {notice ? <div className="text-sm font-medium text-emerald-700">{notice}</div> : null}
          {error ? <div className="text-sm font-medium text-rose-700">{error}</div> : null}
        </div>
      </details>

      {composerChannel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Preview CRM message">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Preview {composerChannel === 'whatsapp' ? 'WhatsApp' : 'email'}</h2>
                <p className="text-sm text-[hsl(var(--muted))]">{memberName} · {composerChannel === 'whatsapp' ? phone : email}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => setComposerChannel(null)} className="rounded-lg border px-3 py-1.5 text-sm font-semibold">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Message type</span>
                <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value as CrmMessageTemplateKey)} className="w-full rounded-xl border px-3 py-2">
                  {(Object.keys(TEMPLATE_LABELS) as CrmMessageTemplateKey[]).map((key) => (
                    <option key={key} value={key}>{TEMPLATE_LABELS[key]}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as CrmMessageLanguage)} className="w-full rounded-xl border px-3 py-2">
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </label>
            </div>

            {!selectedTemplate ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This template is unavailable. Ask a Super Admin to check CRM message templates.
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
              <p className="text-xs text-[hsl(var(--muted))]">
                Opening the app records “contact initiated”; it does not confirm delivery.
              </p>
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
