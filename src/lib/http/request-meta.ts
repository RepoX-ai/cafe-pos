import "server-only";
import { headers } from "next/headers";

export async function getRequestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  return {
    ipAddress: headerList.get("x-forwarded-for"),
    userAgent: headerList.get("user-agent"),
  };
}
