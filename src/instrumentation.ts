/**
 * Next.js instrumentation hook — runs once when the Node server process
 * starts. Configuration that would make production silently unsafe or
 * silently wrong stops the process here instead: the auth pepper, the
 * trusted client-IP source, the printer provider, the timezone, and the
 * database pool / export limits (each validator throws on a bad value).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertAuthSecretConfigured } = await import("@/lib/auth/secret");
  assertAuthSecretConfigured();

  const { assertTrustedClientIpConfig } = await import("@/lib/http/trusted-ip-config");
  assertTrustedClientIpConfig();

  const { assertBusinessTimezoneConfig } = await import("@/lib/dates/dates");
  assertBusinessTimezoneConfig();

  const { resolvePoolSettings } = await import("@/lib/db/pool-config");
  resolvePoolSettings("app");
  resolvePoolSettings("reports");

  const { exportLimitsFromEnv } = await import("@/server/services/report-exports");
  exportLimitsFromEnv();

  const { resolvePrintProvider } = await import("@/printing");
  resolvePrintProvider();

  const { log } = await import("@/lib/observability/log");
  if (process.env.SENTRY_DSN) {
    // There is no Sentry integration in this codebase; say so rather than
    // let a configured DSN look like working error monitoring.
    log("warn", "config.sentry_dsn_ignored", {
      message: "SENTRY_DSN is set but not supported. Server errors are logged as JSON (event request.error) to stdout; ship those logs instead.",
    });
  }
}

/**
 * Every uncaught server error (render, route handler, server action) as one
 * structured log line. The message and stack are included, but never
 * request headers, cookies, bodies or SQL parameters.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { describeError, log } = await import("@/lib/observability/log");
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  log("error", "request.error", {
    method: request.method,
    // Path without the query string, which can carry filters and ids.
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
    ...describeError(error),
    stack: error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : undefined,
  });
}
