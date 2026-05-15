// src/app/contact/page.tsx
import { redirect } from 'next/navigation'

export default function ContactPage() {
  redirect('/notifications?thread=admin')
}
