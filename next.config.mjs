const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).host : undefined

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Reduce client bundles by rewriting imports to per-module where supported.
    // Works especially well for icon libraries and utility libs.
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
  // Remove console.* from production client bundles (keep console.error)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
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
