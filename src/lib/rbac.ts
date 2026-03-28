export const APP_ROLES = ['member', 'champion', 'vip', 'assistant_coach', 'coach', 'head_coach', 'reception', 'admin', 'super_admin'] as const
export type Role = (typeof APP_ROLES)[number]

export const MEMBER_LIKE_ROLES = ['member', 'champion', 'vip'] as const satisfies readonly Role[]
export const MEMBER_LIFETIME_ACCESS_ROLES = ['champion', 'vip'] as const satisfies readonly Role[]
export const STAFF_ROLES = ['reception', 'assistant_coach', 'coach', 'head_coach', 'admin', 'super_admin'] as const satisfies readonly Role[]
export const FRONT_DESK_ROLES = ['reception', 'admin', 'super_admin'] as const satisfies readonly Role[]
export const ADMIN_ROLES = ['admin', 'super_admin'] as const satisfies readonly Role[]
export const SUPER_ADMIN_ROLES = ['super_admin'] as const satisfies readonly Role[]
export const COACH_ROLES = ['coach', 'assistant_coach', 'head_coach'] as const satisfies readonly Role[]
export const LIFETIME_ACCESS_ROLES = ['assistant_coach', 'coach', 'head_coach', 'champion', 'vip'] as const satisfies readonly Role[]
export const NOTIFICATION_MANAGER_ROLES = ['head_coach', 'admin', 'super_admin'] as const satisfies readonly Role[]
export const NOTIFICATION_RECIPIENT_ROLES = ['member', 'champion', 'vip', 'assistant_coach', 'coach', 'head_coach'] as const satisfies readonly Role[]

export type NavIconKey =
  | 'home'
  | 'dashboard'
  | 'bell'
  | 'gift'
  | 'id'
  | 'scan'
  | 'users'
  | 'user-cog'
  | 'bag'
  | 'wallet'
  | 'calendar'
  | 'file-text'

export type NavMenuItem = { label: string; href: string; icon: NavIconKey }

type MenuByRole = Record<Role, NavMenuItem[]>

type CapabilityBlueprint = {
  key: string
  category: 'Core' | 'Front desk' | 'Finance' | 'Admin ops' | 'Store' | 'Comms'
  label: string
  description: string
  href?: string
  check: (role: Role) => boolean
}

export type PermissionAuditCapability = Omit<CapabilityBlueprint, 'check'> & {
  allowedRoles: Role[]
}

const APP_NAV_BY_ROLE: MenuByRole = {
  member: [
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Contact Admin', href: '/contact', icon: 'user-cog' },
  ],
  champion: [
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Contact Admin', href: '/contact', icon: 'user-cog' },
  ],
  vip: [
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Contact Admin', href: '/contact', icon: 'user-cog' },
  ],
  assistant_coach: [
    { label: 'Training Useful', href: '/training-useful', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  coach: [
    { label: 'Training Useful', href: '/training-useful', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  head_coach: [
    { label: 'Training Useful', href: '/training-useful', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  reception: [
    { label: 'Front Desk', href: '/reception', icon: 'dashboard' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'CRM', href: '/admin/crm', icon: 'users' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Store', href: '/store', icon: 'bag' },
  ],
  admin: [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
    { label: 'Front Desk', href: '/reception', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'Attendance', href: '/admin/attendance', icon: 'calendar' },
    { label: 'Scan Audit', href: '/admin/scan-audit', icon: 'file-text' },
    { label: 'Health Monitor', href: '/admin/health-monitor', icon: 'file-text' },
    { label: 'Permissions Audit', href: '/admin/permissions-audit', icon: 'file-text' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'CRM', href: '/admin/crm', icon: 'users' },
    { label: 'Coaches', href: '/coaches', icon: 'user-cog' },
    { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Invoices', href: '/invoices', icon: 'file-text' },
    { label: 'Payments', href: '/admin/payments', icon: 'file-text' },
    { label: 'Cash Report', href: '/admin/cash-report', icon: 'wallet' },
    { label: 'Outstanding Dues', href: '/admin/outstanding-dues', icon: 'wallet' },
    { label: 'Membership Activity', href: '/admin/membership-activity', icon: 'file-text' },
    { label: 'Expiring Soon', href: '/admin/expiring-soon', icon: 'bell' },
    { label: 'Expenses', href: '/expenses', icon: 'wallet' },
    { label: 'Other Income', href: '/admin/external-income', icon: 'wallet' },
  ],
  super_admin: [
    { label: 'Home', href: '/', icon: 'home' },
    { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
    { label: 'Front Desk', href: '/reception', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'Attendance', href: '/admin/attendance', icon: 'calendar' },
    { label: 'Scan Audit', href: '/admin/scan-audit', icon: 'file-text' },
    { label: 'Health Monitor', href: '/admin/health-monitor', icon: 'file-text' },
    { label: 'Permissions Audit', href: '/admin/permissions-audit', icon: 'file-text' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'CRM', href: '/admin/crm', icon: 'users' },
    { label: 'Coaches', href: '/coaches', icon: 'user-cog' },
    { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Store Admin', href: '/admin/store', icon: 'bag' },
    { label: 'Invoices', href: '/invoices', icon: 'file-text' },
    { label: 'Payments', href: '/admin/payments', icon: 'file-text' },
    { label: 'Cash Report', href: '/admin/cash-report', icon: 'wallet' },
    { label: 'Outstanding Dues', href: '/admin/outstanding-dues', icon: 'wallet' },
    { label: 'Membership Activity', href: '/admin/membership-activity', icon: 'file-text' },
    { label: 'Expiring Soon', href: '/admin/expiring-soon', icon: 'bell' },
    { label: 'Expenses', href: '/expenses', icon: 'wallet' },
    { label: 'Other Income', href: '/admin/external-income', icon: 'wallet' },
  ],
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)
}

export function normalizeRole(value: unknown): Role {
  return isRole(value) ? value : 'member'
}

export function hasAnyRole(role: Role | null | undefined, allowed: readonly Role[]) {
  return !!role && allowed.includes(role)
}

export function isMemberLikeRole(role: Role | null | undefined) {
  return hasAnyRole(role, MEMBER_LIKE_ROLES)
}

export function hasLifetimeGymAccess(role: Role | null | undefined) {
  return hasAnyRole(role, LIFETIME_ACCESS_ROLES)
}

export function hasVisibleNotificationInbox(role: Role | null | undefined) {
  return hasAnyRole(role, NOTIFICATION_RECIPIENT_ROLES)
}

export function canAccessAdminDashboard(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessMembersList(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function canOpenOtherMemberProfile(role: Role | null | undefined) {
  return canAccessMembersList(role) || role === 'coach' || role === 'head_coach'
}

export function canAccessCrm(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function canAccessReceptionDesk(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function canAccessMemberProfile(
  role: Role | null | undefined,
  args: { viewerUserId: string | null | undefined; targetUserId: string | null | undefined; targetRole?: Role | null | undefined },
) {
  if (!role) return false
  const isSelf = !!args.viewerUserId && !!args.targetUserId && args.viewerUserId === args.targetUserId
  if (isSelf) return true
  if (canAccessMembersList(role)) return true

  const normalizedTargetRole = normalizeRole(args.targetRole ?? 'member')

  if (role === 'coach') return isMemberLikeRole(normalizedTargetRole)
  if (role === 'head_coach') {
    return normalizedTargetRole === 'member'
      || normalizedTargetRole === 'champion'
      || normalizedTargetRole === 'vip'
      || normalizedTargetRole === 'assistant_coach'
      || normalizedTargetRole === 'coach'
  }

  return false
}

export function canManageSubscriptions(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canCreateSubscription(role: Role | null | undefined) {
  return canAccessMembersList(role)
}

export function canResendInvite(role: Role | null | undefined) {
  return canAccessMembersList(role)
}

export function canManageRoles(role: Role | null | undefined) {
  return hasAnyRole(role, SUPER_ADMIN_ROLES)
}

export function canDeleteUser(role: Role | null | undefined, args?: { isSelf?: boolean }) {
  return hasAnyRole(role, SUPER_ADMIN_ROLES) && !args?.isSelf
}

export function canAccessScan(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function canAccessKiosk(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function canAccessScanAudit(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessHealthMonitor(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessPermissionsAudit(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessPayments(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessCashReport(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessExpenses(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessPersonalFunds(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessExternalIncome(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessCoaches(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessTrainingUseful(role: Role | null | undefined) {
  return hasAnyRole(role, ['coach', 'assistant_coach', 'head_coach', 'admin', 'super_admin'])
}

export function canManageCoaches(role: Role | null | undefined) {
  return hasAnyRole(role, SUPER_ADMIN_ROLES)
}

export function canAccessStore(role: Role | null | undefined) {
  return hasAnyRole(role, ['reception', 'admin', 'super_admin'])
}

export function canAccessStoreAdmin(role: Role | null | undefined) {
  return hasAnyRole(role, SUPER_ADMIN_ROLES)
}

export function canAccessNotifications(role: Role | null | undefined) {
  return !!role && role !== 'reception'
}

export function canManageNotifications(role: Role | null | undefined) {
  return hasAnyRole(role, NOTIFICATION_MANAGER_ROLES)
}

export function canAccessInvoices(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

const CAPABILITY_BLUEPRINTS: CapabilityBlueprint[] = [
  {
    key: 'admin_dashboard',
    category: 'Admin ops',
    label: 'Admin dashboard',
    description: 'Open the main admin dashboard and quick actions.',
    href: '/admin',
    check: (role) => canAccessAdminDashboard(role),
  },
  {
    key: 'permissions_audit',
    category: 'Admin ops',
    label: 'Permissions audit',
    description: 'Review the internal role matrix and capability audit page.',
    href: '/admin/permissions-audit',
    check: (role) => canAccessPermissionsAudit(role),
  },
  {
    key: 'members_list',
    category: 'Front desk',
    label: 'Members list',
    description: 'Open members search and desk operations list.',
    href: '/members',
    check: (role) => canAccessMembersList(role),
  },
  {
    key: 'front_desk_center',
    category: 'Front desk',
    label: 'Front desk center',
    description: 'Open the reception command center with scan, renewals, dues and contact queue.',
    href: '/reception',
    check: (role) => canAccessReceptionDesk(role),
  },
  {
    key: 'crm_queue',
    category: 'Front desk',
    label: 'CRM follow-up queue',
    description: 'Review who should be contacted today and open desk follow-up actions.',
    href: '/admin/crm',
    check: (role) => canAccessCrm(role),
  },
  {
    key: 'other_member_profile',
    category: 'Front desk',
    label: 'Other member profile',
    description: 'Open someone else’s member detail page.',
    href: '/members/[id]',
    check: (role) => canOpenOtherMemberProfile(role),
  },
  {
    key: 'scan',
    category: 'Front desk',
    label: 'Scan',
    description: 'Run front-desk scan flow.',
    href: '/scan',
    check: (role) => canAccessScan(role),
  },
  {
    key: 'kiosk',
    category: 'Front desk',
    label: 'Membership kiosk',
    description: 'Access kiosk / membership desk tools.',
    href: '/kiosk',
    check: (role) => canAccessKiosk(role),
  },
  {
    key: 'subscriptions_manage',
    category: 'Front desk',
    label: 'Manage subscriptions',
    description: 'Create or update subscription records in admin flows.',
    href: '/members/[id]',
    check: (role) => canManageSubscriptions(role),
  },
  {
    key: 'subscriptions_create',
    category: 'Front desk',
    label: 'Create subscriptions',
    description: 'Create subscription entries from front desk flows.',
    href: '/kiosk',
    check: (role) => canCreateSubscription(role),
  },
  {
    key: 'resend_invite',
    category: 'Front desk',
    label: 'Resend invite',
    description: 'Resend onboarding / invite email to a member.',
    href: '/members/[id]',
    check: (role) => canResendInvite(role),
  },
  {
    key: 'payments',
    category: 'Finance',
    label: 'Payments',
    description: 'Open admin payments list and exports.',
    href: '/admin/payments',
    check: (role) => canAccessPayments(role),
  },
  {
    key: 'cash_report',
    category: 'Finance',
    label: 'Cash report',
    description: 'Open cash report totals, filters, and exports.',
    href: '/admin/cash-report',
    check: (role) => canAccessCashReport(role),
  },
  {
    key: 'expenses',
    category: 'Finance',
    label: 'Expenses',
    description: 'Open expense list, receipts, and exports.',
    href: '/expenses',
    check: (role) => canAccessExpenses(role),
  },
  {
    key: 'personal_funds',
    category: 'Finance',
    label: 'Personal Funds',
    description: 'Track advances, reimbursements, and personal-fund proofs.',
    href: '/admin/personal-funds',
    check: (role) => canAccessPersonalFunds(role),
  },
  {
    key: 'external_income',
    category: 'Finance',
    label: 'Other Income',
    description: 'Track money entries outside subscriptions such as bar or store sales.',
    href: '/admin/external-income',
    check: (role) => canAccessExternalIncome(role),
  },
  {
    key: 'scan_audit',
    category: 'Admin ops',
    label: 'Scan Audit',
    description: 'Review scan logs and attendance scan diagnostics.',
    href: '/admin/scan-audit',
    check: (role) => canAccessScanAudit(role),
  },
  {
    key: 'health_monitor',
    category: 'Admin ops',
    label: 'Health Monitor',
    description: 'Run and review daily health checks and report history.',
    href: '/admin/health-monitor',
    check: (role) => canAccessHealthMonitor(role),
  },
  {
    key: 'coaches',
    category: 'Admin ops',
    label: 'Coaches',
    description: 'Open coaches admin area and listing.',
    href: '/coaches',
    check: (role) => canAccessCoaches(role),
  },
  {
    key: 'coaches_manage',
    category: 'Admin ops',
    label: 'Manage coaches',
    description: 'Perform coach management actions reserved for super admins.',
    href: '/coaches',
    check: (role) => canManageCoaches(role),
  },
  {
    key: 'training_useful',
    category: 'Core',
    label: 'Training useful hub',
    description: 'Open the coach-facing hub with QR, schedule, staff updates and member lookup shortcuts.',
    href: '/training-useful',
    check: (role) => canAccessTrainingUseful(role),
  },
  {
    key: 'roles_manage',
    category: 'Admin ops',
    label: 'Manage roles',
    description: 'Change user roles through protected admin APIs.',
    href: '/members/[id]',
    check: (role) => canManageRoles(role),
  },
  {
    key: 'users_delete',
    category: 'Admin ops',
    label: 'Delete users',
    description: 'Delete users and orphan profiles through protected admin APIs.',
    href: '/members/[id]',
    check: (role) => canDeleteUser(role),
  },
  {
    key: 'notifications_read',
    category: 'Comms',
    label: 'Notifications',
    description: 'Open notifications center.',
    href: '/notifications',
    check: (role) => canAccessNotifications(role),
  },
  {
    key: 'notifications_manage',
    category: 'Comms',
    label: 'Manage notifications',
    description: 'Run admin notification actions and protected notification APIs.',
    href: '/notifications',
    check: (role) => canManageNotifications(role),
  },
  {
    key: 'invoices',
    category: 'Finance',
    label: 'Invoices',
    description: 'Open invoice-related pages and desk invoice flows.',
    href: '/invoices',
    check: (role) => canAccessInvoices(role),
  },
  {
    key: 'store',
    category: 'Store',
    label: 'Store',
    description: 'Open the store page for reception/admin roles only.',
    href: '/store',
    check: (role) => canAccessStore(role),
  },
  {
    key: 'store_admin',
    category: 'Store',
    label: 'Store admin',
    description: 'Open store admin controls reserved for super admin.',
    href: '/admin/store',
    check: (role) => canAccessStoreAdmin(role),
  },
]

export function getPermissionAuditCapabilities(): PermissionAuditCapability[] {
  return CAPABILITY_BLUEPRINTS.map(({ check, ...rest }) => ({
    ...rest,
    allowedRoles: APP_ROLES.filter((role) => check(role)),
  }))
}

export function getCapabilityCountForRole(role: Role) {
  return getPermissionAuditCapabilities().filter((cap) => cap.allowedRoles.includes(role)).length
}

export function allowedRolesLabel(roles: readonly Role[]) {
  return roles.join(', ')
}

export function roleLabel(role: Role | null | undefined) {
  switch (role) {
    case 'champion':
      return 'Champion'
    case 'vip':
      return 'VIP'
    case 'assistant_coach':
      return 'Assistant coach'
    case 'coach':
      return 'Coach'
    case 'head_coach':
      return 'Head coach'
    case 'reception':
      return 'Reception'
    case 'admin':
      return 'Admin'
    case 'super_admin':
      return 'Super admin'
    default:
      return 'Member'
  }
}

export function getAppNavForRole(role: Role): NavMenuItem[] {
  return APP_NAV_BY_ROLE[role] ?? []
}
