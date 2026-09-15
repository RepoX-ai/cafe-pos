import { isIP } from "node:net";

/**
 * Which request header, if any, can be trusted to carry the real client IP.
 * Forwarding headers are client-controlled unless a proxy you operate
 * overwrites or appends them, so nothing is trusted by default.
 *
 * - `TRUSTED_CLIENT_IP_HEADER`: a single-address header your edge always
 *   overwrites (Vercel: `x-forwarded-for`; Nginx with
 *   `proxy_set_header X-Real-IP $remote_addr`: `x-real-ip`).
 * - `TRUSTED_PROXY_COUNT`: number of proxies you operate that each append to
 *   `X-Forwarded-For` (Nginx `$proxy_add_x_forwarded_for` = 1). The client is
 *   the entry that many positions from the right; anything to its left was
 *   supplied by the client and is ignored.
 *
 * With neither set, no client IP is known: IP-based login limits are skipped
 * (account limits still apply) and audit rows record no IP.
 */
export interface ClientIpConfig {
  header?: string;
  proxyCount?: number;
}

export function clientIpConfigFromEnv(env: Record<string, string | undefined> = process.env): ClientIpConfig {
  const header = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase() || undefined;
  const proxyCount = Number(env.TRUSTED_PROXY_COUNT);
  return { header, proxyCount: Number.isInteger(proxyCount) && proxyCount > 0 ? proxyCount : undefined };
}

export function resolveClientIp(headers: { get(name: string): string | null }, config: ClientIpConfig): string | null {
  if (config.header) {
    // A list here means the edge appended instead of overwriting — not trustworthy.
    const value = headers.get(config.header)?.trim();
    return value && isIP(value) ? value : null;
  }
  if (config.proxyCount) {
    const chain = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const candidate = chain[chain.length - config.proxyCount];
    return candidate && isIP(candidate) ? candidate : null;
  }
  return null;
}
