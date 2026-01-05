// src/components/BackButtonHandler.tsx
'use client'

import { useEffect } from 'react'
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'

// 🔁 Routes considérées comme "home"
// → Sur ces routes, on propose de QUITTER l’app au lieu de revenir à la page précédente
const HOME_ROUTES = ['/', '/profile']
// Si tu veux seulement la vraie home : const HOME_ROUTES = ['/']

export default function BackButtonHandler({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    let listener: PluginListenerHandle | undefined

    const register = async () => {
      listener = await App.addListener('backButton', (event: any) => {
        const path = window.location.pathname
        const isHome = HOME_ROUTES.includes(path)
        const canGoBack = !!event?.canGoBack || window.history.length > 1

        // 🧠 Cas 1 : on n’est PAS sur une home et on peut revenir → navigation interne
        if (!isHome && canGoBack) {
          window.history.back()
          return
        }

        // 🧠 Cas 2 : on est sur une home (ou pas d'historique) → proposer de quitter
        const shouldExit = window.confirm('Voulez-vous quitter l’application ATOM ?')
        if (shouldExit) {
          App.exitApp()
        }
      })
    }

    register().catch((err) => {
      console.error('Erreur en enregistrant le backButton handler', err)
    })

    return () => {
      if (listener) {
        listener.remove()
      }
    }
  }, [])

  return <>{children}</>
}
