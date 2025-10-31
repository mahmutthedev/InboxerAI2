/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true,
    esmExternals: "loose",
    serverComponentsExternalPackages: ["openai", "@qdrant/js-client-rest"],
  },
  webpack: (config) => {
    config.externals ??= []
    config.externals.push({ undici: "undici" })
    return config
  },
}

export default nextConfig
