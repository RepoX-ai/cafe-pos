import "server-only";
import { headers } from "next/headers";
import { clientIpConfigFromEnv, resolveClientIp } from "./client-ip";

/** Client IP (only when a trusted proxy supplies it — see client-ip.ts) and user agent, for sessions, audit, and rate limits. */
export async function getRequestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  return {
    ipAddress: resolveClientIp(headerList, clientIpConfigFromEnv()),
    userAgent: headerList.get("user-agent"),
  };
}
