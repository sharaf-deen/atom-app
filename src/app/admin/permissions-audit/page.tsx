export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import Forbidden from '@/components/Forbidden'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { getSessionUser } from '@/lib/session'
import {
  APP_ROLES,
  canAccessPermissionsAudit,
  getCapabilityCountForRole,
  getPermissionAuditCapabilities,
  roleLabel,
  type PermissionAuditCapability,
  type Role,
} from '@/lib/rbac'

function yesNoBadge(allowed: boolean) {
  return (
    <Badge className={allowed ? 'bg-black text-white border-black' : 'bg-transparent text-[hsl(var(--muted))]'}>
      {allowed ? 'Yes' : 'No'}
    </Badge>
  )
}

function roleBadge(role: Role, currentRole: Role) {
  return (
    <Badge className={role === currentRole ? 'bg-black text-white border-black' : ''}>
      {roleLabel(role)}
      {role === currentRole ? ' · You' : ''}
    </Badge>
  )
}

function summaryHint(capabilities: PermissionAuditCapability[], role: Role) {
  const finance = capabilities.filter((cap) => cap.category === 'Finance' && cap.allowedRoles.includes(role)).length
  const adminOps = capabilities.filter((cap) => cap.category === 'Admin ops' && cap.allowedRoles.includes(role)).length
  const frontDesk = capabilities.filter((cap) => cap.category === 'Front desk' && cap.allowedRoles.includes(role)).length
  const top = [
    finance ? `${finance} finance` : null,
    adminOps ? `${adminOps} admin ops` : null,
    frontDesk ? `${frontDesk} front desk` : null,
  ].filter(Boolean)

  return top.length ? top.join(' · ') : 'No protected capabilities'
}

export default async function PermissionsAuditPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/permissions-audit')

  if (!canAccessPermissionsAudit(me.role)) {
    return (
      <Forbidden
        pageTitle="Permissions Audit"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Admin / Super Admin can review the internal permissions audit."
        allowed="admin, super_admin"
        nextPath="/admin/permissions-audit"
        actions={[{ href: '/admin', label: 'Back to Admin' }, { href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const capabilities = getPermissionAuditCapabilities()
  const currentRole = me.role
  const summaryRows = APP_ROLES.map((role) => ({
    key: role,
    role: roleBadge(role, currentRole),
    protected: getCapabilityCountForRole(role),
    hint: summaryHint(capabilities, role),
  }))

  const capabilityRows = capabilities.map((cap) => ({
    key: cap.key,
    capability: (
      <div className="space-y-1 min-w-0">
        <div className="font-medium truncate">{cap.label}</div>
        <div className="text-xs text-[hsl(var(--muted))] whitespace-normal break-words">{cap.description}</div>
      </div>
    ),
    category: <Badge>{cap.category}</Badge>,
    member: yesNoBadge(cap.allowedRoles.includes('member')),
    champion: yesNoBadge(cap.allowedRoles.includes('champion')),
    vip: yesNoBadge(cap.allowedRoles.includes('vip')),
    assistant_coach: yesNoBadge(cap.allowedRoles.includes('assistant_coach')),
    coach: yesNoBadge(cap.allowedRoles.includes('coach')),
    head_coach: yesNoBadge(cap.allowedRoles.includes('head_coach')),
    reception: yesNoBadge(cap.allowedRoles.includes('reception')),
    admin: yesNoBadge(cap.allowedRoles.includes('admin')),
    super_admin: yesNoBadge(cap.allowedRoles.includes('super_admin')),
    route: cap.href ? (
      <Link href={cap.href} className="underline underline-offset-2">
        {cap.href}
      </Link>
    ) : (
      <span className="text-[hsl(var(--muted))]">—</span>
    ),
  }))

  const totalCapabilities = capabilities.length
  const adminOnly = capabilities.filter(
    (cap) => cap.allowedRoles.includes('admin') && !cap.allowedRoles.includes('reception') && !cap.allowedRoles.includes('head_coach') && !cap.allowedRoles.includes('coach') && !cap.allowedRoles.includes('assistant_coach') && !cap.allowedRoles.includes('vip') && !cap.allowedRoles.includes('champion') && !cap.allowedRoles.includes('member'),
  ).length
  const superAdminOnly = capabilities.filter(
    (cap) => cap.allowedRoles.length === 1 && cap.allowedRoles[0] === 'super_admin',
  ).length

  return (
    <main>
      <PageHeader
        title="Permissions Audit"
        subtitle="Who can access what — internal role matrix for protected pages and APIs."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" href="/admin">
              Back to Admin
            </Button>
          </div>
        }
      />

      <Section className="space-y-4">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Protected capabilities</div>
              <div className="mt-1 text-2xl font-semibold">{totalCapabilities}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Pages / actions currently tracked by RBAC</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Current role</div>
              <div className="mt-2">{roleBadge(currentRole, currentRole)}</div>
              <div className="mt-2 text-xs text-[hsl(var(--muted))]">Signed in as {me.email || 'current user'}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Admin-only items</div>
              <div className="mt-1 text-2xl font-semibold">{adminOnly}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Accessible to Admin / Super Admin, not front desk or coaches</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Super admin only</div>
              <div className="mt-1 text-2xl font-semibold">{superAdminOnly}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Reserved for governance actions such as role change and delete user</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm font-medium">How to read this page</div>
              <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                This audit is the current RBAC source of truth used by nav, page guards, and key protected APIs. “Yes” means the role is allowed. “No” means the role should be blocked.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {APP_ROLES.map((role) => (
                <span key={role}>{roleBadge(role, currentRole)}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Role summary</h2>
          <div className="text-xs text-[hsl(var(--muted))]">Quick count of protected capabilities by role</div>
        </div>
        <Table
          columns={[
            { key: 'role', header: 'Role' },
            { key: 'protected', header: 'Protected items', thClassName: 'w-28', tdClassName: 'font-semibold' },
            { key: 'hint', header: 'Focus' },
          ]}
          rows={summaryRows}
          keyField="key"
          stickyTopClassName="top-0"
        />
      </Section>

      <Section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Capability matrix</h2>
          <div className="text-xs text-[hsl(var(--muted))]">Desktop/tablet uses sticky headers with the safe top offset fix.</div>
        </div>
        <Table
          columns={[
            { key: 'capability', header: 'Capability', tdClassName: 'whitespace-normal' },
            { key: 'category', header: 'Area', thClassName: 'w-24' },
            { key: 'member', header: 'Member', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'champion', header: 'Champion', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'vip', header: 'VIP', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'assistant_coach', header: 'Assistant', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'coach', header: 'Coach', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'head_coach', header: 'Head coach', thClassName: 'w-24', tdClassName: 'text-center' },
            { key: 'reception', header: 'Reception', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'admin', header: 'Admin', thClassName: 'w-20', tdClassName: 'text-center' },
            { key: 'super_admin', header: 'Super admin', thClassName: 'w-24', tdClassName: 'text-center' },
            { key: 'route', header: 'Route / scope', tdClassName: 'whitespace-normal' },
          ]}
          rows={capabilityRows}
          keyField="key"
          stickyTopClassName="top-0"
        />
      </Section>
    </main>
  )
}
