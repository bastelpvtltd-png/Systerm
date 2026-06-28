/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pdfjs-dist is server-only — exclude from client bundle
      config.resolve.alias['pdfjs-dist'] = false
    }
    return config
  },
}
module.exports = nextConfig
