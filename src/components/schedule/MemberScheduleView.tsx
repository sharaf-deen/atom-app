import { CalendarDays, Clock3, MapPin } from 'lucide-react'

export type MemberScheduleSession = {
  id: string
  session_date: string
  start_time: string
  end_time: string | null
  name_snapshot: string
  audience_snapshot: 'kids_teens' | 'adults' | 'all'
  age_min_snapshot: number | null
  age_max_snapshot: number | null
  level_snapshot: string
  activity_type_snapshot:
    | 'jiu_jitsu'
    | 'competition'
    | 'open_drills'
    | 'open_mat'
    | 'physical_preparation'
    | 'wrestling'
    | 'other'
  uniform_snapshot: 'gi' | 'nogi' | 'gi_nogi' | 'none'
  mat_snapshot: string | null
  status: 'scheduled' | 'completed' | 'cancelled'
}

function dateAtNoonUtc(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

function formatTime(value: string | null) {
  if (!value) return '—'
  const match = String(value).match(/^(\d{2}):(\d{2})/)
  if (!match) return value

  const hours = Number(match[1])
  const minutes = match[2]
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes} ${suffix}`
}

function formatDayHeading(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(dateAtNoonUtc(value))
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dateAtNoonUtc(value))
}

function activityLabel(value: MemberScheduleSession['activity_type_snapshot']) {
  const labels: Record<MemberScheduleSession['activity_type_snapshot'], string> = {
    jiu_jitsu: 'Jiu-Jitsu',
    competition: 'Competition',
    open_drills: 'Open Drills',
    open_mat: 'Open Mat',
    physical_preparation: 'Physical Preparation',
    wrestling: 'Wrestling',
    other: 'Other',
  }
  return labels[value]
}

function uniformLabel(value: MemberScheduleSession['uniform_snapshot']) {
  const labels: Record<MemberScheduleSession['uniform_snapshot'], string | null> = {
    gi: 'Gi',
    nogi: 'NoGi',
    gi_nogi: 'Gi & NoGi',
    none: null,
  }
  return labels[value]
}

function ageLabel(row: MemberScheduleSession) {
  if (row.age_min_snapshot == null || row.age_max_snapshot == null) return null
  if (row.age_min_snapshot === row.age_max_snapshot) return `Age ${row.age_min_snapshot}`
  return `Ages ${row.age_min_snapshot}–${row.age_max_snapshot}`
}

function sessionMeta(row: MemberScheduleSession) {
  return [
    row.level_snapshot,
    activityLabel(row.activity_type_snapshot),
    uniformLabel(row.uniform_snapshot),
    ageLabel(row),
  ].filter(Boolean) as string[]
}

function statusBadge(status: MemberScheduleSession['status']) {
  if (status === 'cancelled') {
    return (
      <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700">
        Cancelled
      </span>
    )
  }

  if (status === 'completed') {
    return (
      <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
        Completed
      </span>
    )
  }

  return null
}

function SessionRow({ row, compact = false }: { row: MemberScheduleSession; compact?: boolean }) {
  const cancelled = row.status === 'cancelled'
  const meta = sessionMeta(row)

  return (
    <article className={`flex gap-3 ${compact ? 'py-3' : 'py-4'}`}>
      <div className="w-[78px] shrink-0">
        <div className={`font-bold tabular-nums ${cancelled ? 'text-[hsl(var(--muted))] line-through' : ''}`}>
          {formatTime(row.start_time)}
        </div>
        {row.end_time ? (
          <div className="mt-0.5 text-xs tabular-nums text-[hsl(var(--muted))]">to {formatTime(row.end_time)}</div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className={`font-semibold ${cancelled ? 'text-[hsl(var(--muted))] line-through' : ''}`}>{row.name_snapshot}</div>
          {statusBadge(row.status)}
        </div>

        {meta.length ? <div className="mt-1 text-sm text-[hsl(var(--muted))]">{meta.join(' · ')}</div> : null}

        {row.mat_snapshot ? (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted))]">
            <MapPin className="h-3.5 w-3.5" />
            {row.mat_snapshot}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function groupByDate(rows: MemberScheduleSession[]) {
  const groups = new Map<string, MemberScheduleSession[]>()
  for (const row of rows) {
    const group = groups.get(row.session_date) ?? []
    group.push(row)
    groups.set(row.session_date, group)
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

export default function MemberScheduleView({ sessions, today }: { sessions: MemberScheduleSession[]; today: string }) {
  const sorted = [...sessions].sort((a, b) => {
    const dateCompare = a.session_date.localeCompare(b.session_date)
    return dateCompare !== 0 ? dateCompare : a.start_time.localeCompare(b.start_time)
  })

  const todayRows = sorted.filter((row) => row.session_date === today)
  const futureRows = sorted.filter((row) => row.session_date > today && row.status !== 'completed')
  const nextClasses = futureRows.slice(0, 6)

  const weekEnd = new Date(`${today}T12:00:00Z`)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const weekEndIso = weekEnd.toISOString().slice(0, 10)
  const weekRows = sorted.filter((row) => row.session_date >= today && row.session_date <= weekEndIso)
  const weekGroups = groupByDate(weekRows)

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft">
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3 sm:px-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted))]">Today at ATOM</div>
            <h2 className="mt-0.5 text-lg font-bold">{formatDayHeading(today)}</h2>
          </div>
          <CalendarDays className="h-5 w-5 text-[hsl(var(--muted))]" />
        </div>

        {todayRows.length ? (
          <div className="divide-y divide-[hsl(var(--border))] px-4 sm:px-5">
            {todayRows.map((row) => (
              <SessionRow key={row.id} row={row} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-7 text-center text-sm text-[hsl(var(--muted))] sm:px-5">No classes scheduled today.</div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">Next classes</h2>
          <p className="text-sm text-[hsl(var(--muted))]">A quick look at what is coming up next.</p>
        </div>

        {nextClasses.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {nextClasses.map((row) => {
              const cancelled = row.status === 'cancelled'
              return (
                <article key={row.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted))]">{formatCompactDate(row.session_date)}</div>
                      <div className={`mt-1 text-base font-bold ${cancelled ? 'text-[hsl(var(--muted))] line-through' : ''}`}>
                        {row.name_snapshot}
                      </div>
                    </div>
                    {statusBadge(row.status)}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <Clock3 className="h-4 w-4 text-[hsl(var(--muted))]" />
                      {formatTime(row.start_time)}
                    </span>
                    {row.mat_snapshot ? (
                      <span className="inline-flex items-center gap-1.5 text-[hsl(var(--muted))]">
                        <MapPin className="h-4 w-4" />
                        {row.mat_snapshot}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 text-sm text-[hsl(var(--muted))]">{sessionMeta(row).join(' · ')}</div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-5 text-center text-sm text-[hsl(var(--muted))]">
            No upcoming classes found in the generated schedule window.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">Next 7 days</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Real dated sessions from the structured ATOM timetable.</p>
        </div>

        <div className="space-y-3">
          {weekGroups.map(([date, rows]) => (
            <section key={date} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft">
              <div className="border-b border-[hsl(var(--border))] px-4 py-2.5 sm:px-5">
                <h3 className="font-bold">{date === today ? `Today · ${formatDayHeading(date)}` : formatDayHeading(date)}</h3>
              </div>
              <div className="divide-y divide-[hsl(var(--border))] px-4 sm:px-5">
                {rows.map((row) => (
                  <SessionRow key={row.id} row={row} compact />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
