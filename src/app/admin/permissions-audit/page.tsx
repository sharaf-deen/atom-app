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
        message="Only Super Admin can review the internal permissions audit."
        allowed="super_admin"
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
  const adminAccess = capabilities.filter((cap) => cap.allowedRoles.includes('admin')).length
  const superAdminOnlyCapabilities = capabilities.filter(
    (cap) => cap.allowedRoles.length === 1 && cap.allowedRoles[0] === 'super_admin',
  )
  const superAdminOnly = superAdminOnlyCapabilities.length
  const financeControls = superAdminOnlyCapabilities.filter((cap) => cap.category === 'Finance')
  const governanceControls = superAdminOnlyCapabilities.filter((cap) => cap.category === 'Admin ops')
  const sensitiveRows = superAdminOnlyCapabilities.map((cap) => ({
    key: cap.key,
    control: (
      <div className="space-y-1 min-w-0">
        <div className="font-medium">{cap.label}</div>
        <div className="text-xs text-[hsl(var(--muted))]">{cap.description}</div>
      </div>
    ),
    area: <Badge>{cap.category}</Badge>,
    access: <Badge className="bg-black text-white border-black">Super Admin only</Badge>,
    route: cap.href ? (
      <Link href={cap.href} className="underline underline-offset-2">
        Open
      </Link>
    ) : (
      <span className="text-[hsl(var(--muted))]">No direct page</span>
    ),
  }))

  return (
    <main>
      <PageHeader
        title="Governance & Permissions"
        subtitle="Review role access, sensitive controls and Super Admin-only capabilities."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" href="/admin">
              Super Admin Today
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
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Protected pages and actions included in this governance view</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Admin access</div>
              <div className="mt-1 text-2xl font-semibold">{adminAccess}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Capabilities available to the Admin role</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Finance controls</div>
              <div className="mt-1 text-2xl font-semibold">{financeControls.length}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">Finance capabilities reserved exclusively for Super Admin</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm text-[hsl(var(--muted))]">Super Admin only</div>
              <div className="mt-1 text-2xl font-semibold">{superAdminOnly}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{governanceControls.length} governance/system control(s) included</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm font-medium">Governance view</div>
              <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                Use this page to verify who can access sensitive areas. Start with Super Admin-only controls, then use the full matrix when a role or access question needs deeper review.
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Sensitive controls</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              These capabilities are currently reserved exclusively for Super Admin.
            </p>
          </div>
          <Badge className="bg-black text-white border-black">{superAdminOnly} protected</Badge>
        </div>
        <Table
          columns={[
            { key: 'control', header: 'Control', tdClassName: 'whitespace-normal' },
            { key: 'area', header: 'Area', thClassName: 'w-28' },
            { key: 'access', header: 'Access', thClassName: 'w-40' },
            { key: 'route', header: 'Workspace', thClassName: 'w-32' },
          ]}
          rows={sensitiveRows}
          keyField="key"
          stickyTopClassName="top-0"
        />
      </Section>

      <Section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Role summary</h2>
          <div className="text-xs text-[hsl(var(--muted))]">Access footprint by role</div>
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
          <div>
            <h2 className="text-lg font-semibold">Full role matrix</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Use the detailed matrix to verify a specific role, capability or protected workspace.
            </p>
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">Yes = access allowed · No = access blocked</div>
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
