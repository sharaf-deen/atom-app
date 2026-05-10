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

type TabKey = 'today' | 'day' | 'adults' | 'kids'

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
    // A time line must contain a real time on the right side of the dash.
    // This avoids mis-detecting titles like "Kids 6–9 years" as time lines.
    const isTimeLine = /–\s*\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(t)
    const isTitle =
      !hasDigit(t) &&
      !t.includes('–') &&
      !t.includes(':') &&
      !t.includes('·') &&
      t.length <= 60
    // Long descriptive lines (can contain an en dash) should not be treated as titles.
    const isLongText = !hasDigit(t) && !t.includes(':') && t.length > 60

    // Titles like "Baby 3–5 years" / "Kids 6–9 years" / "Teens 10–14 years" contain digits
    // and must be treated as section titles (not time lines, not items).
    const isDigitTitle =
      /^Baby\s+\d{1,2}\s*[–-]\s*\d{1,2}\s+years(?:\s+Group\s+[A-Z])?$/i.test(t) ||
      /^Kids\s+\d{1,2}\s*[–-]\s*\d{1,2}\s+years$/i.test(t) ||
      /^Teens\s+\d{1,2}\s*[–-]\s*\d{1,2}\s+years$/i.test(t)

    if (isDigitTitle) {
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
      // Many schedule lines are "short descriptions" (e.g. "All levels") that should belong to the current
      // block rather than starting a new block. If we haven't collected any items yet, treat a short line
      // as a subtitle/description.
      if (cur && cur.items.length === 0 && !cur.subtitle && !cur.description) {
        cur.subtitle = t
        continue
      }

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

function TabButton({
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
        'h-10 rounded-2xl px-4 text-sm font-semibold transition',
        active
          ? 'bg-neutral-900 text-white shadow-soft'
          : 'bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-center">
      <h3 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">{children}</h3>
    </div>
  )
}

function ProgramCardSimple({ b }: { b: ProgramBlock }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
      <div className="text-lg font-extrabold tracking-tight text-neutral-900">{b.title}</div>
      {b.subtitle ? (
        <div className="mt-2 text-xs font-bold uppercase tracking-wide text-neutral-500">{b.subtitle}</div>
      ) : null}
      {b.description ? (
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{b.description}</div>
      ) : null}

      {b.items?.length ? (
        <div className="mt-3 space-y-1.5">
          {b.items.map((it, idx) => {
            const left = it.left
            const time = it.time
            const detail = it.detail

            if (left && time) {
              return (
                <div key={idx} className="text-sm text-neutral-900">
                  <span className="font-semibold">{left}</span>
                  <span className="text-neutral-500"> – </span>
                  <span className="font-semibold">{time}</span>
                  {detail ? <span className="text-neutral-700"> {detail}</span> : null}
                </div>
              )
            }

            return (
              <div key={idx} className="text-sm text-neutral-800">
                {it.raw}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function ItemLine({ it }: { it: ProgramItem }) {
  const left = it.left
  const time = it.time
  const detail = it.detail

  if (left && time) {
    return (
      <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2.5 text-sm text-neutral-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200">
            {left}
          </span>
          <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">{time}</span>
        </div>
        {detail ? <div className="mt-2 text-sm text-neutral-700">{detail}</div> : null}
      </div>
    )
  }

  return <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2.5 text-sm text-neutral-800">{it.raw}</div>
}

function BlockCard({ title, subtitle, description, children }: { title: string; subtitle?: string; description?: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xl font-bold tracking-tight text-neutral-900">{title}</div>
          {subtitle ? (
            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{subtitle}</div>
          ) : null}
          {description ? <div className="mt-2 max-w-2xl text-sm text-neutral-600">{description}</div> : null}
        </div>
      </div>
      <div className="mt-4 space-y-2">{children}</div>
    </div>
  )
}

function isTitleMatch(title: string, pattern: RegExp) {
  return pattern.test(title.replace(/–/g, '-'))
}

function DayCardStacked({ d }: { d: DayBlock }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xl font-bold tracking-tight text-neutral-900">{d.day}</div>
        <div className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">
          {d.kids.length + d.adults.length + d.other.length} sessions
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Kids &amp; teens</div>
        <div className="mt-2 space-y-2">
          {d.kids.length ? (
            d.kids.map((s, idx) => (
              <div key={idx} className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2.5 text-sm text-neutral-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">{s.time}</span>
                  <span className="text-neutral-800">{s.text}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-400">No kids classes.</div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Adults</div>
        <div className="mt-2 space-y-2">
          {d.adults.length ? (
            d.adults.map((s, idx) => (
              <div key={idx} className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2.5 text-sm text-neutral-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">{s.time}</span>
                  <span className="text-neutral-800">{s.text}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-400">No adult classes.</div>
          )}
        </div>
      </div>

      {d.other.length ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Other</div>
          <div className="mt-2 space-y-2">
            {d.other.map((x, i) => (
              <div key={i} className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2.5 text-sm text-neutral-600">
                {x.text}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DayChip({
  label,
  active,
  isToday,
  onClick,
}: {
  label: string
  active: boolean
  isToday: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition',
        active
          ? 'border-neutral-900 bg-neutral-900 text-white shadow-soft'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:text-neutral-900'
      )}
    >
      <span>{label}</span>
      {isToday ? (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            active ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-600'
          )}
        >
          Today
        </span>
      ) : null}
    </button>
  )
}

function DayPreviewPanel({ d, currentDay }: { d: DayBlock | null; currentDay: string }) {
  if (!d) {
    return (
      <div className="rounded-3xl border border-dashed border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-soft">
        No sessions available for this day yet.
      </div>
    )
  }

  const isToday = d.day === currentDay

  const renderGroup = (title: string, sessions: DaySession[], emptyText: string) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{title}</div>
        <div className="text-xs font-medium text-neutral-400">{sessions.length || 0}</div>
      </div>
      {sessions.length ? (
        <div className="space-y-2">
          {sessions.map((s, idx) => (
            <div key={idx} className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">{s.time || 'Time TBC'}</span>
                <span className="text-sm text-neutral-800">{s.text}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-400">{emptyText}</div>
      )}
    </div>
  )

  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-2xl font-bold tracking-tight text-neutral-900">{d.day}</h3>
            {isToday ? (
              <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">Today</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-neutral-600">Your classes for this day at a glance.</p>
        </div>
        <div className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">
          {d.kids.length + d.adults.length + d.other.length} sessions
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {renderGroup('Kids & Teens', d.kids, 'No kids classes scheduled.')}
        {renderGroup('Adults', d.adults, 'No adult classes scheduled.')}
      </div>

      {d.other.length ? <div className="mt-4">{renderGroup('Other', d.other, 'No extra schedule notes.')}</div> : null}
    </div>
  )
}

function findFirstBlock(blocks: ProgramBlock[], re: RegExp) {
  return blocks.find((b) => isTitleMatch(b.title, re)) || null
}

function findBlocks(blocks: ProgramBlock[], re: RegExp) {
  return blocks.filter((b) => isTitleMatch(b.title, re))
}

export default function ScheduleEditor({ initialContent, canEdit, updatedAt }: Props) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialContent)
  const [draft, setDraft] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [tab, setTab] = useState<TabKey>('today')
  const [selectedDay, setSelectedDay] = useState<string>(DAY_NAMES[new Date().getDay()] || DAY_NAMES[0])

  useEffect(() => {
    setContent(initialContent)
    setDraft(initialContent)
  }, [initialContent])

  const parts = useMemo(() => splitByMarker(content), [content])
  const program = useMemo(() => parseProgram(parts.a), [parts.a])
  const byDay = useMemo(() => (parts.b ? parseByDay(parts.b) : []), [parts.b])
  const currentDay = useMemo(() => DAY_NAMES[new Date().getDay()] || DAY_NAMES[0], [])
  const selectedDayBlock = useMemo(() => byDay.find((d) => d.day === selectedDay) || null, [byDay, selectedDay])

  useEffect(() => {
    if (!byDay.length) return
    if (!byDay.some((d) => d.day === selectedDay)) {
      setSelectedDay(byDay.some((d) => d.day === currentDay) ? currentDay : byDay[0].day)
    }
  }, [byDay, currentDay, selectedDay])

  const adultBlocksAll = useMemo(() => program.blocks.filter((b) => b.top === 'Adults'), [program.blocks])
  const kidsBlocksAll = useMemo(() => program.blocks.filter((b) => b.top === 'Kids & Teens'), [program.blocks])

  const adultsStructured = useMemo(() => {
    const beginners = findFirstBlock(adultBlocksAll, /^Beginners$/i)
    const intermediate = findFirstBlock(adultBlocksAll, /^Intermediate$/i)
    const openMat = findFirstBlock(adultBlocksAll, /^Open\s+Mat$/i)
    const advanced =
      findFirstBlock(adultBlocksAll, /^Advanced\b/i) ||
      findFirstBlock(adultBlocksAll, /^Advanced\s*-\s*Competition\s+Team$/i)

    // Optional: a trailing note line may exist in the schedule content; keep it if present.
    const note = adultBlocksAll
      .flatMap((b) => b.items)
      .map((x) => x.raw)
      .find((x) => x.toLowerCase().includes('contact the head coach'))

    return { beginners, intermediate, openMat, advanced, note }
  }, [adultBlocksAll])

  // Adults: ensure Advanced and Open Mat render as separate sections.
  // Depending on how the schedule text is authored, the “Advanced – Competition Team” part can
  // appear either as its own block or as a sub-section inside the Open Mat block.
  const adultsView = useMemo(() => {
    const beginners = adultsStructured.beginners
    const intermediate = adultsStructured.intermediate

    let openMatItems = adultsStructured.openMat?.items ?? []

    // Advanced can be its own block...
    let advancedItems = adultsStructured.advanced?.items ?? []
    let advancedDescription = adultsStructured.advanced?.description

    const defaultAdvancedDescription =
      'For athletes preparing for competitions – you must ask the head coach before joining. Advanced sessions are not accessible if you do not attend the Intermediate classes'

    // ...or it can be embedded inside Open Mat (as plain lines).
    if (!adultsStructured.advanced && adultsStructured.openMat) {
      const items = adultsStructured.openMat.items
      const idx = items.findIndex((it) => /^advanced\b/i.test(it.raw.replace(/–/g, '-').trim()))
      if (idx >= 0) {
        const before = items.slice(0, idx)
        let after = items.slice(idx + 1)

        // Try to capture the long description line right after the Advanced header.
        if (after.length) {
          const first = after[0]
          const isTime = Boolean(first.left && first.time)
          const looksLikeDesc = !isTime && !hasDigit(first.raw) && first.raw.length > 50
          if (looksLikeDesc) {
            advancedDescription = first.raw
            after = after.slice(1)
          }
        }

        advancedItems = after
        openMatItems = before
      }
    }

    // If Advanced exists but the parser didn't set description, try to infer it from the first non-time item.
    if (adultsStructured.advanced && !advancedDescription && advancedItems.length) {
      const first = advancedItems[0]
      const isTime = Boolean(first.left && first.time)
      const looksLikeDesc = !isTime && !hasDigit(first.raw) && first.raw.length > 50
      if (looksLikeDesc) {
        advancedDescription = first.raw
        advancedItems = advancedItems.slice(1)
      }
    }

    // Remove any accidental “Advanced …” label that may still be inside Open Mat lines.
    openMatItems = openMatItems.filter((it) => !/^advanced\b/i.test(it.raw.replace(/–/g, '-').trim()))

    return {
      beginners,
      intermediate,
      openMatItems,
      advancedItems,
      advancedDescription: advancedDescription || (advancedItems.length ? defaultAdvancedDescription : null),
    }
  }, [adultsStructured])

  const kidsStructured = useMemo(() => {
    const babyBlocks = findBlocks(kidsBlocksAll, /^Baby\s+3\s*[-–]\s*5\s+years(?:\s+Group\s+[A-Z])?$/i)
    const babySorted = [...babyBlocks].sort((a, b) => {
      const getGroupOrder = (title: string) => {
        const m = title.match(/Group\s+([A-Z])/i)
        if (!m?.[1]) return 0
        return m[1].toUpperCase().charCodeAt(0) - 64
      }
      return getGroupOrder(a.title) - getGroupOrder(b.title) || a.title.localeCompare(b.title)
    })
    const baby = babySorted[0] || null

    const kids69 = findBlocks(kidsBlocksAll, /^Kids\s+6\s*[-–]\s*9\s+years$/i)
    const kids69Beg = kids69.find((b) => (b.subtitle || '').toLowerCase().includes('beginners')) || null
    const kids69Int = kids69.find((b) => (b.subtitle || '').toLowerCase().includes('intermediate')) || null

    const teens1014 = findBlocks(kidsBlocksAll, /^Teens\s+10\s*[-–]\s*14\s+years$/i)
    const teensBeg = teens1014.find((b) => (b.subtitle || '').toLowerCase().includes('beginners')) || null
    const teensInt = teens1014.find((b) => (b.subtitle || '').toLowerCase().includes('intermediate')) || null

    const compTeams = kidsBlocksAll.filter((b) => b.title === 'Competition Team')

    // Group ordering: A then B then others
    const compSorted = [...compTeams].sort((a, b) => {
      const as = (a.subtitle || '').toUpperCase()
      const bs = (b.subtitle || '').toUpperCase()
      if (as === 'GROUP A') return -1
      if (bs === 'GROUP A') return 1
      if (as === 'GROUP B') return -1
      if (bs === 'GROUP B') return 1
      return as.localeCompare(bs)
    })

    return {
      baby,
      babySorted,
      kids69Beg,
      kids69Int,
      teensBeg,
      teensInt,
      compSorted,
    }
  }, [kidsBlocksAll])

  
  const dayIndex = useMemo(() => {
    const m = new Map<string, number>()
    DAY_NAMES.forEach((d, i) => m.set(d, i))
    return m
  }, [])

  const makeProgramItem = (rawLine: string): ProgramItem => {
    const t = normalizeDash(rawLine.trim())
    if (t.includes('–') && hasDigit(t)) {
      const [l, r] = t.split('–').map((x) => x.trim())
      const { time, detail } = parseTimeRight(r)
      return { raw: t, left: l, time, detail, tags: extractTags(t) }
    }
    return { raw: t, tags: extractTags(t) }
  }

  const sortByDayIfPossible = (items: ProgramItem[]) => {
    const scored = items.map((it, idx) => {
      const d = it.left && dayIndex.has(it.left) ? (dayIndex.get(it.left) as number) : 999
      return { it, idx, d }
    })
    scored.sort((a, b) => (a.d - b.d) || (a.idx - b.idx))
    return scored.map((x) => x.it)
  }

  const itemsOrFallback = (b: ProgramBlock | null | undefined, fallbackLines: string[]) => {
    const items = b?.items && b.items.length ? b.items : fallbackLines.map(makeProgramItem)
    return sortByDayIfPossible(items)
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
    if (tab === 'today') return byDay.length === 0
    if (tab === 'day') return byDay.length === 0
    if (tab === 'adults') return adultBlocksAll.length === 0
    return kidsBlocksAll.length === 0
  }, [tab, byDay.length, adultBlocksAll.length, kidsBlocksAll.length])

  
  const kidsCompA =
    kidsStructured.compSorted.find((b) => (b.subtitle || '').toUpperCase().trim() === 'GROUP A') || null
  const kidsCompB =
    kidsStructured.compSorted.find((b) => (b.subtitle || '').toUpperCase().trim() === 'GROUP B') || null

  const babyBlocksForView = kidsStructured.babySorted.length
    ? kidsStructured.babySorted
    : kidsStructured.baby
      ? [kidsStructured.baby]
      : []

return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-soft sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-neutral-900">Weekly schedule</h2>
              {updatedAt ? (
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  Updated {new Date(updatedAt).toLocaleDateString()}
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-neutral-600">
              {canEdit
                ? 'Simple and readable for members. Editable only by super admin.'
                : 'See today first, then browse the full weekly timetable.'}
            </p>
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
          <div className="mt-5 space-y-2">
            <label className="text-sm font-medium text-neutral-900">Schedule content</label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[520px] w-full rounded-3xl border border-neutral-200 bg-white p-4 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-neutral-200"
              placeholder="Paste your schedule here..."
            />
            <p className="text-xs text-neutral-500">
              Tip: keep the marker <span className="font-mono">Weekly Schedule by Day</span> to enable the “By Day” section.
            </p>
          </div>
        ) : (
          <div className="mt-5">
            {/* Tabs */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-800">Training at a glance</div>
                  <div className="mt-1 text-xs text-neutral-500">Start with today, then browse the full week.</div>
                </div>
                <div className="flex w-full gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-1 sm:w-auto">
                  <TabButton active={tab === 'today'} onClick={() => setTab('today')}>
                    Today
                  </TabButton>
                  <TabButton active={tab === 'day'} onClick={() => setTab('day')}>
                    Full week
                  </TabButton>
                  <TabButton active={tab === 'adults'} onClick={() => setTab('adults')}>
                    Adults
                  </TabButton>
                  <TabButton active={tab === 'kids'} onClick={() => setTab('kids')}>
                    Kids & teens
                  </TabButton>
                </div>
              </div>

              {byDay.length ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {DAY_NAMES.map((day) => (
                    <DayChip
                      key={day}
                      label={day}
                      active={selectedDay === day}
                      isToday={day === currentDay}
                      onClick={() => {
                        setSelectedDay(day)
                        setTab('today')
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            {/* Content */}
            <div className="mt-8 space-y-10">
              {tab === 'today' && byDay.length ? (
                <section className="space-y-6">
                  <SectionTitle>Today first</SectionTitle>
                  <div className="mx-auto max-w-5xl text-center text-sm text-neutral-600">
                    Pick any day above to preview the classes in a cleaner, quicker way.
                  </div>
                  <DayPreviewPanel d={selectedDayBlock} currentDay={currentDay} />
                </section>
              ) : null}

              {tab === 'day' && byDay.length ? (
                <section className="space-y-6">
                  <SectionTitle>Full week</SectionTitle>
                  <div className="mx-auto max-w-5xl text-center text-sm text-neutral-600">
                    See every day of the week with kids and adult sessions grouped clearly.
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {byDay.map((d) => (
                      <DayCardStacked key={d.day} d={d} />
                    ))}
                  </div>
                </section>
              ) : null}

              {tab === 'adults' ? (
                <section className="space-y-6">
                  <SectionTitle>Adults</SectionTitle>
                  <div className="mx-auto max-w-5xl text-center text-sm text-neutral-600">
                    Quick overview by level so members can find the right class faster.
                  </div>

                  {adultsView.beginners || adultsView.intermediate || adultsView.openMatItems.length || adultsView.advancedItems.length ? (
                    <div className="space-y-6">
                      <div className="grid gap-6 md:grid-cols-2">
                        {adultsView.beginners ? (
                          <BlockCard title="Beginners" subtitle="White belts & anyone who wants to build strong basics">
                            {adultsView.beginners.items.map((it, i) => (
                              <ItemLine key={i} it={it} />
                            ))}
                          </BlockCard>
                        ) : null}

                        {adultsView.intermediate ? (
                          <BlockCard title="Intermediate" subtitle="Students with solid basics, usually from blue belt and above">
                            {adultsView.intermediate.items.map((it, i) => (
                              <ItemLine key={i} it={it} />
                            ))}
                          </BlockCard>
                        ) : null}
                      </div>

                      <div className="grid gap-6 md:grid-cols-2">
                      {adultsView.advancedItems.length ? (
                        <BlockCard title="Advanced" subtitle="Competition Team">
                          {adultsView.advancedDescription ? (
                            <div className="text-sm text-neutral-600">{adultsView.advancedDescription}</div>
                          ) : null}
                          <div className="space-y-1.5">
                            {adultsView.advancedItems.map((it, i) => (
                              <ItemLine key={i} it={it} />
                            ))}
                          </div>
                        </BlockCard>
                      ) : null}

                      {adultsView.openMatItems.length ? (
                        <BlockCard title="Open Mat" subtitle="All levels">
                          {adultsView.openMatItems.map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </BlockCard>
                      ) : null}
                      </div>

                    </div>
                  ) : adultBlocksAll.length ? (
                    <div className="grid gap-6 md:grid-cols-2">
                      {adultBlocksAll.map((b) => (
                        <ProgramCardSimple key={b.id} b={b} />
                      ))}
                    </div>
                  ) : null}

                  {adultsStructured.note ? (
                    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                      {adultsStructured.note}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {tab === 'kids' ? (
                <section className="space-y-6">
                  <SectionTitle>Kids &amp; Teens</SectionTitle>
                  <div className="mx-auto max-w-5xl text-center text-sm text-neutral-600">
                    Clear group-by-group planning for children, teens and competition teams.
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    {babyBlocksForView.length ? (
                      babyBlocksForView.map((babyBlock) => (
                        <BlockCard key={babyBlock.id} title={babyBlock.title}>
                          <div>
                            <div className="text-sm font-semibold text-neutral-700">
                              {babyBlock.subtitle || 'Beginners · Gi'}
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {itemsOrFallback(babyBlock, []).map((it, i) => (
                                <ItemLine key={i} it={it} />
                              ))}
                            </div>
                          </div>
                        </BlockCard>
                      ))
                    ) : (
                      <BlockCard title="Baby 3-5 years">
                        <div>
                          <div className="text-sm font-semibold text-neutral-700">Beginners · Gi</div>
                          <div className="mt-2 space-y-1.5">
                            {[
                              'Monday – 5:15 PM',
                              'Wednesday – 5:15 PM',
                              'Saturday – 11:15 AM',
                            ].map(makeProgramItem).map((it, i) => (
                              <ItemLine key={i} it={it} />
                            ))}
                          </div>
                        </div>
                      </BlockCard>
                    )}

                    <BlockCard title="Kids 6–9 years">
                      <div>
                        <div className="text-sm font-semibold text-neutral-700">Beginners · Gi</div>
                        <div className="mt-2 space-y-1.5">
                          {itemsOrFallback(kidsStructured.kids69Beg, [
                            'Sunday – 6:15 PM',
                            'Tuesday – 6:15 PM',
                            'Thursday – 5:00 PM',
                          ]).map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-sm font-semibold text-neutral-700">Intermediate · Gi</div>
                        <div className="mt-2 space-y-1.5">
                          {itemsOrFallback(kidsStructured.kids69Int, [
                            'Monday – 6:15 PM',
                            'Wednesday – 6:15 PM',
                            'Saturday – 12:15 PM',
                          ]).map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </div>
                      </div>
                    </BlockCard>

                    <BlockCard title="Teens 10–14 years">
                      <div>
                        <div className="text-sm font-semibold text-neutral-700">Beginners · Gi</div>
                        <div className="mt-2 space-y-1.5">
                          {itemsOrFallback(kidsStructured.teensBeg, [
                            'Sunday – 7:15 PM',
                            'Tuesday – 7:15 PM',
                            'Thursday – 6:00 PM',
                          ]).map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-sm font-semibold text-neutral-700">Intermediate · Gi</div>
                        <div className="mt-2 space-y-1.5">
                          {itemsOrFallback(kidsStructured.teensInt, [
                            'Monday – 7:15 PM',
                            'Wednesday – 7:15 PM',
                            'Saturday – 1:15 PM',
                          ]).map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </div>
                      </div>
                    </BlockCard>

                    <BlockCard title="Competition Team">
                      <div>
                        <div className="text-sm font-semibold text-neutral-700">Group A</div>
                        <div className="mt-2 space-y-1.5">
                          {itemsOrFallback(kidsCompA, [
                            'Tuesday, Wednesday, Thursday & Sunday – 2:00 PM / Saturday 2:30 PM',
                          ]).map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-sm font-semibold text-neutral-700">Group B</div>
                        <div className="mt-2 space-y-1.5">
                          {itemsOrFallback(kidsCompB, [
                            'Tuesday, Wednesday, Thursday & Sunday – 3:30 PM / Saturday 2:30 PM',
                          ]).map((it, i) => (
                            <ItemLine key={i} it={it} />
                          ))}
                        </div>
                      </div>
                    </BlockCard>
                  </div>
                </section>
              ) : null}

              {nothingToShow ? (
                <div className="rounded-3xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-600">
                  No schedule data to display.
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
