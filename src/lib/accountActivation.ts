import type { Role } from '@/lib/rbac'

export type AccountActivationStatus = 'active' | 'invite_pending' | 'no_account' | 'auth_issue'
export type AccountActivationTone = 'success' | 'warning' | 'neutral' | 'danger'
export type AccountActivationAgeFilter = '' | 'pending_3_plus' | 'pending_7_plus' | 'pending_30_plus' | 'no_invite_age'
export type AccountActivationSort =
  | 'priority'
  | 'member_az'
  | 'member_za'
  | 'invite_oldest'
  | 'invite_newest'
  | 'sign_in_recent'

export type AccountActivationProfile = {
  user_id: string | null
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  role: Role | null
  created_at: string | null
}

export type AccountActivationAuthUser = {
  id?: string | null
  email?: string | null
  invited_at?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  last_sign_in_at?: string | null
} | null

export type AccountActivationRow = AccountActivationProfile & {
  account_status: AccountActivationStatus
  invited_at: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  invite_age_days: number | null
}

function normalizeEmail(value?: string | null) {
  return String(value ?? '').trim().toLowerCase()
}

function timeValue(value?: string | null) {
  if (!value) return null
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : null
}

export function accountActivationLabel(status: AccountActivationStatus) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'invite_pending':
      return 'Invite pending'
    case 'no_account':
      return 'No account'
    case 'auth_issue':
      return 'Auth issue'
    default:
      return 'Unknown'
  }
}

export function accountActivationTone(status: AccountActivationStatus): AccountActivationTone {
  switch (status) {
    case 'active':
      return 'success'
    case 'invite_pending':
      return 'warning'
    case 'no_account':
      return 'neutral'
    case 'auth_issue':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function accountActivationDescription(status: AccountActivationStatus) {
  switch (status) {
    case 'active':
      return 'The member already activated the app account.'
    case 'invite_pending':
      return 'The invite was sent, but the member has not opened the email and finished account setup yet.'
    case 'no_account':
      return 'No usable app account was found for this member yet.'
    case 'auth_issue':
      return 'The member profile and auth account look inconsistent. Review this member from admin.'
    default:
      return 'Unknown account status.'
  }
}

export function accountActivationSortValue(status: AccountActivationStatus) {
  switch (status) {
    case 'invite_pending':
      return 0
    case 'auth_issue':
      return 1
    case 'no_account':
      return 2
    case 'active':
      return 3
    default:
      return 9
  }
}

export function accountActivationAgeFilterLabel(filter: AccountActivationAgeFilter) {
  switch (filter) {
    case 'pending_3_plus':
      return 'Pending 3+ days'
    case 'pending_7_plus':
      return 'Pending 7+ days'
    case 'pending_30_plus':
      return 'Pending 30+ days'
    case 'no_invite_age':
      return 'No invite age'
    default:
      return 'All invite ages'
  }
}

export function accountActivationSortLabel(sort: AccountActivationSort) {
  switch (sort) {
    case 'member_az':
      return 'Member A → Z'
    case 'member_za':
      return 'Member Z → A'
    case 'invite_oldest':
      return 'Oldest invite first'
    case 'invite_newest':
      return 'Newest invite first'
    case 'sign_in_recent':
      return 'Recent sign-in first'
    case 'priority':
    default:
      return 'Priority'
  }
}

export function accountActivationFullName(row: Pick<AccountActivationRow, 'first_name' | 'last_name' | 'email'>) {
  const name = [row.first_name ?? '', row.last_name ?? ''].join(' ').trim()
  return name || row.email || 'Unknown member'
}

export function deriveAccountActivationStatus(args: {
  profileUserId?: string | null
  profileEmail?: string | null
  authUser?: AccountActivationAuthUser
}): AccountActivationStatus {
  const profileUserId = String(args.profileUserId ?? '').trim()
  const profileEmail = normalizeEmail(args.profileEmail)
  const authUser = args.authUser ?? null
  const authEmail = normalizeEmail(authUser?.email)
  const invitedAt = authUser?.invited_at ?? null
  const confirmedAt = authUser?.email_confirmed_at ?? authUser?.confirmed_at ?? null
  const lastSignInAt = authUser?.last_sign_in_at ?? null

  if (!profileUserId) return 'auth_issue'

  if (!profileEmail && !authEmail) return 'no_account'

  if (!authUser) return 'no_account'

  if (profileEmail && authEmail && profileEmail !== authEmail) return 'auth_issue'

  if (lastSignInAt || confirmedAt) return 'active'

  if (invitedAt) return 'invite_pending'

  return 'auth_issue'
}

export function statusCount(rows: AccountActivationRow[], status: AccountActivationStatus) {
  return rows.filter((row) => row.account_status === status).length
}

export function countPendingAged(rows: AccountActivationRow[], minDays: number) {
  return rows.filter(
    (row) => row.account_status === 'invite_pending' && Number(row.invite_age_days ?? -1) >= minDays,
  ).length
}

export function matchesAccountActivationSearch(row: AccountActivationRow, q: string) {
  if (!q) return true
  const hay = [
    row.member_id ?? '',
    row.email ?? '',
    row.first_name ?? '',
    row.last_name ?? '',
    row.role ?? '',
    accountActivationLabel(row.account_status),
  ]
    .join(' ')
    .toLowerCase()

  return hay.includes(q.trim().toLowerCase())
}

export function matchesAccountActivationAgeFilter(
  row: AccountActivationRow,
  filter: AccountActivationAgeFilter,
) {
  if (!filter) return true

  if (filter === 'no_invite_age') {
    return row.invite_age_days === null || row.invited_at === null
  }

  if (row.account_status !== 'invite_pending') return false

  const age = row.invite_age_days ?? -1
  if (filter === 'pending_3_plus') return age >= 3
  if (filter === 'pending_7_plus') return age >= 7
  if (filter === 'pending_30_plus') return age >= 30
  return true
}

export function filterAccountActivationRows(
  rows: AccountActivationRow[],
  args: { q?: string; status?: string; age?: AccountActivationAgeFilter },
) {
  const q = String(args.q ?? '').trim().toLowerCase()
  const status = String(args.status ?? '').trim() as '' | AccountActivationStatus
  const age = (args.age ?? '') as AccountActivationAgeFilter

  return rows
    .filter((row) => (status ? row.account_status === status : true))
    .filter((row) => matchesAccountActivationSearch(row, q))
    .filter((row) => matchesAccountActivationAgeFilter(row, age))
}

export function sortAccountActivationRows(rows: AccountActivationRow[], sort: AccountActivationSort) {
  const out = [...rows]

  out.sort((a, b) => {
    if (sort === 'member_az') {
      return accountActivationFullName(a).localeCompare(accountActivationFullName(b))
    }

    if (sort === 'member_za') {
      return accountActivationFullName(b).localeCompare(accountActivationFullName(a))
    }

    if (sort === 'invite_oldest') {
      const aAge = a.invite_age_days ?? -1
      const bAge = b.invite_age_days ?? -1
      if (aAge !== bAge) return bAge - aAge
      return accountActivationFullName(a).localeCompare(accountActivationFullName(b))
    }

    if (sort === 'invite_newest') {
      const aTs = timeValue(a.invited_at) ?? -1
      const bTs = timeValue(b.invited_at) ?? -1
      if (aTs !== bTs) return bTs - aTs
      return accountActivationFullName(a).localeCompare(accountActivationFullName(b))
    }

    if (sort === 'sign_in_recent') {
      const aTs = timeValue(a.last_sign_in_at) ?? -1
      const bTs = timeValue(b.last_sign_in_at) ?? -1
      if (aTs !== bTs) return bTs - aTs
      return accountActivationFullName(a).localeCompare(accountActivationFullName(b))
    }

    const byStatus = accountActivationSortValue(a.account_status) - accountActivationSortValue(b.account_status)
    if (byStatus !== 0) return byStatus
    const byAge = (b.invite_age_days ?? -1) - (a.invite_age_days ?? -1)
    if (byAge !== 0) return byAge
    return accountActivationFullName(a).localeCompare(accountActivationFullName(b))
  })

  return out
}

function csvEscape(v: unknown): string {
  const s = (v ?? '').toString()
  const escaped = s.replace(/"/g, '""')
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`
  return escaped
}

export function accountActivationRowsToCsv(rows: AccountActivationRow[]) {
  const header = [
    'member_id',
    'first_name',
    'last_name',
    'full_name',
    'email',
    'role',
    'account_status',
    'invited_at',
    'email_confirmed_at',
    'last_sign_in_at',
    'invite_age_days',
  ]

  const lines = [header.map(csvEscape).join(',')]

  for (const row of rows) {
    lines.push(
      [
        row.member_id ?? '',
        row.first_name ?? '',
        row.last_name ?? '',
        accountActivationFullName(row),
        row.email ?? '',
        row.role ?? '',
        accountActivationLabel(row.account_status),
        row.invited_at ?? '',
        row.email_confirmed_at ?? '',
        row.last_sign_in_at ?? '',
        row.invite_age_days ?? '',
      ]
        .map(csvEscape)
        .join(',')
    )
  }

  return lines.join('\n')
}
