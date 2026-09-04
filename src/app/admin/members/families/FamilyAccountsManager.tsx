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

type GuardianMemberProfile = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  role: string | null
}

type FamilyGuardian = {
  family_id: string
  auth_user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  is_primary: boolean
  invited_at: string | null
  created_at: string | null
  member_profile?: GuardianMemberProfile | null
}

type FamilyAccount = {
  id: string
  name: string
  created_at: string | null
  guardians: FamilyGuardian[]
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

type GuardianTarget = {
  familyId: string
  familyName: string
  guardian: FamilyGuardian
}

type FamilyTarget = {
  familyId: string
  familyName: string
  memberCount: number
  guardianCount: number
}

type CleanupDependency = {
  table?: string
  column?: string
}

type CleanupPreview = {
  has_profile?: boolean
  can_remove?: boolean
  reason?: string | null
  role?: string | null
  member_id?: string | null
  email?: string | null
  has_family_member_link?: boolean
  dependency_count?: number
  dependencies?: CleanupDependency[]
}

function memberName(member: Pick<FamilyMember, 'first_name' | 'last_name'>) {
  return `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || 'Unnamed member'
}

function guardianName(guardian: FamilyGuardian) {
  return `${guardian.first_name ?? ''} ${guardian.last_name ?? ''}`.trim() || 'Guardian'
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? data : {}
}

export default function FamilyAccountsManager({
  families,
  canCleanupMemberProfiles = false,
}: {
  families: FamilyAccount[]
  canCleanupMemberProfiles?: boolean
}) {
  const router = useRouter()
  const [familyName, setFamilyName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [editingFamilyId, setEditingFamilyId] = React.useState<string | null>(null)
  const [editingFamilyName, setEditingFamilyName] = React.useState('')
  const [deleteFamilyTarget, setDeleteFamilyTarget] = React.useState<FamilyTarget | null>(null)

  const [openSearchFamilyId, setOpenSearchFamilyId] = React.useState<string | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([])

  const [openParentFamilyId, setOpenParentFamilyId] = React.useState<string | null>(null)
  const [parentFirstName, setParentFirstName] = React.useState('')
  const [parentLastName, setParentLastName] = React.useState('')
  const [parentEmail, setParentEmail] = React.useState('')
  const [parentPhone, setParentPhone] = React.useState('')
  const [editGuardianTarget, setEditGuardianTarget] = React.useState<GuardianTarget | null>(null)
  const [editGuardianFirstName, setEditGuardianFirstName] = React.useState('')
  const [editGuardianLastName, setEditGuardianLastName] = React.useState('')
  const [editGuardianPhone, setEditGuardianPhone] = React.useState('')
  const [cleanupTarget, setCleanupTarget] = React.useState<GuardianTarget | null>(null)
  const [cleanupPreview, setCleanupPreview] = React.useState<CleanupPreview | null>(null)

  const [openNewMemberFamilyId, setOpenNewMemberFamilyId] = React.useState<string | null>(null)
  const [memberFirstName, setMemberFirstName] = React.useState('')
  const [memberLastName, setMemberLastName] = React.useState('')
  const [memberDateOfBirth, setMemberDateOfBirth] = React.useState('')
  const [memberPhone, setMemberPhone] = React.useState('')

  const [actionKey, setActionKey] = React.useState<string | null>(null)
  const [unlinkTarget, setUnlinkTarget] = React.useState<UnlinkTarget | null>(null)
  const [primaryGuardianTarget, setPrimaryGuardianTarget] = React.useState<GuardianTarget | null>(null)
  const [removeGuardianTarget, setRemoveGuardianTarget] = React.useState<GuardianTarget | null>(null)
  const [promoteGuardianTarget, setPromoteGuardianTarget] = React.useState<GuardianTarget | null>(null)
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

  function closeGuardianEdit() {
    setEditGuardianTarget(null)
    setEditGuardianFirstName('')
    setEditGuardianLastName('')
    setEditGuardianPhone('')
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

  async function renameFamily(event: React.FormEvent, family: FamilyAccount) {
    event.preventDefault()
    resetFeedback()
    const name = editingFamilyName.replace(/\s+/g, ' ').trim()
    if (name.length < 2) {
      setError('Enter a valid family name.')
      return
    }

    const key = `rename-family:${family.id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename_family', familyId: family.id, familyName: name }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to rename family')
      }

      setEditingFamilyId(null)
      setEditingFamilyName('')
      setMessage(`Family renamed to ${name}.`)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function deleteFamily() {
    if (!deleteFamilyTarget) return
    resetFeedback()
    const key = `delete-family:${deleteFamilyTarget.familyId}`
    setActionKey(key)

    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_family', familyId: deleteFamilyTarget.familyId }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'FAMILY_HAS_MEMBERS') {
          throw new Error('Remove all member links from this family before deleting it.')
        }
        throw new Error(data.details || data.error || 'Failed to delete family')
      }

      setMessage(`${deleteFamilyTarget.familyName} deleted. Member profiles and guardian Auth accounts were preserved.`)
      setDeleteFamilyTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  function openGuardianEdit(target: GuardianTarget) {
    resetFeedback()
    setEditGuardianTarget(target)
    setEditGuardianFirstName(target.guardian.first_name ?? '')
    setEditGuardianLastName(target.guardian.last_name ?? '')
    setEditGuardianPhone(target.guardian.phone ?? '')
  }

  async function updateGuardian(event: React.FormEvent) {
    event.preventDefault()
    if (!editGuardianTarget) return
    resetFeedback()

    const firstName = editGuardianFirstName.trim()
    const lastName = editGuardianLastName.trim()
    const phone = editGuardianPhone.trim()
    if (!firstName) {
      setError('Guardian first name is required.')
      return
    }

    const key = `edit-guardian:${editGuardianTarget.familyId}:${editGuardianTarget.guardian.auth_user_id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_guardian',
          familyId: editGuardianTarget.familyId,
          authUserId: editGuardianTarget.guardian.auth_user_id,
          firstName,
          lastName,
          phone,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to update guardian')
      }

      setMessage(`Guardian details updated for ${editGuardianTarget.guardian.email}.`)
      closeGuardianEdit()
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function reviewGuardianMemberCleanup(target: GuardianTarget) {
    resetFeedback()
    setCleanupPreview(null)
    const key = `cleanup-preview:${target.familyId}:${target.guardian.auth_user_id}`
    setActionKey(key)

    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview_guardian_member_cleanup',
          familyId: target.familyId,
          authUserId: target.guardian.auth_user_id,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to review member profile')
      }

      const preview = (data.preview ?? {}) as CleanupPreview
      setCleanupPreview(preview)

      if (!preview.has_profile) {
        setMessage('This guardian no longer has a member profile to clean up.')
        return
      }

      if (!preview.can_remove) {
        const dependencies = Array.isArray(preview.dependencies) ? preview.dependencies : []
        const labels = dependencies
          .slice(0, 8)
          .map((dependency) => `${dependency.table ?? 'unknown'}.${dependency.column ?? 'unknown'}`)
        const suffix = dependencies.length > labels.length ? ` +${dependencies.length - labels.length} more` : ''
        throw new Error(
          preview.reason === 'PROFILE_ROLE_NOT_MEMBER'
            ? `Cleanup blocked: this profile role is ${preview.role ?? 'not member'}.`
            : `Cleanup blocked because member-linked data exists: ${labels.join(', ') || 'dependency detected'}${suffix}.`,
        )
      }

      setCleanupTarget(target)
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function removeGuardianMemberProfile() {
    if (!cleanupTarget) return
    resetFeedback()
    const key = `cleanup-remove:${cleanupTarget.familyId}:${cleanupTarget.guardian.auth_user_id}`
    setActionKey(key)

    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_guardian_member_profile',
          familyId: cleanupTarget.familyId,
          authUserId: cleanupTarget.guardian.auth_user_id,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Member profile cleanup was blocked')
      }

      setMessage(
        `${guardianName(cleanupTarget.guardian)} keeps the guardian login, but the unnecessary member profile has been removed.`,
      )
      setCleanupTarget(null)
      setCleanupPreview(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }


  async function promoteGuardianToMember() {
    if (!promoteGuardianTarget) return
    resetFeedback()

    const key = `promote-member:${promoteGuardianTarget.familyId}:${promoteGuardianTarget.guardian.auth_user_id}`
    setActionKey(key)

    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote_guardian_to_member',
          familyId: promoteGuardianTarget.familyId,
          authUserId: promoteGuardianTarget.guardian.auth_user_id,
        }),
      })
      const data = await readJson(response)

      if (!response.ok || data.ok !== true) {
        if (data.error === 'GUARDIAN_ALREADY_HAS_PROFILE') {
          throw new Error('This guardian already has an ATOM profile.')
        }
        if (data.error === 'GUARDIAN_EMAIL_ALREADY_USED_BY_MEMBER_PROFILE') {
          throw new Error('This guardian email is already used by another member profile. Review the duplicate before converting this guardian.')
        }
        throw new Error(data.details || data.error || 'Failed to make guardian a member')
      }

      const memberId = data.member?.member_id ? ` · ${data.member.member_id}` : ''
      setMessage(
        `${guardianName(promoteGuardianTarget.guardian)} is now Guardian + Member${memberId}. The existing login and family access were preserved.`,
      )
      setPromoteGuardianTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function createGuardianAccount(event: React.FormEvent, family: FamilyAccount) {
    event.preventDefault()
    resetFeedback()

    const firstName = parentFirstName.trim()
    const lastName = parentLastName.trim()
    const email = parentEmail.trim().toLowerCase()
    const phone = parentPhone.trim()

    if (!firstName) {
      setError('Guardian first name is required.')
      return
    }
    if (!email) {
      setError('Guardian email is required.')
      return
    }

    const key = `guardian:${family.id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_guardian_account',
          familyId: family.id,
          firstName,
          lastName,
          email,
          phone,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'GUARDIAN_ALREADY_LINKED') {
          throw new Error('This account is already linked to the family.')
        }
        throw new Error(data.details || data.error || 'Failed to create guardian account')
      }

      closeParentForm()
      const roleLabel = data.is_primary ? 'primary guardian' : 'guardian'
      setMessage(
        data.existing_account
          ? `${email} was already an ATOM account and is now linked as ${roleLabel}.`
          : `Family ${roleLabel} account created for ${email}. Invitation sent.`,
      )
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function setPrimaryGuardian() {
    if (!primaryGuardianTarget) return
    resetFeedback()

    const key = `primary:${primaryGuardianTarget.familyId}:${primaryGuardianTarget.guardian.auth_user_id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_primary_guardian',
          familyId: primaryGuardianTarget.familyId,
          authUserId: primaryGuardianTarget.guardian.auth_user_id,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to change primary guardian')
      }

      setMessage(`${guardianName(primaryGuardianTarget.guardian)} is now the primary guardian for ${primaryGuardianTarget.familyName}.`)
      setPrimaryGuardianTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setActionKey(null)
    }
  }

  async function removeGuardian() {
    if (!removeGuardianTarget) return
    resetFeedback()

    const key = `remove-guardian:${removeGuardianTarget.familyId}:${removeGuardianTarget.guardian.auth_user_id}`
    setActionKey(key)
    try {
      const response = await fetch('/api/admin/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_guardian',
          familyId: removeGuardianTarget.familyId,
          authUserId: removeGuardianTarget.guardian.auth_user_id,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'PRIMARY_GUARDIAN_CANNOT_BE_REMOVED') {
          throw new Error('Choose another primary guardian before removing this account.')
        }
        throw new Error(data.details || data.error || 'Failed to remove guardian')
      }

      setMessage(`${guardianName(removeGuardianTarget.guardian)} removed as guardian for ${removeGuardianTarget.familyName}.`)
      setRemoveGuardianTarget(null)
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
          Create the family first, then add one or more parent/guardian accounts and as many member profiles as needed.
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
                    {family.members.length} member{family.members.length === 1 ? '' : 's'} · {family.guardians.length} guardian{family.guardians.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(actionKey)}
                    onClick={() => {
                      resetFeedback()
                      setEditingFamilyId(editingFamilyId === family.id ? null : family.id)
                      setEditingFamilyName(family.name)
                    }}
                  >
                    {editingFamilyId === family.id ? 'Close edit' : 'Edit family'}
                  </Button>
                  {canCleanupMemberProfiles ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(actionKey) || family.members.length > 0}
                      onClick={() =>
                        setDeleteFamilyTarget({
                          familyId: family.id,
                          familyName: family.name,
                          memberCount: family.members.length,
                          guardianCount: family.guardians.length,
                        })
                      }
                    >
                      Delete family
                    </Button>
                  ) : null}
                </div>
              </div>

              {editingFamilyId === family.id ? (
                <form
                  onSubmit={(event) => renameFamily(event, family)}
                  className="mt-3 grid gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3 sm:grid-cols-[1fr_auto] sm:items-end"
                >
                  <Input
                    label="Family name"
                    value={editingFamilyName}
                    onChange={(event) => setEditingFamilyName(event.target.value)}
                    maxLength={120}
                    required
                  />
                  <Button
                    type="submit"
                    size="sm"
                    loading={actionKey === `rename-family:${family.id}`}
                    loadingText="Saving…"
                  >
                    Save family name
                  </Button>
                </form>
              ) : null}

              {canCleanupMemberProfiles && family.members.length > 0 ? (
                <p className="mt-2 text-xs text-[hsl(var(--muted))]">
                  To delete this family, remove its member links first. Member profiles are never deleted with the family.
                </p>
              ) : null}

              <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Parent / guardian accounts</div>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                      Each guardian uses their own email/login and can access the same read-only Family Dashboard.
                    </p>
                  </div>
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
                    {parentOpen ? 'Close' : family.guardians.length === 0 ? 'Add parent / guardian' : 'Add guardian'}
                  </Button>
                </div>

                {family.guardians.length > 0 ? (
                  <div className="mt-3 divide-y divide-[hsl(var(--border))] rounded-2xl border border-[hsl(var(--border))] bg-white">
                    {family.guardians.map((guardian) => (
                      <div
                        key={guardian.auth_user_id}
                        className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{guardianName(guardian)}</span>
                            {guardian.is_primary ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                                Primary guardian
                              </span>
                            ) : (
                              <span className="rounded-full border bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                                Guardian
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            {guardian.email}{guardian.phone ? ` · ${guardian.phone}` : ''}
                          </div>
                        </div>

                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={Boolean(actionKey)}
                              onClick={() =>
                                openGuardianEdit({
                                  familyId: family.id,
                                  familyName: family.name,
                                  guardian,
                                })
                              }
                            >
                              Edit guardian
                            </Button>

                            {!guardian.member_profile ? (
                              <Button
                                type="button"
                                size="sm"
                                disabled={Boolean(actionKey)}
                                onClick={() =>
                                  setPromoteGuardianTarget({
                                    familyId: family.id,
                                    familyName: family.name,
                                    guardian,
                                  })
                                }
                              >
                                Make member
                              </Button>
                            ) : null}

                            {!guardian.is_primary ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={Boolean(actionKey)}
                                  onClick={() =>
                                    setPrimaryGuardianTarget({
                                      familyId: family.id,
                                      familyName: family.name,
                                      guardian,
                                    })
                                  }
                                >
                                  Make primary
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={Boolean(actionKey)}
                                  onClick={() =>
                                    setRemoveGuardianTarget({
                                      familyId: family.id,
                                      familyName: family.name,
                                      guardian,
                                    })
                                  }
                                >
                                  Remove guardian
                                </Button>
                              </>
                            ) : null}

                            {canCleanupMemberProfiles && guardian.member_profile ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                loading={
                                  actionKey ===
                                  `cleanup-preview:${family.id}:${guardian.auth_user_id}`
                                }
                                loadingText="Checking…"
                                disabled={Boolean(actionKey)}
                                onClick={() =>
                                  reviewGuardianMemberCleanup({
                                    familyId: family.id,
                                    familyName: family.name,
                                    guardian,
                                  })
                                }
                              >
                                Review member cleanup
                              </Button>
                            ) : null}
                          </div>

                          {guardian.is_primary ? (
                            <span className="text-xs text-[hsl(var(--muted))]">
                              To remove this guardian, make another guardian primary first.
                            </span>
                          ) : null}

                          {guardian.member_profile ? (
                            <span className="text-xs font-medium text-emerald-700">
                              Guardian + Member
                              {guardian.member_profile.member_id
                                ? ` · ${guardian.member_profile.member_id}`
                                : ''}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-[hsl(var(--muted))]">
                              Guardian only · no member profile
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white px-4 py-4 text-sm text-[hsl(var(--muted))]">
                    No guardian account linked yet. The first account added becomes the primary guardian.
                  </div>
                )}

                {editGuardianTarget?.familyId === family.id ? (
                  <form
                    onSubmit={updateGuardian}
                    className="mt-4 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"
                  >
                    <div>
                      <div className="font-semibold text-amber-950">Edit guardian</div>
                      <p className="mt-1 text-xs text-amber-800">
                        Name and phone can be updated here. To change the login email, add the replacement guardian account first, then remove the old guardian link.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Guardian first name"
                        value={editGuardianFirstName}
                        onChange={(event) => setEditGuardianFirstName(event.target.value)}
                        maxLength={120}
                        required
                      />
                      <Input
                        label="Guardian last name"
                        value={editGuardianLastName}
                        onChange={(event) => setEditGuardianLastName(event.target.value)}
                        maxLength={120}
                      />
                      <Input
                        label="Login email"
                        type="email"
                        value={editGuardianTarget.guardian.email}
                        disabled
                        hint="Email changes use the safe replace-guardian flow."
                      />
                      <Input
                        label="Guardian phone"
                        type="tel"
                        value={editGuardianPhone}
                        onChange={(event) => setEditGuardianPhone(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(actionKey)}
                        onClick={closeGuardianEdit}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        loading={
                          actionKey ===
                          `edit-guardian:${editGuardianTarget.familyId}:${editGuardianTarget.guardian.auth_user_id}`
                        }
                        loadingText="Saving…"
                      >
                        Save guardian
                      </Button>
                    </div>
                  </form>
                ) : null}

                {parentOpen ? (
                  <form onSubmit={(event) => createGuardianAccount(event, family)} className="mt-4 grid gap-3 rounded-2xl bg-white p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Guardian first name"
                        value={parentFirstName}
                        onChange={(event) => setParentFirstName(event.target.value)}
                        maxLength={120}
                        required
                      />
                      <Input
                        label="Guardian last name"
                        value={parentLastName}
                        onChange={(event) => setParentLastName(event.target.value)}
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Guardian email"
                        type="email"
                        value={parentEmail}
                        onChange={(event) => setParentEmail(event.target.value)}
                        autoComplete="email"
                        required
                        hint="Existing ATOM accounts are reused; otherwise an invitation is sent."
                      />
                      <Input
                        label="Guardian phone"
                        type="tel"
                        value={parentPhone}
                        onChange={(event) => setParentPhone(event.target.value)}
                        autoComplete="tel"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        loading={actionKey === `guardian:${family.id}`}
                        loadingText="Creating…"
                      >
                        Create / link guardian
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
        open={Boolean(deleteFamilyTarget)}
        title="Delete family?"
        description="This deletes only the family container and its guardian links. Auth accounts and member profiles are never deleted."
        confirmLabel="Delete family"
        pendingLabel="Deleting…"
        tone="destructive"
        pending={Boolean(
          deleteFamilyTarget &&
            actionKey === `delete-family:${deleteFamilyTarget.familyId}`,
        )}
        summaryItems={
          deleteFamilyTarget
            ? [
                { label: 'Family', value: deleteFamilyTarget.familyName },
                { label: 'Members', value: String(deleteFamilyTarget.memberCount) },
                { label: 'Guardian links', value: String(deleteFamilyTarget.guardianCount) },
              ]
            : []
        }
        warning="A family with linked members cannot be deleted. Remove member links first. Guardian Auth accounts are preserved."
        onCancel={() => {
          if (!actionKey) setDeleteFamilyTarget(null)
        }}
        onConfirm={deleteFamily}
      />

      <ConfirmActionModal
        open={Boolean(promoteGuardianTarget)}
        title="Make this guardian an ATOM member?"
        description="This creates a member profile on the guardian's existing login. No second Auth account or email is created."
        confirmLabel="Make member"
        pendingLabel="Creating member…"
        pending={Boolean(
          promoteGuardianTarget &&
            actionKey ===
              `promote-member:${promoteGuardianTarget.familyId}:${promoteGuardianTarget.guardian.auth_user_id}`,
        )}
        summaryItems={
          promoteGuardianTarget
            ? [
                { label: 'Family', value: promoteGuardianTarget.familyName },
                { label: 'Guardian', value: guardianName(promoteGuardianTarget.guardian) },
                { label: 'Existing login', value: promoteGuardianTarget.guardian.email },
              ]
            : []
        }
        warning="The guardian keeps the same login and Family Dashboard access. ATOM creates only the member profile, Member ID, QR code and family-member link. No subscription is created automatically."
        onCancel={() => {
          if (!actionKey) setPromoteGuardianTarget(null)
        }}
        onConfirm={promoteGuardianToMember}
      />

      <ConfirmActionModal
        open={Boolean(cleanupTarget)}
        title="Remove unnecessary member profile?"
        description="Use this only when this parent/guardian does not train at ATOM. The guardian login and Family Dashboard access will remain active."
        confirmLabel="Remove member profile"
        pendingLabel="Removing…"
        tone="destructive"
        pending={Boolean(
          cleanupTarget &&
            actionKey ===
              `cleanup-remove:${cleanupTarget.familyId}:${cleanupTarget.guardian.auth_user_id}`,
        )}
        summaryItems={
          cleanupTarget
            ? [
                { label: 'Guardian', value: guardianName(cleanupTarget.guardian) },
                { label: 'Email', value: cleanupTarget.guardian.email },
                {
                  label: 'Member ID',
                  value:
                    cleanupPreview?.member_id ||
                    cleanupTarget.guardian.member_profile?.member_id ||
                    '—',
                },
                {
                  label: 'Dependency check',
                  value: cleanupPreview?.can_remove ? 'No member-linked data found' : 'Not cleared',
                },
              ]
            : []
        }
        warning="The member profile and its Family member link will be removed. The Supabase Auth account and guardian link are preserved. This action is blocked if any member-linked data exists."
        onCancel={() => {
          if (!actionKey) {
            setCleanupTarget(null)
            setCleanupPreview(null)
          }
        }}
        onConfirm={removeGuardianMemberProfile}
      />

      <ConfirmActionModal
        open={Boolean(primaryGuardianTarget)}
        title="Change primary guardian?"
        description="The selected account will become the family's primary guardian. All guardians keep access to the same Family Dashboard."
        confirmLabel="Make primary"
        pendingLabel="Updating…"
        pending={Boolean(
          primaryGuardianTarget &&
            actionKey === `primary:${primaryGuardianTarget.familyId}:${primaryGuardianTarget.guardian.auth_user_id}`,
        )}
        summaryItems={
          primaryGuardianTarget
            ? [
                { label: 'Family', value: primaryGuardianTarget.familyName },
                { label: 'New primary guardian', value: guardianName(primaryGuardianTarget.guardian) },
                { label: 'Email', value: primaryGuardianTarget.guardian.email },
              ]
            : []
        }
        onCancel={() => {
          if (!actionKey) setPrimaryGuardianTarget(null)
        }}
        onConfirm={setPrimaryGuardian}
      />

      <ConfirmActionModal
        open={Boolean(removeGuardianTarget)}
        title="Remove guardian access?"
        description="This removes only the guardian-to-family link. It does not delete the Auth account, member profile, subscriptions, payments or family members."
        confirmLabel="Remove guardian"
        pendingLabel="Removing…"
        tone="destructive"
        pending={Boolean(
          removeGuardianTarget &&
            actionKey === `remove-guardian:${removeGuardianTarget.familyId}:${removeGuardianTarget.guardian.auth_user_id}`,
        )}
        summaryItems={
          removeGuardianTarget
            ? [
                { label: 'Family', value: removeGuardianTarget.familyName },
                { label: 'Guardian', value: guardianName(removeGuardianTarget.guardian) },
                { label: 'Email', value: removeGuardianTarget.guardian.email },
              ]
            : []
        }
        warning="Primary guardians must be replaced before they can be removed."
        onCancel={() => {
          if (!actionKey) setRemoveGuardianTarget(null)
        }}
        onConfirm={removeGuardian}
      />

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
