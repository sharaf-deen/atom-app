// src/components/store/AdminProductQuickEdit.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import { STORE_PRODUCT_IMAGE_MAX_BYTES } from '@/lib/storeProductImages'

type Props = {
  id: string
  inventoryQty: number
  isActive: boolean
  imageUrl?: string | null
  hasImage?: boolean
  productName?: string
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AdminProductQuickEdit({
  id,
  inventoryQty,
  isActive,
  imageUrl,
  hasImage,
  productName,
}: Props) {
  const router = useRouter()
  const [qty, setQty] = useState<number>(Number.isFinite(inventoryQty) ? inventoryQty : 0)
  const [active, setActive] = useState<boolean>(!!isActive)
  const [loading, setLoading] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)

  const dirty = useMemo(() => qty !== inventoryQty || active !== isActive, [qty, inventoryQty, active, isActive])
  const previewUrl = useMemo(() => (selectedImage ? URL.createObjectURL(selectedImage) : null), [selectedImage])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function save() {
    if (!dirty || loading) return
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('Inventory must be a non-negative number')
      return
    }

    setLoading(true)
    try {
      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, inventory_qty: Math.floor(qty), is_active: active }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))

      if (!r.ok || !j?.ok) {
        toast.error(j?.details || j?.error || 'Update failed')
        return
      }

      toast.success('Product updated')
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  async function savePhoto(remove = false) {
    if (imageBusy) return
    if (!remove && !selectedImage) {
      toast.error('Select an image first')
      return
    }
    if (selectedImage && selectedImage.size > STORE_PRODUCT_IMAGE_MAX_BYTES) {
      toast.error(`Image is too large (max ${formatBytes(STORE_PRODUCT_IMAGE_MAX_BYTES)})`)
      return
    }

    setImageBusy(true)
    try {
      const form = new FormData()
      form.set('id', id)
      if (selectedImage) form.set('image', selectedImage)
      if (remove) form.set('remove_image', 'true')

      const r = await fetch('/api/store/products/update', {
        method: 'PATCH',
        body: form,
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        toast.error(j?.details || j?.error || 'Photo update failed')
        return
      }

      toast.success(remove ? 'Photo removed' : 'Photo updated')
      setSelectedImage(null)
      router.refresh()
      setTimeout(() => router.refresh(), 250)
    } catch (e: any) {
      toast.error(e?.message || 'Network error')
    } finally {
      setImageBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-[hsl(var(--muted))]">Inventory</label>
          <input
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="rounded-xl border px-3 py-2 text-sm bg-white w-[120px]"
          />
        </div>

        <label className="flex items-center gap-2 text-sm select-none pb-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          Active
        </label>

        <Button onClick={save} disabled={!dirty || loading} className="h-[40px]">
          {loading ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="rounded-2xl border bg-white p-3 space-y-3">
        <div className="text-xs font-medium text-[hsl(var(--muted))]">Photo</div>

        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${productName || 'Product'} preview`}
            className="h-40 w-full rounded-xl border object-cover bg-[hsl(var(--bg))]"
          />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={productName || 'Product'}
            className="h-40 w-full rounded-xl border object-cover bg-[hsl(var(--bg))]"
          />
        ) : (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-xs text-[hsl(var(--muted))] bg-[hsl(var(--bg))]">
            No photo
          </div>
        )}

        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={imageBusy}
          onChange={(e) => setSelectedImage(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />

        {selectedImage ? (
          <div className="text-xs text-[hsl(var(--muted))]">
            Selected: {selectedImage.name} · {formatBytes(selectedImage.size)}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => savePhoto(false)} disabled={imageBusy || !selectedImage}>
            {imageBusy ? 'Saving…' : hasImage ? 'Replace photo' : 'Add photo'}
          </Button>
          {hasImage ? (
            <Button type="button" variant="outline" onClick={() => savePhoto(true)} disabled={imageBusy}>
              Remove photo
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
