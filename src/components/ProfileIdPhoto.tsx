// src/components/ProfileIdPhoto.tsx
'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Camera, Trash2, X } from 'lucide-react'

import Button from '@/components/ui/Button'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

type Props = { userId: string; idPhotoPath?: string | null }

const MAX_MB = 5
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export default function ProfileIdPhoto({ userId, idPhotoPath }: Props) {
  const supabase = createSupabaseBrowserClient()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<'upload' | 'delete' | ''>('')
  const [msg, setMsg] = useState<string>('')
  const [signedUrl, setSignedUrl] = useState<string>('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let mounted = true

    ;(async () => {
      if (!idPhotoPath) {
        setSignedUrl('')
        setEditing(true)
        return
      }

      const { data, error } = await supabase.storage.from('id-photos').createSignedUrl(idPhotoPath, 60 * 10)

      if (!mounted) return

      if (error) {
        setMsg(error.message)
        setSignedUrl('')
      } else {
        setSignedUrl(data?.signedUrl || '')
        setEditing(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [idPhotoPath, supabase])

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])

  function clearLocalSelection() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg('')
    const f = e.target.files?.[0]
    if (!f) return
    if (!ALLOWED.includes(f.type)) return setMsg('Allowed formats: JPG, PNG, WEBP.')
    if (f.size > MAX_MB * 1024 * 1024) return setMsg(`Maximum size is ${MAX_MB} MB.`)
    setFile(f)
  }

  async function onUpload() {
    if (!file || busy || isPending) return

    setBusyAction('upload')
    setBusy(true)
    setMsg('')

    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const objectPath = `${userId}/id-photo.${ext}`

      const { error: upErr1 } = await supabase.storage
        .from('id-photos')
        .upload(objectPath, file, { cacheControl: '3600', upsert: true, contentType: file.type })
      if (upErr1) throw upErr1

      const { error: upErr2 } = await supabase.from('profiles').update({ id_photo_path: objectPath }).eq('user_id', userId)
      if (upErr2) throw upErr2

      setMsg('Profile photo saved ✅')
      clearLocalSelection()
      startTransition(() => router.refresh())
    } catch (e: any) {
      setMsg(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
      setBusyAction('')
    }
  }

  async function onDelete() {
    if (!idPhotoPath || busy || isPending) return

    setBusyAction('delete')
    setBusy(true)
    setMsg('')

    try {
      const { error: delErr } = await supabase.storage.from('id-photos').remove([idPhotoPath])
      if (delErr) throw delErr

      const { error: upErr } = await supabase.from('profiles').update({ id_photo_path: null }).eq('user_id', userId)
      if (upErr) throw upErr

      clearLocalSelection()
      setMsg('Photo removed.')
      startTransition(() => router.refresh())
    } catch (e: any) {
      setMsg(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
      setBusyAction('')
    }
  }

  function closeEditor() {
    if (busy || isPending) return
    clearLocalSelection()
    setEditing(false)
    setMsg('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative h-28 w-28 overflow-hidden rounded-xl border bg-white">
          {preview ? (
            <Image src={preview} alt="Preview" fill className="object-cover" unoptimized />
          ) : signedUrl ? (
            <Image src={signedUrl} alt="Profile photo" fill className="object-cover" unoptimized />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm text-gray-500">No photo</div>
          )}
        </div>

        <div className="flex-1 space-y-2">
          {editing ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED.join(',')}
                onChange={onPick}
                disabled={busy || isPending}
                className="block"
              />
              <div className="text-xs text-muted-foreground">
                Formats: JPG / PNG / WEBP — Max size: {MAX_MB} MB — Recommended ratio: 1:1
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={onUpload} disabled={!file || busy || isPending} loading={busyAction === 'upload'} loadingText="Saving...">
                  Save photo
                </Button>

                {(signedUrl || idPhotoPath) ? (
                  <Button variant="outline" onClick={closeEditor} disabled={busy || isPending}>
                    <X size={16} strokeWidth={2} />
                    Cancel
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(true)} disabled={busy || isPending}>
                <Camera size={16} strokeWidth={2} />
                Change photo
              </Button>

              {(signedUrl || idPhotoPath) ? (
                <Button
                  variant="outline"
                  onClick={onDelete}
                  disabled={busy || isPending}
                  loading={busyAction === 'delete'}
                  loadingText="Saving..."
                  className="border-red-500 text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={16} strokeWidth={2} />
                  Remove photo
                </Button>
              ) : null}
            </div>
          )}

          {busy ? (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted))]">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--muted))]" />
              {busyAction === 'delete' ? 'Saving...' : 'Saving...'}
            </div>
          ) : null}

          {!!msg && !busy ? <div className="text-sm">{msg}</div> : null}
        </div>
      </div>
    </div>
  )
}
