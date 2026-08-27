'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'

type FamilyMember = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

type FamilyParent = {
  family_id: string
  auth_user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  is_primary: boolean
  invited_at: string | null
  created_at: string | null
}

type FamilyAccount = {
  id: string
  name: string
  created_at: string | null
  parent: FamilyParent | null
  members: FamilyMember[]
}

type SearchResult = FamilyMember & {
  current_family: { id: string; name: string } | null
}

type UnlinkTarget = {
  familyId: string
  familyName: string
  member: FamilyMember
}

function memberName(member: Pick<FamilyMember, 'first_name' | 'last_name'>) {
  return `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || 'Unnamed member'
}

function parentName(parent: FamilyParent) {
  return `${parent.first_name ?? ''} ${parent.last_name ?? ''}`.trim() || 'Parent'
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? data : {}
}

export default function FamilyAccountsManager({ families }: { families: FamilyAccount[] }) {
  const router = useRouter()
  const [familyName, setFamilyName] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  const [openSearchFamilyId, setOpenSearchFamilyId] = React.useState<string | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([])

  const [openParentFamilyId, setOpenParentFamilyId] = React.useState<string | null>(null)
  const [parentFirstName, setParentFirstName] = React.useState('')
  const [parentLastName, setParentLastName] = React.useState('')
  const [parentEmail, setParentEmail] = React.useState('')
  const [parentPhone, setParentPhone] = React.useState('')

  const [openNewMemberFamilyId, setOpenNewMemberFamilyId] = React.useState<string | null>(null)
  const [memberFirstName, setMemberFirstName] = React.useState('')
  const [memberLastName, setMemberLastName] = React.useState('')
  const [memberDateOfBirth, setMemberDateOfBirth] = React.useState('')
  const [memberPhone, setMemberPhone] = React.useState('')

  const [actionKey, setActionKey] = React.useState<string | null>(null)
  const [unlinkTarget, setUnlinkTarget] = React.useState<UnlinkTarget | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const resetFeedback = React.useCallback(() => {
    setMessage(null)
    setError(null)
  }, [])

  function closeParentForm() {
    setOpenParentFamilyId(null)
    setParentFirstName('')
    setParentLastName('')
    setParentEmail('')
    setParentPhone('')
  }

  function closeNewMemberForm() {
    setOpenNewMemberFamilyId(null)
    setMemberFirstName('')
    setMemberLastName('')
    setMemberDateOfBirth('')
    setMemberPhone('')
  }

  async function createFamily(event: React.FormEvent) {
    event.preventDefault()
    resetFeedback()
    const name = familyName.replace(/\s+/g, ' ').trim()
    if (name.length < 2) {
      setError('Enter a family name.')
      return
    }

    setCreating(true)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', familyName: name }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to create family')
      }

      setFamilyName('')
      setMessage(`${name} created.`)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setCreating(false)
    }
  }

  async function createParentAccount(event: React.FormEvent, family: FamilyAccount) {
    event.preventDefault()
    resetFeedback()

    const firstName = parentFirstName.trim()
    const lastName = parentLastName.trim()
    const email = parentEmail.trim().toLowerCase()
    const phone = parentPhone.trim()

    if (!firstName) {
      setError('Parent first name is required.')
      return
    }
    if (!email) {
      setError('Parent email is required.')
      return
    }

    const key = `parent:${family.id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_parent_account',
          familyId: family.id,
          firstName,
          lastName,
          email,
          phone,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'PRIMARY_PARENT_ALREADY_EXISTS') {
          throw new Error('This family already has a parent account.')
        }
        throw new Error(data.details || data.error || 'Failed to create parent account')
      }

      closeParentForm()
      setMessage(
        data.existing_account
          ? `${email} was already an ATOM account and is now linked as the family parent.`
          : `Parent account created for ${email}. Invitation sent.`,
      )
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function createDependentMember(event: React.FormEvent, family: FamilyAccount) {
    event.preventDefault()
    resetFeedback()

    const firstName = memberFirstName.trim()
    const lastName = memberLastName.trim()
    const phone = memberPhone.trim()
    const dateOfBirth = memberDateOfBirth.trim()

    if (!firstName || !lastName) {
      setError('First name and last name are required for the family member.')
      return
    }

    const key = `new-member:${family.id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_dependent_member',
          familyId: family.id,
          firstName,
          lastName,
          phone,
          dateOfBirth,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to create family member')
      }

      setMemberFirstName('')
      setMemberLastName('')
      setMemberDateOfBirth('')
      setMemberPhone('')
      setMessage(
        `${firstName} ${lastName} created and added to ${family.name}. No separate email or login was created.`,
      )
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function searchMembers(familyId: string) {
    resetFeedback()
    const q = searchQuery.trim()
    if (q.length < 2) {
      setError('Enter at least 2 characters to search.')
      return
    }

    setSearching(true)
    setSearchResults([])
    try {
      const response = await fetch(`/api/admin/families/member-search?q=${encodeURIComponent(q)}`, {
        cache: 'no-store',
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Member search failed')
      }
      setOpenSearchFamilyId(familyId)
      setSearchResults(Array.isArray(data.items) ? data.items : [])
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setSearching(false)
    }
  }

  async function linkMember(family: FamilyAccount, member: SearchResult) {
    resetFeedback()
    const key = `link:${family.id}:${member.user_id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_member', familyId: family.id, memberId: member.user_id }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'MEMBER_ALREADY_IN_ANOTHER_FAMILY' && data.currentFamily?.name) {
          throw new Error(`This member already belongs to ${data.currentFamily.name}. Unlink them there first.`)
        }
        throw new Error(data.details || data.error || 'Failed to add member')
      }

      setMessage(`${memberName(member)} added to ${family.name}.`)
      setSearchResults((items) =>
        items.map((item) =>
          item.user_id === member.user_id
            ? { ...item, current_family: { id: family.id, name: family.name } }
            : item,
        ),
      )
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function unlinkMember() {
    if (!unlinkTarget) return
    resetFeedback()
    const key = `unlink:${unlinkTarget.familyId}:${unlinkTarget.member.user_id}`
    setActionKey(key)

    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unlink_member',
          familyId: unlinkTarget.familyId,
          memberId: unlinkTarget.member.user_id,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to remove member')
      }

      setMessage(`${memberName(unlinkTarget.member)} removed from ${unlinkTarget.familyName}.`)
      setUnlinkTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={createFamily}
        className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input
            label="Create family"
            value={familyName}
            onChange={(event) => setFamilyName(event.target.value)}
            placeholder="e.g. Ahmed Family"
            maxLength={120}
            autoComplete="off"
          />
          <Button type="submit" loading={creating} loadingText="Creating…" className="w-full sm:w-auto">
            Create family
          </Button>
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--muted))]">
          Create the family first, then add one parent account and as many member profiles as needed.
        </p>
      </form>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {families.map((family) => {
          const searchOpen = openSearchFamilyId === family.id
          const parentOpen = openParentFamilyId === family.id
          const newMemberOpen = openNewMemberFamilyId === family.id

          return (
            <section
              key={family.id}
              className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{family.name}</h2>
                  <p className="text-xs text-[hsl(var(--muted))]">
                    {family.members.length} member{family.members.length === 1 ? '' : 's'} · {family.parent ? 'Parent account linked' : 'No parent account'}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Parent account</div>
                    {family.parent ? (
                      <div className="mt-1">
                        <div className="font-medium">{parentName(family.parent)}</div>
                        <div className="text-xs text-[hsl(var(--muted))]">
                          {family.parent.email}{family.parent.phone ? ` · ${family.parent.phone}` : ''}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                        One email/login for this family. Existing ATOM accounts are reused when the email already exists.
                      </p>
                    )}
                  </div>

                  {!family.parent ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resetFeedback()
                        if (parentOpen) closeParentForm()
                        else {
                          closeNewMemberForm()
                          setOpenSearchFamilyId(null)
                          setOpenParentFamilyId(family.id)
                        }
                      }}
                    >
                      {parentOpen ? 'Close' : 'Add parent account'}
                    </Button>
                  ) : null}
                </div>

                {parentOpen && !family.parent ? (
                  <form onSubmit={(event) => createParentAccount(event, family)} className="mt-4 grid gap-3 rounded-2xl bg-white p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Parent first name"
                        value={parentFirstName}
                        onChange={(event) => setParentFirstName(event.target.value)}
                        maxLength={120}
                        required
                      />
                      <Input
                        label="Parent last name"
                        value={parentLastName}
                        onChange={(event) => setParentLastName(event.target.value)}
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Parent email"
                        type="email"
                        value={parentEmail}
                        onChange={(event) => setParentEmail(event.target.value)}
                        autoComplete="email"
                        required
                        hint="This is the only login email required for the family."
                      />
                      <Input
                        label="Parent phone"
                        type="tel"
                        value={parentPhone}
                        onChange={(event) => setParentPhone(event.target.value)}
                        autoComplete="tel"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        loading={actionKey === `parent:${family.id}`}
                        loadingText="Creating…"
                      >
                        Create / link parent account
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    resetFeedback()
                    if (newMemberOpen) closeNewMemberForm()
                    else {
                      closeParentForm()
                      setOpenSearchFamilyId(null)
                      setSearchResults([])
                      setOpenNewMemberFamilyId(family.id)
                    }
                  }}
                >
                  {newMemberOpen ? 'Close new member' : 'Add new family member'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetFeedback()
                    closeParentForm()
                    closeNewMemberForm()
                    if (searchOpen) {
                      setOpenSearchFamilyId(null)
                      setSearchResults([])
                      setSearchQuery('')
                    } else {
                      setOpenSearchFamilyId(family.id)
                      setSearchResults([])
                      setSearchQuery('')
                    }
                  }}
                >
                  {searchOpen ? 'Close search' : 'Add existing member'}
                </Button>
              </div>

              {newMemberOpen ? (
                <form
                  onSubmit={(event) => createDependentMember(event, family)}
                  className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"
                >
                  <div className="mb-3">
                    <div className="font-semibold text-emerald-950">New family member</div>
                    <p className="mt-1 text-xs text-emerald-800">
                      No email is required. ATOM creates an individual Member ID and QR code, but no separate login account.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="First name"
                      value={memberFirstName}
                      onChange={(event) => setMemberFirstName(event.target.value)}
                      maxLength={120}
                      required
                    />
                    <Input
                      label="Last name"
                      value={memberLastName}
                      onChange={(event) => setMemberLastName(event.target.value)}
                      maxLength={120}
                      required
                    />
                    <Input
                      label="Date of birth"
                      type="date"
                      value={memberDateOfBirth}
                      onChange={(event) => setMemberDateOfBirth(event.target.value)}
                    />
                    <Input
                      label="Phone (optional)"
                      type="tel"
                      value={memberPhone}
                      onChange={(event) => setMemberPhone(event.target.value)}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-emerald-800">After saving, keep this form open to add the next sibling/member.</span>
                    <Button
                      type="submit"
                      loading={actionKey === `new-member:${family.id}`}
                      loadingText="Creating…"
                    >
                      Create member
                    </Button>
                  </div>
                </form>
              ) : null}

              {family.members.length > 0 ? (
                <div className="mt-4 divide-y divide-[hsl(var(--border))] rounded-2xl border border-[hsl(var(--border))]">
                  {family.members.map((member) => (
                    <div key={member.user_id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium">{memberName(member)}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          ID: {member.member_id?.trim() || '—'} · {member.email || member.phone || 'Family-managed member'}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionKey === `unlink:${family.id}:${member.user_id}`}
                        onClick={() => setUnlinkTarget({ familyId: family.id, familyName: family.name, member })}
                      >
                        Remove from family
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
                  No members linked yet.
                </div>
              )}

              {searchOpen ? (
                <div className="mt-4 rounded-2xl bg-[hsl(var(--bg))] p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <Input
                      label="Search existing member"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Name, member ID, email or phone"
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      loading={searching}
                      loadingText="Searching…"
                      onClick={() => searchMembers(family.id)}
                    >
                      Search
                    </Button>
                  </div>

                  {searchResults.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {searchResults.map((member) => {
                        const sameFamily = member.current_family?.id === family.id
                        const anotherFamily = member.current_family && !sameFamily
                        const key = `link:${family.id}:${member.user_id}`
                        return (
                          <div
                            key={member.user_id}
                            className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">{memberName(member)}</div>
                              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                                ID: {member.member_id?.trim() || '—'} · {member.email || member.phone || 'No contact'}
                              </div>
                              {anotherFamily ? (
                                <div className="mt-1 text-xs font-medium text-amber-700">
                                  Already in {member.current_family?.name}
                                </div>
                              ) : sameFamily ? (
                                <div className="mt-1 text-xs font-medium text-emerald-700">Already linked to this family</div>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              disabled={Boolean(member.current_family)}
                              loading={actionKey === key}
                              loadingText="Adding…"
                              onClick={() => linkMember(family, member)}
                            >
                              Add
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}

        {families.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center text-sm text-[hsl(var(--muted))]">
            No families yet. Create the first family above.
          </div>
        ) : null}
      </div>

      <ConfirmActionModal
        open={Boolean(unlinkTarget)}
        title="Remove member from family?"
        description="This only removes the family link. The member profile, account, membership, payments and history stay unchanged."
        confirmLabel="Remove link"
        pendingLabel="Removing…"
        tone="destructive"
        pending={Boolean(unlinkTarget && actionKey === `unlink:${unlinkTarget.familyId}:${unlinkTarget.member.user_id}`)}
        summaryItems={
          unlinkTarget
            ? [
                { label: 'Family', value: unlinkTarget.familyName },
                { label: 'Member', value: memberName(unlinkTarget.member) },
                { label: 'Member ID', value: unlinkTarget.member.member_id || '—' },
              ]
            : []
        }
        warning="No member data will be deleted."
        onCancel={() => {
          if (!actionKey) setUnlinkTarget(null)
        }}
        onConfirm={unlinkMember}
      />
    </div>
  )
}
