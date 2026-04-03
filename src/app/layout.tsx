import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import './globals.css'
import { Poppins } from 'next/font/google'
import AppNav from '@/components/AppNav'
import ThemeProvider from '@/components/ThemeProvider'
import { Toaster } from 'sonner'
import BackButtonHandler from '@/components/BackButtonHandler'
import AuthHashRedirect from '@/components/AuthHashRedirect'
import { getSessionUserCached } from '@/lib/requestCache'
import { isScanTerminalPathAllowed, isScanTerminalRole } from '@/lib/rbac'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ATOM App',
  description: 'ATOM Jiu-Jitsu',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname')?.split('?')[0]?.trim() || null
  const user = await getSessionUserCached()
  const unlockCookie = cookies().get('atom_scan_terminal_unlock')?.value === '1'

  if (isScanTerminalRole(user?.role) && pathname) {
    const wantsLogout = pathname === '/logout'

    if (wantsLogout && !unlockCookie) {
      redirect('/scan')
    }

    if (!wantsLogout && !isScanTerminalPathAllowed(pathname)) {
      redirect('/scan')
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={poppins.className}>
        <ThemeProvider>
          <BackButtonHandler>
            <AuthHashRedirect />
            <AppNav />
            {children}
            <Toaster position="top-right" richColors expand />
          </BackButtonHandler>
        </ThemeProvider>
      </body>
    </html>
  )
}
