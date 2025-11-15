// src/components/ProfileIdPhoto.tsx
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import Button from '@/components/ui/Button'
import { Camera, Trash2, Save, X } from 'lucide-react'

type Props = { userId: string; idPhotoPath?: string | null }

const MAX_MB = 5
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export default function ProfileIdPhoto({ userId, idPhotoPath }: Props) {
  const supabase = createSupabaseBrowserClient()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
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
      const { data, error } = await supabase.storage
        .from('id-photos')
        .createSignedUrl(idPhotoPath, 60 * 10)
      if (!mounted) return
      if (error) {
        setMsg(error.message)
        setSignedUrl('')
      } else {
        setSignedUrl(data?.signedUrl || '')
        setEditing(false)
      }
    })()
    return () => { mounted = false }
  }, [idPhotoPath, supabase])

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg('')
    const f = e.target.files?.[0]
    if (!f) return
    if (!ALLOWED.includes(f.type)) return setMsg('Allowed formats: JPG, PNG, WEBP.')
    if (f.size > MAX_MB * 1024 * 1024) return setMsg(`Maximum size is ${MAX_MB} MB.`)
    setFile(f)
  }

  async function onUpload() {
    if (!file) return
    setBusy(true); setMsg('')
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const objectPath = `${userId}/id-photo.${ext}`

      const { error: upErr1 } = await supabase.storage
        .from('id-photos')
        .upload(objectPath, file, { cacheControl: '3600', upsert: true, contentType: file.type })
      if (upErr1) throw upErr1

      const { error: upErr2 } = await supabase
        .from('profiles')
        .update({ id_photo_path: objectPath })
        .eq('user_id', userId)
      if (upErr2) throw upErr2

      setMsg('Profile photo saved ✅'); setFile(null)
      startTransition(() => router.refresh())
    } catch (e: any) {
      setMsg(e?.message || 'Upload failed')
    } finally { setBusy(false) }
  }

  async function onDelete() {
    if (!idPhotoPath) return
    setBusy(true); setMsg('')
    try {
      const { error: delErr } = await supabase.storage.from('id-photos').remove([idPhotoPath])
      if (delErr) throw delErr
      const { error: upErr } = await supabase.from('profiles').update({ id_photo_path: null }).eq('user_id', userId)
      if (upErr) throw upErr
      setMsg('Photo removed.')
      startTransition(() => router.refresh())
    } catch (e: any) {
      setMsg(e?.message || 'Delete failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative w-28 h-28 rounded-xl overflow-hidden border bg-white">
          {preview ? (
            <Image src={preview} alt="Preview" fill className="object-cover" unoptimized />
          ) : signedUrl ? (
            <Image src={signedUrl} alt="Profile photo" fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full grid place-items-center text-sm text-gray-500">No photo</div>
          )}
        </div>

        <div className="flex-1 space-y-2">
          {editing ? (
            <>
              <input
                type="file"
                accept={ALLOWED.join(',')}
                onChange={onPick}
                disabled={busy || isPending}
                className="block"
              />
              <div className="text-xs text-muted-foreground">
                Formats: JPG / PNG / WEBP — Max size: {MAX_MB} MB — Recommended ratio: 1:1
              </div>
              <div className="flex gap-2">
                {/* SAVE (icon-only) */}
                <button
                  onClick={onUpload}
                  disabled={!file || busy || isPending}
                  aria-label="Save photo"
                  title="Save photo"
                  className="p-2 h-9 w-9 flex items-center justify-center rounded-md bg-black text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Save size={18} strokeWidth={2} color="#ffffff" />
                </button>

                {(signedUrl || idPhotoPath) && (
                  <button
                    onClick={() => setEditing(false)}
                    disabled={busy || isPending}
                    aria-label="Cancel"
                    title="Cancel"
                    className="p-2 h-9 w-9 flex items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <X size={18} strokeWidth={2} color="#374151" />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {/* CHANGE (icon-only) */}
              <button
                onClick={() => setEditing(true)}
                disabled={busy || isPending}
                aria-label="Change photo"
                title="Change photo"
                className="p-2 h-9 w-9 flex items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Camera size={18} strokeWidth={2} color="#374151" />
              </button>

              {(signedUrl || idPhotoPath) && (
                <button
                  onClick={onDelete}
                  disabled={busy || isPending}
                  aria-label="Remove photo"
                  title="Remove photo"
                  className="p-2 h-9 w-9 flex items-center justify-center rounded-md border border-red-500 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={18} strokeWidth={2} color="#dc2626" />
                </button>
              )}
            </div>
          )}

          {!!msg && <div className="text-sm">{msg}</div>}
        </div>
      </div>
    </div>
  )
}
