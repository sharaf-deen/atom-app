'use client';

import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

export default function MemberQR({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const downloadPNG = () => {
    if (!canvasRef.current) return;
    // toDataURL -> crée une URL base64 PNG
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'atomjj-qr.png';
    // Safari fix
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="inline-flex items-center gap-3">
      {/* On obtient la <canvas> via ref prop de QRCodeCanvas */}
      <div className="inline-block p-3 border rounded bg-white">
        <QRCodeCanvas
          value={value}
          size={192}
          includeMargin
          // @ts-ignore - qrcode.react accepte bien ref sur le canvas
          ref={canvasRef}
        />
      </div>

      <button
        type="button"
        onClick={downloadPNG}
        className="border rounded px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm"
        aria-label="Download QR as PNG"
        title="Download QR as PNG"
      >
        Download PNG
      </button>
    </div>
  );
}
