import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import QrCard from '@/components/QrCard'
import ProfileSubscriptions from '@/components/ProfileSubscriptions'
import ProfileIdPhoto from '@/components/ProfileIdPhoto'
import Image from 'next/image'
import { createSupabaseRSC } from '@/lib/supabaseServer'

export default async function ProfilePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const canShowQR = ['member', 'assistant_coach', 'coach'].includes(user.role)
  const canShowSubscriptions = user.role === 'member'

  // Server-side signed URL for avatar in the info card
  let signedAvatar = ''
  if (user.id_photo_path) {
    const supabase = createSupabaseRSC()
    const { data, error } = await supabase.storage
      .from('id-photos')
      .createSignedUrl(user.id_photo_path, 60 * 10)
    if (!error && data?.signedUrl) {
      signedAvatar = data.signedUrl
    }
  }

  return (
    <main>
      <PageHeader
        title="Profile"
        subtitle="Your informations and access"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Role: {user.role}</Badge>
            {user.member_id && <Badge>ID: {user.member_id}</Badge>}
          </div>
        }
      />

      <Section className="space-y-6">
        {/* Basic info with avatar at left */}
        <Card>
          <CardContent className="space-y-6">
            {/* Photo centrée + actions en dessous */}
            <div className="flex flex-col items-center justify-center">
              <ProfileIdPhoto userId={user.id} idPhotoPath={user.id_photo_path} />
            </div>

            {/* Bloc d’infos structuré */}
            <div className="rounded-xl border bg-card/50 p-4 sm:p-6">
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {/* Full name */}
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Full name
                  </dt>
                  <dd
                    className="text-base sm:text-lg font-medium text-foreground truncate"
                    title={user.full_name ?? '—'}
                  >
                    {user.full_name ?? '—'}
                  </dd>
                </div>

                {/* Email */}
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Email
                  </dt>
                  <dd
                    className="text-base text-foreground truncate"
                    title={user.email ?? '—'}
                  >
                    {user.email ?? '—'}
                  </dd>
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Phone
                  </dt>
                  <dd
                    className="text-base text-foreground truncate"
                    title={user.phone ?? '—'}
                  >
                    {user.phone ?? '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>


        {/* Access QR */}
        {canShowQR && !!user.qr_code && (
          <QrCard value={user.qr_code} title="My Access QR" size={220} />
        )}

        {/* Subscriptions */}
        {canShowSubscriptions && <ProfileSubscriptions />}
      </Section>
    </main>
  )
}
