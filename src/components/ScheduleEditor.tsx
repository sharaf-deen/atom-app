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
  if (t.includes('(gi)') || t.includes('· gi') || t.includes(' gi') || t.endsWith('gi')) out.push('Gi')
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
        'rounded-full border px-3 py-1 text-xs font-semibold transition',
        active
          ? 'bg-white text-black border-white'
          : 'bg-transparent text-white/80 border-white/15 hover:border-white/30 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-center">
      <h3 className="text-3xl font-extrabold tracking-tight text-white">{children}</h3>
    </div>
  )
}

function ProgramCardSimple({ b }: { b: ProgramBlock }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5 shadow-soft">
      <div className="text-lg font-extrabold tracking-tight text-orange-400">{b.title}</div>
      {b.subtitle ? <div className="mt-2 text-xs font-bold uppercase tracking-wide text-white/60">{b.subtitle}</div> : null}
      {b.description ? <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-white/55">{b.description}</div> : null}

      {b.items?.length ? (
        <div className="mt-3 space-y-1.5">
          {b.items.map((it, idx) => {
            const left = it.left
            const time = it.time
            const detail = it.detail

            if (left && time) {
              return (
                <div key={idx} className="text-sm text-white">
                  <span className="font-semibold text-white">{left}</span>
                  <span className="text-white/70"> – </span>
                  <span className="font-semibold text-white">{time}</span>
                  {detail ? <span className="text-white/90"> {detail}</span> : null}
                </div>
              )
            }

            return (
              <div key={idx} className="text-sm text-white/90">
                {it.raw}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function DayCardStacked({ d }: { d: DayBlock }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5 shadow-soft">
      <div className="text-xl font-extrabold tracking-tight text-orange-400">{d.day}</div>

      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-wide text-white/60">Kids &amp; Teens</div>
        <div className="mt-2 space-y-1">
          {d.kids.length ? (
            d.kids.map((s, idx) => (
              <div key={idx} className="text-sm text-white">
                <span className="font-semibold">{s.time}</span>
                <span className="text-white/70"> – </span>
                <span className="text-white/95">{s.text}</span>
              </div>
            ))
          ) : (
            <div className="text-sm text-white/30">—</div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-wide text-white/60">Adults</div>
        <div className="mt-2 space-y-1">
          {d.adults.length ? (
            d.adults.map((s, idx) => (
              <div key={idx} className="text-sm text-white">
                <span className="font-semibold">{s.time}</span>
                <span className="text-white/70"> – </span>
                <span className="text-white/95">{s.text}</span>
              </div>
            ))
          ) : (
            <div className="text-sm text-white/30">—</div>
          )}
        </div>
      </div>

      {d.other.length ? (
        <div className="mt-4">
          <div className="text-xs font-bold uppercase tracking-wide text-white/50">Other</div>
          <div className="mt-2 space-y-1">
            {d.other.map((x, i) => (
              <div key={i} className="text-sm text-white/70">
                {x.text}
              </div>
            ))}
          </div>
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

  const qlc = useMemo(() => q.trim().toLowerCase(), [q])
  const tagsSet = useMemo(() => new Set(activeTags), [activeTags])
  const filtersActive = qlc.length > 0 || activeTags.length > 0

  function matchesTags(tags: Tag[]) {
    if (tagsSet.size === 0) return true
    return tags.some((t) => tagsSet.has(t))
  }

  const adultBlocks = useMemo(() => {
    return program.blocks
      .filter((b) => b.top === 'Adults')
      .filter((b) => {
        if (!matchesTags(b.tags)) return false
        if (!qlc) return true
        const text = [b.title, b.subtitle, b.description, ...b.items.map((i) => i.raw)].filter(Boolean).join(' ')
        return includesQuery(text, qlc)
      })
  }, [program.blocks, qlc, tagsSet]) // eslint-disable-line react-hooks/exhaustive-deps

  const kidsBlocks = useMemo(() => {
    return program.blocks
      .filter((b) => b.top === 'Kids & Teens')
      .filter((b) => {
        if (!matchesTags(b.tags)) return false
        if (!qlc) return true
        const text = [b.title, b.subtitle, b.description, ...b.items.map((i) => i.raw)].filter(Boolean).join(' ')
        return includesQuery(text, qlc)
      })
  }, [program.blocks, qlc, tagsSet]) // eslint-disable-line react-hooks/exhaustive-deps

  const otherProgramBlocks = useMemo(() => {
    return program.blocks
      .filter((b) => b.top !== 'Adults' && b.top !== 'Kids & Teens')
      .filter((b) => {
        if (!matchesTags(b.tags)) return false
        if (!qlc) return true
        const text = [b.top, b.title, b.subtitle, b.description, ...b.items.map((i) => i.raw)].filter(Boolean).join(' ')
        return includesQuery(text, qlc)
      })
  }, [program.blocks, qlc, tagsSet]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [byDay, qlc, tagsSet]) // eslint-disable-line react-hooks/exhaustive-deps

  const resultsCount = useMemo(() => {
    if (!filtersActive) return null
    const sessions = byDayFiltered.reduce((acc, d) => acc + d.kids.length + d.adults.length + d.other.length, 0)
    const programs = adultBlocks.length + kidsBlocks.length + otherProgramBlocks.length
    return sessions + programs
  }, [filtersActive, byDayFiltered, adultBlocks.length, kidsBlocks.length, otherProgramBlocks.length])

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

  const nothingToShow = useMemo(() => {
    return byDayFiltered.length === 0 && adultBlocks.length === 0 && kidsBlocks.length === 0 && otherProgramBlocks.length === 0
  }, [byDayFiltered.length, adultBlocks.length, kidsBlocks.length, otherProgramBlocks.length])

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/60 p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">Schedule</h2>
            <p className="mt-1 text-sm text-white/60">
              {canEdit ? 'Visible to all users. Editable only by super admin.' : 'Visible to all users.'}
            </p>
            {updatedAt ? (
              <div className="mt-2 text-xs text-white/50">Last updated: {new Date(updatedAt).toLocaleString()}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {ok ? <span className="text-sm font-medium text-emerald-400">{ok}</span> : null}
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
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {editing ? (
          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium text-white">Schedule content</label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[520px] w-full rounded-2xl border border-white/15 bg-black/40 p-3 text-sm text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-white/20"
              placeholder="Paste your schedule here..."
            />
            <p className="text-xs text-white/50">
              Tip: keep the marker <span className="font-mono">Weekly Schedule by Day</span> to enable the “By Day” section.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            {/* Controls */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search classes…"
                    className="h-10 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-white/20 lg:w-80"
                  />
                  {filtersActive ? (
                    <Button variant="outline" onClick={clearFilters}>
                      Clear
                    </Button>
                  ) : null}

                  {filtersActive && resultsCount !== null ? (
                    <span className="ml-1 text-xs text-white/50">{resultsCount} matches</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                  {TAGS.map((t) => (
                    <FilterChip key={t} active={activeTags.includes(t)} onClick={() => toggleTag(t)}>
                      {t}
                    </FilterChip>
                  ))}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="mt-8 space-y-14">
              {byDayFiltered.length ? (
                <section className="space-y-6">
                  <SectionTitle>Weekly Schedule by Day</SectionTitle>
                  <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {byDayFiltered.map((d) => (
                      <DayCardStacked key={d.day} d={d} />
                    ))}
                  </div>
                </section>
              ) : null}

              {adultBlocks.length ? (
                <section className="space-y-6">
                  <SectionTitle>Adults</SectionTitle>
                  <div className="grid gap-6 md:grid-cols-2">
                    {adultBlocks.map((b) => (
                      <ProgramCardSimple key={b.id} b={b} />
                    ))}
                  </div>
                </section>
              ) : null}

              {kidsBlocks.length ? (
                <section className="space-y-6">
                  <SectionTitle>Kids &amp; Teens</SectionTitle>
                  <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {kidsBlocks.map((b) => (
                      <ProgramCardSimple key={b.id} b={b} />
                    ))}
                  </div>
                </section>
              ) : null}

              {otherProgramBlocks.length ? (
                <section className="space-y-6">
                  <SectionTitle>Other</SectionTitle>
                  <div className="grid gap-6 md:grid-cols-2">
                    {otherProgramBlocks.map((b) => (
                      <ProgramCardSimple key={b.id} b={b} />
                    ))}
                  </div>
                </section>
              ) : null}

              {filtersActive && nothingToShow ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-white/60">
                  No results. Try adjusting your search or filters.
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
