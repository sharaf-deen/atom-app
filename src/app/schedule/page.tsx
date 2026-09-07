export const dynamic = 'force-dynamic'
export const revalidate = 0

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ScheduleEditor from '@/components/ScheduleEditor'
import MemberScheduleView, { type MemberScheduleSession } from '@/components/schedule/MemberScheduleView'
import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

const DEFAULT_SCHEDULE = `Kids & Teens
Baby 3-5 years
Beginners · Gi

Monday – 5:15 PM
Wednesday – 5:15 PM
Saturday – 11:15 AM

Kids 6–9 years
Beginners · Gi

Sunday – 6:15 PM
Tuesday – 6:15 PM
Thursday – 5:00 PM

Kids 6–9 years
Intermediate · Gi

Monday – 6:15 PM
Wednesday – 6:15 PM
Saturday – 12:15 PM

Teens 10–14 years
Beginners · Gi

Sunday – 7:15 PM
Tuesday – 7:15 PM
Thursday – 6:00 PM

Teens 10–14 years
Intermediate · Gi

Monday – 7:15 PM
Wednesday – 7:15 PM
Saturday – 1:15 PM

Competition Team
Group A

Tuesday, Wednesday, Thursday & Sunday – 2:00 PM / Saturday 2:30 PM

Group B

Tuesday, Wednesday, Thursday & Sunday – 3:30 PM / Saturday 2:30 PM

Adults
Beginners
White belts & anyone who wants to build strong basics

Sunday – 9:30 PM (Gi)
Tuesday – 9:30 PM (NoGi)
Thursday – 9:30 PM (Gi)
Friday – 6:00 PM (NoGi)
Saturday – 6:00 PM (Wrestling)

Intermediate
Students with solid basics, usually from blue belt and above

Sunday – 8:15 PM (NoGi)
Tuesday – 8:15 PM (Gi)
Wednesday – 8:15 PM (NoGi)
Thursday – 7:00 PM (Gi)
Saturday – 6:00 PM (Wrestling)

Open Mat
All levels

Wednesday – 9:30 PM (NoGi)
Saturday – 4:00 PM (Gi)

Advanced - Competition Team
For athletes preparing for competitions – you must ask the head coach before joining. Advanced sessions are not accessible if you do not attend the Intermediate classes

Monday – 8:15 PM (NoGi)
Thursday – 8:15 PM (NoGi)

Weekly Schedule by Day
Sunday
Kids & Teens

2:00 PM – Kids Group A · Competition
3:30 PM – Kids Group B · Competition
6:15 PM – Kids 6–9 years · Beginners · Gi
7:15 PM – Teens 10–14 years · Beginners · Gi

Adults

8:15 PM – Intermediate · NoGi
9:30 PM – Beginners · Gi

Monday
Kids & Teens

5:15 PM – Baby 3–5 years · Beginners · Gi
6:15 PM – Kids 6–9 years · Intermediate · Gi
7:15 PM – Teens 10–14 years · Intermediate · Gi

Adults

8:15 PM – Advanced · NoGi

Tuesday
Kids & Teens

2:00 PM – Kids Group A · Competition
3:30 PM – Kids Group B · Competition
6:15 PM – Kids 6–9 years · Beginners · Gi
7:15 PM – Teens 10–14 years · Beginners · Gi

Adults

8:15 PM – Intermediate · Gi
9:30 PM – Beginners · NoGi

Wednesday
Kids & Teens

2:00 PM – Kids Group A · Competition
3:30 PM – Kids Group B · Competition
5:15 PM – Baby 3–5 years · Beginners · Gi
6:15 PM – Kids 6–9 years · Intermediate · Gi
7:15 PM – Teens 10–14 years · Intermediate · Gi

Adults

8:15 PM – Intermediate · NoGi
9:30 PM – Open Mat · All Levels · NoGi

Thursday
Kids & Teens

2:00 PM – Kids Group A · Competition
3:30 PM – Kids Group B · Competition
5:00 PM – Kids 6–9 years · Beginners · Gi
6:00 PM – Teens 10–14 years · Beginners · Gi

Adults

7:00 PM – Intermediate · Gi
8:15 PM – Advanced · NoGi
9:30 PM – Beginners · Gi

Friday
Adults

6:00 PM – Beginners · NoGi

Saturday
Kids & Teens

11:15 AM – Baby 3–5 years · Beginners · Gi
12:15 PM – Kids 6–9 years · Intermediate · Gi
1:15 PM – Teens 10–14 years · Intermediate · Gi
2:30 PM – Kids Group A & B · Competition

Adults

4:00 PM – Open Mat · All Levels · Gi (Ages 15+)
6:00 PM – All Levels · Wrestling

Competition Team (Kids, Teens & Adults) · Contact the head coach for specific training times.`

type LegacyRow = {
  key: string
  content: string
  updated_at: string | null
}

function cairoDateIso() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDaysIso(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export default async function SchedulePage() {
  const me = await getSessionUser()
  if (!me) {
    return (
      <main>
        <PageHeader title="Schedule" subtitle="Today first, then upcoming classes and the next 7 days" />
        <Section>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="text-base font-semibold">Please sign in</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">You need to be authenticated to view the training timetable.</p>
          </div>
        </Section>
      </main>
    )
  }

  const supabase = createSupabaseRSC()
  const today = cairoDateIso()
  const structuredUntil = addDaysIso(today, 13)

  let sessions: MemberScheduleSession[] = []
  let structuredError: string | null = null

  try {
    const { data, error } = await supabase.rpc('get_member_schedule_sessions', {
      p_from_date: today,
      p_to_date: structuredUntil,
    })

    if (error) structuredError = error.message
    else sessions = (data ?? []) as MemberScheduleSession[]
  } catch (cause: any) {
    structuredError = String(cause?.message || cause || 'Structured schedule unavailable')
  }

  let legacyContent = DEFAULT_SCHEDULE
  let legacyUpdatedAt: string | null = null
  const needLegacy = sessions.length === 0 || me.role === 'super_admin'

  if (needLegacy) {
    try {
      const { data, error } = await supabase
        .from('app_schedule')
        .select('key, content, updated_at')
        .eq('key', 'main')
        .maybeSingle()

      if (!error && data) {
        const row = data as any as LegacyRow
        legacyContent = row.content || DEFAULT_SCHEDULE
        legacyUpdatedAt = row.updated_at ?? null
      }
    } catch {
      // Keep the static legacy fallback if the stored legacy timetable cannot be loaded.
    }
  }

  const structuredReady = sessions.length > 0

  return (
    <main>
      <PageHeader title="Schedule" subtitle="Today first, then upcoming classes and the next 7 days" />
      <Section className="max-w-5xl space-y-6">
        {structuredReady ? (
          <MemberScheduleView sessions={sessions} today={today} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              The structured dated timetable is not available for the upcoming period yet. ATOM is showing the legacy timetable as a safe fallback.
              {structuredError && me.role === 'super_admin' ? (
                <div className="mt-1 text-xs text-amber-800">Structured schedule detail: {structuredError}</div>
              ) : null}
            </div>
            <ScheduleEditor initialContent={legacyContent} updatedAt={legacyUpdatedAt} canEdit={me.role === 'super_admin'} />
          </div>
        )}

        {structuredReady && me.role === 'super_admin' ? (
          <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <summary className="cursor-pointer text-sm font-semibold">Legacy schedule editor · transition fallback</summary>
            <p className="mt-2 text-xs text-[hsl(var(--muted))]">
              The member Schedule now reads dated structured sessions. Keep the legacy timetable available during the transition only; editing it does not change structured sessions.
            </p>
            <div className="mt-4">
              <ScheduleEditor initialContent={legacyContent} updatedAt={legacyUpdatedAt} canEdit />
            </div>
          </details>
        ) : null}
      </Section>
    </main>
  )
}
