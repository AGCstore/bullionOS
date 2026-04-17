import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile our workspace package so Next compiles its TS directly.
  transpilePackages: ['@agc/shared'],
  // Pin the workspace root to the monorepo. Without this, Next 15's
  // auto-detection on Windows can walk up to the drive root (E:\) and
  // try to scandir "System Volume Information", which fails with EPERM.
  outputFileTracingRoot: resolve(__dirname, '../..'),
  turbopack: {
    // Turbopack is the default dev bundler in Next 15.3+. Pin its root
    // here for the same reason as outputFileTracingRoot above.
    root: resolve(__dirname, '../..'),
  },
  async rewrites() {
    // Proxy /api/* in dev to the Nest backend, avoiding CORS in the browser.
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },
};
export default nextConfig;
