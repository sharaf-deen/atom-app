'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type StaffAccount = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type StaffPayrollProfile = {
  staff_user_id: string
  primary_role: string
  secondary_roles: string[]
  employment_status: 'active' | 'inactive'
  employment_start_date: string | null
  employment_end_date: string | null
  notes: string | null
  updated_at: string
}

type AccountLink = {
  linked_user_id: string
  staff_user_id: string
}

type AreaRow = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

type TaskRow = {
  id: string
  area_id: string
  name: string
  frequency_label: string | null
  estimated_time_label: string | null
  importance_level: string
  importance_multiplier: number
  unit: string
  sort_order: number
  is_active: boolean
}

type DefaultAssignment = {
  task_id: string
  user_id: string
}

type Props = {
  accounts: StaffAccount[]
  staffProfiles: StaffPayrollProfile[]
  accountLinks: AccountLink[]
  areas: AreaRow[]
  tasks: TaskRow[]
  defaultAssignments: DefaultAssignment[]
  canWrite: boolean
}

const ROLE_OPTIONS = [
  ['assistant_coach', 'Assistant Coach'],
  ['coach', 'Coach'],
  ['head_coach', 'Head Coach'],
  ['competition_coach', 'Competition Coach'],
  ['technical_director', 'Technical Director'],
  ['reception', 'Reception'],
  ['admin', 'Admin'],
  ['operations', 'Operations'],
  ['manager', 'Manager'],
  ['super_admin', 'Super Admin'],
  ['other', 'Other'],
] as const

function accountName(account: StaffAccount | undefined) {
  if (!account) return 'Unknown account'
  const name = `${account.first_name ?? ''} ${account.last_name ?? ''}`.trim()
  return name || account.email || account.user_id.slice(0, 8)
}

function roleLabel(role: string | null | undefined) {
  const match = ROLE_OPTIONS.find(([value]) => value === role)
  if (match) return match[1]

  return String(role ?? 'staff')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function importanceLabel(level: string) {
  switch (level) {
    case 'important':
      return 'Important'
    case 'responsibility':
      return 'Responsibility'
    case 'high_responsibility':
      return 'High responsibility'
    case 'critical':
      return 'Critical / Direction'
    default:
      return 'Standard'
  }
}

function errorLabel(code: string) {
  const labels: Record<string, string> = {
    FORBIDDEN: 'Only Super Admin can change Staff Payroll employee profiles.',
    MIGRATION_REQUIRED: 'Deploy the Staff Payroll 2O database migration first.',
    INVALID_STAFF_USER: 'Select a valid canonical payroll account.',
    INVALID_PRIMARY_ROLE: 'Choose a primary payroll role.',
    INVALID_EMPLOYMENT_STATUS: 'Choose Active or Inactive.',
    INVALID_EMPLOYMENT_DATE: 'Enter valid employment dates.',
    STAFF_PAYROLL_CANONICAL_ACCOUNT_ALREADY_LINKED:
      'This account is already linked as a secondary account of another employee.',
    STAFF_PAYROLL_LINKED_ACCOUNT_IS_ANOTHER_CANONICAL_PROFILE:
      'A linked account is already the canonical account of another payroll employee.',
    STAFF_PAYROLL_LINKED_ACCOUNT_ALREADY_ASSIGNED:
      'A linked account already belongs to another payroll employee.',
    STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_ACTIVE_COMPENSATION:
      'A secondary account still has an active compensation period. Use that account as canonical, or close its active compensation first.',
    STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_CURRENT_TASKS:
      'A secondary account already has current-month payroll tasks. Move/clean those entries before linking it.',
    STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_CURRENT_ADJUSTMENTS:
      'A secondary account has active current-month payroll adjustments. Resolve them before linking it.',
    STAFF_PAYROLL_INVALID_DEFAULT_TASK:
      'One or more selected default tasks are inactive or invalid.',
  }

  return labels[code] ?? code.replace(/_/g, ' ')
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export default function StaffPayrollStaffProfilesManager({
  accounts,
  staffProfiles,
  accountLinks,
  areas,
  tasks,
  defaultAssignments,
  canWrite,
}: Props) {
  const router = useRouter()
  const accountMap = React.useMemo(
    () => new Map(accounts.map((account) => [account.user_id, account])),
    [accounts]
  )

  const profileMap = React.useMemo(
    () =>
      new Map(
        staffProfiles.map((profile) => [profile.staff_user_id, profile])
      ),
    [staffProfiles]
  )

  const ownerByLinkedAccount = React.useMemo(
    () =>
      new Map(
        accountLinks.map((link) => [link.linked_user_id, link.staff_user_id])
      ),
    [accountLinks]
  )

  const [selectedStaffUserId, setSelectedStaffUserId] = React.useState(
    staffProfiles[0]?.staff_user_id ?? ''
  )
  const [newCanonicalId, setNewCanonicalId] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [taskSearch, setTaskSearch] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  const selectedProfile = profileMap.get(selectedStaffUserId) ?? null
  const selectedAccount = accountMap.get(selectedStaffUserId)

  const selectedDefaultIds = React.useMemo(
    () =>
      new Set(
        defaultAssignments
          .filter((row) => row.user_id === selectedStaffUserId)
          .map((row) => row.task_id)
      ),
    [defaultAssignments, selectedStaffUserId]
  )

  const selectedLinkedIds = React.useMemo(
    () =>
      new Set(
        accountLinks
          .filter((row) => row.staff_user_id === selectedStaffUserId)
          .map((row) => row.linked_user_id)
      ),
    [accountLinks, selectedStaffUserId]
  )

  const unconfiguredAccounts = React.useMemo(
    () =>
      accounts.filter(
        (account) =>
          !profileMap.has(account.user_id) &&
          !ownerByLinkedAccount.has(account.user_id)
      ),
    [accounts, ownerByLinkedAccount, profileMap]
  )

  const visibleProfiles = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return staffProfiles
      .filter((profile) => {
        if (!q) return true
        const account = accountMap.get(profile.staff_user_id)
        const linkedNames = accountLinks
          .filter((link) => link.staff_user_id === profile.staff_user_id)
          .map((link) => accountName(accountMap.get(link.linked_user_id)))
          .join(' ')
        return `${accountName(account)} ${account?.email ?? ''} ${profile.primary_role} ${profile.secondary_roles.join(' ')} ${linkedNames}`
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        if (a.employment_status !== b.employment_status) {
          return a.employment_status === 'active' ? -1 : 1
        }
        return accountName(accountMap.get(a.staff_user_id)).localeCompare(
          accountName(accountMap.get(b.staff_user_id))
        )
      })
  }, [accountLinks, accountMap, search, staffProfiles])

  const activeTasks = React.useMemo(
    () =>
      tasks
        .filter((task) => task.is_active)
        .sort((a, b) => {
          const areaA = areas.find((area) => area.id === a.area_id)
          const areaB = areas.find((area) => area.id === b.area_id)
          const areaDiff =
            Number(areaA?.sort_order ?? 999) -
            Number(areaB?.sort_order ?? 999)
          if (areaDiff) return areaDiff
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
          return a.name.localeCompare(b.name)
        }),
    [areas, tasks]
  )

  const filteredTasks = React.useMemo(() => {
    const q = taskSearch.trim().toLowerCase()
    if (!q) return activeTasks
    return activeTasks.filter((task) => {
      const areaName =
        areas.find((area) => area.id === task.area_id)?.name ?? ''
      return `${task.name} ${areaName} ${task.frequency_label ?? ''}`
        .toLowerCase()
        .includes(q)
    })
  }, [activeTasks, areas, taskSearch])

  const activeCount = staffProfiles.filter(
    (profile) => profile.employment_status === 'active'
  ).length
  const configuredTaskCount = new Set(
    defaultAssignments
      .filter((row) => profileMap.has(row.user_id))
      .map((row) => `${row.user_id}:${row.task_id}`)
  ).size
  const linkedCount = accountLinks.length

  function beginNewProfile() {
    if (!newCanonicalId) return
    setSelectedStaffUserId(newCanonicalId)
    setError(null)
    setSuccess(null)
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite || !selectedStaffUserId) return

    const form = event.currentTarget
    const formData = new FormData(form)

    setPending(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/staff-payroll/staff-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          staffUserId: selectedStaffUserId,
          primaryRole: String(formData.get('primary_role') ?? ''),
          secondaryRoles: formData
            .getAll('secondary_roles')
            .map((value) => String(value)),
          employmentStatus: String(
            formData.get('employment_status') ?? 'active'
          ),
          employmentStartDate:
            String(formData.get('employment_start_date') ?? '') || null,
          employmentEndDate:
            String(formData.get('employment_end_date') ?? '') || null,
          notes: String(formData.get('notes') ?? '') || null,
          linkedUserIds: formData
            .getAll('linked_user_ids')
            .map((value) => String(value)),
          defaultTaskIds: formData
            .getAll('default_task_ids')
            .map((value) => String(value)),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.details || `HTTP_${response.status}`)
      }

      setSuccess(
        `Staff profile saved · ${payload.defaultTaskCount ?? 0} default tasks · ${payload.linkedAccountCount ?? 0} linked accounts.`
      )
      setNewCanonicalId('')
      router.refresh()
    } catch (saveError: any) {
      setError(errorLabel(saveError?.message ?? 'STAFF_PAYROLL_PROFILE_SAVE_FAILED'))
    } finally {
      setPending(false)
    }
  }

  const isCreating = Boolean(
    selectedStaffUserId && !profileMap.has(selectedStaffUserId)
  )

  const defaultPrimaryRole =
    selectedProfile?.primary_role ??
    selectedAccount?.role ??
    'coach'

  const [primaryRoleDraft, setPrimaryRoleDraft] = React.useState(defaultPrimaryRole)

  React.useEffect(() => {
    setPrimaryRoleDraft(defaultPrimaryRole)
  }, [defaultPrimaryRole, selectedStaffUserId, selectedProfile?.updated_at])

  const candidateLinkedAccounts = accounts.filter((account) => {
    if (account.user_id === selectedStaffUserId) return false

    const owner = ownerByLinkedAccount.get(account.user_id)
    if (owner && owner !== selectedStaffUserId) return false

    if (
      profileMap.has(account.user_id) &&
      account.user_id !== selectedStaffUserId
    ) {
      return false
    }

    return true
  })

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-black/10 bg-white p-3">
            <div className="text-[11px] text-[hsl(var(--muted))]">Active staff</div>
            <div className="mt-1 text-xl font-bold">{activeCount}</div>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-3">
            <div className="text-[11px] text-[hsl(var(--muted))]">Linked accounts</div>
            <div className="mt-1 text-xl font-bold">{linkedCount}</div>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-3">
            <div className="text-[11px] text-[hsl(var(--muted))]">Default tasks</div>
            <div className="mt-1 text-xl font-bold">{configuredTaskCount}</div>
          </div>
        </section>

        <section className="rounded-3xl border border-black/10 bg-white p-4">
          <div className="font-semibold">Create staff profile</div>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">
            Choose the account that will be the single payroll identity. For a
            coach with an Admin account too, prefer the account used for
            coaching evidence / QR attendance as canonical.
          </p>

          <div className="mt-3 flex gap-2">
            <select
              value={newCanonicalId}
              onChange={(event) => setNewCanonicalId(event.target.value)}
              disabled={!canWrite}
              className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select unconfigured account…</option>
              {unconfiguredAccounts.map((account) => (
                <option key={account.user_id} value={account.user_id}>
                  {accountName(account)} · {roleLabel(account.role)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!canWrite || !newCanonicalId}
              onClick={beginNewProfile}
              className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-black/10 bg-white p-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search staff…"
            className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
          />

          <div className="mt-3 grid gap-2">
            {visibleProfiles.length ? (
              visibleProfiles.map((profile) => {
                const account = accountMap.get(profile.staff_user_id)
                const taskCount = defaultAssignments.filter(
                  (row) => row.user_id === profile.staff_user_id
                ).length
                const accountCount =
                  1 +
                  accountLinks.filter(
                    (link) => link.staff_user_id === profile.staff_user_id
                  ).length
                const selected =
                  selectedStaffUserId === profile.staff_user_id

                return (
                  <button
                    key={profile.staff_user_id}
                    type="button"
                    onClick={() => {
                      setSelectedStaffUserId(profile.staff_user_id)
                      setError(null)
                      setSuccess(null)
                    }}
                    className={
                      'rounded-2xl border p-3 text-left transition ' +
                      (selected
                        ? 'border-black bg-black text-white'
                        : 'border-black/10 bg-white hover:bg-black/[0.025]')
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {accountName(account)}
                        </div>
                        <div
                          className={
                            'mt-1 text-xs ' +
                            (selected
                              ? 'text-white/70'
                              : 'text-[hsl(var(--muted))]')
                          }
                        >
                          {roleLabel(profile.primary_role)}
                          {profile.secondary_roles.length
                            ? ` + ${profile.secondary_roles
                                .map(roleLabel)
                                .join(', ')}`
                            : ''}
                        </div>
                      </div>
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                          (profile.employment_status === 'active'
                            ? selected
                              ? 'bg-emerald-400/20 text-emerald-100'
                              : 'bg-emerald-50 text-emerald-800'
                            : selected
                              ? 'bg-white/10 text-white/70'
                              : 'bg-black/5 text-[hsl(var(--muted))]')
                        }
                      >
                        {profile.employment_status}
                      </span>
                    </div>
                    <div
                      className={
                        'mt-2 text-[11px] ' +
                        (selected
                          ? 'text-white/60'
                          : 'text-[hsl(var(--muted))]')
                      }
                    >
                      {taskCount} default tasks · {accountCount} account
                      {accountCount === 1 ? '' : 's'}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-black/10 p-5 text-center text-sm text-[hsl(var(--muted))]">
                No configured staff profile yet.
              </div>
            )}
          </div>
        </section>
      </div>

      <div>
        {!selectedStaffUserId ? (
          <section className="rounded-3xl border border-dashed border-black/10 bg-white p-10 text-center">
            <div className="font-semibold">Select or create a staff profile.</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">
              This becomes the employee&apos;s single payroll configuration.
            </div>
          </section>
        ) : (
          <form
            key={`${selectedStaffUserId}:${selectedProfile?.updated_at ?? 'new'}`}
            onSubmit={saveProfile}
            className="space-y-4"
          >
            <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                    {isCreating ? 'New payroll employee' : 'Payroll employee'}
                  </div>
                  <h2 className="mt-1 text-2xl font-bold">
                    {accountName(selectedAccount)}
                  </h2>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    Canonical account · {selectedAccount?.email || 'No email'} ·
                    App role {roleLabel(selectedAccount?.role)}
                  </div>
                </div>

                {!isCreating ? (
                  <Link
                    href={`/admin/staff-payroll/monthly-tasks?staff=${encodeURIComponent(
                      selectedStaffUserId
                    )}`}
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
                  >
                    Open Monthly Tasks
                  </Link>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
                This canonical account is the identity to use for compensation
                rates, manual tasks, bonuses/deductions and future salary
                calculations. Linked accounts are operational aliases, not
                separate salaries.
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium">
                  Primary role
                  <select
                    name="primary_role"
                    value={primaryRoleDraft}
                    onChange={(event) => setPrimaryRoleDraft(event.target.value)}
                    disabled={!canWrite}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2"
                  >
                    {ROLE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-medium">
                  Employment status
                  <select
                    name="employment_status"
                    defaultValue={
                      selectedProfile?.employment_status ?? 'active'
                    }
                    disabled={!canWrite}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>

                <label className="text-sm font-medium">
                  Start date
                  <input
                    type="date"
                    name="employment_start_date"
                    defaultValue={
                      selectedProfile?.employment_start_date ?? ''
                    }
                    disabled={!canWrite}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2"
                  />
                </label>

                <label className="text-sm font-medium">
                  End date
                  <input
                    type="date"
                    name="employment_end_date"
                    defaultValue={
                      selectedProfile?.employment_end_date ?? ''
                    }
                    disabled={!canWrite}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2"
                  />
                </label>
              </div>

              <div className="mt-4">
                <div className="text-sm font-medium">Secondary roles</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ROLE_OPTIONS.filter(
                    ([value]) => value !== primaryRoleDraft
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 rounded-xl border border-black/10 p-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="secondary_roles"
                        value={value}
                        defaultChecked={Boolean(
                          selectedProfile?.secondary_roles.includes(value)
                        )}
                        disabled={!canWrite}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="mt-4 block text-sm font-medium">
                Internal notes
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={2000}
                  defaultValue={selectedProfile?.notes ?? ''}
                  disabled={!canWrite}
                  placeholder="Responsibilities, payroll setup notes, employment context…"
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2"
                />
              </label>

              {!isCreating ? (
                <div className="mt-3 text-xs text-[hsl(var(--muted))]">
                  Employment start: {formatDate(selectedProfile?.employment_start_date ?? null)}
                  {' · '}
                  Last profile update: {selectedProfile?.updated_at
                    ? new Intl.DateTimeFormat('en-GB', {
                        timeZone: 'Africa/Cairo',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(selectedProfile.updated_at))
                    : '—'}
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
              <h3 className="text-lg font-bold">Linked ATOM accounts</h3>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">
                Link extra accounts that belong to the same employee. A linked
                account cannot receive new manual payroll tasks, compensation
                rates or adjustments; use the canonical account above.
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {candidateLinkedAccounts.length ? (
                  candidateLinkedAccounts.map((account) => (
                    <label
                      key={account.user_id}
                      className="flex items-start gap-2 rounded-xl border border-black/10 p-3"
                    >
                      <input
                        type="checkbox"
                        name="linked_user_ids"
                        value={account.user_id}
                        defaultChecked={selectedLinkedIds.has(account.user_id)}
                        disabled={!canWrite}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {accountName(account)}
                        </span>
                        <span className="block truncate text-xs text-[hsl(var(--muted))]">
                          {roleLabel(account.role)} · {account.email || 'No email'}
                        </span>
                      </span>
                    </label>
                  ))
                ) : (
                  <div className="sm:col-span-2 rounded-2xl border border-dashed border-black/10 p-5 text-center text-sm text-[hsl(var(--muted))]">
                    No other available staff account to link.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold">Default payroll tasks</h3>
                  <p className="mt-1 max-w-3xl text-xs text-[hsl(var(--muted))]">
                    These are the employee&apos;s normal responsibilities.
                    Monthly Tasks automatically marks them as Suggested when
                    this employee is selected. Actual hours are still entered
                    month by month, and extra tasks can always be added.
                  </p>
                </div>
                <div className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                  {selectedDefaultIds.size} currently assigned
                </div>
              </div>

              <input
                value={taskSearch}
                onChange={(event) => setTaskSearch(event.target.value)}
                placeholder="Search tasks or Areas…"
                className="mt-4 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
              />

              <div className="mt-4 grid gap-4">
                {areas
                  .filter((area) => area.is_active)
                  .map((area) => {
                    const areaTasks = filteredTasks.filter(
                      (task) => task.area_id === area.id
                    )
                    if (!areaTasks.length) return null

                    return (
                      <div key={area.id}>
                        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted))]">
                          {area.name}
                        </div>
                        <div className="grid gap-2 lg:grid-cols-2">
                          {areaTasks.map((task) => (
                            <label
                              key={task.id}
                              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 p-3"
                            >
                              <input
                                type="checkbox"
                                name="default_task_ids"
                                value={task.id}
                                defaultChecked={selectedDefaultIds.has(task.id)}
                                disabled={!canWrite}
                                className="mt-1"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold">
                                  {task.name}
                                </span>
                                <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
                                  {importanceLabel(task.importance_level)} ×
                                  {task.importance_multiplier.toLocaleString(
                                    'en-US',
                                    { maximumFractionDigits: 2 }
                                  )}
                                  {' · '}
                                  {task.unit}
                                  {task.frequency_label
                                    ? ` · ${task.frequency_label}`
                                    : ''}
                                  {task.estimated_time_label
                                    ? ` · ${task.estimated_time_label}`
                                    : ''}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </section>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                {success}
              </div>
            ) : null}

            {canWrite ? (
              <div className="sticky bottom-3 flex justify-end">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
                >
                  {pending ? 'Saving staff profile…' : 'Save staff profile'}
                </button>
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  )
}
