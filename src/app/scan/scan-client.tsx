'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function ScanClient() {
  const [msg, setMsg] = useState('Point the camera at a member QR…');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastCodeRef = useRef<string>('');
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // l'id DOIT matcher le 1er argument du scanner
    const elementId = 'qr-reader';

    const scanner = new Html5QrcodeScanner(
      elementId,
      { fps: 10, qrbox: 250 },
      /* verbose */ false
    );

    const onScanSuccess = async (decodedText: string) => {
      // anti-double scan: 2s
      const now = Date.now();
      if (decodedText === lastCodeRef.current && now - lastTimeRef.current < 2000) return;
      lastCodeRef.current = decodedText;
      lastTimeRef.current = now;

      setBusy(true);
      setMsg('Checking access…');
      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: decodedText }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok) {
          setMsg(`✅ ${json.message || 'Access granted'}`);
        } else {
          setMsg(`❌ ${json?.message || 'Access denied'}`);
        }
      } catch {
        setMsg('❌ Error verifying QR');
      } finally {
        setBusy(false);
      }
    };

    const onScanFailure = (_err: unknown) => {
      // erreurs normales de lecture, on ignore pour éviter le spam
    };

    scanner.render(onScanSuccess, onScanFailure);

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Entrance Scanner</h1>
      {/* IMPORTANT: l'id ci-dessous doit être "qr-reader" */}
      <div id="qr-reader" ref={containerRef} />
      <div
        className={`p-3 rounded border ${
          msg.startsWith('✅') ? 'bg-green-50 border-green-300' :
          msg.startsWith('❌') ? 'bg-red-50 border-red-300' :
          'bg-white'
        }`}
      >
        {busy ? 'Working… ' : null}{msg}
      </div>
      <p className="text-xs text-gray-500">If prompted, allow camera access.</p>
    </main>
  );
}
