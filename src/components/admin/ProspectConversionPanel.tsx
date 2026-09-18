'use client'

import { useMemo, useState } from 'react'
import type { ProspectRow, ProspectSubmissionRow } from '@/app/admin/prospects/page'

type Props = {
  prospect: ProspectRow
  latestSubmission: ProspectSubmissionRow | null
}

type MemberCreateForm = {
  email: string
  first_name: string
  last_name: string
  phone: string
  date_of_birth: string
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return {
    first: parts[0] ?? '',
    last: parts.slice(1).join(' '),
  }
}

function todayDateOnly() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? data : {}
}

export default function ProspectConversionPanel({ prospect, latestSubmission }: Props) {
  const names = useMemo(() => splitName(prospect.full_name), [prospect.full_name])
  const [visitorOpen, setVisitorOpen] = useState(false)
  const [memberOpen, setMemberOpen] = useState(false)
  const [busy, setBusy] = useState<'visitor' | 'member' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [visitor, setVisitor] = useState({
    first_name: names.first,
    last_name: names.last,
    trial_date: todayDateOnly(),
  })
  const [member, setMember] = useState<MemberCreateForm>({
    email: prospect.email ?? '',
    first_name: names.first,
    last_name: names.last,
    phone: prospect.phone ?? '',
    date_of_birth: '',
  })
  const [needsNewMember, setNeedsNewMember] = useState(false)

  const hasVisitor = !!prospect.linked_visitor_trial_id
  const hasMember = !!prospect.linked_member_id

  async function convertVisitor() {
    setBusy('visitor')
    setError(null)
    setInfo(null)
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: prospect.id,
          action: 'convert_to_visitor',
          first_name: visitor.first_name,
          last_name: visitor.last_name,
          trial_date: visitor.trial_date,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Visitor conversion failed.')
      }
      setInfo(data.reused ? 'Existing Visitor safely reused and linked.' : 'Visitor created and linked.')
      window.location.reload()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setBusy(null)
    }
  }

  async function resolveMember() {
    setBusy('member')
    setError(null)
    setInfo(null)
    setNeedsNewMember(false)
    try {
      const response = await fetch('/api/admin/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospect.id, action: 'link_existing_member' }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Member lookup failed.')
      }
      if (data.member_user_id) {
        window.location.href = `/members/${data.member_user_id}`
        return
      }
      setNeedsNewMember(true)
      setInfo('No safe existing Member match was found. Create the Member through the existing Member API below.')
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setBusy(null)
    }
  }

  async function createAndLinkMember() {
    setBusy('create')
    setError(null)
    setInfo(null)
    try {
      if (!member.email.trim()) throw new Error('Email is required for a standalone Member account.')
      if (!member.date_of_birth) throw new Error('Date of birth is required.')

      const createResponse = await fetch('/api/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: member.email.trim(),
          first_name: member.first_name.trim() || undefined,
          last_name: member.last_name.trim() || undefined,
          phone: member.phone.trim() || undefined,
          date_of_birth: member.date_of_birth,
          firstName: member.first_name.trim() || undefined,
          lastName: member.last_name.trim() || undefined,
          dateOfBirth: member.date_of_birth,
        }),
      })
      const created = await readJson(createResponse)

      let memberUserId = created?.user?.id || created?.user_id || created?.id || created?.existing_member?.user_id || ''
      if (!createResponse.ok || created.ok !== true) {
        if (!(created.error === 'EMAIL_ALREADY_IN_USE' && memberUserId)) {
          throw new Error(created.details || created.error || 'Member creation failed.')
        }
      }
      if (!memberUserId) throw new Error('Member was saved but no Member user id was returned.')

      const linkResponse = await fetch('/api/admin/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: prospect.id,
          action: 'link_member',
          member_user_id: memberUserId,
        }),
      })
      const linked = await readJson(linkResponse)
      if (!linkResponse.ok || linked.ok !== true) {
        throw new Error(
          `Member exists, but Prospect linking needs review: ${linked.details || linked.error || 'link failed'}`,
        )
      }
      window.location.href = `/members/${memberUserId}`
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold text-sky-950">Visitor / Member conversion</div>
          <p className="mt-1 text-xs text-sky-900">
            Prospect history is preserved. Existing Visitor/Member records are reused when the match is safe.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasVisitor ? (
            <a href="/admin/visitors" className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-950">
              Visitor linked
            </a>
          ) : (
            <button type="button" onClick={() => setVisitorOpen((v) => !v)} className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-950">
              Convert to Visitor
            </button>
          )}
          {hasMember ? (
            <a href={`/members/${prospect.linked_member_id}`} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">
              Open Member
            </a>
          ) : (
            <button type="button" onClick={() => setMemberOpen((v) => !v)} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">
              Convert to Member
            </button>
          )}
        </div>
      </div>

      {latestSubmission?.requested_classes?.length || latestSubmission?.submitted_level || latestSubmission?.goals?.length ? (
        <div className="mt-3 text-xs text-sky-900">
          Latest enquiry context will be retained in the Visitor conversion: {[
            latestSubmission?.requested_classes?.length ? `classes ${latestSubmission.requested_classes.join(', ')}` : '',
            latestSubmission?.submitted_level ? `level ${latestSubmission.submitted_level}` : '',
            latestSubmission?.goals?.length ? `goals ${latestSubmission.goals.join(', ')}` : '',
          ].filter(Boolean).join(' · ')}
        </div>
      ) : null}

      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      {info ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</div> : null}

      {visitorOpen && !hasVisitor ? (
        <div className="mt-3 grid gap-3 rounded-xl border border-sky-200 bg-white p-3 sm:grid-cols-2">
          <label className="text-sm font-medium">First name *
            <input value={visitor.first_name} onChange={(e) => setVisitor((v) => ({ ...v, first_name: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
          </label>
          <label className="text-sm font-medium">Last name
            <input value={visitor.last_name} onChange={(e) => setVisitor((v) => ({ ...v, last_name: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
          </label>
          <label className="text-sm font-medium">Trial date *
            <input type="date" value={visitor.trial_date} onChange={(e) => setVisitor((v) => ({ ...v, trial_date: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
          </label>
          <div className="flex items-end">
            <button type="button" disabled={busy === 'visitor' || !visitor.first_name.trim() || !visitor.trial_date} onClick={() => void convertVisitor()} className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'visitor' ? 'Converting…' : 'Confirm Visitor conversion'}
            </button>
          </div>
        </div>
      ) : null}

      {memberOpen && !hasMember ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-950">Member safety</div>
          <p className="mt-1 text-xs text-amber-900">
            For a child who must be family-managed without child Auth, use Prospect → Visitor, then the existing Family Intake conversion. The direct Member path below is for a standalone Auth-based Member.
          </p>
          <div className="mt-3">
            <button type="button" disabled={busy === 'member'} onClick={() => void resolveMember()} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 disabled:opacity-50">
              {busy === 'member' ? 'Checking…' : 'Find / reuse existing Member'}
            </button>
          </div>

          {needsNewMember ? (
            <div className="mt-3 grid gap-3 rounded-xl border border-amber-200 bg-white p-3 sm:grid-cols-2">
              <label className="text-sm font-medium">Email *
                <input type="email" value={member.email} onChange={(e) => setMember((v) => ({ ...v, email: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
              </label>
              <label className="text-sm font-medium">Phone
                <input value={member.phone} onChange={(e) => setMember((v) => ({ ...v, phone: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
              </label>
              <label className="text-sm font-medium">First name
                <input value={member.first_name} onChange={(e) => setMember((v) => ({ ...v, first_name: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
              </label>
              <label className="text-sm font-medium">Last name
                <input value={member.last_name} onChange={(e) => setMember((v) => ({ ...v, last_name: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
              </label>
              <label className="text-sm font-medium">Date of birth *
                <input type="date" value={member.date_of_birth} onChange={(e) => setMember((v) => ({ ...v, date_of_birth: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" />
              </label>
              <div className="flex items-end">
                <button type="button" disabled={busy === 'create' || !member.email.trim() || !member.date_of_birth} onClick={() => void createAndLinkMember()} className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busy === 'create' ? 'Creating…' : 'Create through existing Member flow'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
