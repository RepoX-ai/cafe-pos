import type { NextConfig } from "next";

/**
 * Baseline browser security headers (SEC-005). The Content-Security-Policy
 * is not here: it carries a per-request nonce, so `src/proxy.ts` sets it on
 * every document response.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Web Bluetooth is used by the POS tablet printer path — allow only same-origin.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(self)",
  },
];

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
