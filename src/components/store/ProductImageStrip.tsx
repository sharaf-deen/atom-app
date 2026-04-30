'use client'

import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'

type ProductImageStripProps = {
  name: string
  imageUrls: Array<string | null | undefined>
}

export default function ProductImageStrip({ name, imageUrls }: ProductImageStripProps) {
  const photos = useMemo(
    () =>
      imageUrls
        .map((url, index) => ({ id: `photo-${index + 1}`, url: String(url ?? '').trim(), index }))
        .filter((item) => item.url),
    [imageUrls]
  )

  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (photos.length === 0) return null

  const activePhoto = activeIndex === null ? null : photos[activeIndex] ?? null

  return (
    <>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {photos.map((photo, photoIndex) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setActiveIndex(photoIndex)}
            className="group overflow-hidden rounded-xl border bg-white transition hover:border-black focus:outline-none focus:ring-2 focus:ring-black/20"
            aria-label={`Open ${name} photo ${photoIndex + 1}`}
            title={`Open photo ${photoIndex + 1}`}
          >
            <img
              src={photo.url}
              alt={`${name} photo ${photoIndex + 1}`}
              className="h-12 w-12 object-cover transition group-hover:scale-[1.03]"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      <Modal
        open={activePhoto !== null}
        onClose={() => setActiveIndex(null)}
        title={activePhoto ? `${name} · Photo ${activePhoto.index + 1}` : name}
        className="w-[min(96vw,72rem)] p-4"
      >
        {activePhoto ? (
          <div className="flex max-h-[80vh] items-center justify-center overflow-hidden rounded-2xl bg-black/5 p-2">
            <img
              src={activePhoto.url}
              alt={`${name} full photo ${activePhoto.index + 1}`}
              className="max-h-[72vh] w-auto max-w-full rounded-xl object-contain"
            />
          </div>
        ) : null}
      </Modal>
    </>
  )
}
