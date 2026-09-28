import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { BookOpenCheck, Save } from 'lucide-react'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser, type Role } from '@/lib/session'
import { loadActiveMemberProgramOptions, memberProgramLabel } from '@/lib/memberPrograms'

type EnrollmentRow = {
  id: string
  program_key: string
  program_name_snapshot: string
  started_at: string
  ended_at: string | null
  is_current: boolean
}

type Props = {
  memberUserId: string
  viewerRole: Role
  nextPath: string
}

const EDIT_ROLES = new Set(['reception', 'admin', 'super_admin', 'head_coach'])

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

async function saveMemberProgramAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '').trim()
  const programKey = String(formData.get('program_key') || '').trim()

  if (!me || !memberUserId || !EDIT_ROLES.has(String(me.role ?? ''))) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const result = await admin.rpc('set_member_current_program_v1', {
    p_member_user_id: memberUserId,
    p_program_key: programKey || null,
    p_actor_user_id: me.id,
    p_source: 'member_profile',
  })

  if (result.error) throw new Error(result.error.message)

  revalidatePath(nextPath)
  revalidatePath('/members')
  redirect(nextPath)
}

export default async function MemberProgramSection({ memberUserId, viewerRole, nextPath }: Props) {
  const admin = createSupabaseAdminClient()
  const canEdit = EDIT_ROLES.has(String(viewerRole ?? ''))

  const [{ data: historyData, error: historyError }, programs] = await Promise.all([
    admin
      .from('member_program_enrollments')
      .select('id,program_key,program_name_snapshot,started_at,ended_at,is_current')
      .eq('member_user_id', memberUserId)
      .order('started_at', { ascending: false })
      .limit(20),
    canEdit ? loadActiveMemberProgramOptions(admin) : Promise.resolve([]),
  ])

  if (historyError) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-soft sm:p-5">
        Academy program information is temporarily unavailable.
      </section>
    )
  }

  const history = (historyData ?? []) as EnrollmentRow[]
  const current = history.find((row) => row.is_current) ?? null

  return (
    <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookOpenCheck size={18} />
            <h2 className="text-base font-semibold tracking-tight">Academy program</h2>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Current academy group/program. This is separate from the athlete progression level.
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-xs font-semibold">
          {current?.program_name_snapshot ?? 'Not assigned'}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Current program</div>
          <div className="mt-2 text-lg font-semibold">{current?.program_name_snapshot ?? 'No program assigned'}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
            {current ? `Since ${fmtDateTime(current.started_at)}` : 'Assign a program to start tracking program history.'}
          </div>
        </div>

        {canEdit ? (
          <form action={saveMemberProgramAction} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
            <input type="hidden" name="memberUserId" value={memberUserId} />
            <input type="hidden" name="nextPath" value={nextPath} />
            <label className="block text-sm font-medium">
              Change current program
              <select
                name="program_key"
                defaultValue={current?.program_key ?? ''}
                className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
              >
                <option value="">No current program</option>
                {programs.map((program) => (
                  <option key={program.key} value={program.key}>
                    {memberProgramLabel(program)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              <Save size={14} />
              Save program
            </button>
          </form>
        ) : null}
      </div>

      {history.length > 1 ? (
        <details className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Program history · {history.length} record(s)</summary>
          <div className="border-t border-[hsl(var(--border))] p-4">
            <div className="grid gap-2">
              {history.map((row) => (
                <div key={row.id} className="flex flex-col gap-1 rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium">{row.program_name_snapshot}</span>
                  <span className="text-xs text-[hsl(var(--muted))]">
                    {fmtDateTime(row.started_at)} → {row.is_current ? 'Current' : fmtDateTime(row.ended_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </section>
  )
}
