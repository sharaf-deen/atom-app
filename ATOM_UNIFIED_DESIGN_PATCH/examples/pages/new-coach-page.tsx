import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'

export default function NewCoachPage() {
  return (
    <main>
      <PageHeader title="New Coach" subtitle="Create a coach profile" />
      <Section className="max-w-2xl">
        <form className="space-y-4">
          <Input label="Full name" placeholder="Jane Doe" />
          <Input type="email" label="Email" placeholder="jane@atom.app" />
          <Select label="Role">
            <option value="coach">Coach</option>
            <option value="assistant_coach">Assistant coach</option>
          </Select>
          <Textarea label="Notes" rows={4} placeholder="Internal notes…" />
          <div className="pt-2">
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Section>
    </main>
  )
}
