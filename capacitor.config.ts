import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.atomjiujitsu.app',
  appName: 'ATOM',
  webDir: 'out', // peu importe ici, on utilise surtout server.url
  server: {
    url: 'https://atom-app-one.vercel.app', // ⬅️ ton app Next déployée
    androidScheme: 'https',
  },
}

export default config
