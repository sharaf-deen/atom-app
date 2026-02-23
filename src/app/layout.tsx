// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'
import { Poppins } from 'next/font/google'
import AppNav from '@/components/AppNav'
import ThemeProvider from '@/components/ThemeProvider'
import { Toaster } from 'sonner'
import BackButtonHandler from '@/components/BackButtonHandler'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ATOM App',
  description: 'ATOM Jiu-Jitsu',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={poppins.className}>
        <ThemeProvider>
          <BackButtonHandler>
            <AppNav />
            {children}
            <Toaster position="top-right" richColors expand />
          </BackButtonHandler>
        </ThemeProvider>
      </body>
    </html>
  )
}
