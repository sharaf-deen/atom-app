// src/app/auth/set-password/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

export default function SetPasswordPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    if (pwd.length < 8) return setMsg('Password must be at least 8 characters.')
    if (pwd !== pwd2) return setMsg('Passwords do not match.')

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) {
        setMsg(error.message)
        return
      }
      setMsg('Password set ✓ Redirecting…')
      setTimeout(() => router.replace('/profile'), 700)
    } catch {
      setMsg('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-3">Set your password</h1>
      <form onSubmit={onSubmit} className="grid gap-3 border rounded-xl p-4 bg-white">
        <label className="grid gap-1">
          <span className="text-sm">New password</span>
          <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} className="px-3 py-2 border rounded" />
        </label>
        <label className="grid gap-1">
          <span className="text-sm">Confirm password</span>
          <input type="password" value={pwd2} onChange={e=>setPwd2(e.target.value)} className="px-3 py-2 border rounded" />
        </label>
        <button disabled={busy} className="px-4 py-2 border rounded hover:bg-gray-50">
          {busy ? 'Saving…' : 'Save password'}
        </button>
        {!!msg && <div className="text-sm">{msg}</div>}
      </form>
    </main>
  )
}
