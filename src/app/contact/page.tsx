// src/app/contact/page.tsx
// Page Contact (membre) — Freeze request supprimé
//
// ✅ On réutilise maintenant le composant ContactForm unique (src/components/ContactForm.tsx)
// pour éviter les doublons de logique et les oublis.

import ContactForm from '@/components/ContactForm'

export default function ContactPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <ContactForm />
    </div>
  )
}
