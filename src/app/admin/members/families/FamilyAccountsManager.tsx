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

type FamilyAccount = {
  id: string
  name: string
  created_at: string | null
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
  const [actionKey, setActionKey] = React.useState<string | null>(null)
  const [unlinkTarget, setUnlinkTarget] = React.useState<UnlinkTarget | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const resetFeedback = React.useCallback(() => {
    setMessage(null)
    setError(null)
  }, [])

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
          This only creates a family group. Existing member accounts and emails are not changed.
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
          return (
            <section
              key={family.id}
              className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{family.name}</h2>
                  <p className="text-xs text-[hsl(var(--muted))]">
                    {family.members.length} member{family.members.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetFeedback()
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

              {family.members.length > 0 ? (
                <div className="mt-4 divide-y divide-[hsl(var(--border))] rounded-2xl border border-[hsl(var(--border))]">
                  {family.members.map((member) => (
                    <div key={member.user_id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium">{memberName(member)}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          ID: {member.member_id?.trim() || '—'} · {member.email || member.phone || 'No contact'}
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
