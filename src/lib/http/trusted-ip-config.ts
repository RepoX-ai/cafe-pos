/**
 * Startup check for the client-IP settings (see client-ip.ts), run from
 * instrumentation in production. Per-IP login limits and audit IPs silently
 * stop working when these are missing or mistyped — and trusting a header
 * the proxy doesn't actually control lets any client pick its own IP — so a
 * production process refuses to start on a missing, malformed or ambiguous
 * configuration instead of logging a warning nobody reads.
 *
 * LAN-only installs with no reverse proxy (and therefore no trustworthy
 * client IP) must say so explicitly with TRUSTED_CLIENT_IP_NONE=1.
 */
export class TrustedClientIpConfigError extends Error {}

const HEADER_TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/i;
// Headers that carry a single address only if an edge overwrites them;
// anything else is almost certainly a typo.
const KNOWN_SINGLE_ADDRESS_HEADERS = new Set(["x-real-ip", "x-forwarded-for", "cf-connecting-ip", "true-client-ip", "fly-client-ip", "x-client-ip"]);

export function assertTrustedClientIpConfig(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const header = env.TRUSTED_CLIENT_IP_HEADER?.trim();
  const proxyCount = env.TRUSTED_PROXY_COUNT?.trim();
  const none = env.TRUSTED_CLIENT_IP_NONE?.trim();

  if (none && none !== "1") {
    throw new TrustedClientIpConfigError(`TRUSTED_CLIENT_IP_NONE must be "1" or unset (got "${none}").`);
  }
  const configured = [header ? "TRUSTED_CLIENT_IP_HEADER" : null, proxyCount ? "TRUSTED_PROXY_COUNT" : null, none ? "TRUSTED_CLIENT_IP_NONE" : null].filter(Boolean);
  if (configured.length > 1) {
    throw new TrustedClientIpConfigError(`Set only one of TRUSTED_CLIENT_IP_HEADER, TRUSTED_PROXY_COUNT or TRUSTED_CLIENT_IP_NONE (found ${configured.join(", ")}).`);
  }
  if (configured.length === 0) {
    throw new TrustedClientIpConfigError(
      "No client-IP source configured. Behind a reverse proxy set TRUSTED_PROXY_COUNT or TRUSTED_CLIENT_IP_HEADER; " +
        "for a LAN-only install with no proxy set TRUSTED_CLIENT_IP_NONE=1. See docs/deployment.md § Client IP and rate limits.",
    );
  }
  if (header && (!HEADER_TOKEN.test(header) || !KNOWN_SINGLE_ADDRESS_HEADERS.has(header.toLowerCase()))) {
    throw new TrustedClientIpConfigError(
      `TRUSTED_CLIENT_IP_HEADER "${header}" is not a recognised client-IP header (${[...KNOWN_SINGLE_ADDRESS_HEADERS].join(", ")}).`,
    );
  }
  if (proxyCount && !/^([1-9])$/.test(proxyCount)) {
    throw new TrustedClientIpConfigError(`TRUSTED_PROXY_COUNT must be a whole number from 1 to 9 (got "${proxyCount}").`);
  }
}
