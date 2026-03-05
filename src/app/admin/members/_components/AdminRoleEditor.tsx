'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import type { Role } from '@/lib/session'

export type RoleOption = { id: Role; label: string }

type Props = {
  userId: string
  currentRole: Role
  options: RoleOption[]
  compact?: boolean
  className?: string
}

function isRole(v: unknown): v is Role {
  return (
    v === 'member' ||
    v === 'assistant_coach' ||
    v === 'coach' ||
    v === 'reception' ||
    v === 'admin' ||
    v === 'super_admin'
  )
}

export default function AdminRoleEditor({ userId, currentRole, options, compact, className }: Props) {
  const initial = (currentRole ?? 'member') as Role
  const [savedRole, setSavedRole] = useState<Role>(initial)
  const [role, setRole] = useState<Role>(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const roleOptions = useMemo(() => {
    // Ensure we never render invalid options.
    const safe = (options ?? []).filter((o) => isRole(o?.id) && typeof o?.label === 'string')
    return safe.length ? safe : ([
      { id: 'member', label: 'Member' },
      { id: 'assistant_coach', label: 'Assistant Coach' },
      { id: 'coach', label: 'Coach' },
      { id: 'reception', label: 'Reception' },
      { id: 'admin', label: 'Admin' },
      { id: 'super_admin', label: 'Super Admin' },
    ] as RoleOption[])
  }, [options])

  const dirty = role !== savedRole

  async function onSave() {
    if (!dirty || saving) return

    setSaving(true)
    setMsg(null)
    setIsError(false)

    try {
      const res = await fetch('/api/admin/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role }),
      })

      const json = (await res.json().catch(() => null)) as any

      if (!res.ok || !json?.ok) {
        const err = String(json?.error ?? json?.details ?? 'FAILED')
        setIsError(true)
        setMsg(err)
        // Roll back UI to the last saved role.
        setRole(savedRole)
        return
      }

      setSavedRole(role)
      setIsError(false)
      setMsg('Saved')

      // Clear success msg quickly (no toast dependency).
      window.setTimeout(() => setMsg(null), 1200)
    } catch (e: any) {
      setIsError(true)
      setMsg(e?.message || 'NETWORK_ERROR')
      setRole(savedRole)
    } finally {
      setSaving(false)
    }
  }

  const selectCls =
    'rounded-xl border border-[hsl(var(--border))] bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]'
  const sizeCls = compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`.trim()}>
      <select
        className={`${selectCls} ${sizeCls}`}
        value={role}
        onChange={(e) => {
          const v = e.target.value
          if (isRole(v)) {
            setRole(v)
            setMsg(null)
          }
        }}
        disabled={saving}
        aria-label="Role"
      >
        {roleOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>

      <Button
        type="button"
        variant="outline"
        size={compact ? 'sm' : 'md'}
        loading={saving}
        disabled={!dirty || saving}
        onClick={onSave}
        className={compact ? 'rounded-xl' : ''}
      >
        Save
      </Button>

      {msg ? (
        <span className={`text-[11px] ${isError ? 'text-rose-700' : 'text-emerald-600'}`}>{msg}</span>
      ) : null}
    </div>
  )
}
