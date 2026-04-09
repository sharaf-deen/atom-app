// src/app/schedule/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getSessionUser } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ScheduleEditor from '@/components/ScheduleEditor'

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

type Row = {
  key: string
  content: string
  updated_at: string | null
}

export default async function SchedulePage() {
  const me = await getSessionUser()
  if (!me) {
    return (
      <main>
        <PageHeader title="Schedule" subtitle="Today first, then the full weekly timetable" />
        <Section>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="text-base font-semibold">Please sign in</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              You need to be authenticated to view the training timetable.
            </p>
          </div>
        </Section>
      </main>
    )
  }

  const supabase = createSupabaseRSC()

  let content = DEFAULT_SCHEDULE
  let updatedAt: string | null = null

  try {
    const { data, error } = await supabase
      .from('app_schedule')
      .select('key, content, updated_at')
      .eq('key', 'main')
      .maybeSingle()

    if (!error && data) {
      const r = data as any as Row
      content = r.content || DEFAULT_SCHEDULE
      updatedAt = r.updated_at ?? null
    }
  } catch {
    // fallback to default schedule
  }

  const canEdit = me.role === 'super_admin'

  return (
    <main>
      <PageHeader title="Schedule" subtitle="Today first, then the full weekly timetable" />
      <Section className="space-y-6">
        <ScheduleEditor initialContent={content} updatedAt={updatedAt} canEdit={canEdit} />
      </Section>
    </main>
  )
}
