import Button from '@/components/ui/Button'

const ITEMS = [
  { href: '/head-coach/private-coaching/bookings', label: 'Bookings' },
  { href: '/head-coach/private-coaching/requests', label: 'Requests' },
  { href: '/head-coach/private-coaching/past-session', label: 'Past session' },
  { href: '/head-coach/private-coaching/availability', label: 'Availability' },
  { href: '/head-coach/private-coaching/availability/new', label: 'Add availability' },
  { href: '/head-coach/private-coaching/promo-codes', label: 'Promo codes' },
] as const

export default function PrivateCoachingAdminSubnav() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" href="/head-coach/private-coaching">Dashboard</Button>
      {ITEMS.map((item) => (
        <Button key={item.href} asChild variant="outline" href={item.href}>{item.label}</Button>
      ))}
    </div>
  )
}
