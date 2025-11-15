import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'

export default async function MembersPage() {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'status', header: 'Status' },
    { key: 'plan', header: 'Plan' },
  ]
  const rows = [
    { id: 1, name: 'John Doe', status: <Badge>Active</Badge>, plan: 'Annual' },
    { id: 2, name: 'Jane Roe', status: <Badge className="bg-black text-white border-black">Paused</Badge>, plan: 'Monthly' },
  ]
  return (
    <main>
      <PageHeader title="Members" subtitle="Manage your members and subscriptions" right={<Button>New member</Button>} />
      <Section>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input placeholder="Search name/email…" />
          <Input placeholder="Filter by plan…" />
        </div>
        <Table columns={columns} rows={rows} keyField="id" />
      </Section>
    </main>
  )
}
