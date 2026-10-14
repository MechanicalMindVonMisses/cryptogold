import type { NextConfig } from "next";

/** Public host, e.g. "www.cryptogold.me". Requests for the bare domain are redirected to it. */
const publicHost = process.env.PUBLIC_HOST?.trim() || null;
const apexHost = publicHost?.startsWith("www.") ? publicHost.slice(4) : null;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
  async redirects() {
    if (!apexHost || !publicHost) return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: apexHost }],
        destination: `https://${publicHost}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
