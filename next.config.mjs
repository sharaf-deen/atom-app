const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).host : undefined

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Needed for QR scanner pages
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          // Only effective on HTTPS
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
        ],
      },
    ]
  },

  images: {
    remotePatterns: SUPABASE_HOST
      ? [
          { protocol: 'https', hostname: SUPABASE_HOST, pathname: '/storage/v1/object/sign/**' },
          { protocol: 'https', hostname: SUPABASE_HOST, pathname: '/storage/v1/object/public/**' },
          { protocol: 'https', hostname: SUPABASE_HOST, pathname: '/storage/v1/render/image/**' },
        ]
      : [],
  },
}

export default nextConfig
