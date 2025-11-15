# ATOM — Design unifié (UI + layout + dark mode)

## Installation
1) Copier ces fichiers dans votre projet (mêmes chemins).
2) Installer la dépendance:
   ```bash
   npm i next-themes
   ```
3) Mettre `public/LogoAtomWhite.svg` (logo inversé blanc).
4) Dans `src/app/layout.tsx`, envelopper l'app :
   ```tsx
   import ThemeProvider from '@/components/ThemeProvider'
   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html lang="en" suppressHydrationWarning>
         <body>
           <ThemeProvider>
             <AppNav />
             {children}
           </ThemeProvider>
         </body>
       </html>
     )
   }
   ```

## Utilisation
- Commencez chaque page avec `PageHeader`, puis placez votre contenu dans `Section`.
- Utilisez les primitives `Button`, `Card`, `Input`, `Select`, `Textarea`, `Badge`, `Table`, `Modal`.
- Le `TreeMenu` gère l'overlay global (dim) et reste cliquable en toutes circonstances.

## Exemples
Regardez `examples/pages/*` pour un squelette liste et formulaire.
