// src/components/ThemeProvider.tsx
'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"   // 🚨 toujours light par défaut
      enableSystem={false}   // 🚫 ignore le thème système (dark / light)
      forcedTheme="light"    // ✅ force le thème clair partout (local + Vercel)
    >
      {children}
    </NextThemesProvider>
  )
}
