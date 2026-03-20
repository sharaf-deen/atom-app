export const APP_ROLES = ['member', 'assistant_coach', 'coach', 'reception', 'admin', 'super_admin'] as const
export type Role = (typeof APP_ROLES)[number]

export const STAFF_ROLES = ['reception', 'assistant_coach', 'coach', 'admin', 'super_admin'] as const satisfies readonly Role[]
export const FRONT_DESK_ROLES = ['reception', 'admin', 'super_admin'] as const satisfies readonly Role[]
export const ADMIN_ROLES = ['admin', 'super_admin'] as const satisfies readonly Role[]
export const SUPER_ADMIN_ROLES = ['super_admin'] as const satisfies readonly Role[]
export const COACH_ROLES = ['coach', 'assistant_coach'] as const satisfies readonly Role[]

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

const APP_NAV_BY_ROLE: MenuByRole = {
  member: [
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Contact Admin', href: '/contact', icon: 'user-cog' },
  ],
  assistant_coach: [
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  coach: [
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  reception: [
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Store', href: '/store', icon: 'bag' },
  ],
  admin: [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'Attendance', href: '/admin/attendance', icon: 'calendar' },
    { label: 'Scan Audit', href: '/admin/scan-audit', icon: 'file-text' },
    { label: 'Health Monitor', href: '/admin/health-monitor', icon: 'file-text' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'Coaches', href: '/coaches', icon: 'user-cog' },
    { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Invoices', href: '/invoices', icon: 'file-text' },
    { label: 'Payments', href: '/admin/payments', icon: 'file-text' },
    { label: 'Cash Report', href: '/admin/cash-report', icon: 'wallet' },
    { label: 'Outstanding Dues', href: '/admin/outstanding-dues', icon: 'wallet' },
    { label: 'Membership Activity', href: '/admin/membership-activity', icon: 'file-text' },
    { label: 'Expiring Soon', href: '/admin/expiring-soon', icon: 'bell' },
    { label: 'Expenses', href: '/expenses', icon: 'wallet' },
  ],
  super_admin: [
    { label: 'Home', href: '/', icon: 'home' },
    { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Schedule', href: '/schedule', icon: 'calendar' },
    { label: 'Attendance', href: '/admin/attendance', icon: 'calendar' },
    { label: 'Scan Audit', href: '/admin/scan-audit', icon: 'file-text' },
    { label: 'Health Monitor', href: '/admin/health-monitor', icon: 'file-text' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
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

export function canAccessAdminDashboard(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessMembersList(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function canOpenOtherMemberProfile(role: Role | null | undefined) {
  return canAccessMembersList(role) || role === 'coach'
}

export function canAccessMemberProfile(
  role: Role | null | undefined,
  args: { viewerUserId: string | null | undefined; targetUserId: string | null | undefined; targetRole?: Role | null | undefined },
) {
  if (!role) return false
  const isSelf = !!args.viewerUserId && !!args.targetUserId && args.viewerUserId === args.targetUserId
  if (isSelf) return true
  if (canAccessMembersList(role)) return true
  if (role === 'coach') return normalizeRole(args.targetRole ?? 'member') === 'member'
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

export function canAccessCoaches(role: Role | null | undefined) {
  return hasAnyRole(role, ADMIN_ROLES)
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
  return hasAnyRole(role, ADMIN_ROLES)
}

export function canAccessInvoices(role: Role | null | undefined) {
  return hasAnyRole(role, FRONT_DESK_ROLES)
}

export function allowedRolesLabel(roles: readonly Role[]) {
  return roles.join(', ')
}

export function roleLabel(role: Role | null | undefined) {
  switch (role) {
    case 'assistant_coach':
      return 'Assistant coach'
    case 'coach':
      return 'Coach'
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
