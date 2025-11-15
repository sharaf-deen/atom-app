// src/app/coaches/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
type Profile = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  role: Role
}

type AttendanceRow = {
  id: string
  member_id: string        // = profiles.user_id
  date: string | null
  status: string | null
  scanned_at: string | null
  profiles: Profile | null
}

function dateOnlyUTC(d: Date) { return d.toISOString().slice(0,10) }
function addDays(dateOnly: string, days: number) {
  const [y,m,d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m-1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dateOnlyUTC(dt)
}
function ensureDateRange(sp: URLSearchParams) {
  let from = sp.get('from'); let to = sp.get('to')
  const today = dateOnlyUTC(new Date())
  if (!to) to = today
  if (!from) from = addDays(to, -14)
  if (from > to) [from, to] = [to, from]
  return { from: from!, to: to! }
}
function initials(first?: string|null, last?: string|null) {
  const f = (first ?? '').trim(), l = (last ?? '').trim()
  if (!f && !l) return '—'
  return `${f.charAt(0) ?? ''}${l.charAt(0) ?? ''}`.toUpperCase()
}

// HH:mm à l'heure du Caire
function formatCairoTime(ts?: string | null) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('fr-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return '—'
  }
}

export default async function CoachesPage({ searchParams }:{
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const sp = new URLSearchParams(
    Object.entries(searchParams ?? {}).flatMap(([k,v]) => Array.isArray(v) ? v.map(vv=>[k,vv]) : v ? [[k,v]] : [])
  )

  const supabase = await createSupabaseRSC()
  const sessionUser = await getSessionUser()
  if (!sessionUser || !['admin','super_admin'].includes(sessionUser.role)) notFound()

  const { from, to } = ensureDateRange(sp)

  // 1) Annuaire coachs & assistants
  const { data: staff, error: staffErr } = await supabase
    .from('profiles')
    .select('user_id, first_name, last_name, email, phone, role')
    .in('role', ['coach','assistant_coach'] as string[])
    .order('role', { ascending: true })
    .order('first_name', { ascending: true })

  if (staffErr) throw new Error(`Erreur chargement profils: ${staffErr.message}`)

  const totalCoaches = (staff ?? []).filter(s => s.role === 'coach').length
  const totalAssistants = (staff ?? []).filter(s => s.role === 'assistant_coach').length

  // 2) ATTENDANCE avec JOIN embarqué (FK: attendance.member_id -> profiles.user_id)
  const { data: att, error: attErr } = await supabase
    .from('attendance')
    .select(`
      id,
      member_id,
      date,
      status,
      scanned_at,
      profiles!inner(
        user_id,
        first_name,
        last_name,
        email,
        phone,
        role
      )
    `)
    .in('profiles.role', ['coach','assistant_coach'] as string[])
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false }) as unknown as { data: AttendanceRow[] | null, error: any }

  if (attErr) console.error('attendance join error:', attErr?.message ?? attErr)

  // 3) Indexer par user_id
  const attendanceByUserId = new Map<string, AttendanceRow[]>()
  for (const r of att ?? []) {
    const u = r.profiles?.user_id
    if (!u) continue
    if (!attendanceByUserId.has(u)) attendanceByUserId.set(u, [])
    attendanceByUserId.get(u)!.push(r)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Coaches & Assistant Coaches :</h1>
        <Link href="/" className="text-sm underline underline-offset-4 hover:opacity-80">← Back</Link>
      </div>

      {/* Résumé Annuaire */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Total: <strong>{staff?.length ?? 0}</strong></span>
          <span>•</span>
          <span>Coaches: <strong>{totalCoaches}</strong></span>
          <span>•</span>
          <span>Assistant Coaches: <strong>{totalAssistants}</strong></span>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {(staff ?? []).map((p) => {
            const full = [p.first_name, p.last_name].filter(Boolean).join(' ') || '—'
            const profileHref = `/members/${p.user_id}`
            return (
              <div key={p.user_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                {/* Avatar + nom NON cliquables */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-gray-100 grid place-items-center text-sm font-medium text-gray-600">
                    {initials(p.first_name, p.last_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{full}</div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${p.role === 'coach' ? 'bg-emerald-100' : 'bg-sky-100'}`}>
                        {p.role === 'coach' ? 'Coach' : 'Assistant Coach'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 truncate">
                      {p.email ?? '—'} {p.phone ? <> • {p.phone}</> : null}
                    </div>
                  </div>
                </div>

                {/* Accès profil UNIQUEMENT via ce bouton */}
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={profileHref}
                    className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-gray-50"
                    aria-label={`View ${full} profile`}
                  >
                    View profile
                  </Link>
                </div>
              </div>
            )
          })}
          {(staff?.length ?? 0) === 0 && <div className="text-sm text-gray-600">No coaches found.</div>}
        </div>
      </div>

      {/* Filtres */}
      <h1 className="text-2xl font-semibold">Attendance :</h1>
      <form className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-sm mb-1">From (inclusive)</label>
          <input type="date" name="from" defaultValue={from} className="w-full rounded-md border p-2" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm mb-1">To (inclusive)</label>
          <input type="date" name="to" defaultValue={to} className="w-full rounded-md border p-2" />
        </div>
        <div className="sm:col-span-1 flex items-end">
          <button type="submit" className="w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50">Filter</button>
        </div>
      </form>

      <div className="text-sm text-gray-600">Selected range: <strong>{from}</strong> → <strong>{to}</strong></div>

      {/* Attendance par personne (avec heure) */}
      <div className="grid grid-cols-1 gap-4">
        {(staff ?? []).map((p) => {
          const recs = attendanceByUserId.get(p.user_id) ?? []
          const full = [p.first_name, p.last_name].filter(Boolean).join(' ') || '—'
          const profileHref = `/members/${p.user_id}`

          return (
            <div key={p.user_id} className="rounded-2xl border p-4 shadow-sm bg-white">
              <div className="flex items-start justify-between gap-3">
                {/* En-tête NON cliquable */}
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gray-100 grid place-items-center text-sm font-medium text-gray-600">
                    {initials(p.first_name, p.last_name)}
                  </div>
                  <div>
                    <div className="font-medium">{full}</div>
                    <div className="text-xs text-gray-500">
                      {p.role === 'coach' ? 'Coach' : 'Assistant Coach'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Time</th>
                      <th className="py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.length === 0 ? (
                      <tr><td className="py-3 text-gray-500" colSpan={3}>No attendance in this period.</td></tr>
                    ) : (
                      recs.map(r => (
                        <tr key={r.id} className="border-b/50">
                          <td className="py-2 pr-3">{r.date ?? '—'}</td>
                          <td className="py-2 pr-3">{formatCairoTime(r.scanned_at)}</td>
                          <td className="py-2 pr-3">{r.status ?? '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
