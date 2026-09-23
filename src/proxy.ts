import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request nonce Content-Security-Policy (see the installed Next.js
 * guide, 02-guides/content-security-policy.md). Next.js puts the nonce on
 * its own scripts; the only other inline script, next-themes', gets it from
 * the root layout. `'strict-dynamic'` lets those trusted scripts load the
 * app's chunks, so `script-src` needs no `'unsafe-inline'` in production.
 *
 * Still permissive, deliberately: `style-src 'unsafe-inline'` (Tailwind
 * style attributes, and the receipt popup builds a <style> element in an
 * about:blank window that inherits this policy) and `img-src https:` (menu
 * photos can be pasted URLs on any host). CSP is defence in depth — it is
 * not a substitute for escaping output, which React does, or for the
 * server-side validation on every action.
 *
 * Auth is not done here: every page and action checks its own permission
 * (docs/security-ops-notes.md, CQ-002).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only for an HTTPS site. On a plain-HTTP origin (a LAN-only install, or
    // local testing) browsers would rewrite every script and stylesheet to
    // https:// and the app would never load.
    ...(process.env.APP_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Documents only: not static assets, images, media files or API routes
      // (a CSV export has no scripts to govern), and not link prefetches.
      source: "/((?!api|_next/static|_next/image|media|favicon.ico|images|uploads).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
