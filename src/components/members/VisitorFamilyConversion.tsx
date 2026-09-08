'use client'

import * as React from 'react'
import Button from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import InlineAlert from '@/components/ui/InlineAlert'
import Input from '@/components/ui/Input'

type Visitor = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  email: string | null
  date_of_birth: string | null
  trial_date: string
  trial_attended_at: string | null
  free_trial_used: boolean
  linked_member_id: string | null
  family_intake_id: string | null
}

type Intake = {
  id: string
  guardian_first_name: string
  guardian_last_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  guardian_relationship: string
  guardian_auth_user_id: string | null
  family_id: string | null
  status: string
}

type Family = {
  id: string
  name: string
}

type LinkedMember = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
}

type ConversionResult = {
  ok: true
  already_converted?: boolean
  member_user_id: string
  member_id: string | null
  family_id: string
  family_name: string
  guardian_auth_user_id: string | null
  guardian_account_created?: boolean
  guardian_invite_sent?: boolean
  guardian_invite_warning?: string | null
  message?: string
}

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'Unnamed'
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? data : {}
}

export default function VisitorFamilyConversion({
  visitor,
  intake,
  family,
  linkedMember,
}: {
  visitor: Visitor
  intake: Intake | null
  family: Family | null
  linkedMember: LinkedMember | null
}) {
  const [guardianEmail, setGuardianEmail] = React.useState(intake?.guardian_email ?? '')
  const [familyName, setFamilyName] = React.useState(
    family?.name
      ?? `${intake?.guardian_last_name || intake?.guardian_first_name || visitor.last_name || visitor.first_name} Family`.trim(),
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ConversionResult | null>(null)

  if (linkedMember || visitor.linked_member_id) {
    const memberUserId = linkedMember?.user_id ?? visitor.linked_member_id
    return (
      <Card>
        <CardHeader><CardTitle>Already linked to a Member</CardTitle></CardHeader>
        <CardContent>
          <InlineAlert variant="info">
            This Visitor is already linked to {linkedMember ? fullName(linkedMember.first_name, linkedMember.last_name) : 'an ATOM Member'}.
            No second Member will be created.
          </InlineAlert>
          <div className="mt-4 flex flex-wrap gap-2">
            {memberUserId ? <Button asChild href={`/members/${memberUserId}`}>Open member</Button> : null}
            <Button asChild variant="outline" href="/admin/visitors">Back to Visitors</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!intake) {
    return (
      <Card>
        <CardHeader><CardTitle>Family Intake required</CardTitle></CardHeader>
        <CardContent>
          <InlineAlert variant="warning">
            This Visitor is not attached to a Family Intake yet. Create a Family Intake and choose “Link existing Visitor” first.
            This prevents creating a family or guardian from incomplete information.
          </InlineAlert>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild href="/admin/members/family-intake">Open Family Intake</Button>
            <Button asChild variant="outline" href="/admin/visitors">Back to Visitors</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  async function convert() {
    setSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/admin/family-intake/convert-visitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorTrialId: visitor.id,
          guardianEmail: guardianEmail.trim(),
          familyName: familyName.trim(),
        }),
      })
      const data = await readJson(response)

      if (!response.ok || data.ok !== true) {
        const message =
          data.error === 'GUARDIAN_EMAIL_REQUIRED'
            ? 'Guardian email is required before creating the Family Account and guardian login.'
            : data.error === 'VISITOR_ALREADY_LINKED_TO_MEMBER'
              ? 'This Visitor is already linked to another Member. No duplicate was created. Super Admin review is required if that link is incorrect.'
              : data.error === 'GUARDIAN_ALREADY_BELONGS_TO_ANOTHER_FAMILY'
                ? 'The guardian is already linked to another Family. The conversion was stopped to avoid creating or moving family relationships silently.'
                : data.details || data.error || 'Visitor conversion failed.'
        throw new Error(message)
      }

      setResult(data as ConversionResult)
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <InlineAlert variant="success">
          {result.message || 'Visitor converted to a family-managed Member. Trial history was preserved.'}
        </InlineAlert>

        {result.guardian_invite_warning ? (
          <InlineAlert variant="warning">
            Member conversion succeeded, but the guardian invitation email needs attention: {result.guardian_invite_warning}
          </InlineAlert>
        ) : null}

        <Card>
          <CardHeader><CardTitle>Conversion complete</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div><span className="font-semibold">Member:</span> {fullName(visitor.first_name, visitor.last_name)}</div>
              <div><span className="font-semibold">Member ID:</span> {result.member_id || 'Generated'}</div>
              <div><span className="font-semibold">Family:</span> {result.family_name}</div>
              <div><span className="font-semibold">Guardian login:</span> {result.guardian_account_created ? 'Created / invited' : 'Reused'}</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild href={`/members/${result.member_user_id}`}>
                Open member & add membership
              </Button>
              <Button asChild variant="outline" href="/admin/visitors">
                Back to Visitors
              </Button>
              <Button asChild variant="outline" href="/admin/members/family-intake">
                Family Intake
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const needsGuardianEmail = !family

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>1. Visitor to convert</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="font-semibold">Name:</span> {fullName(visitor.first_name, visitor.last_name)}</div>
            <div><span className="font-semibold">DOB:</span> {visitor.date_of_birth || 'Not recorded'}</div>
            <div><span className="font-semibold">Trial date:</span> {visitor.trial_date}</div>
            <div><span className="font-semibold">Trial used:</span> {visitor.free_trial_used ? 'Yes' : 'Not marked yet'}</div>
          </div>
          <p className="mt-3 text-xs text-[hsl(var(--muted))]">
            Conversion keeps this Visitor record and links it to the new Member. It does not create a separate login/email for the child.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Guardian & Family</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="font-semibold">Guardian:</span> {fullName(intake.guardian_first_name, intake.guardian_last_name)}</div>
            <div><span className="font-semibold">Relationship:</span> {intake.guardian_relationship}</div>
            <div><span className="font-semibold">Phone:</span> {intake.guardian_phone || '—'}</div>
            <div><span className="font-semibold">Current Family:</span> {family?.name || 'Not created yet'}</div>
          </div>

          {family ? (
            <InlineAlert variant="info" compact>
              Existing Family Account will be reused. No second guardian account or Family will be created.
            </InlineAlert>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Guardian email *
                <Input
                  className="mt-1"
                  type="email"
                  value={guardianEmail}
                  onChange={(event) => setGuardianEmail(event.target.value)}
                  placeholder="parent@example.com"
                  required
                />
              </label>
              <label className="text-sm font-medium">
                Family name
                <Input
                  className="mt-1"
                  value={familyName}
                  onChange={(event) => setFamilyName(event.target.value)}
                  placeholder="Hassan Family"
                />
              </label>
            </div>
          )}

          {needsGuardianEmail && !intake.guardian_email ? (
            <p className="mt-2 text-xs text-[hsl(var(--muted))]">
              The trial intake was created without an email. Reception/Admin can collect the parent email now; it will become the guardian login.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Confirm conversion</CardTitle></CardHeader>
        <CardContent>
          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
          <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3 text-sm">
            <div className="font-semibold">ATOM will:</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[hsl(var(--muted))]">
              <li>create one family-managed Member profile with Member ID and QR;</li>
              <li>reuse or create the Family Account and guardian login safely;</li>
              <li>preserve the original Visitor/trial history;</li>
              <li>never create an Auth/login account for the child.</li>
            </ul>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={convert}
              loading={submitting}
              loadingText="Converting…"
              disabled={needsGuardianEmail && !guardianEmail.trim()}
            >
              Convert to family member
            </Button>
            <Button asChild variant="outline" href="/admin/visitors">Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
