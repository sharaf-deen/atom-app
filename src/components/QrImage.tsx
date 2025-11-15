// src/components/QrImage.tsx
import QRCode from 'qrcode'

export default async function QrImage({ value, size = 192 }: { value: string; size?: number }) {
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M', // bon compromis taille/robustesse
    margin: 1,
    width: size,
  })
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt="Member QR"
      width={size}
      height={size}
      className="rounded bg-white"
    />
  )
}
