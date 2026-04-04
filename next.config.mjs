/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Hide the floating “N” dev badge — Turbopack can leave it on “compiling” while the app is already usable. */
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
