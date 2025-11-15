import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.atomjiujitsu.app',
  appName: 'ATOM',
  webDir: 'out', // on laisse "out", mais on ne fera PAS de next export
  server: {
    // 🔹 pour les tests sur émulateur :
    // url: 'http://10.0.2.2:3000',
    // cleartext: true,

    // 🔹 pour la version Play Store (quand ton site sera déployé) :
    url: 'https://TON-DOMAINE-OU-VERCEL-APP', // ex: https://atom-app.vercel.app
    cleartext: false
  },
  ios: { contentInset: 'always' },
  android: { allowMixedContent: true },
}

export default config
