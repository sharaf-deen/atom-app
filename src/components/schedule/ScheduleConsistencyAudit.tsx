import Link from 'next/link'
import type { ScheduleTrainingSession } from '@/app/schedule/sessions/page'

export type AuditClassTemplate = {
  id: string
  series_key: string
  name: string
  is_active: boolean
  day_of_week: number
  start_time: string
  end_time: string | null
  level: string
  activity_type: string
  uniform: string
  mat: string | null
  effective_from: string
  effective_until: string | null
}

type Props = {
  sessions: ScheduleTrainingSession[]
  templates: AuditClassTemplate[]
  fromDate: string
  throughDate: string
}

function normalizedTime(s: string | null) {
  return (s ?? '').slice(0, 5)
}

function formatDate(d: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(d + 'T12:00:00Z'))
}

function dateList(from: string, through: string) {
  const result: string[] = []
  const first = Date.parse(from + 'T12:00:00Z')
  const last = Date.parse(through + 'T12:00:00Z')
  for (let at = first; at <= last; at += 86400000) {
    result.push(new Date(at).toISOString().slice(0, 10))
  }
  return result
}

export default function ScheduleConsistencyAudit({ sessions, templates, fromDate, throughDate }: Props) {
  const templateById = new Map(templates.map(t => [t.id, t]))
  const existingKeys = new Set(sessions.map(s => s.class_template_id + '|' + s.session_date))
  const missing: Array<{ key: string; name: string; date: string; time: string }> = []
  const drift: Array<{ key: string; name: string; date: string; issue: string }> = []

  for (const date of dateList(fromDate, throughDate)) {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay()
    for (const template of templates) {
      if (!template.is_active || template.day_of_week !== weekday ||
        template.effective_from > date || (template.effective_until && template.effective_until < date)) continue
      const key = template.id + '|' + date
      if (!existingKeys.has(key)) {
        missing.push({ key, name: template.name, date, time: normalizedTime(template.start_time) })
      }
    }
  }

  for (const session of sessions) {
    if (session.status !== 'scheduled') continue
    const template = templateById.get(session.class_template_id)
    if (!template) {
      drift.push({ key: session.id, name: session.name_snapshot, date: session.session_date, issue: 'Template no longer exists' })
      continue
    }
    if (!template.is_active || template.effective_from > session.session_date ||
      (template.effective_until && template.effective_until < session.session_date) ||
      template.day_of_week !== new Date(session.session_date + 'T12:00:00Z').getUTCDay()) {
      drift.push({ key: session.id, name: session.name_snapshot, date: session.session_date, issue: 'Template archived or not applicable on this date' })
      continue
    }
    const differs = session.name_snapshot !== template.name
      || session.level_snapshot !== template.level
      || session.activity_type_snapshot !== template.activity_type
      || session.uniform_snapshot !== template.uniform
      || normalizedTime(session.start_time) !== normalizedTime(template.start_time)
      || normalizedTime(session.end_time) !== normalizedTime(template.end_time)
      || (session.mat_snapshot ?? '') !== (template.mat ?? '')
    if (differs) {
      drift.push({
        key: session.id, name: session.name_snapshot, date: session.session_date,
        issue: 'Snapshot differs from current template: ' + template.name,
      })
    }
  }

  if (missing.length === 0 && drift.length === 0) {
    return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <strong>Schedule consistency:</strong> active Class Templates and scheduled dated sessions agree for this 14-day preview.
    </div>
  }
  return (
    <section aria-label="Class Template and dated-session consistency" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="font-semibold">Schedule consistency review</h2>
      <p className="mt-1">
        {missing.length} active template date(s) without a scheduled session; {drift.length} scheduled session(s)
        with archived, inapplicable, or changed Class Templates. These differences also affect Member Schedule.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <h3 className="font-semibold">Missing sessions from active templates ({missing.length})</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {missing.slice(0, 12).map(item => <li key={item.key}>
              {formatDate(item.date)} · {item.time} · {item.name}
            </li>)}
          </ul>
          {missing.length > 12 ? <p className="mt-2 text-xs">+ {missing.length - 12} more within the preview.</p> : null}
          <p className="mt-2 text-xs">Use Generate / sync dated sessions to create these from active templates.</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <h3 className="font-semibold">Existing sessions requiring review ({drift.length})</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {drift.slice(0, 12).map(item => <li key={item.key}>
              {formatDate(item.date)} · {item.name} — {item.issue}
            </li>)}
          </ul>
          {drift.length > 12 ? <p className="mt-2 text-xs">+ {drift.length - 12} more within the preview.</p> : null}
          <p className="mt-2 text-xs">
            Do not bulk-delete linked sessions: check their coaching/programme assignments and Training Logs first.
            Use a dated-session exception to cancel an obsolete class with an audit reason.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Link href="/schedule/templates" className="font-semibold underline">Review Class Templates</Link>
        <a href="#sync-dated-sessions" className="font-semibold underline">Generate / sync sessions</a>
      </div>
    </section>
  )
}
