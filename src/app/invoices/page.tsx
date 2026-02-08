// src/app/invoices/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'

type InvoiceRow = {
  id: string
  invoice_number: string | null
  member_id: string
  amount: number | null
  currency: string | null
  paid_at: string | null
}

type ProfileMini = {
  user_id: string
  first_name: string | null
  last_name: string | null
  member_id: string | null
  email: string | null
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function displayName(p?: ProfileMini | null) {
  if (!p) return '—'
  const n = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
  return n || p.email || '—'
}

export default async function InvoicesPage() {
  const me = await getSessionUser()
  const nextPath = '/invoices'
  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  const STAFF: Role[] = ['reception', 'admin', 'super_admin']
  const isStaff = STAFF.includes(me.role)

  if (!isStaff) {
    return (
      <AccessDeniedPage
        title="Invoices"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can view invoices."
        allowed="reception, admin, super_admin"
        nextPath={nextPath}
        showBackHome
        showProfile
      />
    )
  }

  const supa = createSupabaseRSC()

  const { data: invoices } = (await supa
    .from('invoices')
    .select('id, invoice_number, member_id, amount, currency, paid_at')
    .order('paid_at', { ascending: false })
    .limit(500)) as { data: InvoiceRow[] | null }

  const inv = invoices ?? []
  const memberIds = Array.from(new Set(inv.map((i) => i.member_id).filter(Boolean)))

  let profilesById = new Map<string, ProfileMini>()
  if (memberIds.length) {
    const { data: people } = (await supa
      .from('profiles')
      .select('user_id, first_name, last_name, member_id, email')
      .in('user_id', memberIds)) as { data: ProfileMini[] | null }

    for (const p of people ?? []) profilesById.set(p.user_id, p)
  }

  return (
    <main>
      <PageHeader title="Invoices" subtitle="Download receipts (PDF)" />

      <Section className="space-y-6">
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft space-y-3">
          {inv.length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted))]">No invoices yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[hsl(var(--muted))]">
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="text-left px-3 py-2">Invoice</th>
                    <th className="text-left px-3 py-2">Member</th>
                    <th className="text-left px-3 py-2">Paid at</th>
                    <th className="text-left px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.map((row) => {
                    const p = profilesById.get(row.member_id) ?? null
                    return (
                      <tr key={row.id} className="border-t border-[hsl(var(--border))]">
                        <td className="px-3 py-2">
                          <code className="text-xs">{row.invoice_number ?? '—'}</code>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span>{displayName(p)}</span>
                            {p?.member_id ? (
                              <span className="text-xs text-[hsl(var(--muted))]">{p.member_id}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">{fmtDate(row.paid_at)}</td>
                        <td className="px-3 py-2">
                          {row.amount ?? 0} {row.currency ?? 'EGP'}
                        </td>
                        <td className="px-3 py-2">
                          <a className="text-sm underline hover:opacity-80" href={`/api/invoices/${row.id}/download`}>
                            Download PDF
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-[hsl(var(--muted))]">Showing last 500 invoices.</div>
        </section>
      </Section>
    </main>
  )
}
