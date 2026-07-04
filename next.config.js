/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // mupdf's .wasm binary isn't picked up by Next's default file tracing —
  // without this, the extract-pdf serverless function ships without it on Vercel.
  outputFileTracingIncludes: {
    '/api/extract-pdf': ['./node_modules/mupdf/dist/*.wasm'],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pdfjs-dist is server-only — exclude from client bundle
      config.resolve.alias['pdfjs-dist'] = false
    }
    return config
  },
}
module.exports = nextConfig
