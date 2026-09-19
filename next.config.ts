import type { NextConfig } from "next";

/**
 * Baseline browser security headers (SEC-005). CSP here is intentionally
 * permissive enough for Next.js App Router + POS Web Bluetooth without a
 * per-request nonce middleware. Follow-ups (nonce/`strict-dynamic` CSP via
 * `proxy.ts`, locking `connect-src` to known storage hosts) are noted in
 * docs/deployment.md.
 */
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js ships inline bootstrapping scripts; tighten with nonces later.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Menu photos may be served from S3-compatible storage (https).
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // App fetch + optional Sentry/storage endpoints.
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Web Bluetooth is used by the POS tablet printer path — allow only same-origin.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(self)",
  },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
