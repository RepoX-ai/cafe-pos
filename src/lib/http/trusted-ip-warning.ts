import { clientIpConfigFromEnv } from "./client-ip";

/**
 * Fail-soft production warning: public HTTPS deploys need a trusted client-IP
 * source so per-IP login buckets and audit IPs work. Local/dev without a
 * proxy is fine with neither set. Never throws.
 */
export function warnIfTrustedClientIpUnset(
  env: Record<string, string | undefined> = process.env,
  log: (message: string) => void = console.warn,
): void {
  if (env.NODE_ENV !== "production") return;
  const { header, proxyCount } = clientIpConfigFromEnv(env);
  if (header || proxyCount) return;
  log(
    "[cafe-pos] Production is running without TRUSTED_CLIENT_IP_HEADER or TRUSTED_PROXY_COUNT. " +
      "Per-IP login rate limits and audit IPs will be empty behind a public reverse proxy. " +
      "See docs/deployment.md § Client IP and rate limits.",
  );
}
