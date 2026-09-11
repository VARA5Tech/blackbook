import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits .next/standalone: a self-contained server with only the packages it
   * actually uses. That is what the Docker image runs, and it is why the final
   * image does not need node_modules or pnpm.
   */
  output: "standalone",

  /**
   * The app is served behind Dokploy's Traefik proxy, which terminates TLS.
   * Next needs to know the real protocol and host so redirects and auth
   * cookies are built against https://blackbook.vara5.travel rather than the
   * container's internal address.
   */
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
