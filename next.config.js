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
}
module.exports = nextConfig
