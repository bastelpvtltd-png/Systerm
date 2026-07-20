/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // mupdf's and tesseract.js-core's .wasm binaries aren't picked up by Next's
  // default file tracing — without this, the extract-pdf serverless function
  // ships without them on Vercel.
  experimental: {
    outputFileTracingIncludes: {
      '/api/extract-pdf': [
        './node_modules/mupdf/dist/mupdf-wasm.wasm',
        './node_modules/tesseract.js-core/tesseract-core.js',
        './node_modules/tesseract.js-core/tesseract-core.wasm',
        './node_modules/tesseract.js-core/tesseract-core.wasm.js',
        './node_modules/tesseract.js-core/tesseract-core-lstm.js',
        './node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
        './node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
        './node_modules/tesseract.js-core/tesseract-core-simd.js',
        './node_modules/tesseract.js-core/tesseract-core-simd.wasm',
        './node_modules/tesseract.js-core/tesseract-core-simd.wasm.js',
        './node_modules/tesseract.js-core/tesseract-core-simd-lstm.js',
        './node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
        './node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
        './node_modules/tesseract.js-core/tesseract-core-relaxedsimd.js',
        './node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm',
        './node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js',
        './node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js',
        './node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
        './node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
      ],
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pdfjs-dist is server-only — exclude from client bundle
      config.resolve.alias['pdfjs-dist'] = false
    }
    return config
  },
  // Bare aliases for every page under /admin/* — lets non-admin users (whose
  // access is scoped via profiles.allowed_tabs) browse without ever seeing
  // "/admin" in the address bar. This only masks the URL; it does NOT grant
  // access on its own — AdminLayout still gates every one of these pages by
  // is_admin / allowed_tabs regardless of which alias was used to reach it.
  async rewrites() {
    const adminPages = [
      'dashboard', 'my-tasks', 'shipment-entry', 'upload-docs', 'shipment-overview',
      'docs-create', 'templates', 'automation', 'database', 'financials',
      'reports', 'users', 'settings', 'google-reauth',
    ]
    return adminPages.map(p => ({ source: `/${p}`, destination: `/admin/${p}` }))
  },
}
module.exports = nextConfig
