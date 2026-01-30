'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Button from '@/components/ui/Button'

type Props = {
  initialContent: string
  canEdit: boolean
  updatedAt?: string | null
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const DAY_SET = new Set<string>(DAY_NAMES)
const TOP_HEADINGS = new Set(['Kids & Teens', 'Adults', 'Weekly Schedule by Day'])

type Tag = 'Gi' | 'NoGi' | 'Wrestling' | 'Competition' | 'Open Mat'

type ProgramItem = {
  raw: string
  left?: string
  time?: string
  detail?: string
  tags: Tag[]
}

type ProgramBlock = {
  id: string
  top: string
  title: string
  subtitle?: string
  description?: string
  tags: Tag[]
  items: ProgramItem[]
}

type DaySession = {
  time: string
  text: string
  tags: Tag[]
}

type DayBlock = {
  day: string
  kids: DaySession[]
  adults: DaySession[]
  other: DaySession[]
}

const TAGS: Tag[] = ['Gi', 'NoGi', 'Wrestling', 'Competition', 'Open Mat']

function cn(...parts: Array<string | null | undefined | false>) {
  return parts.filter((p): p is string => Boolean(p)).join(' ')
}

function hasDigit(s: string) {
  return /\d/.test(s)
}

function normalizeDash(line: string) {
  // Normalize a few dash variants to an en-dash surrounded by spaces
  return line
    .replace(/\s-\s/g, ' – ')
    .replace(/\s—\s/g, ' – ')
    .replace(/\s–\s/g, ' – ')
}

function extractTags(text: string): Tag[] {
  const t = text.toLowerCase()
  const out: Tag[] = []
  if (t.includes('nogi') || t.includes('no-gi') || t.includes('no gi')) out.push('NoGi')
  if (t.includes('(gi)') || (t.includes(' gi') || t.includes('gi ')) || t.endsWith('gi')) out.push('Gi')
  if (t.includes('wrestling')) out.push('Wrestling')
  if (t.includes('competition')) out.push('Competition')
  if (t.includes('open mat')) out.push('Open Mat')
  return Array.from(new Set(out))
}

function splitByMarker(content: string) {
  const marker = 'Weekly Schedule by Day'
  const idx = content.indexOf(marker)
  if (idx < 0) return { a: content.trim(), b: '' }
  const a = content.slice(0, idx).trim()
  const b = content.slice(idx).trim()
  return { a, b }
}

function parseTimeRight(right: string) {
  const m = right.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))(.*)$/i)
  if (!m) return { time: undefined as string | undefined, detail: right.trim() }
  const time = m[1].trim()
  const detail = (m[2] || '').trim()
  return { time, detail }
}

function parseProgram(partA: string): { tops: string[]; blocks: ProgramBlock[] } {
  const lines = partA
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)

  const blocks: ProgramBlock[] = []
  const tops: string[] = []

  let top = ''
  let cur: ProgramBlock | null = null
  let idn = 0

  const pushCur = () => {
    if (!cur) return
    const allText = [cur.title, cur.subtitle, cur.description, ...cur.items.map((i) => i.raw)]
      .filter(Boolean)
      .join(' | ')
    cur.tags = extractTags(allText)
    blocks.push(cur)
    cur = null
  }

  for (const raw of lines) {
    const t = normalizeDash(raw)
    if (t === 'Weekly Schedule by Day') break

    if (TOP_HEADINGS.has(t) && t !== 'Weekly Schedule by Day') {
      pushCur()
      top = t
      if (!tops.includes(top)) tops.push(top)
      continue
    }

    const isMeta = t.includes('·') && !hasDigit(t)
    const isTimeLine = t.includes('–') && hasDigit(t)
    const isTitle =
      !hasDigit(t) &&
      !t.includes('–') &&
      !t.includes(':') &&
      !t.includes('·') &&
      t.length <= 60
    const isLongText = !hasDigit(t) && !t.includes('–') && !t.includes(':') && t.length > 60

    // Special case: Competition Team > Group A / Group B as separate blocks
    if (cur && cur.title === 'Competition Team' && /^Group\s+[A-Z]$/i.test(t)) {
      pushCur()
      cur = {
        id: `p_${idn++}`,
        top: top || 'Schedule',
        title: 'Competition Team',
        subtitle: t,
        tags: [],
        items: [],
      }
      continue
    }

    if (isTitle) {
      if (cur) pushCur()
      cur = {
        id: `p_${idn++}`,
        top: top || 'Schedule',
        title: t,
        tags: [],
        items: [],
      }
      continue
    }

    if (!cur) {
      cur = {
        id: `p_${idn++}`,
        top: top || 'Schedule',
        title: t,
        tags: [],
        items: [],
      }
      continue
    }

    if (isMeta && !cur.subtitle) {
      cur.subtitle = t
      continue
    }
    if (isLongText && !cur.description) {
      cur.description = t
      continue
    }

    if (isTimeLine) {
      const [l, r] = t.split('–').map((x) => x.trim())
      const { time, detail } = parseTimeRight(r)
      cur.items.push({ raw: t, left: l, time, detail, tags: extractTags(t) })
    } else {
      cur.items.push({ raw: t, tags: extractTags(t) })
    }
  }

  pushCur()
  return { tops, blocks }
}

function splitMultiSessions(line: string): { time: string; text: string }[] {
  const s = normalizeDash(line)
  const rx = /(\d{1,2}:\d{2}\s*(?:AM|PM))\s*–\s*/gi
  const matches = Array.from(s.matchAll(rx))
  if (matches.length <= 1) {
    const m = s.match(/^\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*–\s*(.*)$/i)
    if (!m) return []
    return [{ time: m[1].trim(), text: (m[2] || '').trim() }]
  }

  const out: { time: string; text: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const time = (m[1] || '').trim()
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? s.length) : s.length
    const text = s.slice(start, end).trim()
    if (time && text) out.push({ time, text })
  }
  return out
}

function parseByDay(partB: string): DayBlock[] {
  const lines = partB
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)

  const out: DayBlock[] = []
  let cur: DayBlock | null = null
  let section: 'kids' | 'adults' | 'other' = 'other'

  for (const raw of lines) {
    const t = normalizeDash(raw)
    if (t === 'Weekly Schedule by Day') continue

    if (DAY_SET.has(t)) {
      if (cur) out.push(cur)
      cur = { day: t, kids: [], adults: [], other: [] }
      section = 'other'
      continue
    }

    if (!cur) continue

    if (t === 'Kids & Teens') {
      section = 'kids'
      continue
    }
    if (t === 'Adults') {
      section = 'adults'
      continue
    }

    const sessions = splitMultiSessions(t)
    if (sessions.length) {
      for (const s of sessions) {
        const sess: DaySession = { time: s.time, text: s.text, tags: extractTags(s.text) }
        cur[section].push(sess)
      }
      continue
    }

    cur.other.push({ time: '', text: t, tags: extractTags(t) })
  }

  if (cur) out.push(cur)
  return out
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-white px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted))]">
      {children}
    </span>
  )
}

function TagPills({ tags }: { tags: Tag[] }) {
  if (!tags?.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Pill key={t}>{t}</Pill>
      ))}
    </div>
  )
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active ? 'bg-black text-white border-black' : 'bg-white text-black border-[hsl(var(--border))] hover:bg-black/5'
      )}
    >
      {children}
    </button>
  )
}

function ProgramCard({ b }: { b: ProgramBlock }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold leading-6">{b.title}</div>
          {b.subtitle ? <div className="mt-1 text-sm font-medium text-[hsl(var(--muted))]">{b.subtitle}</div> : null}
          {b.description ? <div className="mt-2 text-sm text-[hsl(var(--muted))]">{b.description}</div> : null}
        </div>
        <TagPills tags={b.tags} />
      </div>

      {b.items?.length ? (
        <div className="mt-4 space-y-2">
          {b.items.map((it, idx) => {
            const left = it.left
            const time = it.time
            const detail = it.detail

            return (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-white/60 px-3 py-2"
              >
                <div className="min-w-[92px]">
                  {left ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">{left}</div>
                  ) : (
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Info</div>
                  )}
                  {time ? (
                    <div className="mt-1 inline-flex rounded-lg bg-black px-2 py-1 text-xs font-semibold text-white">
                      {time}
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-5">{detail ?? it.raw}</div>
                  {it.tags?.length ? (
                    <div className="mt-1">
                      <TagPills tags={it.tags} />
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function DayCard({ d }: { d: DayBlock }) {
  const hasKids = d.kids.length > 0
  const hasAdults = d.adults.length > 0

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold tracking-tight">{d.day}</div>
        <div className="flex gap-1">
          {hasKids ? <Pill>Kids</Pill> : null}
          {hasAdults ? <Pill>Adults</Pill> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className={cn(!hasKids && 'opacity-50')}>
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Kids & Teens</div>
          <div className="mt-2 space-y-2">
            {d.kids.length ? (
              d.kids.map((s, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-white/60 px-3 py-2"
                >
                  <div className="shrink-0 rounded-lg bg-black px-2 py-1 text-xs font-semibold text-white">
                    {s.time}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-5">{s.text}</div>
                    {s.tags.length ? (
                      <div className="mt-1">
                        <TagPills tags={s.tags} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-white/50 px-3 py-2 text-sm text-[hsl(var(--muted))]">
                —
              </div>
            )}
          </div>
        </div>

        <div className={cn(!hasAdults && 'opacity-50')}>
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Adults</div>
          <div className="mt-2 space-y-2">
            {d.adults.length ? (
              d.adults.map((s, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-white/60 px-3 py-2"
                >
                  <div className="shrink-0 rounded-lg bg-black px-2 py-1 text-xs font-semibold text-white">
                    {s.time}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-5">{s.text}</div>
                    {s.tags.length ? (
                      <div className="mt-1">
                        <TagPills tags={s.tags} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-[hsl(var(--border))] bg-white/50 px-3 py-2 text-sm text-[hsl(var(--muted))]">
                —
              </div>
            )}
          </div>
        </div>
      </div>

      {d.other.length ? (
        <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-white/50 px-3 py-2 text-sm">
          {d.other.map((x, i) => (
            <div key={i} className="text-[hsl(var(--muted))]">
              {x.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function includesQuery(hay: string, q: string) {
  if (!q) return true
  return hay.toLowerCase().includes(q)
}

export default function ScheduleEditor({ initialContent, canEdit, updatedAt }: Props) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialContent)
  const [draft, setDraft] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // Search / filters
  const [q, setQ] = useState('')
  const [activeTags, setActiveTags] = useState<Tag[]>([])

  useEffect(() => {
    setContent(initialContent)
    setDraft(initialContent)
  }, [initialContent])

  const parts = useMemo(() => splitByMarker(content), [content])
  const program = useMemo(() => parseProgram(parts.a), [parts.a])
  const byDay = useMemo(() => (parts.b ? parseByDay(parts.b) : []), [parts.b])

  const [tab, setTab] = useState<'program' | 'day'>('program')

  useEffect(() => {
    if (tab === 'day' && !parts.b) setTab('program')
  }, [parts.b, tab])

  const qlc = useMemo(() => q.trim().toLowerCase(), [q])
  const tagsSet = useMemo(() => new Set(activeTags), [activeTags])
  const filtersActive = qlc.length > 0 || activeTags.length > 0

  function matchesTags(tags: Tag[]) {
    if (tagsSet.size === 0) return true
    return tags.some((t) => tagsSet.has(t))
  }

  const programBlocksFiltered = useMemo(() => {
    return program.blocks.filter((b) => {
      if (!matchesTags(b.tags)) return false
      if (!qlc) return true
      const text = [b.top, b.title, b.subtitle, b.description, ...b.items.map((i) => i.raw)].filter(Boolean).join(' ')
      return includesQuery(text, qlc)
    })
  }, [program.blocks, qlc, tagsSet])  // eslint-disable-line react-hooks/exhaustive-deps

  const programTopsFiltered = useMemo(() => {
    // Keep known headings order, only include headings that have any blocks
    const tops = program.tops.filter((t) => programBlocksFiltered.some((b) => b.top === t))
    // If blocks exist without a known top, we'll render them under "Other"
    return tops
  }, [program.tops, programBlocksFiltered])

  const byDayFiltered = useMemo(() => {
    if (!byDay.length) return []
    const out: DayBlock[] = []
    for (const d of byDay) {
      const kids = d.kids.filter((s) => matchesTags(s.tags) && (!qlc || includesQuery(`${s.time} ${s.text}`, qlc)))
      const adults = d.adults.filter((s) => matchesTags(s.tags) && (!qlc || includesQuery(`${s.time} ${s.text}`, qlc)))
      const other = d.other.filter((s) => matchesTags(s.tags) && (!qlc || includesQuery(s.text, qlc)))
      if (kids.length || adults.length || other.length) out.push({ day: d.day, kids, adults, other })
    }
    return out
  }, [byDay, qlc, tagsSet])  // eslint-disable-line react-hooks/exhaustive-deps

  const resultsCount = useMemo(() => {
    if (!filtersActive) return null
    if (tab === 'program') return programBlocksFiltered.length
    // count sessions shown
    return byDayFiltered.reduce((acc, d) => acc + d.kids.length + d.adults.length + d.other.length, 0)
  }, [filtersActive, tab, programBlocksFiltered, byDayFiltered])

  function toggleTag(t: Tag) {
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  function clearFilters() {
    setQ('')
    setActiveTags([])
  }

  async function onSave() {
    setSaving(true)
    setError(null)
    setOk(null)
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'Save failed')
      setContent(draft)
      setEditing(false)
      setOk('Saved')
      window.dispatchEvent(new Event('atom:reload'))
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
      setTimeout(() => setOk(null), 2500)
    }
  }

  function onCancel() {
    setDraft(content)
    setEditing(false)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Weekly Schedule</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              {canEdit ? 'Visible to all users. Editable only by super admin.' : 'Visible to all users.'}
            </p>
            {updatedAt ? (
              <div className="mt-2 text-xs text-[hsl(var(--muted))]">Last updated: {new Date(updatedAt).toLocaleString()}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {ok ? <span className="text-sm font-medium text-emerald-600">{ok}</span> : null}
            {canEdit && !editing ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {canEdit && editing ? (
              <>
                <Button variant="outline" onClick={onCancel} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={onSave} disabled={saving || !draft.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        {editing ? (
          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium">Schedule content</label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[520px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-black/20"
              placeholder="Paste your schedule here..."
            />
            <p className="text-xs text-[hsl(var(--muted))]">
              Tip: keep the marker <span className="font-mono">Weekly Schedule by Day</span> to enable the “By Day” tab.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            {/* Controls */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setTab('program')}
                    className={cn(
                      'rounded-full px-3 py-1 text-sm border transition',
                      tab === 'program' ? 'bg-black text-white border-black' : 'bg-white text-black border-[hsl(var(--border))]'
                    )}
                  >
                    By Program
                  </button>
                  <button
                    onClick={() => setTab('day')}
                    disabled={!parts.b}
                    className={cn(
                      'rounded-full px-3 py-1 text-sm border transition',
                      tab === 'day' ? 'bg-black text-white border-black' : 'bg-white text-black border-[hsl(var(--border))]',
                      !parts.b ? 'opacity-40 cursor-not-allowed' : null
                    )}
                  >
                    By Day
                  </button>

                  {filtersActive && resultsCount !== null ? (
                    <span className="ml-1 text-xs text-[hsl(var(--muted))]">
                      {resultsCount} match{resultsCount === 1 ? '' : 'es'}
                    </span>
                  ) : null}
                </div>

                <div className="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search classes…"
                    className="h-9 w-full sm:w-72 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-black/20"
                  />
                  {filtersActive ? (
                    <Button variant="outline" onClick={clearFilters}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {TAGS.map((t) => (
                  <FilterChip key={t} active={activeTags.includes(t)} onClick={() => toggleTag(t)}>
                    {t}
                  </FilterChip>
                ))}
              </div>
            </div>

            {/* Content */}
            {tab === 'program' ? (
              <div className="mt-5 space-y-8">
                {programTopsFiltered.map((top) => {
                  const blocks = programBlocksFiltered.filter((b) => b.top === top)
                  if (!blocks.length) return null
                  return (
                    <div key={top} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold tracking-tight">{top}</h3>
                        <div className="text-xs text-[hsl(var(--muted))]">{blocks.length} program{blocks.length === 1 ? '' : 's'}</div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {blocks.map((b) => (
                          <ProgramCard key={b.id} b={b} />
                        ))}
                      </div>
                    </div>
                  )
                })}

                {/* Other blocks (no known heading) */}
                {programBlocksFiltered.some((b) => !program.tops.includes(b.top)) ? (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold tracking-tight">Other</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {programBlocksFiltered
                        .filter((b) => !program.tops.includes(b.top))
                        .map((b) => (
                          <ProgramCard key={b.id} b={b} />
                        ))}
                    </div>
                  </div>
                ) : null}

                {filtersActive && programBlocksFiltered.length === 0 ? (
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/60 p-6 text-sm text-[hsl(var(--muted))]">
                    No results. Try adjusting your search or filters.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-5">
                {byDayFiltered.length ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {byDayFiltered.map((d) => (
                      <DayCard key={d.day} d={d} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/60 p-6 text-sm text-[hsl(var(--muted))]">
                    No results. Try adjusting your search or filters.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
