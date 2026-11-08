import { redirect } from 'next/navigation'
// Monthly coaching totals are entered centrally by Super Admin from WhatsApp messages.
// Legacy self-service route is deliberately disabled.
export default function Page() { redirect('/coach-operations/programs') }
